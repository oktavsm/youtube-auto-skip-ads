(() => {
  'use strict';

  console.log('[AutoSkipAds] Robust auto-skip controller loaded.');

  const DEFAULT_SETTINGS = {
    enabled: true,
    autoCloseBanners: true,
    speedUpAd: true,
    adSpeed: 4,
    autoMuteAd: false
  };

  let settings = { ...DEFAULT_SETTINGS };
  let originalPlaybackRate = 1;
  let lastSkipTime = 0;
  const SKIP_COOLDOWN_MS = 1500;
  let lastBannerCloseTime = 0;
  let isProcessing = false;
  let throttleTimer = null;

  // Selectors for YouTube skip buttons
  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    'button.ytp-ad-skip-button',
    'button.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-skip-button-slot button',
    'button.ytp-ad-skip-button-text',
    '[class*="skip-ad-button"]',
    '[class*="ytp-ad-skip-button"]',
    'button[class*="skip-ad"]',
    'button[class*="skip_ad"]',
    'button[aria-label*="Skip"]',
    'button[aria-label*="Lewati"]',
    '[id^="skip-button:"]',
    '[id^="skip-button:"] button',
    '.videoAdUiSkipButton'
  ];

  // Selectors for banner and overlay close buttons
  const BANNER_SELECTORS = [
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-overlay-close-container button',
    '.ytp-ad-overlay-close-container',
    '.ytp-ad-text-overlay .ytp-ad-overlay-close-container button',
    '[class*="overlay-close"]',
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

  // Check if player is currently in ad state
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

  // Click skip button once with strict debouncing
  function tryClickSkip() {
    const now = Date.now();
    if (now - lastSkipTime < SKIP_COOLDOWN_MS) return false;

    for (const sel of SKIP_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        lastSkipTime = now;

        // Perform clean click without recursive event storms
        btn.click();
        const childBtn = btn.querySelector('button');
        if (childBtn) childBtn.click();

        incrementSkipCounter();
        console.log('[AutoSkipAds] Skip button clicked successfully.');
        return true;
      }
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
        break;
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
      // Normal video playback: restore speed and audio
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

  // Core scan routine protected against re-entrancy
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

  // Throttled scan runner to prevent CPU locking and page freeze
  function requestScan() {
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      handleAds();
    }, 150);
  }

  // Initialize
  function init() {
    loadSettings();

    // Observe DOM mutations with throttle to prevent lockup
    const observer = new MutationObserver(() => {
      requestScan();
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
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
      setTimeout(handleAds, 150);
    }
  }).observe(document, { subtree: true, childList: true });
})();
