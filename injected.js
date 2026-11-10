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

  const IDLE_DIALOG_SELECTORS = [
    'yt-confirm-dialog-renderer',
    'ytd-popup-container yt-confirm-dialog-renderer',
    'tp-yt-paper-dialog yt-confirm-dialog-renderer',
    'tp-yt-paper-dialog',
    'ytmusic-you-there-renderer'
  ];

  function isIdlePauseDialog(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    if (el.tagName.toLowerCase().includes('you-there') || el.querySelector('ytmusic-you-there-renderer')) {
      return true;
    }

    const text = (el.textContent || '').toLowerCase();
    const idlePhrases = [
      'video paused',
      'continue watching',
      'still watching',
      'video dijeda',
      'lanjutkan menonton',
      'masih menonton',
      'video en pausa',
      'seguir viéndolo',
      'sigues ahí',
      'vidéo suspendue',
      'poursuivre la lecture',
      'video pausiert',
      'weiter ansehen',
      '動画が一時停止しました',
      '続きを視聴しますか',
      '동영상이 일시중지되었습니다',
      '이어서 시청하시겠습니까'
    ];

    return idlePhrases.some(phrase => text.includes(phrase));
  }

  function checkAndHandleIdlePause() {
    if (document.documentElement.dataset.preventIdlePause === 'false') {
      return;
    }

    for (const sel of IDLE_DIALOG_SELECTORS) {
      const dialogs = document.querySelectorAll(sel);
      for (const dialog of dialogs) {
        if (isIdlePauseDialog(dialog)) {
          console.log('[AutoSkipAds] Main World idle pause dialog detected: auto-confirming.');
          const confirmBtn = dialog.querySelector(
            '#confirm-button button, ' +
            '#confirm-button yt-button-shape button, ' +
            '#confirm-button, ' +
            'ytd-button-renderer#confirm-button button, ' +
            'button[aria-label*="Yes"], ' +
            'button[aria-label*="Ya"], ' +
            'button[aria-label*="Continue"]'
          );

          if (confirmBtn) {
            confirmBtn.click();
          }

          const backdrop = document.querySelector('tp-yt-iron-overlay-backdrop');
          if (backdrop) {
            try { backdrop.click(); } catch (e) {}
          }

          const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
          if (video && video.paused && !video.ended) {
            video.play().catch(() => {});
          }
          return;
        }
      }
    }
  }

  // Refresh window._lact periodically to prevent YouTube idle timeout from ever firing
  function keepAliveLact() {
    if (document.documentElement.dataset.preventIdlePause === 'false') {
      return;
    }
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (video && !video.paused && !video.ended) {
      try {
        window._lact = Date.now();
      } catch (e) {}
    }
  }
  setInterval(keepAliveLact, 10000);

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
    if (document.documentElement.dataset.autoSkipEnabled === 'false') {
      return;
    }

    const player = document.querySelector('#movie_player, .html5-video-player');
    const isAd = player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
    if (!isAd && !document.querySelector('.ytp-ad-player-overlay')) {
      return;
    }

    const btn = findSkipButton();
    if (btn) {
      executeSkip(btn);
      return;
    }

    // Fast-forward unskippable ads directly in main world
    if (document.documentElement.dataset.skipUnskippable !== 'false') {
      const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (video && isFinite(video.duration) && video.duration <= 20 && video.duration > 0) {
        if (video.currentTime >= 0.1 && (video.duration - video.currentTime > 0.5)) {
          console.log('[AutoSkipAds] Main World unskippable ad skip triggered.');
          try {
            video.currentTime = Math.max(0, video.duration - 0.1);
            video.play().catch(() => {});
          } catch (e) {}
        }
      }
    }
  }

  // Fast interval check (100ms)
  setInterval(() => {
    checkAndSkip();
    checkAndHandleIdlePause();
  }, 100);

  // MutationObserver for instant reaction
  const observer = new MutationObserver(() => {
    checkAndSkip();
    checkAndHandleIdlePause();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'id']
  });

  // Listen to triggers from content.js
  document.addEventListener('__AutoSkipAds_TriggerSkip', () => {
    checkAndSkip();
    checkAndHandleIdlePause();
  });
})();
