import { st } from './state.js';
import { fmtW, todayStr, currentMinutes, tzDayStartMs, tzHourMin, tzMinutes, tzWallToMs, applyHistoryToPanels, recolorPanels } from './utils.js';
import { fetchGrid } from './layout.js';
import { renderPanelGridMobile, switchPanelTab, loadPanelChart, savePanelRename } from './panels.js';
import { renderSunArc } from './arc.js';
import { drawGridChart, drawArrayChart, drawBatterySocChart, drawBatteryKwhChart } from './charts.js';

// ── Build mobile HTML shell ───────────────────────────────────────────────

function buildMobileShell() {
  const hide = ['.header', '#panels-section', '.color-legend', '.arc-section'];
  for (const sel of hide) {
    const el = document.querySelector(sel);
    if (el) el.style.display = 'none';
  }
  document.body.classList.add('mobile-view');

  const shell = document.createElement('div');
  shell.id = 'm-shell';
  shell.innerHTML = `
    <div id="m-content">

      <div id="m-tab-panels" class="m-tab-pane active">
        <div id="m-panel-grid"></div>
        <div id="m-summary-row">
          <span id="m-time-label">Live</span>
          <span id="m-summary-power">-- W</span>
          <span id="m-online-count">--</span>
        </div>
        <div id="m-color-legend">
          <span class="m-legend-label m-legend-low">LOW</span>
          <div class="m-legend-bar"></div>
          <span class="m-legend-label m-legend-high">HIGH</span>
        </div>
        <div id="m-timeline-area">
          <svg id="m-sun-arc" viewBox="0 0 800 220" preserveAspectRatio="xMidYMid meet"
               style="width:100%;height:auto;display:block"></svg>
          <div id="m-slider-wrap">
            <input type="range" id="m-time-slider" min="0" max="1439" step="5" value="720">
            <div class="m-slider-ticks">
              <span>Dawn</span><span>Noon</span><span>Dusk</span>
            </div>
          </div>
        </div>
        <div id="m-timeline-controls">
          <button class="m-ctrl-btn" id="m-start-btn" title="Start of day">&#9646;&#9664;</button>
          <button class="m-ctrl-btn" id="m-play-btn" title="Play">&#9654;</button>
          <button class="m-ctrl-btn m-day-arrow" id="m-prev-day-btn" title="Previous day">&#8249;</button>
          <span id="m-date-label" style="cursor:pointer">${todayStr()}</span>
          <input type="date" id="m-date-input" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0">
          <button class="m-ctrl-btn m-day-arrow" id="m-next-day-btn" title="Next day">&#8250;</button>
          <button class="m-ctrl-btn m-live-btn active" id="m-live-btn">Live</button>
        </div>
      </div>

      <div id="m-tab-grid" class="m-tab-pane">
        <div class="m-chart-header">
          <span class="m-chart-title">Grid</span>
          <span class="m-chart-kwh" id="m-grid-kwh">-- kWh</span>
        </div>
        <div class="m-range-btns" id="m-grid-range-btns">
          <button class="m-range-btn active" data-range="today">Today</button>
          <button class="m-range-btn" data-range="week">Week</button>
          <button class="m-range-btn" data-range="month">Month</button>
          <button class="m-range-btn" data-range="year">Year</button>
        </div>
        <div class="m-chart-wrap"><canvas id="m-grid-canvas"></canvas></div>
        <p class="m-chart-hint">Tap chart to see values</p>
      </div>

      <div id="m-tab-production" class="m-tab-pane">
        <div class="m-chart-header">
          <span class="m-chart-title">Production</span>
          <span class="m-chart-kwh" id="m-prod-kwh">-- kWh</span>
        </div>
        <div class="m-range-btns" id="m-prod-range-btns">
          <button class="m-range-btn active" data-range="today">Today</button>
          <button class="m-range-btn" data-range="week">Week</button>
          <button class="m-range-btn" data-range="month">Month</button>
          <button class="m-range-btn" data-range="year">Year</button>
        </div>
        <div class="m-chart-wrap"><canvas id="m-prod-canvas"></canvas></div>
        <p class="m-chart-hint">Tap chart to see values</p>
      </div>

      <div id="m-tab-battery" class="m-tab-pane">
        <div class="m-chart-header">
          <span class="m-chart-title">Battery</span>
          <span class="m-chart-kwh" id="m-battery-soc">-- %</span>
        </div>
        <div class="m-range-btns" id="m-battery-range-btns">
          <button class="m-range-btn active" data-range="today">Today</button>
          <button class="m-range-btn" data-range="week">Week</button>
          <button class="m-range-btn" data-range="month">Month</button>
          <button class="m-range-btn" data-range="year">Year</button>
        </div>
        <div class="m-chart-wrap"><canvas id="m-battery-canvas"></canvas></div>
        <p class="m-chart-hint">Tap chart to see values</p>
      </div>

      <div id="m-tab-settings" class="m-tab-pane">
        <div class="m-settings-body">
          <p class="m-set-note">Some options (panel layout, grid chart visibility, panel names) are only available in the desktop browser version.</p>
          <div class="m-set-group">
            <label class="m-set-label" for="m-set-interval">Refresh interval (seconds)</label>
            <input class="m-set-input" id="m-set-interval" type="number" min="30" max="3600">
          </div>
          <div class="m-set-group">
            <label class="m-set-label" for="m-set-min-avg-w">Min avg W (hide panels below)</label>
            <input class="m-set-input" id="m-set-min-avg-w" type="number" min="0">
          </div>
          <div class="m-set-group">
            <label class="m-set-label" for="m-set-peak-panel-w">Peak panel W (color scale max)</label>
            <input class="m-set-input" id="m-set-peak-panel-w" type="number" min="0">
          </div>
          <div class="m-set-check-row" id="m-set-invert-battery-row" style="display:none">
            <label class="m-set-check-label">
              <input type="checkbox" id="m-set-invert-battery"> Invert battery power
            </label>
          </div>
          <div class="m-set-actions">
            <button class="m-set-btn m-set-save-btn" id="m-set-save-btn">Save</button>
            <button class="m-set-btn m-set-rediscover-btn" id="m-set-rediscover-btn">Rediscover Panels</button>
          </div>
          <div class="m-set-sponsor">
            <p class="m-set-sponsor-text">If Solar Sentinel saves you time, consider sponsoring to help keep development going.</p>
            <a class="m-set-sponsor-btn" href="https://github.com/sponsors/smcneece" target="_blank" rel="noopener">&#9829; Sponsor on GitHub</a>
          </div>
        </div>
      </div>

    </div>

    <nav id="m-bottom-nav">
      <div class="m-nav-logo">
        <img src="${window.BASE}/icon.png" class="m-nav-logo-icon" alt="Solar Sentinel">
      </div>
      <button class="m-nav-btn active" data-tab="panels">
        <span class="m-nav-icon">&#128306;</span>
        <span class="m-nav-label">Panels</span>
      </button>
      <button class="m-nav-btn" data-tab="production">
        <span class="m-nav-icon">&#9728;&#xFE0F;</span>
        <span class="m-nav-label">Production</span>
      </button>
      <button class="m-nav-btn" data-tab="grid">
        <span class="m-nav-icon">&#9889;</span>
        <span class="m-nav-label">Grid</span>
      </button>
      <button class="m-nav-btn m-nav-battery" data-tab="battery" style="display:none">
        <span class="m-nav-icon">&#128267;</span>
        <span class="m-nav-label">Battery</span>
      </button>
      <button class="m-nav-btn m-nav-settings" data-tab="settings">
        <span class="m-nav-icon">&#9881;&#xFE0F;</span>
        <span class="m-nav-label">Settings</span>
      </button>
    </nav>
  `;
  document.body.appendChild(shell);
}

