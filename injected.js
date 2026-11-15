(() => {
  'use strict';

  const DEBUG = false;
  const CONFIG_REQ_CHANNEL = '__yt_cfg_req_7f3a';
  const TRIGGER_CHANNEL = '__yt_act_skip_7f3a';
  const SKIPPED_CHANNEL = '__yt_act_done_7f3a';

  function log(...args) {
    if (DEBUG) console.log('[AutoSkipAds]', ...args);
  }

  let config = {
    enabled: true,
    skipUnskippable: true,
    preventIdlePause: true
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__ytSync7f3a !== 1) return;
    config = {
      enabled: e.data.enabled !== false,
      skipUnskippable: e.data.skipUnskippable !== false,
      preventIdlePause: e.data.preventIdlePause !== false
    };
  });

  // Request initial state from isolated content script without touching <html> attributes
  window.dispatchEvent(new Event(CONFIG_REQ_CHANNEL));

  // Stealth listener capture using WeakMap + native-preserving Proxy
  const listenerMap = new WeakMap();
  const originalAEL = EventTarget.prototype.addEventListener;
  const originalREL = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = new Proxy(originalAEL, {
    apply(target, thisArg, args) {
      const type = args[0];
      const listener = args[1];
      if ((type === 'click' || type === 'pointerup') && listener && thisArg instanceof Element) {
        try {
          let list = listenerMap.get(thisArg);
          if (!list) {
            list = [];
            listenerMap.set(thisArg, list);
          }
          if (!list.includes(listener)) {
            list.push(listener);
          }
        } catch (e) {}
      }
      return Reflect.apply(target, thisArg, args);
    }
  });

  EventTarget.prototype.removeEventListener = new Proxy(originalREL, {
    apply(target, thisArg, args) {
      const type = args[0];
      const listener = args[1];
      if ((type === 'click' || type === 'pointerup') && listener && thisArg instanceof Element) {
        try {
          const list = listenerMap.get(thisArg);
          if (list) {
            const idx = list.indexOf(listener);
            if (idx !== -1) list.splice(idx, 1);
          }
        } catch (e) {}
      }
      return Reflect.apply(target, thisArg, args);
    }
  });

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

  const IDLE_DIALOG_SELECTORS = [
    'yt-confirm-dialog-renderer',
    'ytd-popup-container yt-confirm-dialog-renderer',
    'tp-yt-paper-dialog yt-confirm-dialog-renderer',
    'tp-yt-paper-dialog',
    'ytmusic-you-there-renderer'
  ];

  let lastSkipAttemptTime = 0;
  let lastFastForwardedKey = '';

  function createTrustedProxyEvent(targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const jitterX = (Math.random() - 0.5) * Math.min(8, rect.width * 0.2);
    const jitterY = (Math.random() - 0.5) * Math.min(8, rect.height * 0.2);
    const clientX = Math.round(rect.left + rect.width / 2 + jitterX);
    const clientY = Math.round(rect.top + rect.height / 2 + jitterY);

    const realEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      screenX: clientX + (window.screenX || 0),
      screenY: clientY + (window.screenY || 0),
      button: 0,
      buttons: 1
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
    const list = listenerMap.get(el);

    if (list && list.length > 0) {
      for (const fn of [...list]) {
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

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isSkipButtonReady(el) {
    if (!isElementVisible(el)) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;

    const style = window.getComputedStyle(el);
    if (style.pointerEvents === 'none') return false;

    const opacity = parseFloat(style.opacity);
    if (!isNaN(opacity) && opacity < 0.75) return false;

    // Avoid firing during countdown labels (e.g., "5", "Skip in 4", "Lewati dalam 3")
    const text = (el.textContent || '').trim();
    if (/^\d+$/.test(text) || /\b(in|dalam)\s+\d+/i.test(text)) {
      return false;
    }

    return true;
  }

  function hasPendingSkippableUI(root) {
    const scope = root || document;
    // Check if skip button exists (even if counting down) or preview countdown container is visible
    for (const sel of SKIP_SELECTORS) {
      if (scope.querySelector(sel)) return true;
    }
    const preview = scope.querySelector('.ytp-ad-preview-container, .ytp-ad-preview-slot');
    if (preview && isElementVisible(preview)) {
      const text = (preview.textContent || '').toLowerCase();
      // If preview says "after ad" / "setelah iklan", it is unskippable; otherwise it is a skip countdown
      const unskippableText = (
        text.includes('after ad') ||
        text.includes('after ads') ||
        text.includes('setelah iklan') ||
        text.includes('akan selesai') ||
        text.includes('berakhir dalam') ||
        text.includes('ends in') ||
        text.includes('video will play')
      );
      if (!unskippableText) return true;
    }
    return false;
  }

  function isIdlePauseDialog(el) {
    if (!isElementVisible(el)) return false;

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
    if (!config.preventIdlePause) return;

    for (const sel of IDLE_DIALOG_SELECTORS) {
      const dialogs = document.querySelectorAll(sel);
      for (const dialog of dialogs) {
        if (isIdlePauseDialog(dialog)) {
          log('Inactivity pause dialog detected.');
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
          if (backdrop && isElementVisible(backdrop)) {
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
    if (!config.preventIdlePause) return;
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (video && !video.paused && !video.ended) {
      try {
        window._lact = Date.now();
      } catch (e) {}
    }
  }
  setInterval(keepAliveLact, 10000);

  function executeSkip(btn) {
    if (!btn || !config.enabled) return false;

    const now = Date.now();
    if (now - lastSkipAttemptTime < 700) {
      return false;
    }
    lastSkipAttemptTime = now;

    log('Executing trusted skip on:', btn.className || btn.id);
    const proxyEvent = createTrustedProxyEvent(btn);
    let success = false;

    if (invokeListenersOn(btn, proxyEvent)) {
      success = true;
    }

    const innerText = btn.querySelector('.ytp-skip-ad-button__text, [class*="skip-button__text"], div, span');
    if (innerText && invokeListenersOn(innerText, proxyEvent)) {
      success = true;
    }

    if (btn.parentElement && invokeListenersOn(btn.parentElement, proxyEvent)) {
      success = true;
    }

    if (!success) {
      try {
        btn.dispatchEvent(proxyEvent);
      } catch (e) {}
      try {
        btn.click();
      } catch (e) {}
    }

    window.dispatchEvent(new Event(SKIPPED_CHANNEL));
    return true;
  }

  function findReadySkipButton(root) {
    const scope = root || document;
    for (const sel of SKIP_SELECTORS) {
      const el = scope.querySelector(sel);
      if (!el) continue;

      const targetBtn = el.tagName.toLowerCase() !== 'button' ? (el.querySelector('button') || el) : el;
      if (isSkipButtonReady(targetBtn)) {
        return targetBtn;
      }
    }
    return null;
  }

  function checkAndSkip() {
    if (!config.enabled) return;

    const player = document.querySelector('#movie_player, .html5-video-player');
    const isAd = player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
    if (!isAd && !document.querySelector('.ytp-ad-player-overlay')) {
      lastFastForwardedKey = '';
      return;
    }

    const scope = player || document.querySelector('.ytp-ad-player-overlay');
    if (!scope) return;
    const btn = findReadySkipButton(scope);
    if (btn) {
      executeSkip(btn);
      return;
    }

    // Handle genuinely unskippable ads safely (only when no skip button/countdown UI exists)
    if (config.skipUnskippable && !hasPendingSkippableUI(scope)) {
      const video = scope.querySelector('video.html5-main-video') || scope.querySelector('video');
      if (video && isFinite(video.duration) && video.duration > 0 && video.duration <= 25) {
        const adKey = `${(video.currentSrc || video.src || '').slice(-32)}|${video.duration.toFixed(1)}`;
        // Wait at least 1.0s so ad-start telemetry registers cleanly and countdown UI has time to mount
        if (lastFastForwardedKey !== adKey && video.currentTime >= 1.0 && (video.duration - video.currentTime > 0.6)) {
          lastFastForwardedKey = adKey;
          log('Unskippable ad fast-forward triggered:', adKey);
          try {
            video.currentTime = Math.max(0, video.duration - 0.15);
            video.play().catch(() => {});
          } catch (e) {}
        }
      }
    }
  }

  let tickScheduled = false;
  function scheduleTick() {
    if (tickScheduled) return;
    tickScheduled = true;
    setTimeout(() => {
      tickScheduled = false;
      checkAndSkip();
      checkAndHandleIdlePause();
    }, 60);
  }

  // Periodic safety check (150ms)
  setInterval(() => {
    checkAndSkip();
    checkAndHandleIdlePause();
  }, 150);

  // Coalesced MutationObserver
  const observer = new MutationObserver(scheduleTick);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  });

  window.addEventListener(TRIGGER_CHANNEL, () => {
    checkAndSkip();
    checkAndHandleIdlePause();
  });
})();
