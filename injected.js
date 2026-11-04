(() => {
  'use strict';

  console.log('[AutoSkipAds] Main World Core Engine active.');

  // Hook EventTarget.prototype.addEventListener to capture YouTube click handlers
  const originalAEL = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if ((type === 'click' || type === 'pointerup') && listener) {
      try {
        if (!this.__ytClickListeners) {
          this.__ytClickListeners = [];
        }
        if (!this.__ytClickListeners.includes(listener)) {
          this.__ytClickListeners.push(listener);
        }
      } catch (e) {}
    }
    return originalAEL.call(this, type, listener, options);
  };

  const SKIP_SELECTORS = [
    'button.ytp-skip-ad-button',
    'button.ytp-skip-ad-button-fix-fullscreen-grid',
    'button.ytp-ad-skip-button-modern',
    'button.ytp-ad-skip-button',
    'button[id^="skip-button:"]',
    '.ytp-skip-ad-button',
    '.ytp-skip-ad-button-fix-fullscreen-grid',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button',
    'button[aria-label*="Skip"]',
    'button[aria-label*="Lewati"]',
    '[id^="skip-button:"] button',
    '[id^="skip-button:"]'
  ];

  function createTrustedProxyEvent(targetEl) {
    const realEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    });

    return new Proxy(realEvent, {
      get(target, prop) {
        if (prop === 'isTrusted') return true;
        if (prop === 'target' || prop === 'currentTarget') return targetEl;
        if (prop === 'composedPath') {
          return () => [targetEl, targetEl.parentElement, document.body, document, window];
        }
        const val = Reflect.get(target, prop);
        return typeof val === 'function' ? val.bind(target) : val;
      }
    });
  }

  function invokeListenersOn(el, proxyEvent) {
    if (!el) return false;
    let invoked = false;

    if (el.__ytClickListeners && el.__ytClickListeners.length > 0) {
      for (const fn of el.__ytClickListeners) {
        try {
          if (typeof fn === 'function') {
            fn.call(el, proxyEvent);
            invoked = true;
          } else if (fn && typeof fn.handleEvent === 'function') {
            fn.handleEvent(proxyEvent);
            invoked = true;
          }
        } catch (e) {}
      }
    }

    return invoked;
  }

  function executeSkip(btn) {
    if (!btn) return false;

    if (document.documentElement.dataset.autoSkipEnabled === 'false') {
      return false;
    }

    console.log('[AutoSkipAds] Executing trusted Proxy skip on:', btn.className || btn.id);
    const proxyEvent = createTrustedProxyEvent(btn);
    let success = false;

    // 1. Invoke captured listeners directly on the button
    if (invokeListenersOn(btn, proxyEvent)) {
      success = true;
    }

    // 2. Invoke listeners on inner text div or children
    const innerText = btn.querySelector('.ytp-skip-ad-button__text, [class*="skip-button__text"], div, span');
    if (innerText && invokeListenersOn(innerText, proxyEvent)) {
      success = true;
    }

    // 3. Invoke listeners on parent container
    if (btn.parentElement && invokeListenersOn(btn.parentElement, proxyEvent)) {
      success = true;
    }

    // 4. Dispatch proxy event through standard DOM event pipeline
    try {
      btn.dispatchEvent(proxyEvent);
    } catch (e) {}

    // 5. Native click
    try {
      btn.click();
    } catch (e) {}

    // 6. Notify content script of successful skip
    document.dispatchEvent(new CustomEvent('__AutoSkipAds_AdSkipped'));
    return success;
  }

  function findSkipButton() {
    for (const sel of SKIP_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        if (el.tagName.toLowerCase() !== 'button') {
          const innerBtn = el.querySelector('button');
          if (innerBtn) return innerBtn;
        }
        return el;
      }
    }
    return null;
  }

  function checkAndSkip() {
    const player = document.querySelector('#movie_player, .html5-video-player');
    const isAd = player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
    if (!isAd && !document.querySelector('.ytp-ad-player-overlay')) {
      return;
    }

    const btn = findSkipButton();
    if (btn) {
      executeSkip(btn);
    }
  }

  // Fast interval check (100ms)
  setInterval(checkAndSkip, 100);

  // MutationObserver for instant reaction
  const observer = new MutationObserver(checkAndSkip);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'id']
  });

  // Listen to triggers from content.js
  document.addEventListener('__AutoSkipAds_TriggerSkip', () => {
    const btn = findSkipButton();
    if (btn) executeSkip(btn);
  });
})();