// ── Tab switching ─────────────────────────────────────────────────────────

let _activeTab = 'panels';

function switchTab(name) {
  _activeTab = name;
  document.querySelectorAll('.m-tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.m-nav-btn[data-tab]').forEach(el =>
    el.classList.toggle('active', el.dataset.tab === name)
  );
  const pane = document.getElementById(`m-tab-${name}`);
  if (pane) pane.classList.add('active');
  if (name === 'settings')    loadSettingsTab();
  if (name === 'grid')        fetchMobileGridChart();
  if (name === 'production')  fetchMobileProductionChart();
  if (name === 'battery')     fetchMobileBatteryChart();
}

// ── Toast ─────────────────────────────────────────────────────────────────

let _toastDismissListener = null;

function _dismissToast(t) {
  t.classList.remove('visible');
  setTimeout(() => { if (t.parentNode) t.remove(); }, 300);
}

function showToast(msg, durationMs = 2000, html = false, persistent = false) {
  const existing = document.getElementById('m-toast');
  if (existing) {
    existing.remove();
    if (_toastDismissListener) {
      document.removeEventListener('touchstart', _toastDismissListener);
      _toastDismissListener = null;
    }
  }
  const t = document.createElement('div');
  t.id = 'm-toast';
  if (html) t.innerHTML = msg;
  else t.textContent = msg;
  document.getElementById('m-shell').appendChild(t);
  requestAnimationFrame(() => {
    t.classList.add('visible');
    if (persistent) {
      setTimeout(() => {
        _toastDismissListener = () => {
          _dismissToast(t);
          _toastDismissListener = null;
        };
        document.addEventListener('touchstart', _toastDismissListener, { once: true, passive: true });
      }, 350);
    } else {
      setTimeout(() => _dismissToast(t), durationMs);
    }
  });
}

// ── Modal helpers (panel detail modal only) ───────────────────────────────

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Settings tab ──────────────────────────────────────────────────────────

