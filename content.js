(() => {
  'use strict';

  console.log('[AutoSkipAds] Verified Skip Clicker loaded.');

  const DEFAULT_SETTINGS = {
    enabled: true,
    autoCloseBanners: true,
    speedUpAd: true,
    adSpeed: 4,
    autoMuteAd: false
  };

  let settings = { ...DEFAULT_SETTINGS };
  let originalPlaybackRate = 1;
  let lastBannerCloseTime = 0;
  let isProcessing = false;
  let throttleTimer = null;

  // Strict list of actual button elements (never match wrapper divs or slots)
  const SKIP_BUTTON_SELECTORS = [
    'button.ytp-ad-skip-button-modern',
    'button.ytp-ad-skip-button',
    'button.ytp-skip-ad-button',
    '.ytp-ad-skip-button-modern.ytp-button',
    '.ytp-ad-skip-button.ytp-button',
    '.ytp-skip-ad-button.ytp-button',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button',
    'button[aria-label*="Skip"]',
    'button[aria-label*="Lewati"]',
    '[id^="skip-button:"] button',
    '.videoAdUiSkipButton'
  ];

  // Overlay and banner close selectors
  const BANNER_SELECTORS = [
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-overlay-close-container button',
    '.ytp-ad-text-overlay .ytp-ad-overlay-close-container button',
    'button.ytp-ad-feedback-dialog-close-button'
  ];

  // Load stored settings
  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
        if (stored) {
          settings = { ...DEFAULT_SETTINGS, ...stored };
        }
      });
    }
  }

  // Real-time settings sync
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

  // Check if YouTube player is currently presenting an ad
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

  // Increment skip counter in storage
  function incrementSkipCounter() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ skipCount: 0 }, (data) => {
        const nextCount = (data.skipCount || 0) + 1;
        chrome.storage.local.set({ skipCount: nextCount });
      });
    }
  }

  // Fallback search only for genuine button elements containing "Skip" or "Lewati"
  function findFallbackSkipButton() {
    const player = document.querySelector('#movie_player, .video-ads, .ytp-ad-module');
    if (!player) return null;

    const buttons = player.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      if (btn && btn.offsetParent !== null) {
        const text = (btn.textContent || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (
          text.startsWith('skip') ||
          text.includes('skip ad') ||
          text.includes('lewati') ||
          aria.startsWith('skip') ||
          aria.includes('skip ad') ||
          aria.includes('lewati')
        ) {
          return btn;
        }
      }
    }
    return null;
  }

  // Try to click the genuine skip button
  function tryClickSkip() {
    let skipBtn = null;

    // 1. Check strict button selectors
    for (const sel of SKIP_BUTTON_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        skipBtn = el;
        break;
      }
    }

    // 2. Fallback search by text only on button elements
    if (!skipBtn) {
      skipBtn = findFallbackSkipButton();
    }

    // 3. Click the real button once
    if (skipBtn && !skipBtn.__clickedByExtension) {
      skipBtn.__clickedByExtension = true;

      console.log('[AutoSkipAds] Real Skip button found:', skipBtn.tagName, skipBtn.className);

      // Native click
      skipBtn.click();

      // Dispatch simulated pointer and mouse events directly to the button
      try {
        const rect = skipBtn.getBoundingClientRect();
        const opts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        };
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((evt) => {
          skipBtn.dispatchEvent(new MouseEvent(evt, opts));
        });
      } catch (e) {
        // Handled silently
      }

      incrementSkipCounter();
      return true;
    }

    return false;
  }

  // Close overlay banners
  function tryCloseBanners() {
    if (!settings.autoCloseBanners) return;

    const now = Date.now();
    if (now - lastBannerCloseTime < 1000) return;

    for (const sel of BANNER_SELECTORS) {
      const closeBtn = document.querySelector(sel);
      if (closeBtn && closeBtn.offsetParent !== null) {
        lastBannerCloseTime = now;
        closeBtn.click();
        console.log('[AutoSkipAds] Banner closed.');
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
        if (video.playbackRate !== targetSpeed) {
          if (!video.__adRateApplied) {
            originalPlaybackRate = (video.playbackRate && video.playbackRate <= 2) ? video.playbackRate : 1;
          }
          video.playbackRate = targetSpeed;
          video.__adRateApplied = true;
        }
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

  // Main scan routine protected against re-entrancy
  function handleAds() {
    if (isProcessing || !settings.enabled) return;
    isProcessing = true;

    try {
      const adActive = isAdShowing();
      handlePlaybackRate(adActive);
      tryClickSkip();
      tryCloseBanners();
    } finally {
      isProcessing = false;
    }
  }

  // Throttled scan runner
  function requestScan() {
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      handleAds();
    }, 120);
  }

  // Initialize
  function init() {
    loadSettings();

    // Observe DOM mutations
    const observer = new MutationObserver(() => {
      requestScan();
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    // Steady interval fallback (150ms)
    setInterval(handleAds, 150);

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
      setTimeout(handleAds, 150);
    }
  }).observe(document, { subtree: true, childList: true });
})();
