document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // DOM Elements
  const toggleEnabled = document.getElementById('toggleEnabled');
  const toggleBanners = document.getElementById('toggleBanners');
  const toggleMute = document.getElementById('toggleMute');
  const skipCountDisplay = document.getElementById('skipCountDisplay');
  const resetStatsBtn = document.getElementById('resetStatsBtn');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');

  const DEFAULTS = {
    enabled: true,
    autoCloseBanners: true,
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

  // Load stored settings and statistics
  function initUI() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return;
    }

    chrome.storage.local.get(DEFAULTS, (data) => {
      toggleEnabled.checked = data.enabled;
      toggleBanners.checked = data.autoCloseBanners;
      toggleMute.checked = data.autoMuteAd;

      skipCountDisplay.textContent = Number(data.skipCount || 0).toLocaleString('id-ID');
      updateStatusBadge(data.enabled);
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

    toggleBanners.addEventListener('change', () => {
      chrome.storage.local.set({ autoCloseBanners: toggleBanners.checked });
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