async function loadSettingsTab() {
  const row = document.getElementById('m-set-invert-battery-row');
  if (row) row.style.display = st.batteryAvailable ? '' : 'none';
  try {
    const resp = await fetch(`${window.BASE}/api/settings`);
    if (!resp.ok) return;
    const s = await resp.json();
    document.getElementById('m-set-interval').value         = s.refresh_interval || 30;
    document.getElementById('m-set-min-avg-w').value        = s.min_avg_w ?? 5;
    document.getElementById('m-set-peak-panel-w').value     = s.peak_panel_w ?? 300;
    document.getElementById('m-set-invert-battery').checked     = s.invert_battery_power === true;
  } catch (e) { console.error('loadSettingsTab:', e); }
}

async function saveSettings() {
  const interval = Math.min(3600, Math.max(30,
    parseInt(document.getElementById('m-set-interval').value) || 300));
  try {
    await fetch(`${window.BASE}/api/settings`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        refresh_interval:     interval,
        min_avg_w:            Math.max(0, parseInt(document.getElementById('m-set-min-avg-w').value) || 0),
        peak_panel_w:         Math.max(0, parseInt(document.getElementById('m-set-peak-panel-w').value) || 0),
        invert_battery_power: document.getElementById('m-set-invert-battery').checked,
      }),
    });
    st.refreshInterval    = Math.min(3600, Math.max(30, interval)) * 1000;
    st.minAvgW            = Math.max(0, parseInt(document.getElementById('m-set-min-avg-w').value) || 0);
    st.peakPanelW         = Math.max(0, parseInt(document.getElementById('m-set-peak-panel-w').value) || 0);
    st.invertBatteryPower = document.getElementById('m-set-invert-battery').checked;
    showToast('Settings saved');
  } catch (e) { console.error('saveSettings:', e); }
}

// ── Sun arc ───────────────────────────────────────────────────────────────

async function fetchSunMobile(dateStr) {
  try {
    const url = (dateStr && dateStr !== todayStr())
      ? `${window.BASE}/api/sun?date=${dateStr}`
      : `${window.BASE}/api/sun`;
    const resp = await fetch(url);
    if (!resp.ok) return;
    st.sunData = await resp.json();
    _applySliderRange();
    _updateSliderTicks();
    const arcEl = document.getElementById('m-sun-arc');
    if (!arcEl || !st.sunData) return;
    const slider = document.getElementById('m-time-slider');
    const currentMs = st.sliderActive && slider
      ? tzWallToMs(_mDate, parseInt(slider.value))
      : null;
    // If the SVG hasn't been laid out yet, defer one frame so getBoundingClientRect
    // returns real pixel dimensions (avoids elongated sun/moon on first load).
    if (arcEl.getBoundingClientRect().width === 0) {
      requestAnimationFrame(() => renderSunArc(st.sunData, currentMs, null, arcEl));
    } else {
      renderSunArc(st.sunData, currentMs, null, arcEl);
    }
  } catch (e) { console.error('fetchSunMobile:', e); }
}

// ── Chart fetchers ────────────────────────────────────────────────────────

let _mGridRange = 'today';
let _mProdRange = 'today';
let _mBatRange  = 'today';

let _mGridData = null;
let _mProdData = null;
let _mBatData  = null;

let _mDate           = todayStr();
let _mHistoryData    = null;
let _mPlayTimer      = null;
let _mFetchingHist   = false;
let _mResizeTimer    = null;

function _sunArcMinutes() {
  const sun = st.sunData;
  if (!sun || !sun.dawn || !sun.dusk) return [0, 1439];
  const dayRange = sun.dusk - sun.dawn;
  const extMin = Math.round((dayRange * 0.16) / 60);
  const toMin = ts => tzMinutes(ts * 1000);
  const arcMin = Math.max(0,    toMin(sun.dawn) - extMin);
  const arcMax = Math.min(1439, toMin(sun.dusk) + extMin);
  if (arcMin >= arcMax) return [0, 1439];
  return [arcMin, arcMax];
}

function _fmtTick(epochSec) {
  if (!epochSec) return '--';
  const { hour, minute } = tzHourMin(epochSec * 1000);
  const h = hour % 12 || 12;
  const suffix = hour < 12 ? 'a' : 'p';
  return minute === 0 ? `${h}${suffix}` : `${h}:${String(minute).padStart(2,'0')}${suffix}`;
}

