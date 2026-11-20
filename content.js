(() => {
  'use strict';

  const DEBUG = false;
  const CONFIG_REQ_CHANNEL = '__yt_cfg_req_7f3a';
  const TRIGGER_CHANNEL = '__yt_act_skip_7f3a';
  const SKIPPED_CHANNEL = '__yt_act_done_7f3a';
  const SHORTS_NEXT_CHANNEL = '__yt_act_shorts_next_7f3a';

  function log(...args) {
    if (DEBUG) console.log('[AutoSkipAds]', ...args);
  }

  const DEFAULT_SETTINGS = {
    enabled: true,
    autoCloseBanners: true,
    skipUnskippable: true,
    preventIdlePause: true,
    autoScrollShorts: true,
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
  const shortsWatchedVideos = new WeakSet();
  const shortsLoopOverridden = new WeakSet();

  const shortsState = {
    activeKey: '',
    maxTimeSeen: 0,
    lastScrolledKey: '',
    lastScrollTime: 0
  };

  const SHORTS_NEXT_SELECTORS = [
    '#navigation-button-down button',
    'ytd-shorts #navigation-button-down button',
    '.navigation-button-down button',
    'ytd-shorts button[aria-label*="Next video"]',
    'ytd-shorts button[aria-label*="Video berikutnya"]',
    'ytd-shorts button[aria-label*="Selanjutnya"]'
  ];

  const SHORTS_AD_CONTAINER_SELECTORS = [
    'ytd-ad-slot-renderer',
    'ytd-in-feed-ad-layout-renderer'
  ];

  const SHORTS_AD_BADGE_SELECTORS = [
    'ad-badge-view-model',
    'yt-ad-badge-view-model',
    'reels-ad-metadata-view-model',
    'reels-ad-card-buttoned-view-model',
    '.ytp-ad-player-overlay',
    '.ytp-ad-badge',
    '.ytp-ad-simple-ad-badge',
    '[class*="ad-badge-view-model"]'
  ];

  const SHORTS_SPONSORED_LABELS = new Set([
    'sponsored',
    'bersponsor',
    'iklan',
    'gesponsert',
    'sponsorisé',
    'patrocinado',
    'sponsorlu',
    'реклама',
    '広告',
    '광고'
  ]);

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
    if (isRunning || !settings.enabled || isShortsPage()) return;
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

  function isShortsPage() {
    return window.location.pathname.startsWith('/shorts/');
  }

  function isUserEditingText() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable;
  }

  function isInViewport(el) {
    if (!isVisible(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight - 4;
  }

  function isMainInViewport(el) {
    if (!isVisible(el)) return false;
    const rect = el.getBoundingClientRect();
    return rect.height > 120 && rect.top < window.innerHeight * 0.75 && rect.bottom > window.innerHeight * 0.25;
  }

  function getActiveShortsContext() {
    const shortsRoot = document.querySelector('ytd-shorts') || document;
    let activeReel = shortsRoot.querySelector('ytd-reel-video-renderer[is-active]');

    if (!activeReel) {
      const reelCandidates = shortsRoot.querySelectorAll(
        'ytd-reel-video-renderer, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, reels-player-overlay-layout-view-model'
      );
      for (const candidate of reelCandidates) {
        if (isMainInViewport(candidate)) {
          activeReel = candidate;
          break;
        }
      }
    }

    let video = activeReel && (activeReel.querySelector('video.html5-main-video') || activeReel.querySelector('video'));
    if (!video) {
      const shortsPlayerVideo = document.querySelector('#shorts-player video');
      if (shortsPlayerVideo && isInViewport(shortsPlayerVideo)) {
        video = shortsPlayerVideo;
      }
    }
    if (!video) {
      for (const v of shortsRoot.querySelectorAll('video')) {
        if (isMainInViewport(v)) {
          video = v;
          break;
        }
      }
    }

    return { activeReel, video };
  }

  function getShortsKey(activeReel, video) {
    const reelId = activeReel ? (activeReel.getAttribute('id') || activeReel.tagName) : '';
    const srcTail = video ? (video.currentSrc || video.src || '').slice(-24) : '';
    return `${window.location.pathname}|${reelId}|${srcTail}`;
  }

  function advanceToNextShort(activeReel, cooldownMs = 1500) {
    const now = Date.now();
    if (now - shortsState.lastScrollTime < cooldownMs) return false;
    shortsState.lastScrollTime = now;

    log('Shorts advancing to next Short.');
    const startPath = window.location.pathname;
    let hasDownBtn = false;

    for (const sel of SHORTS_NEXT_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn && isVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
        hasDownBtn = true;
        break;
      }
    }

    const scrollFallback = () => {
      const nextReel = activeReel && activeReel.nextElementSibling;
      if (nextReel && /^(ytd-reel-video-renderer|ytd-ad-slot-renderer)$/i.test(nextReel.tagName)) {
        nextReel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const container = document.querySelector('#shorts-inner-container');
      if (container) {
        container.scrollBy({ top: container.clientHeight || window.innerHeight, behavior: 'smooth' });
      }
    };

    if (hasDownBtn) {
      // Trigger trusted click via MAIN world engine first
      window.dispatchEvent(new Event(SHORTS_NEXT_CHANNEL));
      setTimeout(() => {
        if (isShortsPage() && window.location.pathname === startPath) {
          scrollFallback();
        }
      }, 400);
    } else {
      scrollFallback();
    }

    return true;
  }

  function isShortsAd(activeReel) {
    const shortsPlayer = document.querySelector('#shorts-player');
    if (shortsPlayer && (shortsPlayer.classList.contains('ad-showing') || shortsPlayer.classList.contains('ad-interrupting'))) {
      return true;
    }

    if (activeReel && activeReel.hasAttribute('is-ad')) {
      return true;
    }

    // Scope to activeReel if it is a standard reel, otherwise inspect visible elements in ytd-shorts viewport
    const scope = (activeReel && activeReel.matches('ytd-reel-video-renderer[is-active]'))
      ? activeReel
      : (document.querySelector('ytd-shorts') || activeReel);

    if (!scope) return false;

    for (const sel of SHORTS_AD_CONTAINER_SELECTORS) {
      for (const match of scope.querySelectorAll(sel)) {
        if (isMainInViewport(match)) return true;
      }
    }

    for (const sel of SHORTS_AD_BADGE_SELECTORS) {
      for (const match of scope.querySelectorAll(sel)) {
        if (isInViewport(match)) return true;
      }
    }

    // Check standalone Sponsored badge inside viewport (excluding titles, descriptions, and comments)
    const candidates = scope.querySelectorAll('span, div, yt-formatted-string, badge-shape, .yt-core-attributed-string');
    for (const el of candidates) {
      if (el.children.length > 0 || !isInViewport(el)) continue;
      if (el.closest('h1, h2, h3, ytd-comments, #comments-button, [class*="title"], [class*="description"]')) {
        continue;
      }
      const text = (el.textContent || '').trim().toLowerCase();
      if (SHORTS_SPONSORED_LABELS.has(text)) {
        return true;
      }
    }

    return false;
  }

  function handleShortsAds(activeReel, video) {
    if (!settings.enabled || !isShortsAd(activeReel)) return false;

    const reelKey = getShortsKey(activeReel, video);
    if (shortsState.lastScrolledKey === reelKey) {
      return true;
    }

    if (advanceToNextShort(activeReel, 700)) {
      log('Shorts sponsored ad detected: skipping to next Short.');
      shortsState.lastScrolledKey = reelKey;
      incrementSkipCounter();

      if (video && !video.muted) {
        video.muted = true;
        setTimeout(() => {
          try {
            video.muted = false;
          } catch (e) {}
        }, 600);
      }
    }

    return true;
  }

  function handleShortsAutoScroll() {
    if (!isShortsPage()) {
      shortsState.activeKey = '';
      shortsState.maxTimeSeen = 0;
      return;
    }

    const { activeReel, video } = getActiveShortsContext();
    if (handleShortsAds(activeReel, video)) {
      return;
    }

    if (!video) return;

    if (!settings.autoScrollShorts) {
      if (shortsLoopOverridden.has(video)) {
        video.loop = true;
        shortsLoopOverridden.delete(video);
      }
      return;
    }

    // Disable native Shorts looping so playback can finish cleanly
    if (video.loop) {
      video.loop = false;
      shortsLoopOverridden.add(video);
    }

    if (!isFinite(video.duration) || video.duration <= 0.5) return;

    const reelKey = getShortsKey(activeReel, video);
    if (!shortsWatchedVideos.has(video)) {
      shortsWatchedVideos.add(video);
      video.addEventListener('ended', () => {
        if (!isShortsPage() || !settings.autoScrollShorts || isUserEditingText()) return;
        const { activeReel: currentReel } = getActiveShortsContext();
        const currentKey = getShortsKey(currentReel, video);
        if (shortsState.lastScrolledKey !== currentKey) {
          shortsState.lastScrolledKey = currentKey;
          advanceToNextShort(currentReel);
        }
      });
    }

    if (reelKey !== shortsState.activeKey) {
      shortsState.activeKey = reelKey;
      shortsState.maxTimeSeen = video.currentTime;
      return;
    }

    const prevMax = shortsState.maxTimeSeen;
    if (video.currentTime > prevMax) {
      shortsState.maxTimeSeen = video.currentTime;
    }

    if (isUserEditingText() || shortsState.lastScrolledKey === reelKey) return;

    const reachedEnd = video.ended ||
      (!video.paused && !video.seeking && prevMax > 0.5 && (video.duration - video.currentTime <= 0.12));
    const playerLoopedInternally = !video.paused && !video.seeking &&
      video.duration >= 1.5 && prevMax >= video.duration - 0.8 && video.currentTime < 0.35;

    if (reachedEnd || playerLoopedInternally) {
      shortsState.lastScrolledKey = reelKey;
      advanceToNextShort(activeReel);
    }
  }

  function runTicks() {
    handleAds();
    handleIdlePause();
    handleShortsAutoScroll();
  }

  function init() {
    loadSettings();
    syncSettingsToMainWorld();

    let throttleTimeout = null;
    const observer = new MutationObserver(() => {
      if (throttleTimeout) return;
      throttleTimeout = setTimeout(() => {
        throttleTimeout = null;
        runTicks();
      }, 100);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    setInterval(runTicks, 200);

    window.addEventListener('yt-navigate-finish', runTicks);
    window.addEventListener('yt-page-data-updated', runTicks);
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
      setTimeout(runTicks, 200);
    }
  }).observe(document, { subtree: true, childList: true });
})();
