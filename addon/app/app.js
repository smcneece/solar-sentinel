import { st, FINE_W, FINE_H } from './state.js';
import { fmtW, todayStr, currentMinutes, sliderToTimestamp, applyHistoryToPanels, recolorPanels } from './utils.js';
import { renderSunArc } from './arc.js';
import { applyLeftPanelVisibility, fetchArrayChart, fetchGridChart, fetchBatteryChart, drawArrayChart, drawGridChart, drawBatterySocChart, drawBatteryKwhChart, initChartTooltip, initGridChartTooltip, initBatteryChartTooltip } from './charts.js';
import { renderPanels, fitViewGrid, openPanelModal, switchPanelTab, loadPanelChart, savePanelRename } from './panels.js';
import { fetchGrid, enterEditMode, exitEditMode, renderEditMode } from './layout.js';

// ── Modal helpers ─────────────────────────────────────────────────────────

export function openModal(id)  { document.getElementById(id).classList.add('open'); }
export function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Slider helpers ────────────────────────────────────────────────────────

function updateSliderToNow() {
  if (st.sliderActive) return;
  const cm = currentMinutes();
  const slider = document.getElementById('time-slider');
  slider.value = cm;
  const h = Math.floor(cm / 60), m = cm % 60;
  document.getElementById('slider-label').textContent =
    `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function sunArcMinutes() {
  const sun = st.sunData;
  if (!sun || !sun.dawn || !sun.dusk) return [0, 1440];
  const dayRange = sun.dusk - sun.dawn;
  const extMin = Math.round((dayRange * 0.16) / 60);
  const toMin = ts => { const d = new Date(ts * 1000); return d.getHours() * 60 + d.getMinutes(); };
  const arcMin = Math.max(0,    toMin(sun.dawn) - extMin);
  const arcMax = Math.min(1440, toMin(sun.dusk)  + extMin);
  if (arcMin >= arcMax) return [0, 1440];
  return [arcMin, arcMax];
}

function _setLiveActive(isLive) {
  document.getElementById('live-btn').classList.toggle('active', isLive);
  document.getElementById('next-day-btn').disabled =
    document.getElementById('date-picker').value >= todayStr();
}

// ── Data fetching ─────────────────────────────────────────────────────────

export async function fetchPanels() {
  try {
    const resp = await fetch(`${window.BASE}/api/panels`);
    if (!resp.ok) return;
    const data = await resp.json();
    st.panels = data.panels || [];
    st.gridAvailable = data.grid_available || false;
    st.batteryAvailable = data.battery_available || false;
    if (data.has_export !== undefined) st.gridHasExport = data.has_export;
    applyLeftPanelVisibility();
    if (!st.sliderActive) {
      document.getElementById('total-power').textContent = data.total_w != null ? fmtW(data.total_w) : '-- W';
      const online = (data.panels || []).filter(p => p.status === 'online').length;
      document.getElementById('header-status').textContent =
        data.count ? `${online} / ${data.count} online` : 'No inverters found';
      renderPanels(st.panels);
      requestAnimationFrame(fitViewGrid);
    }
  } catch (e) {
    console.error('fetchPanels:', e);
  }
}

async function fetchSun() {
  try {
    const resp = await fetch(`${window.BASE}/api/sun`);
    if (!resp.ok) return;
    st.sunData = await resp.json();
    const [arcMin, arcMax] = sunArcMinutes();
    const slider = document.getElementById('time-slider');
    slider.min = arcMin;
    slider.max = arcMax;
    const currentMs = st.sliderActive ? sliderToTimestamp(slider.value) : null;
    renderSunArc(st.sunData, currentMs, st.weather);
  } catch (e) {
    console.error('fetchSun:', e);
  }
}

async function fetchWeather() {
  try {
    const resp = await fetch(`${window.BASE}/api/weather`);
    if (!resp.ok) return;
    const data = await resp.json();
    st.weather = (data.today || data.tomorrow) ? data : null;
    if (st.sunData) {
      const currentMs = st.sliderActive
        ? sliderToTimestamp(parseInt(document.getElementById('time-slider').value))
        : null;
      renderSunArc(st.sunData, currentMs, st.weather);
    }
  } catch (e) {
    console.error('fetchWeather:', e);
  }
}

async function fetchHistory(dateStr) {
  if (st.historyCache[dateStr]) return st.historyCache[dateStr];
  try {
    document.getElementById('slider-label').textContent = 'Loading...';
    const resp = await fetch(`${window.BASE}/api/history?date=${dateStr}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    st.historyCache[dateStr] = data;
    return data;
  } catch (e) {
    console.error('fetchHistory:', e);
    return null;
  }
}