function _fmtShortDate(dateStr) {
  const [, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}`;
}

function _updateChartTodayLabels() {
  const label = _mDate === todayStr() ? 'Today' : _fmtShortDate(_mDate);
  document.querySelectorAll('.m-range-btn[data-range="today"]').forEach(btn => {
    btn.textContent = label;
  });
}

function _updateSliderTicks() {
  const wrap = document.querySelector('.m-slider-ticks');
  if (!wrap) return;
  const sun = st.sunData;
  if (!sun || !sun.dawn) {
    wrap.innerHTML = '<span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span>';
    return;
  }
  wrap.innerHTML = `<span>${_fmtTick(sun.dawn)}</span><span>${_fmtTick(sun.solar_noon)}</span><span>${_fmtTick(sun.dusk)}</span>`;
}

function _applySliderRange() {
  const slider = document.getElementById('m-time-slider');
  if (!slider) return;
  const [arcMin, arcMax] = _sunArcMinutes();
  slider.min = String(arcMin);
  slider.max = String(arcMax);
}

function _drawLoading(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim();
  ctx.font = '13px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Loading...', W / 2, H / 2);
}

async function fetchMobileGridChart(range) {
  if (range) _mGridRange = range;
  const canvas = document.getElementById('m-grid-canvas');
  if (!canvas) return;
  _drawLoading('m-grid-canvas');
  try {
    const dateParam = (_mGridRange === 'today' && _mDate !== todayStr()) ? `&date=${_mDate}` : '';
    const resp = await fetch(`${window.BASE}/api/grid_chart?range=${_mGridRange}${dateParam}`);
    if (!resp.ok) return;
    const data = await resp.json();
    const totalEl = document.getElementById('m-grid-kwh');
    if (totalEl) {
      totalEl.textContent = data.has_export
        ? `${(data.import_total || 0).toFixed(1)} in / ${(data.export_total || 0).toFixed(1)} out kWh`
        : `${(data.import_total || 0).toFixed(1)} kWh`;
    }
    const isToday = _mGridRange === 'today';
    _mGridData = { points: data.points || [], hasExport: data.has_export || false, range: _mGridRange };
    drawGridChart(data.points || [], data.has_export || false, canvas, isToday, _mGridRange);
  } catch (e) { console.error('fetchMobileGridChart:', e); }
}

async function fetchMobileProductionChart(range) {
  if (range) _mProdRange = range;
  const canvas = document.getElementById('m-prod-canvas');
  if (!canvas) return;
  _drawLoading('m-prod-canvas');
  try {
    const dateParam = (_mProdRange === 'today' && _mDate !== todayStr()) ? `&date=${_mDate}` : '';
    const resp = await fetch(`${window.BASE}/api/array_chart?range=${_mProdRange}${dateParam}`);
    if (!resp.ok) return;
    const data = await resp.json();
    const totalEl = document.getElementById('m-prod-kwh');
    if (totalEl) totalEl.textContent = data.total_kwh != null
      ? `${data.total_kwh.toFixed(1)} kWh` : '-- kWh';
    const r = data.range || _mProdRange;
    const isToday = r === 'today';
    _mProdData = { points: data.points || [], range: r };
    drawArrayChart(data.points || [], r, canvas, !isToday, isToday);
  } catch (e) { console.error('fetchMobileProductionChart:', e); }
}

async function fetchMobileBatteryChart(range) {
  if (range) _mBatRange = range;
  const canvas = document.getElementById('m-battery-canvas');
  if (!canvas) return;
  _drawLoading('m-battery-canvas');
  try {
    const dateParam = (_mBatRange === 'today' && _mDate !== todayStr()) ? `&date=${_mDate}` : '';
    const resp = await fetch(`${window.BASE}/api/battery_chart?range=${_mBatRange}${dateParam}`);
    if (!resp.ok) return;
    const data = await resp.json();
    const totalEl = document.getElementById('m-battery-soc');
    if (totalEl) totalEl.textContent = data.current_soc != null
      ? `${Math.round(data.current_soc)} %` : '-- %';
    const pts = data.points || [];
    _mBatData = { points: pts, type: data.type || 'soc' };
    if (data.type === 'soc') {
      drawBatterySocChart(pts, canvas, true);
    } else {
      drawBatteryKwhChart(pts, canvas);
    }
  } catch (e) { console.error('fetchMobileBatteryChart:', e); }
}

// ── Data fetching ─────────────────────────────────────────────────────────

async function fetchDisplayTz() {
  try {
    const resp = await fetch(`${window.BASE}/api/about`);
    if (!resp.ok) return;
    const d = await resp.json();
    if (d.ha_tz) st.haTz = d.ha_tz;
  } catch (e) { /* ignore */ }
}

async function fetchMobileSettings() {
  try {
    const resp = await fetch(`${window.BASE}/api/settings`);
    if (!resp.ok) return;
    const s = await resp.json();
    st.refreshInterval    = Math.min(3600, Math.max(30, (s.refresh_interval || 300))) * 1000;
    st.nameStrip          = (s.name_strip || '').split(',').map(x => x.trim()).filter(Boolean);
    st.showPanelNames     = s.show_panel_names !== false;
    st.showPanelUnit      = s.show_panel_unit !== false;
    st.minAvgW            = s.min_avg_w ?? 5;
    st.peakPanelW         = s.peak_panel_w ?? 300;
    st.invertBatteryPower = s.invert_battery_power === true;
  } catch (e) { /* ignore */ }
}

export async function fetchPanels() {
  try {
    const resp = await fetch(`${window.BASE}/api/panels`);
    if (!resp.ok) return;
    const data = await resp.json();
    st.panels           = data.panels || [];
    st.gridAvailable    = data.grid_available || false;
    st.batteryAvailable = data.battery_available || false;
    if (data.has_export !== undefined) st.gridHasExport = data.has_export;

    if (!st.sliderActive) {
      const online = (data.panels || []).filter(p => p.status === 'online').length;
      const totalW = data.total_w != null ? fmtW(data.total_w) : '-- W';
      const summaryEl = document.getElementById('m-summary-power');
      const countEl   = document.getElementById('m-online-count');
      if (summaryEl) summaryEl.textContent = totalW;
      if (countEl)   countEl.textContent   = data.count
        ? `${online} / ${data.count} online`
        : 'No inverters';
      renderPanelGridMobile(st.panels);
    }

    // Show battery tab only when a battery is configured
    const batBtn = document.querySelector('.m-nav-battery');
    if (batBtn) batBtn.style.display = st.batteryAvailable ? '' : 'none';

  } catch (e) {
    console.error('fetchPanels:', e);
  }
}

// ── Refresh loop ──────────────────────────────────────────────────────────

function _updateSliderToNow() {
  if (st.sliderActive) return;
  const slider = document.getElementById('m-time-slider');
  if (slider) slider.value = String(currentMinutes());
  const arcEl = document.getElementById('m-sun-arc');
  if (arcEl && st.sunData) renderSunArc(st.sunData, null, null, arcEl);
}

function scheduleRefresh() {
  if (st.refreshTimer) clearTimeout(st.refreshTimer);
  st.refreshTimer = setTimeout(async () => {
    await fetchPanels();
    _updateSliderToNow();
    scheduleRefresh();
  }, st.refreshInterval);
}

// ── Orientation / resize handling ─────────────────────────────────────────

function _redrawActiveChart() {
  if (_activeTab === 'grid' && _mGridData) {
    const canvas = document.getElementById('m-grid-canvas');
    if (canvas) drawGridChart(_mGridData.points, _mGridData.hasExport, canvas, _mGridRange === 'today', _mGridRange);
  } else if (_activeTab === 'production' && _mProdData) {
    const canvas = document.getElementById('m-prod-canvas');
    if (canvas) drawArrayChart(_mProdData.points, _mProdData.range, canvas, _mProdData.range !== 'today', _mProdData.range === 'today');
  } else if (_activeTab === 'battery' && _mBatData) {
    const canvas = document.getElementById('m-battery-canvas');
    if (canvas) {
      if (_mBatData.type === 'soc') drawBatterySocChart(_mBatData.points, canvas, true);
      else drawBatteryKwhChart(_mBatData.points, canvas);
    }
  }
}

function _onOrientationChange() {
  if (st.panels.length) renderPanelGridMobile(st.panels);
  const arcEl = document.getElementById('m-sun-arc');
  if (arcEl && st.sunData) {
    const slider = document.getElementById('m-time-slider');
    const currentMs = st.sliderActive && slider
      ? tzWallToMs(_mDate, parseInt(slider.value))
      : null;
    renderSunArc(st.sunData, currentMs, null, arcEl);
  }
  _redrawActiveChart();
}

// ── Range button helper ───────────────────────────────────────────────────

function wireRangeBtns(groupId, fetchFn) {
  document.querySelectorAll(`#${groupId} .m-range-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${groupId} .m-range-btn`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fetchFn(btn.dataset.range);
    });
  });
}

