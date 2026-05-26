import { st, FINE_W, FINE_H } from './state.js';
import { fmtW, todayStr, currentMinutes, sliderToTimestamp, applyHistoryToPanels, recolorPanels } from './utils.js';
import { renderSunArc } from './arc.js';
import { applyGridVisibility, fetchArrayChart, fetchGridChart, drawArrayChart, drawGridChart, initChartTooltip, initGridChartTooltip } from './charts.js';
import { renderPanels, openPanelModal, switchPanelTab, loadPanelChart, savePanelRename } from './panels.js';
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
    if (data.has_export !== undefined) st.gridHasExport = data.has_export;
    applyGridVisibility();
    if (!st.sliderActive) {
      document.getElementById('total-power').textContent = data.total_w != null ? fmtW(data.total_w) : '-- W';
      const online = (data.panels || []).filter(p => p.status === 'online').length;
      document.getElementById('header-status').textContent =
        data.count ? `${online} / ${data.count} online` : 'No inverters found';
      renderPanels(st.panels);
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
    const currentMs = st.sliderActive ? sliderToTimestamp(
      document.getElementById('time-slider').value) : null;
    renderSunArc(st.sunData, currentMs);
  } catch (e) {
    console.error('fetchSun:', e);
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
    st.refreshInterval = Math.max(10, (s.refresh_interval || 30)) * 1000;
    st.showGridChart = s.show_grid_chart !== false;
    applyGridVisibility();
  } catch (e) { /* ignore */ }
}

// ── Refresh loop ──────────────────────────────────────────────────────────

function scheduleRefresh() {
  if (st.refreshTimer) clearTimeout(st.refreshTimer);
  st.refreshTimer = setTimeout(async () => {
    await fetchPanels();
    if (!st.sliderActive) {
      updateSliderToNow();
      if (st.sunData) renderSunArc(st.sunData, null);
      if (st.chartRange === 'today') fetchArrayChart();
    }
    scheduleRefresh();
  }, st.refreshInterval);
}

// ── Slider and date picker ────────────────────────────────────────────────

function onLive() {
  document.getElementById('date-picker').value = todayStr();
  st.sliderActive = false;
  st.historyCache = {};
  _setLiveActive(true);
  updateSliderToNow();
  renderPanels(st.panels);
  if (st.sunData) renderSunArc(st.sunData, null);
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
      if (st.sunData) renderSunArc(st.sunData, null);
      return;
    }
  }

  st.sliderActive = true;
  _setLiveActive(false);

  const h = Math.floor(val / 60), m = val % 60;
  const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  label.textContent = timeStr;

  renderSunArc(st.sunData, sliderToTimestamp(val));

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
}

async function onDateChange(preserveSlider = false) {
  const dateStr = document.getElementById('date-picker').value;
  if (!dateStr) return;
  st.historyCache = {};
  const slider = document.getElementById('time-slider');
  if (dateStr !== todayStr() && !preserveSlider) {
    let dawnMin = 360;
    if (st.sunData && st.sunData.dawn) {
      const dd = new Date(st.sunData.dawn * 1000);
      dawnMin = dd.getHours() * 60 + dd.getMinutes();
    }
    slider.value = dawnMin;
  }
  st.sliderActive = true;
  _setLiveActive(false);
  await onSliderInput();
  if (st.chartRange === 'today') fetchArrayChart();
  if (st.gridChartRange === 'today') fetchGridChart();
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
  try {
    const resp = await fetch(`${window.BASE}/api/settings`);
    if (!resp.ok) return;
    const s = await resp.json();
    document.getElementById('setting-interval').value = s.refresh_interval || 30;
    document.getElementById('setting-min-avg-w').value = s.min_avg_w ?? 5;
    document.getElementById('setting-show-grid').checked = s.show_grid_chart !== false;
  } catch (e) { console.error('openSettings:', e); }
}

async function saveSettings() {
  const interval = parseInt(document.getElementById('setting-interval').value) || 30;
  const showGrid = document.getElementById('setting-show-grid').checked;
  try {
    await fetch(`${window.BASE}/api/settings`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        refresh_interval: interval,
        min_avg_w: Math.max(0, parseInt(document.getElementById('setting-min-avg-w').value) || 0),
        show_grid_chart: showGrid,
      }),
    });
    st.refreshInterval = Math.max(10, interval) * 1000;
    st.showGridChart = showGrid;
    applyGridVisibility();
    closeModal('settings-modal');
  } catch (e) { console.error('saveSettings:', e); }
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
  updateSliderToNow();

  // Refresh panels on rename-clear event from panels.js
  document.addEventListener('solar:refresh-panels', fetchPanels);

  document.getElementById('time-slider').addEventListener('input', onSliderInput);
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
      const text = await resp.text();
      // navigator.clipboard requires HTTPS; HA ingress is HTTP so use execCommand fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      status.textContent = 'Copied to clipboard.';
    } catch (e) {
      status.textContent = 'Failed. Check browser console.';
      console.error('debug copy failed:', e);
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

  window.addEventListener('resize', () => {
    if (st.chartRange) drawArrayChart(st.lastChartPoints || [], st.chartRange);
    if (st.lastGridPoints.length) drawGridChart(st.lastGridPoints, st.gridHasExport);
  });

  scheduleRefresh();
}

document.addEventListener('DOMContentLoaded', init);
