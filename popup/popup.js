document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // DOM Elements
  const toggleEnabled = document.getElementById('toggleEnabled');
  const toggleUnskippable = document.getElementById('toggleUnskippable');
  const togglePreventIdle = document.getElementById('togglePreventIdle');
  const toggleBanners = document.getElementById('toggleBanners');
  const toggleSpeed = document.getElementById('toggleSpeed');
  const speedSliderGroup = document.getElementById('speedSliderGroup');
  const speedSlider = document.getElementById('speedSlider');
  const speedValueBadge = document.getElementById('speedValueBadge');
  const toggleMute = document.getElementById('toggleMute');
  const skipCountDisplay = document.getElementById('skipCountDisplay');
  const resetStatsBtn = document.getElementById('resetStatsBtn');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');

  const DEFAULTS = {
    enabled: true,
    autoCloseBanners: true,
    skipUnskippable: true,
    preventIdlePause: true,
    speedUpAd: false,
    adSpeed: 4,
    autoMuteAd: false,
    skipCount: 0
  };

  // Update status badge UI
  function updateStatusBadge(isActive) {
    if (isActive) {
      statusBadge.className = 'status-badge status-active';
      statusText.textContent = 'Aktif';
    } else {
      statusBadge.className = 'status-badge status-inactive';
      statusText.textContent = 'Nonaktif';
    }
  }

  // Update speed group active/disabled appearance
  function updateSpeedSliderState(isEnabled) {
    if (isEnabled) {
      speedSliderGroup.classList.remove('disabled');
      speedSlider.disabled = false;
    } else {
      speedSliderGroup.classList.add('disabled');
      speedSlider.disabled = true;
    }
  }

  // Load stored settings and statistics
  function initUI() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return;
    }

    chrome.storage.local.get(DEFAULTS, (data) => {
      toggleEnabled.checked = data.enabled !== false;
      if (toggleUnskippable) {
        toggleUnskippable.checked = data.skipUnskippable !== false;
      }
      if (togglePreventIdle) {
        togglePreventIdle.checked = data.preventIdlePause !== false;
      }
      toggleBanners.checked = data.autoCloseBanners !== false;
      toggleSpeed.checked = data.speedUpAd === true;
      toggleMute.checked = data.autoMuteAd === true;

      const currentSpeed = data.adSpeed || 4;
      speedSlider.value = currentSpeed;
      speedSlider.setAttribute('aria-valuenow', currentSpeed);
      speedValueBadge.textContent = currentSpeed + 'x';

      updateSpeedSliderState(data.speedUpAd === true);
      skipCountDisplay.textContent = Number(data.skipCount || 0).toLocaleString('id-ID');
      updateStatusBadge(data.enabled !== false);
    });
  }

  // Bind change events to storage save
  function bindEvents() {
    toggleEnabled.addEventListener('change', () => {
      const isEnabled = toggleEnabled.checked;
      chrome.storage.local.set({ enabled: isEnabled }, () => {
        updateStatusBadge(isEnabled);
      });
    });

    if (toggleUnskippable) {
      toggleUnskippable.addEventListener('change', () => {
        chrome.storage.local.set({ skipUnskippable: toggleUnskippable.checked });
      });
    }

    if (togglePreventIdle) {
      togglePreventIdle.addEventListener('change', () => {
        chrome.storage.local.set({ preventIdlePause: togglePreventIdle.checked });
      });
    }

    toggleBanners.addEventListener('change', () => {
      chrome.storage.local.set({ autoCloseBanners: toggleBanners.checked });
    });

    toggleSpeed.addEventListener('change', () => {
      const isSpeedEnabled = toggleSpeed.checked;
      updateSpeedSliderState(isSpeedEnabled);
      chrome.storage.local.set({ speedUpAd: isSpeedEnabled });
    });

    speedSlider.addEventListener('input', () => {
      const val = Number(speedSlider.value);
      speedValueBadge.textContent = val + 'x';
      speedSlider.setAttribute('aria-valuenow', val);
      chrome.storage.local.set({ adSpeed: val });
    });

    toggleMute.addEventListener('change', () => {
      chrome.storage.local.set({ autoMuteAd: toggleMute.checked });
    });

    resetStatsBtn.addEventListener('click', () => {
      chrome.storage.local.set({ skipCount: 0 }, () => {
        skipCountDisplay.textContent = '0';
      });
    });

    // Real-time listener for counter updates while popup is open
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.skipCount) {
        const newCount = changes.skipCount.newValue || 0;
        skipCountDisplay.textContent = Number(newCount).toLocaleString('id-ID');
      }
    });
  }

  initUI();
  bindEvents();
});