// ── Timeline slider ───────────────────────────────────────────────────────

async function fetchMobileHistory(date) {
  if (_mFetchingHist) return;
  _mFetchingHist = true;
  const timeEl = document.getElementById('m-time-label');
  if (timeEl) timeEl.textContent = 'Loading...';
  try {
    const resp = await fetch(`${window.BASE}/api/history?date=${date}`);
    if (resp.ok) _mHistoryData = await resp.json();
  } catch (e) { console.error('fetchMobileHistory:', e); }
  finally { _mFetchingHist = false; }
}

function _updatePanelsAtSlider() {
  const slider = document.getElementById('m-time-slider');
  if (!slider || !_mHistoryData) return;
  const val = parseInt(slider.value);
  const targetMs = tzWallToMs(_mDate, val);
  let panels = applyHistoryToPanels(st.panels, _mHistoryData, targetMs);
  panels = recolorPanels(panels);

  // Time label
  const h = Math.floor(val / 60), m = val % 60;
  const timeEl = document.getElementById('m-time-label');
  if (timeEl) timeEl.textContent = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;

  // Summary bar
  const totalW = panels.filter(p => p.status === 'online').reduce((s, p) => s + (p.power_w || 0), 0);
  const online  = panels.filter(p => p.status === 'online').length;
  const summaryEl = document.getElementById('m-summary-power');
  const countEl   = document.getElementById('m-online-count');
  if (summaryEl) summaryEl.textContent = fmtW(totalW);
  if (countEl)   countEl.textContent   = `${online} / ${panels.length} online`;

  // Update panel cards in-place (avoids full DOM recreate)
  const cardMap = {};
  document.querySelectorAll('.m-panel-card[data-entity-id]').forEach(c => { cardMap[c.dataset.entityId] = c; });
  for (const p of panels) {
    const card = cardMap[p.entity_id];
    if (!card) continue;
    const isGradient = p.color && p.color !== 'gray';
    card.className = 'm-panel-card ' + (isGradient ? 'gradient' : 'gray');
    card.style.backgroundColor = isGradient ? p.color : '';
    const numEl = card.querySelector('.m-p-num');
    const unitEl = card.querySelector('.m-p-unit');
    if (!numEl) continue;
    if (p.status === 'online' && p.power_w !== null) {
      const w = p.power_w || 0;
      const isKw = w >= 1000;
      numEl.textContent = isKw ? (w / 1000).toFixed(1) : Math.round(w).toString();
      if (unitEl) unitEl.textContent = isKw ? 'kW' : 'W';
    } else {
      numEl.textContent = '--';
      if (unitEl) unitEl.textContent = '';
    }
  }

  // Move sun ball to slider time (pass ms; renderSunArc divides by 1000 internally)
  const arcEl = document.getElementById('m-sun-arc');
  if (arcEl && st.sunData) renderSunArc(st.sunData, targetMs, null, arcEl);
}

