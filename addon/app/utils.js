import { st, FINE_W, FINE_H } from './state.js';

// ── Timezone helpers ──────────────────────────────────────────────────────
// All time display and minutes-of-day math uses the Home Assistant server's
// timezone (the array's physical location), not the browser's. The active zone
// is st.haTz, loaded from /api/about at startup.

// Returns undefined only until haTz loads, so Intl falls back to the browser
// zone briefly at startup, then uses the HA server zone.
export function _tz() { return st.haTz || undefined; }

// Wall-clock parts of an instant (unix ms) in the display timezone.
export function tzParts(ms) {
  const o = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: _tz(), hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(ms)) {
    if (p.type !== 'literal') o[p.type] = p.value;
  }
  if (o.hour === '24') o.hour = '00';  // some engines emit 24 at midnight
  return { year: +o.year, month: +o.month, day: +o.day,
           hour: +o.hour, minute: +o.minute, second: +o.second };
}

// Minutes since midnight for an instant, in the display timezone.
export function tzMinutes(ms) {
  const p = tzParts(ms);
  return p.hour * 60 + p.minute;
}

// {hour, minute} of an instant in the display timezone (chart tooltips).
export function tzHourMin(ms) {
  const p = tzParts(ms);
  return { hour: p.hour, minute: p.minute };
}

// YYYY-MM-DD of an instant in the display timezone.
function tzDateStr(p) {
  return p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
}

// Unix ms for a wall-clock time (date string + minutes-of-day) in the display
// timezone. Iterative because the UTC offset depends on the date (DST).
export function tzWallToMs(dateStr, minutes) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const wantUtc = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60, 0);
  let guess = wantUtc;
  for (let i = 0; i < 3; i++) {
    const p = tzParts(guess);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess;
    const target = wantUtc - offset;
    if (target === guess) break;
    guess = target;
  }
  return guess;
}

// Unix ms of midnight in the display timezone for the day containing ms.
export function tzDayStartMs(ms) {
  return tzWallToMs(tzDateStr(tzParts(ms)), 0);
}

// Format a date in the display timezone with Intl options (chart labels).
export function fmtDateTz(ms, opts) {
  return new Date(ms).toLocaleString('en-US', { ...opts, timeZone: _tz() });
}

export function stripName(name) {
  if (!st.nameStrip || !st.nameStrip.length) return name;
  let result = name;
  for (const s of st.nameStrip) {
    if (!s) continue;
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'gi'), '').trim();
  }
  return result || name;
}

export function getSpan(eid, rotations) {
  return (rotations[eid] || 0) ? [FINE_H, FINE_W] : [FINE_W, FINE_H];
}

export function fmtW(w) {
  if (w === null || w === undefined) return '--';
  if (w >= 1000) return (w / 1000).toFixed(2) + ' kW';
  return Math.round(w) + ' W';
}

export function fmtWh(wh) {
  if (wh === null || wh === undefined) return '';
  if (wh >= 1000) return (wh / 1000).toFixed(2) + ' kWh';
  return Math.round(wh) + ' Wh';
}

export function fmtTime(ts) {
  if (!ts) return '--';
  return new Date(ts * 1000).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', timeZone: _tz(),
  });
}

export function todayStr() {
  const p = tzParts(Date.now());
  return tzDateStr(p);
}

export function currentMinutes() {
  return tzMinutes(Date.now());
}

export function sliderToTimestamp(sliderVal) {
  // Anchor to the selected date and the display timezone so the sun ball and
  // production shading land on the correct day and time.
  const dp = document.getElementById('date-picker');
  return tzWallToMs((dp && dp.value) ? dp.value : todayStr(), parseInt(sliderVal));
}

export function estimateWh(series, targetMs) {
  if (!series || series.length < 2) return null;
  let wh = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i].ts > targetMs) break;
    const dt = (series[i].ts - series[i - 1].ts) / 3600000;
    wh += (series[i - 1].w + series[i].w) / 2 * dt;
  }
  return Math.round(Math.max(0, wh));
}

export function applyHistoryToPanels(panels, historyData, targetMs) {
  if (!historyData || !historyData.panels) return panels;
  return panels.map(p => {
    const series = historyData.panels[p.entity_id];
    if (!series || series.length === 0) return {...p, power_w: null, status: 'unavailable', today_wh: null};
    let best = null;
    for (const pt of series) {
      if (pt.ts <= targetMs) best = pt;
      else break;
    }
    const w = best ? best.w : null;
    const today_wh = estimateWh(series, targetMs);
    return {...p, power_w: w, status: w !== null ? 'online' : 'unavailable', today_wh};
  });
}

const _WARM_THRESHOLD = 150;

function _gradientColor(t) {
  t = Math.min(Math.max(t, 0), 1);
  const hue = Math.round(55 - t * 33);
  const sat = Math.round(70 + t * 30);
  const lit = Math.round(82 - t * 34);
  return `hsl(${hue},${sat}%,${lit}%)`;
}

export function recolorPanels(panels) {
  const online = panels.filter(p => p.status === 'online' && p.power_w > 0);
  const avg = online.length ? online.reduce((s, p) => s + p.power_w, 0) / online.length : 0;
  if (avg < (st.minAvgW ?? 5)) {
    return panels.map(p => ({...p, power_w: 0, color: 'gray'}));
  }
  return panels.map(p => {
    if (p.status !== 'online' || avg <= 0) return {...p, color: 'gray'};
    let t;
    if (st.peakPanelW > 0) {
      t = Math.min(1.0, p.power_w / (st.peakPanelW * 0.95));
    } else {
      t = (p.power_w / avg) * Math.min(1.0, avg / _WARM_THRESHOLD);
    }
    return {...p, color: _gradientColor(t)};
  });
}
