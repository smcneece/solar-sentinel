import { FINE_W, FINE_H } from './state.js';

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
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

export function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

export function currentMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

export function sliderToTimestamp(sliderVal) {
  const minutes = parseInt(sliderVal);
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
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

export function recolorPanels(panels) {
  const online = panels.filter(p => p.status === 'online' && p.power_w > 0);
  const avg = online.length ? online.reduce((s, p) => s + p.power_w, 0) / online.length : 0;
  return panels.map(p => {
    if (p.status !== 'online' || avg <= 0) return {...p, color: 'gray'};
    const r = p.power_w / avg;
    const color = r >= 0.90 ? 'green' : r >= 0.70 ? 'yellow' : 'red';
    return {...p, color};
  });
}