function _goStartOfDay() {
  _stopPlayback();
  st.sliderActive = true;
  document.getElementById('m-live-btn')?.classList.remove('active');
  const slider = document.getElementById('m-time-slider');
  if (slider) slider.value = slider.min || 0;
  if (!_mHistoryData || _mHistoryData.date !== _mDate) {
    fetchMobileHistory(_mDate).then(_updatePanelsAtSlider);
  } else {
    _updatePanelsAtSlider();
  }
}

function _stopPlayback() {
  if (_mPlayTimer) { clearInterval(_mPlayTimer); _mPlayTimer = null; }
  const playBtn = document.getElementById('m-play-btn');
  if (playBtn) playBtn.innerHTML = '&#9654;';
}

function _continuePlayback() {
  const slider = document.getElementById('m-time-slider');
  if (!slider) return;
  const maxVal = _mDate === todayStr() ? currentMinutes() : parseInt(slider.max);
  if (parseInt(slider.value) >= maxVal - 5) slider.value = slider.min || 0;
  const playBtn = document.getElementById('m-play-btn');
  if (playBtn) playBtn.innerHTML = '&#9646;&#9646;';
  _mPlayTimer = setInterval(() => {
    const v = parseInt(slider.value) + 10;
    if (v >= maxVal) { slider.value = String(maxVal); _stopPlayback(); _updatePanelsAtSlider(); return; }
    slider.value = v;
    _updatePanelsAtSlider();
  }, 150);
}

function _startPlayback() {
  st.sliderActive = true;
  document.getElementById('m-live-btn')?.classList.remove('active');
  if (!_mHistoryData || _mHistoryData.date !== _mDate) {
    fetchMobileHistory(_mDate).then(_continuePlayback);
  } else {
    _continuePlayback();
  }
}

