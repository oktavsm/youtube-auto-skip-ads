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
  let originalPlaybackRate = 1;

  // Complete selector list for modern and legacy skip buttons
  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-skip-button-slot',
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

  // Robust click trigger for target, children, and parents with synthetic events
  function triggerClick(el) {
    if (!el) return false;
    try {
      el.click();

      const childBtn = el.querySelector('button');
      if (childBtn) childBtn.click();

      const parentBtn = el.closest('button');
      if (parentBtn && parentBtn !== el) parentBtn.click();

      const rect = el.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      const eventOpts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY
      };

      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, eventOpts));
        if (childBtn) childBtn.dispatchEvent(new MouseEvent(type, eventOpts));
        if (parentBtn) parentBtn.dispatchEvent(new MouseEvent(type, eventOpts));
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  // Increment skipped ads counter
  function incrementSkipCounter() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ skipCount: 0 }, (data) => {
        const nextCount = (data.skipCount || 0) + 1;
        chrome.storage.local.set({ skipCount: nextCount });
      });
    }
  }

  // Find all visible skip buttons in the current DOM
  function getVisibleSkipButtons() {
    const list = [];
    for (const sel of SKIP_SELECTORS) {
      const elements = document.querySelectorAll(sel);
      for (const el of elements) {
        if (el && el.offsetParent !== null) {
          list.push(el);
        }
      }
    }
    return list;
  }

  // Core handler running on every mutation & tick
  function handleAds() {
    if (!settings.enabled) return;

    const player = document.querySelector('#movie_player, .html5-video-player');
    const adModule = document.querySelector('.video-ads.ytp-ad-module');
    const hasAdModuleContent = adModule && adModule.children.length > 0;

    // Detect if an advertisement is active
    const isPlayerInAd =
      (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) ||
      document.querySelector('.ytp-ad-player-overlay') !== null ||
      document.querySelector('.ad-showing') !== null ||
      hasAdModuleContent;

    const visibleButtons = getVisibleSkipButtons();
    const adShowing = isPlayerInAd || visibleButtons.length > 0;

    const videos = document.querySelectorAll('video');

    if (adShowing) {
      if (!isCurrentlyInAd) {
        isCurrentlyInAd = true;
        incrementSkipCounter();
        console.log('[AutoSkipAds] Ad detected. Handling playback and skipping...');
      }

      // 1. Immediately click any visible skip button
      for (const btn of visibleButtons) {
        triggerClick(btn);
      }

      // 2. Accelerate ad playback cleanly using 16x speed and mute
      // Note: We deliberately do NOT set video.currentTime to duration,
      // because forced seeks to unbuffered timestamps cause black screens
      // and infinite buffering in modern YouTube MediaSource pipelines.
      videos.forEach((video) => {
        if (settings.autoMuteAd && !video.muted) {
          video.muted = true;
          video.__adSkipperMuted = true;
        }

        if (settings.fastForwardAd) {
          if (video.playbackRate !== 16) {
            originalPlaybackRate = video.playbackRate || 1;
            video.playbackRate = 16;
          }
        }
      });

      // 3. Close banner overlay ads
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
    } else {
      // Normal playback: restore user playback rate and unmute if muted by extension
      if (isCurrentlyInAd) {
        isCurrentlyInAd = false;
        console.log('[AutoSkipAds] Ad ended. Restored normal playback speed and volume.');
      }

      videos.forEach((video) => {
        if (video.__adSkipperMuted) {
          video.muted = false;
          video.__adSkipperMuted = false;
        }
        if (video.playbackRate === 16) {
          video.playbackRate = originalPlaybackRate || 1;
        }
      });
    }
  }

  // Initialize
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

    // 2. High-frequency polling (200ms)
    setInterval(handleAds, 200);

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
      setTimeout(handleAds, 250);
    }
  }).observe(document, { subtree: true, childList: true });
})();
