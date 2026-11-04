(() => {
  'use strict';

  console.log('[AutoSkipAds] High-Precision Skip Engine loaded.');

  const DEFAULT_SETTINGS = {
    enabled: true,
    autoCloseBanners: true,
    speedUpAd: false,
    adSpeed: 4,
    autoMuteAd: false
  };

  let settings = { ...DEFAULT_SETTINGS };
  let originalPlaybackRate = 1;
  let currentAdIdentifier = '';
  let isRunning = false;
  let lastSkipClickTime = 0;

  // Strict list of skip button selectors
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
    '[id^="skip-button:"]',
    '.videoAdUiSkipButton'
  ];

  // Overlay and banner close selectors
  const BANNER_SELECTORS = [
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-overlay-close-container button',
    '.ytp-ad-text-overlay .ytp-ad-overlay-close-container button',
    'button.ytp-ad-feedback-dialog-close-button'
  ];

  // Load settings from storage
  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
        if (stored) {
          settings = { ...DEFAULT_SETTINGS, ...stored };
        }
      });
    }
  }

  // Real-time settings listener
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        for (const [key, change] of Object.entries(changes)) {
          if (key in settings) {
            settings[key] = change.newValue;
          }
        }
      }
    });
  }

  // Robust visibility check that handles position:fixed, opacity:0.5, and modern grids
  function isVisible(el) {
    if (!el) return false;

    // Modern standards-compliant visibility check
    if (typeof el.checkVisibility === 'function') {
      try {
        if (!el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) {
          return false;
        }
      } catch (e) {
        // Fallback to style and rect checks below
      }
    }

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Check if player is currently in an advertisement state
  function isAdShowing() {
    const player = document.querySelector('#movie_player, .html5-video-player');
    if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
      return true;
    }
    if (document.querySelector('.ytp-ad-player-overlay') !== null) {
      return true;
    }
    if (document.querySelector('.ad-showing') !== null) {
      return true;
    }
    return false;
  }

  // Generate unique signature for current ad to avoid spamming the skip counter
  function getAdSignature() {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    const badge = document.querySelector('.ytp-ad-text, .ytp-ad-simple-ad-badge');
    const skipBtn = document.querySelector('[id^="skip-button:"]');

    const badgeText = badge ? badge.textContent.trim() : '';
    const skipId = skipBtn ? skipBtn.id : '';
    const videoSrc = video ? (video.currentSrc || video.src || '').slice(-30) : '';

    return `${badgeText}|${skipId}|${videoSrc}`;
  }

  // Increment skip counter in storage (strictly once per ad)
  function incrementSkipCounter() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ skipCount: 0 }, (data) => {
        const nextCount = (data.skipCount || 0) + 1;
        chrome.storage.local.set({ skipCount: nextCount });
      });
    }
  }

  // Find the active skip button in the DOM
  function findSkipButton() {
    // 1. Check exact selectors
    for (const sel of SKIP_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) {
        if (el.tagName.toLowerCase() !== 'button') {
          const innerBtn = el.querySelector('button');
          if (innerBtn && isVisible(innerBtn)) {
            return innerBtn;
          }
        }
        return el;
      }
    }

    // 2. Fallback search by text inside player
    const player = document.querySelector('#movie_player, .video-ads, .ytp-ad-module');
    if (!player) return null;

    const candidates = player.querySelectorAll('button, [role="button"]');
    for (const btn of candidates) {
      if (btn && isVisible(btn)) {
        const text = (btn.textContent || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (text.startsWith('skip') || text.includes('lewati') || aria.startsWith('skip') || aria.includes('lewati')) {
          return btn;
        }
      }
    }

    return null;
  }

  // Dispatch full pointer, mouse, and keyboard click sequence to bypass synthetic filters
  function clickSkipButton(btn) {
    if (!btn) return;

    try {
      console.log('[AutoSkipAds] Dispatching skip click to:', btn.tagName, btn.className || btn.id);

      // 1. Focus element
      if (typeof btn.focus === 'function') {
        btn.focus();
      }

      // 2. Inner target elements
      const innerText = btn.querySelector('.ytp-skip-ad-button__text, [class*="skip-button__text"]');

      // 3. Native .click()
      btn.click();
      if (innerText && typeof innerText.click === 'function') {
        innerText.click();
      }

      // 4. Dispatch simulated PointerEvent and MouseEvent sequence with real coordinates
      const rect = btn.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: 1,
        screenX: clientX,
        screenY: clientY,
        clientX,
        clientY,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
      };

      if (typeof PointerEvent === 'function') {
        ['pointerover', 'pointerenter', 'pointerdown', 'pointerup'].forEach((type) => {
          btn.dispatchEvent(new PointerEvent(type, eventInit));
          if (innerText) innerText.dispatchEvent(new PointerEvent(type, eventInit));
        });
      }

      ['mouseover', 'mouseenter', 'mousedown', 'mouseup', 'click'].forEach((type) => {
        btn.dispatchEvent(new MouseEvent(type, eventInit));
        if (innerText) innerText.dispatchEvent(new MouseEvent(type, eventInit));
      });

      // 5. Simulate keyboard activation (Enter & Space)
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      btn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    } catch (e) {
      // Handled silently
    }
  }

  // Close overlay banners
  function closeBanners() {
    for (const sel of BANNER_SELECTORS) {
      const closeBtn = document.querySelector(sel);
      if (closeBtn && isVisible(closeBtn)) {
        closeBtn.click();
        return;
      }
    }
  }

  // Manage playback speed and audio safely
  function handlePlaybackRate(adActive) {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return;

    if (adActive) {
      if (settings.speedUpAd && Number(settings.adSpeed) > 1) {
        const targetSpeed = Math.min(16, Math.max(1, Number(settings.adSpeed)));
        // Ease back to 1.0x near the end to avoid freezing on final frame
        const nearEnd = video.duration && (video.duration - video.currentTime <= 0.5);
        const effectiveSpeed = nearEnd ? 1.0 : targetSpeed;

        if (video.playbackRate !== effectiveSpeed) {
          if (!video.__adRateApplied) {
            originalPlaybackRate = (video.playbackRate && video.playbackRate <= 2) ? video.playbackRate : 1;
          }
          video.playbackRate = effectiveSpeed;
          video.__adRateApplied = true;
        }
      }

      // Auto-resume if ad is stuck or paused near the end
      if (video.paused && !video.ended && video.duration && (video.duration - video.currentTime <= 1.0)) {
        video.play().catch(() => {});
      }

      if (settings.autoMuteAd && !video.muted) {
        video.muted = true;
        video.__adSkipperMuted = true;
      }
    } else {
      // Normal video playback: restore user speed and audio
      if (video.__adRateApplied) {
        video.playbackRate = originalPlaybackRate || 1;
        video.__adRateApplied = false;
      }
      if (video.__adSkipperMuted) {
        video.muted = false;
        video.__adSkipperMuted = false;
      }
    }
  }

  // Main scan tick
  function handleAds() {
    if (isRunning || !settings.enabled) return;
    isRunning = true;

    try {
      const adActive = isAdShowing();
      handlePlaybackRate(adActive);

      if (adActive) {
        const signature = getAdSignature();
        if (signature !== currentAdIdentifier) {
          currentAdIdentifier = signature;
          incrementSkipCounter();
          console.log('[AutoSkipAds] Ad active with signature:', signature);
        }

        // Continuously try to click skip button while ad is active
        const now = Date.now();
        if (now - lastSkipClickTime >= 150) {
          const skipBtn = findSkipButton();
          if (skipBtn) {
            lastSkipClickTime = now;
            clickSkipButton(skipBtn);
          }
        }

        if (settings.autoCloseBanners) {
          closeBanners();
        }
      } else {
        if (currentAdIdentifier !== '') {
          currentAdIdentifier = '';
          console.log('[AutoSkipAds] All ads ended.');
        }
      }
    } finally {
      isRunning = false;
    }
  }

  // Initialize
  function init() {
    loadSettings();

    // DOM Observer with lightweight throttle
    let throttleTimeout = null;
    const observer = new MutationObserver(() => {
      if (throttleTimeout) return;
      throttleTimeout = setTimeout(() => {
        throttleTimeout = null;
        handleAds();
      }, 100);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'id']
    });

    // Steady interval fallback (200ms)
    setInterval(handleAds, 200);

    // YouTube SPA navigation events
    window.addEventListener('yt-navigate-finish', handleAds);
    window.addEventListener('yt-page-data-updated', handleAds);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Handle SPA URL transitions
  let currentUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      setTimeout(handleAds, 200);
    }
  }).observe(document, { subtree: true, childList: true });
})();