async function fetchSettings() {
  try {
    const resp = await fetch(`${window.BASE}/api/settings`);
    if (!resp.ok) return;
    const s = await resp.json();
    st.refreshInterval = Math.min(3600, Math.max(30, (s.refresh_interval || 300))) * 1000;
    st.showGridChart = s.show_grid_chart !== false;
    st.nameStrip = (s.name_strip || '').split(',').map(x => x.trim()).filter(Boolean);
    st.showPanelNames = s.show_panel_names !== false;
    st.showPanelUnit = s.show_panel_unit !== false;
    st.minAvgW = s.min_avg_w ?? 5;
    st.peakPanelW = s.peak_panel_w ?? 300;
    st.invertBatteryPower = s.invert_battery_power === true;
    applyLeftPanelVisibility();
  } catch (e) { /* ignore */ }
}

// ── Refresh loop ──────────────────────────────────────────────────────────

let _lastRefreshMs = Date.now();

function updateCountdown() {
  const el = document.getElementById('refresh-countdown');
  if (!el) return;
  if (st.sliderActive) { el.textContent = ''; return; }
  const remaining = Math.max(0, Math.ceil((st.refreshInterval - (Date.now() - _lastRefreshMs)) / 1000));
  el.textContent = remaining + 's';
}

function scheduleRefresh() {
  if (st.refreshTimer) clearTimeout(st.refreshTimer);
  st.refreshTimer = setTimeout(async () => {
    _lastRefreshMs = Date.now();
    await fetchPanels();
    if (!st.sliderActive) {
      updateSliderToNow();
      if (st.sunData) renderSunArc(st.sunData, null, st.weather);
      if (st.chartRange === 'today') fetchArrayChart();
      if (st.showGridChart && st.gridChartRange === 'today') fetchGridChart();
      if (st.batteryAvailable) {
        fetchBatteryStatus();
        if (st.leftPanelTab === 'battery' && st.batteryChartRange === 'today') fetchBatteryChart();
      }
    }
    scheduleRefresh();
  }, st.refreshInterval);
}

// ── Playback ──────────────────────────────────────────────────────────────

function updatePlayBtn() {
  const btn = document.getElementById('play-btn');
  if (!btn) return;
  btn.textContent = st.isPlaying ? '⏸' : '▶';
  btn.title = st.isPlaying ? 'Pause' : 'Play';
}

function stopPlayback() {
  if (!st.isPlaying) return;
  st.isPlaying = false;
  clearInterval(st.playbackTimer);
  st.playbackTimer = null;
  updatePlayBtn();
}

