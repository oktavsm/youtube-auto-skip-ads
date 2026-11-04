(() => {
  'use strict';

  // Configuration and state
  const DEFAULT_SETTINGS = {
    enabled: true,
    autoCloseBanners: true,
    fastForwardAd: false,
    autoMuteAd: false
  };

  let settings = { ...DEFAULT_SETTINGS };
  let lastSkipTime = 0;
  const SKIP_DEBOUNCE_MS = 600;
  let isAdMutedByExtension = false;
  let originalMutedState = false;

  // Selectors for YouTube skip buttons (modern and legacy)
  const SKIP_BUTTON_SELECTORS = [
    'button.ytp-ad-skip-button',
    'button.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '[id^="skip-button:"] button',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-skip-button-slot button',
    '.videoAdUiSkipButton',
    'button.ytp-ad-skip-button-text'
  ];

  // Selectors for overlay and banner close buttons
  const BANNER_CLOSE_SELECTORS = [
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-overlay-close-container',
    'button.ytp-ad-feedback-dialog-close-button',
    '.ytp-ad-image-overlay .ytp-ad-overlay-close-button'
  ];

  // Load initial settings from chrome.storage.local
  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
        if (stored) {
          settings = { ...DEFAULT_SETTINGS, ...stored };
        }
      });
    }
  }

  // Listen for real-time settings updates from popup
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

  // Check if an element is visible and interactive
  function isElementVisible(el) {
    if (!el) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity) === 0
    ) {
      return false;
    }
    return true;
  }

  // Simulate complete click sequence on target element
  function triggerClick(element) {
    if (!element) return false;

    try {
      element.click();

      const rect = element.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      const eventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
      for (const eventType of eventTypes) {
        const evt = new MouseEvent(eventType, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY
        });
        element.dispatchEvent(evt);
      }
      return true;
    } catch (err) {
      console.debug('[AutoSkip] Click error:', err);
      return false;
    }
  }

  // Increment skipped ads counter in storage
  function incrementSkipCounter() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ skipCount: 0 }, (data) => {
        const nextCount = (data.skipCount || 0) + 1;
        chrome.storage.local.set({ skipCount: nextCount });
      });
    }
  }

  // Check if player is currently in an ad state
  function isAdShowing() {
    const player = document.querySelector('#movie_player, .html5-video-player');
    if (!player) return false;
    return (
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting') ||
      document.querySelector('.ytp-ad-player-overlay') !== null
    );
  }

  // Handle ad fast-forward and muting options when enabled
  function handleAdMediaModifiers(adActive) {
    const video = document.querySelector('video.html5-main-video');
    if (!video) return;

    if (adActive) {
      // Fast forward ad if enabled
      if (settings.fastForwardAd && isFinite(video.duration)) {
        if (video.playbackRate < 16) {
          video.playbackRate = 16;
        }
      }

      // Auto mute ad if enabled
      if (settings.autoMuteAd && !isAdMutedByExtension) {
        originalMutedState = video.muted;
        video.muted = true;
        isAdMutedByExtension = true;
      }
    } else {
      // Reset fast forward when ad is finished
      if (video.playbackRate === 16) {
        video.playbackRate = 1;
      }

      // Restore mute state when ad is finished
      if (isAdMutedByExtension) {
        video.muted = originalMutedState;
        isAdMutedByExtension = false;
      }
    }
  }

  // Scan and click available skip buttons
  function scanAndSkip() {
    if (!settings.enabled) return;

    const adActive = isAdShowing();
    handleAdMediaModifiers(adActive);

    const now = Date.now();

    // 1. Check for Skip Button
    for (const selector of SKIP_BUTTON_SELECTORS) {
      const skipBtn = document.querySelector(selector);
      if (skipBtn && isElementVisible(skipBtn)) {
        if (now - lastSkipTime > SKIP_DEBOUNCE_MS) {
          lastSkipTime = now;
          const clicked = triggerClick(skipBtn);
          if (clicked) {
            incrementSkipCounter();
            console.debug('[AutoSkip] Ad skip button clicked successfully.');
            break;
          }
        }
      }
    }

    // 2. Check for Overlay / Banner Ads Close Button
    if (settings.autoCloseBanners) {
      for (const selector of BANNER_CLOSE_SELECTORS) {
        const closeBtn = document.querySelector(selector);
        if (closeBtn && isElementVisible(closeBtn)) {
          triggerClick(closeBtn);
          console.debug('[AutoSkip] Ad banner closed.');
        }
      }
    }
  }

  // Initialize observer and polling timer
  function initialize() {
    loadSettings();

    // 1. MutationObserver on document body to catch DOM updates instantly
    const observer = new MutationObserver(() => {
      scanAndSkip();
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    // 2. Fallback timer (interval 350ms) to ensure continuous monitoring
    setInterval(scanAndSkip, 350);

    // 3. YouTube SPA navigation listeners
    window.addEventListener('yt-navigate-finish', scanAndSkip);
    window.addEventListener('yt-page-data-updated', scanAndSkip);
  }

  // Start extension logic when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();
