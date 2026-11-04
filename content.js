(() => {
  'use strict';

  console.log('[AutoSkipAds] Content script loaded on YouTube.');

  const DEFAULT_SETTINGS = {
    enabled: true,
    autoCloseBanners: true,
    autoMuteAd: true,
    fastForwardAd: true
  };

  let settings = { ...DEFAULT_SETTINGS };
  let isCurrentlyInAd = false;

  // Modern and legacy skip button selectors
  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-skip-button-slot button',
    'button.ytp-ad-skip-button-text',
    '[class*="skip-ad"]',
    '[class*="skip_ad"]',
    'button[aria-label*="Skip"]',
    'button[aria-label*="Lewati"]',
    '[id^="skip-button:"] button',
    '.videoAdUiSkipButton'
  ];

  // Overlay and banner close selectors
  const BANNER_SELECTORS = [
    '.ytp-ad-overlay-close-button',
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

  // Trigger robust click on element and child buttons
  function triggerClick(el) {
    if (!el) return false;
    try {
      el.click();

      const childBtn = el.querySelector('button');
      if (childBtn) childBtn.click();

      const rect = el.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
        const evt = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY
        });
        el.dispatchEvent(evt);
        if (childBtn) childBtn.dispatchEvent(evt);
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  // Record stats
  function incrementSkipCounter() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ skipCount: 0 }, (data) => {
        const nextCount = (data.skipCount || 0) + 1;
        chrome.storage.local.set({ skipCount: nextCount });
      });
    }
  }

  // Core handler running on every tick / mutation
  function handleAds() {
    if (!settings.enabled) return;

    // Detect if YouTube is currently presenting an ad
    const player = document.querySelector('#movie_player, .html5-video-player');
    const adShowing =
      (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) ||
      document.querySelector('.ytp-ad-player-overlay') !== null ||
      document.querySelector('.ad-showing') !== null;

    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');

    if (adShowing) {
      if (!isCurrentlyInAd) {
        isCurrentlyInAd = true;
        incrementSkipCounter();
        console.log('[AutoSkipAds] Ad detected. Skipping...');
      }

      // 1. Click skip button if available in DOM
      for (const sel of SKIP_SELECTORS) {
        const elements = document.querySelectorAll(sel);
        for (const btn of elements) {
          if (btn && btn.offsetParent !== null) {
            triggerClick(btn);
          }
        }
      }

      // 2. Fast-forward & mute video ad to bypass countdown and unskippable ads
      if (video) {
        // Mute during ad
        if (settings.autoMuteAd && !video.muted) {
          video.muted = true;
          video.__adSkipperMuted = true;
        }

        // Fast forward playback rate
        if (settings.fastForwardAd && video.playbackRate < 16) {
          video.playbackRate = 16;
        }

        // Seek directly to end of ad video
        if (video.duration && isFinite(video.duration) && video.duration > 0) {
          try {
            video.currentTime = video.duration;
          } catch (e) {
            // Handled silently if video element restricts seeking
          }
        }
      }

      // 3. Close banner overlay ads
      if (settings.autoCloseBanners) {
        for (const sel of BANNER_SELECTORS) {
          const bannerButtons = document.querySelectorAll(sel);
          for (const closeBtn of bannerButtons) {
            if (closeBtn && closeBtn.offsetParent !== null) {
              triggerClick(closeBtn);
            }
          }
        }
      }
    } else {
      // Normal playback: restore audio and playback rate
      if (isCurrentlyInAd) {
        isCurrentlyInAd = false;
        console.log('[AutoSkipAds] Ad ended. Restored normal playback.');
      }

      if (video) {
        if (video.__adSkipperMuted) {
          video.muted = false;
          video.__adSkipperMuted = false;
        }
        if (video.playbackRate === 16) {
          video.playbackRate = 1;
        }
      }
    }
  }

  // Initialize listeners
  function init() {
    loadSettings();

    // 1. MutationObserver for instant reaction
    const observer = new MutationObserver(() => {
      handleAds();
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'src']
    });

    // 2. High-frequency polling fallback (250ms)
    setInterval(handleAds, 250);

    // 3. YouTube SPA navigation events
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
      setTimeout(handleAds, 300);
    }
  }).observe(document, { subtree: true, childList: true });
})();
