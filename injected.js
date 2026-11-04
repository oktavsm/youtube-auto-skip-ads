(() => {
  'use strict';

  function triggerMainWorldSkip() {
    const selectors = [
      'button.ytp-skip-ad-button',
      'button.ytp-skip-ad-button-fix-fullscreen-grid',
      'button.ytp-ad-skip-button-modern',
      'button.ytp-ad-skip-button',
      'button[id^="skip-button:"]',
      '.ytp-skip-ad-button',
      '.ytp-ad-skip-button-modern'
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        try {
          btn.click();
        } catch (e) {}
      }
    }

    try {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (player && typeof player.skipAd === 'function') {
        player.skipAd();
      }
    } catch (e) {}
  }

  document.addEventListener('__AutoSkipAds_TriggerSkip', triggerMainWorldSkip);

  setInterval(() => {
    const player = document.querySelector('#movie_player, .html5-video-player');
    if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
      const skipBtn = document.querySelector('button.ytp-skip-ad-button, button[id^="skip-button:"]');
      if (skipBtn) {
        triggerMainWorldSkip();
      }
    }
  }, 250);
})();
