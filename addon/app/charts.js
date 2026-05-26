import { st } from './state.js';

function drawCrosshair(canvas, x, padT, chartH) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(128,128,128,0.55)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x, padT);
  ctx.lineTo(x, padT + chartH);
  ctx.stroke();
  ctx.setLineDash([]);
}

function clearCrosshair(canvas) {
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function getTooltipTimeHeader(pt, range) {
  const ts = pt.ts_ms;
  if (!ts) return pt.label || '';
  const d = new Date(ts);
  if (range === 'today') {
    const h = d.getHours(), nh = (h + 1) % 24;
    const fmt = h2 => `${h2 % 12 || 12}:00 ${h2 < 12 ? 'AM' : 'PM'}`;
    return `${fmt(h)} – ${fmt(nh)}`;
  }
  if (range === 'week')  return `Week of ${d.toLocaleString('en-US', {month: 'short'})} ${d.getDate()}`;
  if (range === 'month') return d.toLocaleString('en-US', {month: 'long', year: 'numeric'});
  return String(d.getFullYear());
}

function _drawChartMessage(msg) {
  const canvas = document.getElementById('array-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim();
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, W / 2, H / 2);
}

function _drawGridMessage(msg) {
  const canvas = document.getElementById('grid-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim();
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, W / 2, H / 2);
}

export function applyGridVisibility() {
  const panel = document.getElementById('arc-grid-panel');
  if (!panel) return;
  const show = st.showGridChart && st.gridAvailable;
  panel.style.display = show ? 'flex' : 'none';
  if (show && !st.lastGridPoints.length) fetchGridChart();
}

export async function fetchGridChart() {
  const range = st.gridChartRange;
  let url = `${window.BASE}/api/grid_chart?range=${range}`;
  if (range === 'today') {
    const dateVal = document.getElementById('date-picker').value;
    if (dateVal) url += `&date=${dateVal}`;
  }
  const loadingTimer = setTimeout(() => _drawGridMessage('Loading...'), 400);
  try {
    const resp = await fetch(url);
    clearTimeout(loadingTimer);
    if (!resp.ok) { _drawGridMessage('Error'); return; }
    const data = await resp.json();
    st.lastGridPoints = data.points || [];
    st.gridHasExport  = data.has_export || false;
    const totalEl = document.getElementById('grid-chart-total');
    if (totalEl) {
      if (st.gridHasExport) {
        totalEl.textContent = `${(data.import_total || 0).toFixed(1)} in / ${(data.export_total || 0).toFixed(1)} out kWh`;
      } else {
        totalEl.textContent = `${(data.import_total || 0).toFixed(1)} kWh`;
      }
    }
    drawGridChart(st.lastGridPoints, st.gridHasExport);
  } catch (e) {
    clearTimeout(loadingTimer);
    console.error('fetchGridChart:', e);
    _drawGridMessage('Error loading data');
  }
}

export function drawGridChart(points, hasExport) {
  const canvas = document.getElementById('grid-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const style = getComputedStyle(document.documentElement);
  const dimColor    = style.getPropertyValue('--text-dim').trim();
  const mutedColor  = style.getPropertyValue('--text-muted').trim();
  const borderColor = style.getPropertyValue('--border').trim();

  const hasData = points.some(p => (p.import_kwh || 0) + (p.export_kwh || 0) > 0);
  if (!points.length || !hasData) {
    ctx.fillStyle = dimColor;
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data', W / 2, H / 2);
    return;
  }

  const padT = 4, padR = 2, padB = 18, padL = 2;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n      = points.length;
  const slotW  = chartW / n;
  const barW   = Math.max(1.5, slotW * 0.72);

  const maxPos = Math.max(...points.map(p =>
    (p.import_kwh || 0) + (hasExport ? (p.consumed_solar_kwh || 0) : 0)), 0.001);
  const maxNeg = hasExport ? Math.max(...points.map(p => p.export_kwh || 0), 0) : 0;

  let zeroY, posH, negH;
  if (!hasExport || maxNeg < 0.001) {
    zeroY = padT + chartH; posH = chartH; negH = 0;
  } else {
    zeroY = padT + chartH / 2;
    posH  = chartH / 2;
    negH  = chartH / 2;
  }

  ctx.clearRect(0, 0, W, H);

  const gr = Math.min(2, barW / 2);
  points.forEach((pt, i) => {
    const x = padL + i * slotW + (slotW - barW) / 2;
    const importKwh = pt.import_kwh || 0;
    const solarKwh  = hasExport ? (pt.consumed_solar_kwh || 0) : 0;
    const exportKwh = hasExport ? (pt.export_kwh || 0) : 0;
    const totalPos  = importKwh + solarKwh;

    if (totalPos > 0 && posH > 0) {
      const totalBarH  = (totalPos / maxPos) * posH;
      const importBarH = (importKwh / maxPos) * posH;
      const solarBarH  = totalBarH - importBarH;
      if (solarBarH > 0) {
        ctx.fillStyle = '#d4882a';
        ctx.beginPath();
        ctx.roundRect(x, zeroY - totalBarH, barW, solarBarH, [gr, gr, 0, 0]);
        ctx.fill();
        if (importBarH > 0) {
          ctx.fillStyle = '#5b8ee6';
          ctx.fillRect(x, zeroY - importBarH, barW, importBarH);
        }
      } else if (importBarH > 0) {
        ctx.fillStyle = '#5b8ee6';
        ctx.beginPath();
        ctx.roundRect(x, zeroY - importBarH, barW, importBarH, [gr, gr, 0, 0]);
        ctx.fill();
      }
    }
    if (exportKwh > 0 && negH > 0) {
      const eh = (exportKwh / maxNeg) * negH;
      ctx.fillStyle = '#8b5cf6';
      ctx.beginPath();
      ctx.roundRect(x, zeroY, barW, eh, [0, 0, gr, gr]);
      ctx.fill();
    }
  });

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = hasExport && maxNeg > 0.001 ? 1.0 : 0.5;
  ctx.beginPath();
  ctx.moveTo(padL, zeroY); ctx.lineTo(W - padR, zeroY);
  ctx.stroke();

  let every = 1;
  if (n > 20) every = 6; else if (n > 12) every = 4;
  else if (n > 8) every = 3; else if (n > 5) every = 2;
  ctx.fillStyle = mutedColor;
  ctx.font = `${Math.max(9, Math.min(11, Math.floor(slotW * 0.9)))}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  points.forEach((pt, i) => {
    if (i % every !== 0) return;
    ctx.fillText(pt.label, padL + i * slotW + slotW / 2, padT + chartH + 3);
  });
}

export function initGridChartTooltip() {
  const canvas    = document.getElementById('grid-chart');
  const crosshair = document.getElementById('grid-crosshair');
  const tooltip   = document.getElementById('grid-chart-tooltip');
  if (!canvas || !tooltip) return;

  const padL = 2, padR = 2, padB = 18, padT = 4;

  canvas.addEventListener('mousemove', (e) => {
    const points = st.lastGridPoints;
    if (!points || !points.length) { tooltip.style.display = 'none'; if (crosshair) clearCrosshair(crosshair); return; }

    const rect   = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const chartW = rect.width - padL - padR;
    const chartH = rect.height - padT - padB;

    if (mouseX < padL || mouseX > rect.width - padR) { tooltip.style.display = 'none'; if (crosshair) clearCrosshair(crosshair); return; }

    const idx = Math.max(0, Math.min(points.length - 1, Math.floor((mouseX - padL) / (chartW / points.length))));
    const pt  = points[idx];
    const barCenterX = padL + idx * (chartW / points.length) + (chartW / points.length) / 2;
    if (crosshair) drawCrosshair(crosshair, barCenterX, padT, chartH);

    const header = getTooltipTimeHeader(pt, st.gridChartRange);
    let html = `<div style="font-weight:600;margin-bottom:0.25rem">${header}</div>`;
    const rows = [];
    if ((pt.import_kwh || 0) > 0 || !st.gridHasExport)
      rows.push(['#5b8ee6', 'Grid import', pt.import_kwh || 0]);
    if (st.gridHasExport && (pt.consumed_solar_kwh || 0) > 0)
      rows.push(['#d4882a', 'Consumed solar', pt.consumed_solar_kwh || 0]);
    if (st.gridHasExport && (pt.export_kwh || 0) > 0)
      rows.push(['#8b5cf6', 'Exported', pt.export_kwh || 0]);
    for (const [color, label, val] of rows) {
      html += `<div style="display:flex;align-items:center;gap:5px">
        <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></div>
        <span>${label}: ${val.toFixed(2)} kWh</span></div>`;
    }
    if (st.gridHasExport) {
      const net = (pt.import_kwh || 0) - (pt.export_kwh || 0);
      html += `<div style="font-weight:600;margin-top:0.2rem;border-top:1px solid var(--border);padding-top:0.2rem">Net: ${net >= 0 ? '+' : ''}${net.toFixed(2)} kWh</div>`;
    }
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';

    const wrap = canvas.parentElement, wrapRect = wrap.getBoundingClientRect();
    let tx = e.clientX - wrapRect.left + 10;
    let ty = e.clientY - wrapRect.top - 10;
    if (tx + tooltip.offsetWidth > wrapRect.width - 4) tx = e.clientX - wrapRect.left - tooltip.offsetWidth - 10;
    if (ty + tooltip.offsetHeight > wrapRect.height) ty = wrapRect.height - tooltip.offsetHeight - 4;
    if (ty < 0) ty = 4;
    tooltip.style.left = tx + 'px';
    tooltip.style.top  = ty + 'px';
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
    if (crosshair) clearCrosshair(crosshair);
  });
}

export async function fetchArrayChart() {
  const range = st.chartRange;
  let url = `${window.BASE}/api/array_chart?range=${range}`;
  if (range === 'today') {
    const dateVal = document.getElementById('date-picker').value;
    if (dateVal) url += `&date=${dateVal}`;
  }
  const loadingTimer = setTimeout(() => _drawChartMessage('Loading...'), 400);
  try {
    const resp = await fetch(url);
    clearTimeout(loadingTimer);
    if (!resp.ok) { _drawChartMessage('Error'); return; }
    const data = await resp.json();
    st.lastChartPoints = data.points || [];
    const totalEl = document.getElementById('chart-total-kwh');
    if (totalEl) totalEl.textContent = data.total_kwh != null ? `${data.total_kwh.toFixed(1)} kWh` : '-- kWh';
    drawArrayChart(st.lastChartPoints, data.range);
  } catch (e) {
    clearTimeout(loadingTimer);
    console.error('fetchArrayChart:', e);
    _drawChartMessage('Error loading data');
  }
}

export function drawArrayChart(points, range) {
  const canvas = document.getElementById('array-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const style = getComputedStyle(document.documentElement);
  const accentColor = style.getPropertyValue('--accent').trim();
  const dimColor    = style.getPropertyValue('--text-dim').trim();
  const mutedColor  = style.getPropertyValue('--text-muted').trim();
  const borderColor = style.getPropertyValue('--border').trim();

  const hasProd = points.some(p => p.kwh > 0);
  if (!points.length || !hasProd) {
    ctx.fillStyle = dimColor;
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No data', W / 2, H / 2);
    return;
  }

  const padT = 4, padR = 2, padB = 18, padL = 2;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n = points.length;
  const slotW = chartW / n;
  const barW = Math.max(1.5, slotW * 0.72);
  const maxKwh = Math.max(...points.map(p => p.kwh), 0.001);

  ctx.clearRect(0, 0, W, H);

  const barR = Math.min(2, barW / 2);
  points.forEach((pt, i) => {
    if (pt.kwh <= 0) return;
    const bh = (pt.kwh / maxKwh) * chartH;
    const x = padL + i * slotW + (slotW - barW) / 2;
    const y = padT + chartH - bh;
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, bh, [barR, barR, 0, 0]);
    ctx.fill();
  });

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(padL, padT + chartH);
  ctx.lineTo(W - padR, padT + chartH);
  ctx.stroke();

  let every = 1;
  if (n > 20) every = 6;
  else if (n > 12) every = 4;
  else if (n > 8) every = 3;
  else if (n > 5) every = 2;
  ctx.fillStyle = mutedColor;
  ctx.font = `${Math.max(9, Math.min(11, Math.floor(slotW * 0.9)))}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  points.forEach((pt, i) => {
    if (i % every !== 0) return;
    ctx.fillText(pt.label, padL + i * slotW + slotW / 2, padT + chartH + 3);
  });
}

export function initChartTooltip() {
  const canvas    = document.getElementById('array-chart');
  const crosshair = document.getElementById('array-crosshair');
  const tooltip   = document.getElementById('chart-tooltip');
  if (!canvas || !tooltip) return;

  const padL = 2, padR = 2, padB = 18, padT = 4;

  canvas.addEventListener('mousemove', (e) => {
    const points = st.lastChartPoints;
    if (!points || !points.length) { tooltip.style.display = 'none'; if (crosshair) clearCrosshair(crosshair); return; }

    const rect   = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const chartW = rect.width - padL - padR;
    const chartH = rect.height - padT - padB;

    if (mouseX < padL || mouseX > rect.width - padR) { tooltip.style.display = 'none'; if (crosshair) clearCrosshair(crosshair); return; }

    const idx = Math.max(0, Math.min(points.length - 1, Math.floor((mouseX - padL) / (chartW / points.length))));
    const pt  = points[idx];
    const barCenterX = padL + idx * (chartW / points.length) + (chartW / points.length) / 2;
    if (crosshair) drawCrosshair(crosshair, barCenterX, padT, chartH);

    const header = getTooltipTimeHeader(pt, st.chartRange);
    let html = `<div style="font-weight:600;margin-bottom:0.25rem">${header}</div>`;
    html += `<div style="display:flex;align-items:center;gap:5px">
      <div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0"></div>
      <span>Production: ${(pt.kwh || 0).toFixed(2)} kWh</span></div>`;
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';

    const wrap = canvas.parentElement, wrapRect = wrap.getBoundingClientRect();
    let tx = e.clientX - wrapRect.left + 10;
    let ty = e.clientY - wrapRect.top - 10;
    if (tx + tooltip.offsetWidth > wrapRect.width - 4) tx = e.clientX - wrapRect.left - tooltip.offsetWidth - 10;
    if (ty + tooltip.offsetHeight > wrapRect.height) ty = wrapRect.height - tooltip.offsetHeight - 4;
    if (ty < 0) ty = 4;
    tooltip.style.left = tx + 'px';
    tooltip.style.top  = ty + 'px';
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
    if (crosshair) clearCrosshair(crosshair);
  });
}