function playTick() {
  const slider = document.getElementById('time-slider');
  const dateStr = document.getElementById('date-picker').value || todayStr();
  const isToday = dateStr === todayStr();
  const maxVal = isToday ? currentMinutes() : parseInt(slider.max);
  const step = 5;
  let val = parseInt(slider.value) + step;
  if (val >= maxVal) {
    slider.value = maxVal;
    stopPlayback();
    onSliderInput();
    return;
  }
  slider.value = val;
  const h = Math.floor(val / 60), m = val % 60;
  document.getElementById('slider-label').textContent =
    `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  if (st.sunData) renderSunArc(st.sunData, sliderToTimestamp(val), st.weather);
  const history = st.historyCache[dateStr];
  if (history) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const sliderTs = new Date(y, mo - 1, d, h, m).getTime();
    let panels = applyHistoryToPanels(st.panels, history, sliderTs);
    panels = recolorPanels(panels);
    const online = panels.filter(p => p.status === 'online' && p.power_w > 0);
    document.getElementById('total-power').textContent = fmtW(online.reduce((s, p) => s + p.power_w, 0));
    renderPanels(panels);
    requestAnimationFrame(fitViewGrid);
  } else {
    onSliderInput();
  }
}

function startPlayback() {
  if (st.isPlaying) return;
  const slider = document.getElementById('time-slider');
  const dateStr = document.getElementById('date-picker').value || todayStr();
  const isToday = dateStr === todayStr();
  const maxVal = isToday ? currentMinutes() : parseInt(slider.max);
  if (!st.sliderActive || parseInt(slider.value) >= maxVal - 5) {
    slider.value = slider.min;
    st.sliderActive = true;
    _setLiveActive(false);
    onSliderInput();
  }
  st.isPlaying = true;
  updatePlayBtn();
  st.playbackTimer = setInterval(playTick, playInterval());
}

function togglePlay() {
  if (st.isPlaying) stopPlayback(); else startPlayback();
}

function playInterval() {
  return st.playbackSpeed === 2 ? 50 : st.playbackSpeed === 1 ? 100 : 200;
}

function speedLabel() {
  return st.playbackSpeed === 2 ? '2x' : st.playbackSpeed === 1 ? '1x' : '0.5x';
}

function togglePlaySpeed() {
  st.playbackSpeed = st.playbackSpeed === 0.5 ? 1 : st.playbackSpeed === 1 ? 2 : 0.5;
  const btn = document.getElementById('play-speed-btn');
  if (btn) {
    btn.textContent = speedLabel();
    btn.classList.toggle('active', st.playbackSpeed === 2);
  }
  if (st.isPlaying) {
    clearInterval(st.playbackTimer);
    st.playbackTimer = setInterval(playTick, playInterval());
  }
}

function jumpToStart() {
  stopPlayback();
  const slider = document.getElementById('time-slider');
  slider.value = slider.min;
  st.sliderActive = true;
  _setLiveActive(false);
  onSliderInput();
}

// ── Slider and date picker ────────────────────────────────────────────────

function onLive() {
  stopPlayback();
  document.getElementById('date-picker').value = todayStr();
  st.sliderActive = false;
  st.historyCache = {};
  _setLiveActive(true);
  updateSliderToNow();
  renderPanels(st.panels);
  requestAnimationFrame(fitViewGrid);
  if (st.sunData) renderSunArc(st.sunData, null, st.weather);
  const liveOnline = (st.panels || []).filter(p => p.status === 'online');
  document.getElementById('total-power').textContent = fmtW(liveOnline.reduce((s, p) => s + p.power_w, 0));
  const total = (st.panels || []).length;
  document.getElementById('header-status').textContent =
    total ? `${liveOnline.length} / ${total} online` : 'No inverters found';
}

function onToday() {
  const dp = document.getElementById('date-picker');
  if (dp.value === todayStr() && !st.sliderActive) return;
  dp.value = todayStr();
  st.historyCache = {};
  onDateChange();
}

function changeDay(delta) {
  const dp = document.getElementById('date-picker');
  const cur = dp.value || todayStr();
  const [y, mo, d] = cur.split('-').map(Number);
  const dt = new Date(y, mo - 1, d + delta);
  const newStr = dt.toISOString().slice(0, 10);
  if (newStr > todayStr()) return;
  dp.value = newStr;
  st.historyCache = {};
  onDateChange(true);
}

async function onSliderInput() {
  const slider = document.getElementById('time-slider');
  let val = parseInt(slider.value);
  const label = document.getElementById('slider-label');
  const dateStr = document.getElementById('date-picker').value || todayStr();
  const isToday = dateStr === todayStr();

  if (isToday) {
    const cm = currentMinutes();
    if (val >= cm) {
      slider.value = cm;
      st.sliderActive = false;
      _setLiveActive(true);
      updateSliderToNow();
      renderPanels(st.panels);
      requestAnimationFrame(fitViewGrid);
      if (st.sunData) renderSunArc(st.sunData, null, st.weather);
      return;
    }
  }

  st.sliderActive = true;
  _setLiveActive(false);

  const h = Math.floor(val / 60), m = val % 60;
  const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  label.textContent = timeStr;

  renderSunArc(st.sunData, sliderToTimestamp(val), st.weather);

  const [y, mo, d] = dateStr.split('-').map(Number);
  const sliderTs = new Date(y, mo - 1, d, h, m).getTime();

  const history = await fetchHistory(dateStr);
  label.textContent = history && history.statistics_fallback ? timeStr + ' (hourly)' : timeStr;
  if (!history) return;

  let panels = applyHistoryToPanels(st.panels, history, sliderTs);
  panels = recolorPanels(panels);

  const online = panels.filter(p => p.status === 'online' && p.power_w > 0);
  document.getElementById('total-power').textContent =
    fmtW(online.reduce((s, p) => s + p.power_w, 0));

  renderPanels(panels);
  requestAnimationFrame(fitViewGrid);
}

async function onDateChange(preserveSlider = false) {
  stopPlayback();
  const dateStr = document.getElementById('date-picker').value;
  if (!dateStr) return;
  st.historyCache = {};
  const slider = document.getElementById('time-slider');
  if (dateStr !== todayStr() && !preserveSlider) {
    slider.value = slider.min;
  }
  st.sliderActive = true;
  _setLiveActive(false);
  await onSliderInput();
  if (st.chartRange === 'today') fetchArrayChart();
  if (st.gridChartRange === 'today') fetchGridChart();
  if (st.batteryAvailable && st.batteryChartRange === 'today') fetchBatteryChart();
}

// ── Settings modal ────────────────────────────────────────────────────────

async function openAbout() {
  openModal('about-modal');
  try {
    const resp = await fetch(`${window.BASE}/api/about`);
    if (!resp.ok) return;
    const d = await resp.json();
    document.getElementById('about-version').textContent = d.version || '--';
    document.getElementById('about-ha-version').textContent = d.ha_version || '--';
    document.getElementById('about-mode').textContent = d.mode || '--';
    document.getElementById('about-inverters').textContent = d.inverters_found ?? '--';
    document.getElementById('about-tz').textContent = d.ha_tz || '--';
  } catch (e) { console.error('openAbout:', e); }
}

async function openSettings() {
  openModal('settings-modal');
  document.getElementById('setting-invert-battery-row').style.display = st.batteryAvailable ? '' : 'none';
  try {
    const resp = await fetch(`${window.BASE}/api/settings`);
    if (!resp.ok) return;
    const s = await resp.json();
    document.getElementById('setting-interval').value = s.refresh_interval || 30;
    document.getElementById('setting-min-avg-w').value = s.min_avg_w ?? 5;
    document.getElementById('setting-peak-panel-w').value = s.peak_panel_w ?? 300;
    document.getElementById('setting-show-grid').checked = s.show_grid_chart !== false;
    document.getElementById('setting-show-panel-names').checked = s.show_panel_names !== false;
    document.getElementById('setting-show-panel-unit').checked = s.show_panel_unit !== false;
    document.getElementById('setting-invert-battery').checked = s.invert_battery_power === true;
    document.getElementById('setting-name-strip').value = s.name_strip || '';
  } catch (e) { console.error('openSettings:', e); }
}

async function saveSettings() {
  const interval = Math.min(3600, Math.max(30, parseInt(document.getElementById('setting-interval').value) || 300));
  const showGrid = document.getElementById('setting-show-grid').checked;
  try {
    await fetch(`${window.BASE}/api/settings`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        refresh_interval: interval,
        min_avg_w: Math.max(0, parseInt(document.getElementById('setting-min-avg-w').value) || 0),
        peak_panel_w: Math.max(0, parseInt(document.getElementById('setting-peak-panel-w').value) || 0),
        show_grid_chart: showGrid,
        show_panel_names: document.getElementById('setting-show-panel-names').checked,
        show_panel_unit: document.getElementById('setting-show-panel-unit').checked,
        invert_battery_power: document.getElementById('setting-invert-battery').checked,
        name_strip: document.getElementById('setting-name-strip').value.trim(),
      }),
    });
    st.refreshInterval = Math.min(3600, Math.max(30, interval)) * 1000;
    st.showGridChart = showGrid;
    st.nameStrip = (document.getElementById('setting-name-strip').value.trim())
      .split(',').map(x => x.trim()).filter(Boolean);
    st.showPanelNames = document.getElementById('setting-show-panel-names').checked;
    st.showPanelUnit = document.getElementById('setting-show-panel-unit').checked;
    st.invertBatteryPower = document.getElementById('setting-invert-battery').checked;
    st.minAvgW = Math.max(0, parseInt(document.getElementById('setting-min-avg-w').value) || 0);
    st.peakPanelW = Math.max(0, parseInt(document.getElementById('setting-peak-panel-w').value) || 0);
    applyLeftPanelVisibility();
    renderPanels(st.panels);
    requestAnimationFrame(fitViewGrid);
    closeModal('settings-modal');
  } catch (e) { console.error('saveSettings:', e); }
}

// ── Battery status ────────────────────────────────────────────────────────

async function fetchBatteryStatus() {
  if (!st.batteryAvailable) return;
  try {
    const resp = await fetch(`${window.BASE}/api/battery_status`);
    if (!resp.ok) return;
    const data = await resp.json();
    const batteries = data.batteries || [];
    if (!batteries.length) return;
    st.batteryList = batteries;
    if (st.selectedBatteryIdx >= batteries.length) st.selectedBatteryIdx = 0;
    st.batteryStatus = batteries[st.selectedBatteryIdx];
    renderBatterySelector();
    updateBatteryStatusDisplay(st.batteryStatus);
  } catch (e) {
    console.error('fetchBatteryStatus:', e);
  }
}

function renderBatterySelector() {
  const el = document.getElementById('battery-selector');
  if (!el) return;
  if (st.batteryList.length < 2) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = st.batteryList.map((b, i) =>
    `<button class="battery-sel-btn${i === st.selectedBatteryIdx ? ' active' : ''}" data-idx="${i}">${b.name || 'Battery ' + (i+1)}</button>`
  ).join('');
  el.querySelectorAll('.battery-sel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      st.selectedBatteryIdx = parseInt(btn.dataset.idx);
      st.batteryStatus = st.batteryList[st.selectedBatteryIdx];
      renderBatterySelector();
      updateBatteryStatusDisplay(st.batteryStatus);
      fetchBatteryChart();
    });
  });
}

function updateBatteryStatusDisplay(bat) {
  if (!bat) return;

  const nameEl = document.getElementById('battery-panel-title');
  if (nameEl) nameEl.textContent = bat.name || 'Battery';

  const socEl = document.getElementById('battery-soc-pct');
  if (socEl) socEl.textContent = bat.soc_pct != null ? `${bat.soc_pct.toFixed(0)} %` : '-- %';

  const powerEl = document.getElementById('battery-power-label');
  if (powerEl) {
    const dir = bat.direction || 'idle';
    const w = bat.power_w || 0;
    if (dir === 'charging')    powerEl.textContent = `↑ ${fmtW(w)} charging`;
    else if (dir === 'discharging') powerEl.textContent = `↓ ${fmtW(w)} discharging`;
    else powerEl.textContent = 'Idle';
  }

  const modeEl = document.getElementById('battery-mode-label');
  if (modeEl) {
    const raw = bat.mode || '';
    const friendly = raw.replace(/[_-]/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    modeEl.textContent = friendly;
  }

  const todayEl = document.getElementById('battery-today-label');
  if (todayEl) {
    todayEl.textContent =
      `${(bat.today_charged_kwh || 0).toFixed(1)} in / ${(bat.today_discharged_kwh || 0).toFixed(1)} out kWh`;
  }
}

function switchLeftPanelTab(tab) {
  st.leftPanelTab = tab;
  const gridContent    = document.getElementById('left-grid-content');
  const batteryContent = document.getElementById('left-battery-content');
  const onGrid = tab === 'grid';
  if (gridContent)    gridContent.style.display    = onGrid ? 'flex' : 'none';
  if (batteryContent) batteryContent.style.display = onGrid ? 'none' : 'flex';
  document.getElementById('left-tab-grid')?.classList.toggle('active', onGrid);
  document.getElementById('left-tab-battery')?.classList.toggle('active', !onGrid);
  if (!onGrid) {
    if (st.batteryStatus) updateBatteryStatusDisplay(st.batteryStatus);
    else fetchBatteryStatus();
    fetchBatteryChart();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  document.getElementById('date-picker').value = todayStr();
  document.getElementById('date-picker').max = todayStr();
  const _initSlider = document.getElementById('time-slider');
  _initSlider.max = 1440;
  _initSlider.value = currentMinutes();

  await fetchSettings();
  await fetchGrid();
  await fetchPanels();
  await fetchSun();
  fetchWeather();
  if (st.batteryAvailable) await fetchBatteryStatus();
  updateSliderToNow();

  // Refresh panels on rename-clear event from panels.js
  document.addEventListener('solar:refresh-panels', fetchPanels);

  document.getElementById('time-slider').addEventListener('input', () => { stopPlayback(); onSliderInput(); });
  document.getElementById('play-jump-btn').addEventListener('click', jumpToStart);
  document.getElementById('play-btn').addEventListener('click', togglePlay);
  document.getElementById('play-speed-btn').addEventListener('click', togglePlaySpeed);
  document.getElementById('date-picker').addEventListener('change', onDateChange);
  document.getElementById('prev-day-btn').addEventListener('click', () => changeDay(-1));
  document.getElementById('next-day-btn').addEventListener('click', () => changeDay(1));
  document.getElementById('today-btn').addEventListener('click', onToday);
  document.getElementById('live-btn').addEventListener('click', onLive);

  document.getElementById('panel-close').addEventListener('click', () => closeModal('panel-modal'));
  document.getElementById('panel-cancel-btn').addEventListener('click', () => closeModal('panel-modal'));
  document.getElementById('panel-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('panel-modal');
  });
  document.getElementById('panel-save-btn').addEventListener('click', savePanelRename);
  document.getElementById('panel-rename-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') savePanelRename();
    if (e.key === 'Escape') closeModal('panel-modal');
  });
  document.getElementById('panel-tab-details-btn').addEventListener('click', () => switchPanelTab('details'));
  document.getElementById('panel-tab-history-btn').addEventListener('click', () => switchPanelTab('history'));
  document.querySelectorAll('.chart-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (st.panelTarget) loadPanelChart(st.panelTarget.entity_id, btn.dataset.range);
    });
  });

  document.getElementById('version-badge').addEventListener('click', openAbout);
  document.getElementById('about-close').addEventListener('click', () => closeModal('about-modal'));
  document.getElementById('about-debug-btn').addEventListener('click', async () => {
    const btn = document.getElementById('about-debug-btn');
    const status = document.getElementById('about-debug-status');
    btn.disabled = true;
    status.textContent = 'Gathering...';
    try {
      const resp = await fetch(`${window.BASE}/api/debug`);
      const data = await resp.json();
      data.client = {
        userAgent: navigator.userAgent,
        screenWidth: screen.width,
        screenHeight: screen.height,
        devicePixelRatio: window.devicePixelRatio,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'solar-sentinel-debug.json';
      a.click();
      URL.revokeObjectURL(url);
      status.textContent = 'Downloaded.';
    } catch (e) {
      status.textContent = 'Failed. Check browser console.';
      console.error('debug download failed:', e);
    }
    btn.disabled = false;
    setTimeout(() => { status.textContent = ''; }, 4000);
  });
  document.getElementById('about-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('about-modal');
  });

  document.getElementById('edit-layout-btn').addEventListener('click', enterEditMode);
  document.getElementById('reset-confirm-no').addEventListener('click', () => closeModal('reset-confirm-modal'));
  document.getElementById('reset-confirm-yes').addEventListener('click', () => {
    st.editPositions = {};
    st.editRotations = {};
    st.editLabels = [];
    st.editRows = 4 * FINE_H;
    st.editCols = 16 * FINE_W;
    closeModal('reset-confirm-modal');
    renderEditMode(st.panels);
  });
  document.getElementById('reset-confirm-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('reset-confirm-modal');
  });
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', () => closeModal('settings-modal'));
  document.getElementById('settings-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('settings-modal');
  });
  document.getElementById('settings-save-btn').addEventListener('click', saveSettings);
  document.getElementById('settings-rediscover-btn').addEventListener('click', async () => {
    document.getElementById('header-status').textContent = 'Re-discovering...';
    try {
      await fetch(`${window.BASE}/api/rediscover`, {method: 'POST'});
      closeModal('settings-modal');
      setTimeout(fetchPanels, 3000);
    } catch (e) { console.error(e); }
  });

  document.getElementById('settings-export-btn').addEventListener('click', async () => {
    try {
      const [lr, gr] = await Promise.all([
        fetch(`${window.BASE}/api/layout`),
        fetch(`${window.BASE}/api/grid`),
      ]);
      const layout = await lr.json();
      const grid = await gr.json();
      const blob = new Blob([JSON.stringify({layout, grid}, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'solar-sentinel-layout.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error('Export failed:', e); }
  });

  document.getElementById('settings-import-btn').addEventListener('click', () => {
    document.getElementById('settings-import-file').click();
  });

  document.getElementById('settings-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const data = JSON.parse(await file.text());
      if (!data.layout || !data.grid) { alert('Invalid layout file.'); return; }
      await fetch(`${window.BASE}/api/layout`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data.layout)});
      await fetch(`${window.BASE}/api/grid`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data.grid)});
      location.reload();
    } catch (err) { alert('Import failed: ' + err.message); }
  });

  setInterval(fetchSun, 5 * 60 * 1000);
  setInterval(fetchWeather, 60 * 60 * 1000);

  document.querySelectorAll('.chart-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      st.chartRange = btn.dataset.range;
      fetchArrayChart();
    });
  });
  fetchArrayChart();
  initChartTooltip();

  document.querySelectorAll('.grid-chart-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.grid-chart-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      st.gridChartRange = btn.dataset.range;
      st.lastGridPoints = [];
      fetchGridChart();
    });
  });
  initGridChartTooltip();

  document.getElementById('left-tab-grid')?.addEventListener('click', () => switchLeftPanelTab('grid'));
  document.getElementById('left-tab-battery')?.addEventListener('click', () => switchLeftPanelTab('battery'));

  document.querySelectorAll('.battery-chart-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.battery-chart-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      st.batteryChartRange = btn.dataset.range;
      st.lastBatteryPoints = [];
      fetchBatteryChart();
    });
  });
  initBatteryChartTooltip();

  let _resizeTimer = null;
  window.addEventListener('resize', () => {
    if (st.chartRange) drawArrayChart(st.lastChartPoints || [], st.chartRange);
    if (st.lastGridPoints.length) drawGridChart(st.lastGridPoints, st.gridHasExport);
    if (st.lastBatteryPoints.length) {
      if (st.batteryChartType === 'soc') drawBatterySocChart(st.lastBatteryPoints);
      else drawBatteryKwhChart(st.lastBatteryPoints);
    }
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(fitViewGrid, 100);
    if (st.sunData) renderSunArc(st.sunData, st.sliderActive ? sliderToTimestamp(parseInt(document.getElementById('time-slider').value)) : null, st.weather);
    if (st.editMode) renderEditMode(st.panels);
  });

  scheduleRefresh();
  setInterval(updateCountdown, 1000);
}

document.addEventListener('DOMContentLoaded', init);