async function _changeDay(delta) {
  _stopPlayback();
  const today = todayStr();
  const d = new Date(_mDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  const next = d.toISOString().slice(0, 10);
  if (next > today) return;

  // Capture current slider position so the same time-of-day is preserved
  const slider = document.getElementById('m-time-slider');
  const savedVal = slider ? parseInt(slider.value) : null;

  _mDate = next;
  st.sliderActive = true;
  document.getElementById('m-live-btn')?.classList.remove('active');
  const dateLabel = document.getElementById('m-date-label');
  if (dateLabel) dateLabel.textContent = _mDate;
  _updateChartTodayLabels();

  await fetchSunMobile(_mDate);   // sets new slider.min / slider.max for this day

  if (slider && savedVal !== null) {
    const cap = _mDate === todayStr() ? currentMinutes() : parseInt(slider.max);
    const lo  = parseInt(slider.min) || 0;
    slider.value = String(Math.max(lo, Math.min(cap, savedVal)));
  }
  await fetchMobileHistory(_mDate);
  _updatePanelsAtSlider();
}

function _goLive() {
  _stopPlayback();
  st.sliderActive = false;
  _mDate = todayStr();
  const timeEl  = document.getElementById('m-time-label');
  const liveBtn = document.getElementById('m-live-btn');
  const dateLabel = document.getElementById('m-date-label');
  if (timeEl)    timeEl.textContent    = 'Live';
  if (liveBtn)   liveBtn.classList.add('active');
  if (dateLabel) dateLabel.textContent = _mDate;
  _updateChartTodayLabels();
  const sliderEl = document.getElementById('m-time-slider');
  if (sliderEl) sliderEl.value = String(currentMinutes());
  const arcEl = document.getElementById('m-sun-arc');
  if (arcEl && st.sunData) renderSunArc(st.sunData, null, null, arcEl);
  fetchPanels();
  // Re-fetch today's sun in case we were on a past date; restore arc range
  fetchSunMobile().then(() => {
    const s = document.getElementById('m-time-slider');
    if (s) s.value = String(currentMinutes());
  });
}

// ── Chart touch-to-toast ──────────────────────────────────────────────────

function _findBarIdx(touchX, padL, canvasW, n) {
  return Math.max(0, Math.min(n - 1, Math.floor((touchX - padL) / ((canvasW - padL - 2) / n))));
}

function _findTodayIdx(touchX, padL, canvasW, points) {
  const dayStartMs = tzDayStartMs(points[0].ts_ms);
  const ts = dayStartMs + ((touchX - padL) / (canvasW - padL - 2)) * 86400000;
  let idx = 0, minDist = Infinity;
  points.forEach((p, i) => { const d = Math.abs(p.ts_ms - ts); if (d < minDist) { minDist = d; idx = i; } });
  return idx;
}

function _row(color, text) {
  return `<div><span style="color:${color};margin-right:4px">&#9679;</span>${text}</div>`;
}

function _hitFmtGrid(touchX, canvasW) {
  const data = _mGridData;
  if (!data || !data.points.length) return null;
  const { points, hasExport, range } = data;
  const isToday = range === 'today';
  const padL = isToday ? 30 : 2;

  let pt, header;
  if (isToday && points[0]?.ts_ms) {
    const idx = _findTodayIdx(touchX, padL, canvasW, points);
    pt = points[idx];
    const { hour: h } = tzHourMin(pt.ts_ms);
    const fmt = h2 => `${h2 % 12 || 12}${h2 < 12 ? 'am' : 'pm'}`;
    header = `${fmt(h)} - ${fmt((h + 1) % 24)}`;
  } else {
    pt = points[_findBarIdx(touchX, padL, canvasW, points.length)];
    header = pt.label || '';
  }
  let html = `<div style="font-weight:700;margin-bottom:3px">${header}</div>`;
  if ((pt.import_kwh || 0) > 0 || !hasExport)
    html += _row('#5b8ee6', `Import: ${(pt.import_kwh || 0).toFixed(2)} kWh`);
  if (hasExport && (pt.consumed_solar_kwh || 0) > 0)
    html += _row('#d4882a', `Solar used: ${(pt.consumed_solar_kwh || 0).toFixed(2)} kWh`);
  if (hasExport && (pt.export_kwh || 0) > 0)
    html += _row('#8b5cf6', `Exported: ${(pt.export_kwh || 0).toFixed(2)} kWh`);
  if (hasExport) {
    const net = (pt.import_kwh || 0) - (pt.export_kwh || 0);
    html += `<div style="font-weight:700;margin-top:3px;border-top:1px solid var(--border);padding-top:3px">Net: ${net >= 0 ? '+' : ''}${net.toFixed(2)} kWh</div>`;
  }
  return html;
}

function _hitFmtProd(touchX, canvasW) {
  const data = _mProdData;
  if (!data || !data.points.length) return null;
  const { points, range } = data;
  const isToday = range === 'today';
  const padL = isToday ? 30 : 2;

  let pt, header;
  if (isToday && points[0]?.ts_ms) {
    const idx = _findTodayIdx(touchX, padL, canvasW, points);
    pt = points[idx];
    const { hour: h } = tzHourMin(pt.ts_ms);
    const fmt = h2 => `${h2 % 12 || 12}${h2 < 12 ? 'am' : 'pm'}`;
    header = `${fmt(h)} - ${fmt((h + 1) % 24)}`;
  } else {
    pt = points[_findBarIdx(touchX, padL, canvasW, points.length)];
    header = pt.label || '';
  }
  return `<div style="font-weight:700;margin-bottom:3px">${header}</div>` +
         _row('#d4882a', `Production: ${(pt.kwh || 0).toFixed(2)} kWh`);
}

function _hitFmtBat(touchX, canvasW) {
  const data = _mBatData;
  if (!data || !data.points.length) return null;
  const { points, type } = data;
  if (type === 'soc') {
    const padL = 30;
    const idx = _findTodayIdx(touchX, padL, canvasW, points);
    const pt = points[idx];
    const { hour: h, minute: m } = tzHourMin(pt.ts_ms);
    const header = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    return `<div style="font-weight:700;margin-bottom:3px">${header}</div>` +
           _row('#43a047', `SoC: ${(pt.soc_pct || 0).toFixed(1)}%`);
  } else {
    const pt = points[_findBarIdx(touchX, 2, canvasW, points.length)];
    let html = `<div style="font-weight:700;margin-bottom:3px">${pt.label || ''}</div>`;
    if ((pt.charged_kwh || 0) > 0)    html += _row('#43a047', `Charged: ${pt.charged_kwh.toFixed(2)} kWh`);
    if ((pt.discharged_kwh || 0) > 0) html += _row('#d4882a', `Discharged: ${pt.discharged_kwh.toFixed(2)} kWh`);
    return html;
  }
}

function wireTouchToast(canvasId, hitFn) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  canvas.addEventListener('touchstart', e => {
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const html = hitFn(touch.clientX - rect.left, rect.width);
    if (html) showToast(html, 0, true, true);
  }, { passive: true });
}

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  await fetchDisplayTz();
  await fetchMobileSettings();
  await fetchGrid();
  buildMobileShell();

  // Tab switching
  document.querySelectorAll('.m-nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Re-render on orientation change / resize
  window.addEventListener('resize', () => {
    if (_mResizeTimer) clearTimeout(_mResizeTimer);
    _mResizeTimer = setTimeout(_onOrientationChange, 150);
  });

  // Date label tap opens native date picker
  document.getElementById('m-date-label').addEventListener('click', () => {
    const input = document.getElementById('m-date-input');
    input.value = _mDate;
    input.max   = todayStr();
    input.showPicker ? input.showPicker() : input.click();
  });
  document.getElementById('m-date-input').addEventListener('change', async () => {
    const d = document.getElementById('m-date-input').value;
    if (!d || d > todayStr()) return;
    _stopPlayback();
    _mDate = d;
    st.sliderActive = true;
    document.getElementById('m-live-btn')?.classList.remove('active');
    const dateLabel = document.getElementById('m-date-label');
    if (dateLabel) dateLabel.textContent = _mDate;
    _updateChartTodayLabels();
    await fetchSunMobile(_mDate);
    const slider = document.getElementById('m-time-slider');
    if (slider) slider.value = _mDate === todayStr() ? String(currentMinutes()) : (slider.min || '0');
    await fetchMobileHistory(_mDate);
    _updatePanelsAtSlider();
  });

  // Timeline slider
  document.getElementById('m-time-slider').addEventListener('input', () => {
    _stopPlayback();
    const slider = document.getElementById('m-time-slider');
    if (_mDate === todayStr()) {
      const cap = currentMinutes();
      if (parseInt(slider.value) >= cap) {
        slider.value = String(cap);
        _goLive();
        return;
      }
    }
    st.sliderActive = true;
    document.getElementById('m-live-btn').classList.remove('active');
    if (!_mHistoryData || _mHistoryData.date !== _mDate) {
      fetchMobileHistory(_mDate).then(_updatePanelsAtSlider);
    } else {
      _updatePanelsAtSlider();
    }
  });
  document.getElementById('m-start-btn').addEventListener('click',    _goStartOfDay);
  document.getElementById('m-play-btn').addEventListener('click',     () => { _mPlayTimer ? _stopPlayback() : _startPlayback(); });
  document.getElementById('m-prev-day-btn').addEventListener('click', () => _changeDay(-1));
  document.getElementById('m-next-day-btn').addEventListener('click', () => _changeDay(1));
  document.getElementById('m-live-btn').addEventListener('click',     _goLive);

  // Chart range buttons
  wireRangeBtns('m-grid-range-btns',    fetchMobileGridChart);
  wireRangeBtns('m-prod-range-btns',    fetchMobileProductionChart);
  wireRangeBtns('m-battery-range-btns', fetchMobileBatteryChart);

  // Chart touch-to-toast
  wireTouchToast('m-grid-canvas',    _hitFmtGrid);
  wireTouchToast('m-prod-canvas',    _hitFmtProd);
  wireTouchToast('m-battery-canvas', _hitFmtBat);

  // Settings tab actions
  document.getElementById('m-set-save-btn').addEventListener('click', saveSettings);
  document.getElementById('m-set-rediscover-btn').addEventListener('click', async () => {
    try {
      await fetch(`${window.BASE}/api/rediscover`, {method: 'POST'});
      showToast('Rediscovering panels...');
      setTimeout(fetchPanels, 3000);
    } catch (e) { console.error(e); }
  });

  // Panel detail modal
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
  document.addEventListener('solar:refresh-panels', fetchPanels);

  await fetchPanels();
  await fetchSunMobile();

  // Set slider to current time (max stays 1439, thumb just moves to now)
  {
    const sliderEl = document.getElementById('m-time-slider');
    if (sliderEl) sliderEl.value = String(currentMinutes());
  }

  scheduleRefresh();
}

// Dynamic import() fires after DOMContentLoaded, so DOM is already available.
init();
