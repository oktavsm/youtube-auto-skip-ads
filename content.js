(() => {
  'use strict';

  console.log('[AutoSkipAds] High-Precision Controller loaded.');

  const DEFAULT_SETTINGS = {
    enabled: true,
    autoCloseBanners: true,
    skipUnskippable: true,
    preventIdlePause: true,
    speedUpAd: false,
    adSpeed: 4,
    autoMuteAd: false
  };

  let settings = { ...DEFAULT_SETTINGS };
  let originalPlaybackRate = 1;
  let currentAdIdentifier = '';
  let isRunning = false;

  // Banner close selectors
  const BANNER_SELECTORS = [
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-overlay-close-container button',
    '.ytp-ad-text-overlay .ytp-ad-overlay-close-container button',
    'button.ytp-ad-feedback-dialog-close-button'
  ];

  // Inactivity / Idle confirmation dialog selectors
  const IDLE_DIALOG_SELECTORS = [
    'yt-confirm-dialog-renderer',
    'ytd-popup-container yt-confirm-dialog-renderer',
    'tp-yt-paper-dialog yt-confirm-dialog-renderer',
    'tp-yt-paper-dialog',
    'ytmusic-you-there-renderer'
  ];

  // Sync state to documentElement for main world script
  function syncStateToDOM() {
    if (document.documentElement) {
      document.documentElement.dataset.autoSkipEnabled = settings.enabled ? 'true' : 'false';
      document.documentElement.dataset.skipUnskippable = settings.skipUnskippable ? 'true' : 'false';
      document.documentElement.dataset.preventIdlePause = settings.preventIdlePause ? 'true' : 'false';
    }
  }

  // Load settings from storage
  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
        if (stored) {
          settings = { ...DEFAULT_SETTINGS, ...stored };
          syncStateToDOM();
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
        syncStateToDOM();
      }
    });
  }

  // Visibility check
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
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

  // Check if current ad is an unskippable ad (e.g. 5s or 15s bumper/non-skippable ad)
  function isUnskippableAd() {
    const skipBtn = document.querySelector(
      'button.ytp-skip-ad-button, ' +
      'button.ytp-skip-ad-button-fix-fullscreen-grid, ' +
      'button.ytp-ad-skip-button-modern, ' +
      'button.ytp-ad-skip-button, ' +
      'button[id^="skip-button:"], ' +
      '.ytp-skip-ad-button, ' +
      '.ytp-ad-skip-button-modern, ' +
      '.ytp-ad-skip-button'
    );
    if (skipBtn) return false;

    // Check textual markers used by YouTube for unskippable ads
    const adTextEl = document.querySelector('.ytp-ad-preview-text, .ytp-ad-message-container, .ytp-ad-text');
    if (adTextEl) {
      const text = (adTextEl.textContent || '').toLowerCase();
      if (
        text.includes('after ad') ||
        text.includes('after ads') ||
        text.includes('setelah iklan') ||
        text.includes('akan selesai') ||
        text.includes('berakhir dalam') ||
        text.includes('ends in') ||
        text.includes('video will play')
      ) {
        return true;
      }
    }

    // Short ads without a skip button are unskippable bumper/pre-roll ads (typically <= 20 seconds)
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (video && isFinite(video.duration) && video.duration <= 20) {
      return true;
    }

    return false;
  }

  // Fast-forward unskippable ad directly to completion in 0.1s
  function handleUnskippableAd(video) {
    if (!video || !settings.skipUnskippable) return;

    if (!isFinite(video.duration) || video.duration <= 0 || isNaN(video.duration)) {
      return;
    }

    // Wait until video has begun playback (> 0.1s) and not already near end
    if (video.currentTime >= 0.1 && (video.duration - video.currentTime > 0.5)) {
      console.log('[AutoSkipAds] Unskippable ad detected: fast-forwarding to completion.');
      try {
        video.currentTime = Math.max(0, video.duration - 0.1);
        video.play().catch(() => {});
      } catch (e) {}
    }
  }

  // Verify if a dialog is the YouTube idle "Video paused. Continue watching?" prompt
  function isIdlePauseDialog(el) {
    if (!el || !isVisible(el)) return false;

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

  // Dismiss idle pause dialog and resume playback automatically
  function handleIdlePause() {
    if (!settings.preventIdlePause) return;

    for (const sel of IDLE_DIALOG_SELECTORS) {
      const dialogs = document.querySelectorAll(sel);
      for (const dialog of dialogs) {
        if (isIdlePauseDialog(dialog)) {
          console.log('[AutoSkipAds] Inactivity pause dialog detected: auto-confirming.');
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
          if (backdrop && isVisible(backdrop)) {
            backdrop.click();
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

  // Generate unique signature for current ad to track counter accurately
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

  // Listen to skip events from main world script
  document.addEventListener('__AutoSkipAds_AdSkipped', () => {
    const sig = getAdSignature();
    if (sig !== currentAdIdentifier) {
      currentAdIdentifier = sig;
      incrementSkipCounter();
    }
  });

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
          console.log('[AutoSkipAds] Ad detected with signature:', signature);
        }

        // 1. If ad is unskippable (no skip button, short duration), fast-forward immediately
        const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (isUnskippableAd()) {
          handleUnskippableAd(video);
        }

        // 2. Signal main world engine to check and trigger proxy skip for skippable ads
        document.dispatchEvent(new CustomEvent('__AutoSkipAds_TriggerSkip'));

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
    syncStateToDOM();

    let throttleTimeout = null;
    const observer = new MutationObserver(() => {
      if (throttleTimeout) return;
      throttleTimeout = setTimeout(() => {
        throttleTimeout = null;
        handleAds();
        handleIdlePause();
      }, 100);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'id']
    });

    setInterval(() => {
      handleAds();
      handleIdlePause();
    }, 200);

    window.addEventListener('yt-navigate-finish', () => {
      handleAds();
      handleIdlePause();
    });
    window.addEventListener('yt-page-data-updated', () => {
      handleAds();
      handleIdlePause();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  let currentUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      setTimeout(() => {
        handleAds();
        handleIdlePause();
      }, 200);
    }
  }).observe(document, { subtree: true, childList: true });
})();
