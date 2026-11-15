(() => {
  'use strict';

  const DEBUG = false;
  const CONFIG_REQ_CHANNEL = '__yt_cfg_req_7f3a';
  const TRIGGER_CHANNEL = '__yt_act_skip_7f3a';
  const SKIPPED_CHANNEL = '__yt_act_done_7f3a';

  function log(...args) {
    if (DEBUG) console.log('[AutoSkipAds]', ...args);
  }

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

  const rateAdjustedVideos = new WeakSet();
  const mutedVideos = new WeakSet();

  const BANNER_SELECTORS = [
    '.ytp-ad-overlay-close-button',
    '.ytp-ad-overlay-close-container button',
    '.ytp-ad-text-overlay .ytp-ad-overlay-close-container button',
    'button.ytp-ad-feedback-dialog-close-button'
  ];

  const IDLE_DIALOG_SELECTORS = [
    'yt-confirm-dialog-renderer',
    'ytd-popup-container yt-confirm-dialog-renderer',
    'tp-yt-paper-dialog yt-confirm-dialog-renderer',
    'tp-yt-paper-dialog',
    'ytmusic-you-there-renderer'
  ];

  // Sync settings to main world engine via postMessage (no <html> dataset footprint)
  function syncSettingsToMainWorld() {
    const targetOrigin = (window.location && window.location.origin && window.location.origin !== 'null')
      ? window.location.origin
      : '*';
    window.postMessage({
      __ytSync7f3a: 1,
      enabled: settings.enabled,
      skipUnskippable: settings.skipUnskippable,
      preventIdlePause: settings.preventIdlePause
    }, targetOrigin);
  }

  window.addEventListener(CONFIG_REQ_CHANNEL, syncSettingsToMainWorld);

  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
        if (stored) {
          settings = { ...DEFAULT_SETTINGS, ...stored };
          syncSettingsToMainWorld();
        }
      });
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        for (const [key, change] of Object.entries(changes)) {
          if (key in settings) {
            settings[key] = change.newValue;
          }
        }
        syncSettingsToMainWorld();
      }
    });
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

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

  function isIdlePauseDialog(el) {
    if (!isVisible(el)) return false;

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

  function handleIdlePause() {
    if (!settings.preventIdlePause) return;

    for (const sel of IDLE_DIALOG_SELECTORS) {
      const dialogs = document.querySelectorAll(sel);
      for (const dialog of dialogs) {
        if (isIdlePauseDialog(dialog)) {
          log('Inactivity pause dialog detected: auto-confirming.');
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

  function getAdSignature() {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    const badge = document.querySelector('.ytp-ad-text, .ytp-ad-simple-ad-badge');
    const skipBtn = document.querySelector('[id^="skip-button:"]');

    const badgeText = badge ? badge.textContent.trim() : '';
    const skipId = skipBtn ? skipBtn.id : '';
    const videoSrc = video ? (video.currentSrc || video.src || '').slice(-30) : '';

    return `${badgeText}|${skipId}|${videoSrc}`;
  }

  function incrementSkipCounter() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ skipCount: 0 }, (data) => {
        const nextCount = (data.skipCount || 0) + 1;
        chrome.storage.local.set({ skipCount: nextCount });
      });
    }
  }

  function closeBanners() {
    for (const sel of BANNER_SELECTORS) {
      const closeBtn = document.querySelector(sel);
      if (closeBtn && isVisible(closeBtn)) {
        closeBtn.click();
        return;
      }
    }
  }

  function handlePlaybackRate(adActive) {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return;

    if (adActive) {
      if (settings.speedUpAd && Number(settings.adSpeed) > 1) {
        const targetSpeed = Math.min(16, Math.max(1, Number(settings.adSpeed)));
        const nearEnd = video.duration && (video.duration - video.currentTime <= 0.5);
        const effectiveSpeed = nearEnd ? 1.0 : targetSpeed;

        if (video.playbackRate !== effectiveSpeed) {
          if (!rateAdjustedVideos.has(video)) {
            originalPlaybackRate = (video.playbackRate && video.playbackRate <= 2) ? video.playbackRate : 1;
          }
          video.playbackRate = effectiveSpeed;
          rateAdjustedVideos.add(video);
        }
      }

      if (video.paused && !video.ended && video.duration && (video.duration - video.currentTime <= 1.0)) {
        video.play().catch(() => {});
      }

      if (settings.autoMuteAd && !video.muted) {
        video.muted = true;
        mutedVideos.add(video);
      }
    } else {
      if (rateAdjustedVideos.has(video)) {
        video.playbackRate = originalPlaybackRate || 1;
        rateAdjustedVideos.delete(video);
      }
      if (mutedVideos.has(video)) {
        video.muted = false;
        mutedVideos.delete(video);
      }
    }
  }

  window.addEventListener(SKIPPED_CHANNEL, () => {
    const sig = getAdSignature();
    if (sig !== currentAdIdentifier) {
      currentAdIdentifier = sig;
      incrementSkipCounter();
    }
  });

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
          log('Ad detected with signature:', signature);
        }

        // Delegate skip & unskippable completion to main world engine
        window.dispatchEvent(new Event(TRIGGER_CHANNEL));

        if (settings.autoCloseBanners) {
          closeBanners();
        }
      } else if (currentAdIdentifier !== '') {
        currentAdIdentifier = '';
        log('All ads ended.');
      }
    } finally {
      isRunning = false;
    }
  }

  function init() {
    loadSettings();
    syncSettingsToMainWorld();

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
      attributeFilter: ['class', 'style']
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
