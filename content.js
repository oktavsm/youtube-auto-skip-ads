(() => {
  'use strict';

  console.log('[AutoSkipAds] Pure auto-skip and speed-control active on YouTube.');

  const DEFAULT_SETTINGS = {
    enabled: true,
    autoCloseBanners: true,
    speedUpAd: true,
    adSpeed: 4,
    autoMuteAd: false
  };

  let settings = { ...DEFAULT_SETTINGS };
  let lastSkippedTimestamp = 0;
  const SKIP_DEBOUNCE_MS = 1000;
  let originalPlaybackRate = 1;

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

  // Overlay and banner close selectors
  const BANNER_SELECTORS = [
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-overlay-close-container button',
    '.ytp-ad-overlay-close-container',
    '.ytp-ad-text-overlay .ytp-ad-overlay-close-container button',
    '[class*="overlay-close"]',
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

  // Robust click trigger
  function triggerClick(el) {
    if (!el) return false;
    try {
      el.click();

      const child = el.querySelector('button');
      if (child) child.click();

      const parent = el.closest('button');
      if (parent && parent !== el) parent.click();

      const rect = el.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY
      };

      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((evtType) => {
        el.dispatchEvent(new MouseEvent(evtType, opts));
        if (child) child.dispatchEvent(new MouseEvent(evtType, opts));
      });
      return true;
    } catch (e) {
      return false;
    }
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

  // Main tick handler
  function handleAds() {
    if (!settings.enabled) return;

    const now = Date.now();
    const player = document.querySelector('#movie_player, .html5-video-player');
    const isAdActive =
      (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) ||
      document.querySelector('.ytp-ad-player-overlay') !== null ||
      document.querySelector('.ad-showing') !== null;

    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');

    // 1. Manage Playback Speed and Audio
    if (video) {
      if (isAdActive) {
        // Adjust speed if enabled
        if (settings.speedUpAd && Number(settings.adSpeed) > 1) {
          const targetSpeed = Math.min(16, Math.max(1, Number(settings.adSpeed)));
          if (video.playbackRate !== targetSpeed) {
            if (!video.__adRateApplied) {
              originalPlaybackRate = video.playbackRate || 1;
            }
            video.playbackRate = targetSpeed;
            video.__adRateApplied = true;
          }
        }

        // Auto mute if enabled
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

    // 2. Scan and click Skip Buttons if present and visible
    for (const sel of SKIP_SELECTORS) {
      const elements = document.querySelectorAll(sel);
      for (const btn of elements) {
        if (btn && btn.offsetParent !== null) {
          const clicked = triggerClick(btn);
          if (clicked) {
            if (now - lastSkippedTimestamp > SKIP_DEBOUNCE_MS) {
              lastSkippedTimestamp = now;
              incrementSkipCounter();
              console.log('[AutoSkipAds] Skip button clicked successfully.');
            }
            return;
          }
        }
      }
    }

    // 3. Scan and close Overlay Banners if enabled
    if (settings.autoCloseBanners) {
      for (const sel of BANNER_SELECTORS) {
        const banners = document.querySelectorAll(sel);
        for (const closeBtn of banners) {
          if (closeBtn && closeBtn.offsetParent !== null) {
            triggerClick(closeBtn);
          }
        }
      }
    }
  }

  // Initialize
  function init() {
    loadSettings();

    // Instant DOM observer
    const observer = new MutationObserver(() => {
      handleAds();
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden']
    });

    // Frequent polling fallback (150ms)
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
