import { st, FINE_W, FINE_H } from './state.js';
import { fmtW, fmtWh, getSpan, stripName } from './utils.js';

export function makePanelCard(p, isDraggable) {
  const cell = document.createElement('div');
  const isGradient = p.color && p.color !== 'gray';
  cell.className = 'panel-cell ' + (isGradient ? 'gradient' : (p.color || 'gray'));
  cell.dataset.entityId = p.entity_id;
  if (isGradient) {
    cell.style.backgroundColor = p.color;
    cell.style.borderColor = p.color.replace(
      /hsl\((\d+),(\d+)%,(\d+)%\)/,
      (_, h, s, l) => `hsl(${h},${s}%,${Math.max(0, parseInt(l) - 15)}%)`
    );
  }

  const displayName = stripName(p.name);
  cell.title = displayName;

  const power = document.createElement('div');
  power.className = 'panel-power';
  const rawPower = p.status === 'online' ? fmtW(p.power_w) : '--';
  power.textContent = (p.status === 'online' && !st.showPanelUnit)
    ? rawPower.replace(/ (W|kW)$/, '')
    : rawPower;

  if (isDraggable || st.showPanelNames) {
    const name = document.createElement('div');
    name.className = 'panel-name';
    name.textContent = displayName;
    cell.appendChild(name);
  }
  cell.appendChild(power);

  if (p.status === 'online' && p.today_wh !== null && p.today_wh !== undefined) {
    const wh = document.createElement('div');
    wh.className = 'panel-wh';
    wh.textContent = fmtWh(p.today_wh);
    cell.appendChild(wh);
  } else if (p.status !== 'online') {
    const off = document.createElement('div');
    off.className = 'panel-offline';
    off.textContent = 'offline';
    cell.appendChild(off);
  }

  if (isDraggable) {
    cell.draggable = true;
    cell.addEventListener('dragstart', e => {
      st.dragEntityId = p.entity_id;
      e.dataTransfer.effectAllowed = 'move';
      st.dragOffsetRow = 0;
      st.dragOffsetCol = 0;
    });
    cell.addEventListener('dragend', () => { st.dragEntityId = null; });
  } else {
    cell.addEventListener('click', () => openPanelModal(p));
  }
  return cell;
}

function _clearPanelsSection() {
  const section = document.getElementById('panels-section');
  for (const el of Array.from(section.children)) {
    if (el.id !== 'discovery-msg') el.remove();
  }
}

export function renderPanels(panels) {
  if (st.editMode) return;

  const section = document.getElementById('panels-section');
  const msg = document.getElementById('discovery-msg');

  if (!panels || panels.length === 0) {
    _clearPanelsSection();
    msg.style.display = 'block';
    return;
  }
  msg.style.display = 'none';
  _clearPanelsSection();

  if (st.gridLayout && Object.keys(st.gridLayout.positions || {}).length > 0) {
    renderGridView(panels, section, msg);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'panel-grid';
  for (const p of panels) grid.appendChild(makePanelCard(p, false));
  section.insertBefore(grid, msg);
}

export function renderGridView(panels, section, msg) {
  const { rows, cols, positions } = st.gridLayout;
  const rotations = st.gridLayout.rotations || {};
  const byId = {};
  for (const p of panels) byId[p.entity_id] = p;

  const panelAt = {};
  const placedIds = new Set();
  for (const [eid, [fr, fc]] of Object.entries(positions)) {
    if (!byId[eid]) continue;
    panelAt[`${fr},${fc}`] = eid;
    placedIds.add(eid);
  }

  const wrapper = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'panel-grid-pos';
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  grid.style.aspectRatio = `${cols} / ${rows}`;

  for (const [key, eid] of Object.entries(panelAt)) {
    const [fr, fc] = key.split(',').map(Number);
    const [spanCols, spanRows] = getSpan(eid, rotations);
    const card = makePanelCard(byId[eid], false);
    card.style.gridColumn = `${fc + 1} / span ${spanCols}`;
    card.style.gridRow = `${fr + 1} / span ${spanRows}`;
    grid.appendChild(card);
  }

  for (const lbl of (st.gridLayout.labels || [])) {
    const el = document.createElement('div');
    el.className = 'label-view';
    el.style.gridColumn = `${lbl.col + 1} / span ${lbl.spanCols}`;
    el.style.gridRow = `${lbl.row + 1} / span ${lbl.spanRows}`;
    el.textContent = lbl.text;
    grid.appendChild(el);
  }

  wrapper.appendChild(grid);

  const unplaced = panels.filter(p => !placedIds.has(p.entity_id));
  if (unplaced.length > 0) {
    const bank = document.createElement('div');
    bank.className = 'unplaced-bank';
    const label = document.createElement('div');
    label.className = 'unplaced-label';
    label.textContent = 'Unplaced';
    const tray = document.createElement('div');
    tray.className = 'unplaced-tray';
    for (const p of unplaced) tray.appendChild(makePanelCard(p, false));
    bank.appendChild(label);
    bank.appendChild(tray);
    wrapper.appendChild(bank);
  }
  section.insertBefore(wrapper, msg);
}

export function openPanelModal(panel) {
  st.panelTarget = panel;
  document.getElementById('panel-rename-input').value = panel.name;
  document.getElementById('panel-entity-id-label').textContent = panel.entity_id;
  switchPanelTab('details');
  openModal('panel-modal');
  setTimeout(() => {
    const inp = document.getElementById('panel-rename-input');
    inp.focus(); inp.select();
  }, 60);
  loadPanelDetails(panel.entity_id);
}

export function switchPanelTab(tab) {
  const isDetails = tab === 'details';
  document.getElementById('panel-tab-details').style.display = isDetails ? '' : 'none';
  document.getElementById('panel-tab-history').style.display = isDetails ? 'none' : '';
  document.getElementById('panel-tab-details-btn').classList.toggle('active', isDetails);
  document.getElementById('panel-tab-history-btn').classList.toggle('active', !isDetails);
  if (!isDetails && st.panelTarget) loadPanelChart(st.panelTarget.entity_id, st.panelChartRange);
}

export async function loadPanelDetails(entityId) {
  const list = document.getElementById('panel-detail-list');
  const tsEl = document.getElementById('panel-detail-ts');
  list.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.4rem 0">Loading...</div>';

  let url = `${window.BASE}/api/panel_detail?entity_id=${encodeURIComponent(entityId)}`;
  if (st.sliderActive) {
    const sliderVal = parseInt(document.getElementById('time-slider').value);
    const dateStr = document.getElementById('date-picker').value;
    if (dateStr) {
      const [y, mo, d] = dateStr.split('-').map(Number);
      const h = Math.floor(sliderVal / 60), m = sliderVal % 60;
      url += `&ts=${new Date(y, mo - 1, d, h, m).getTime()}`;
    }
  }

  try {
    const resp = await fetch(url);
    if (!resp.ok) { list.innerHTML = '<div style="color:var(--text-muted);padding:0.4rem 0">Could not load details.</div>'; return; }
    const data = await resp.json();
    if (tsEl) {
      if (data.historical_ts) {
        const d = new Date(data.historical_ts);
        tsEl.textContent = `Historical: ${d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
        tsEl.style.display = '';
      } else {
        tsEl.style.display = 'none';
      }
    }
    renderPanelDetails(data.sensors || []);
  } catch (e) {
    console.error('loadPanelDetails:', e);
    list.innerHTML = '<div style="color:var(--text-muted);padding:0.4rem 0">Error loading details.</div>';
  }
}

function _stripDevicePrefix(sensors, mainEntityId) {
  if (sensors.length < 2) return sensors.map(s => ({...s}));
  const refNames = sensors.filter(s => s.entity_id !== mainEntityId).map(s => s.name);
  if (!refNames.length) refNames.push(...sensors.map(s => s.name));
  let prefix = refNames[0];
  for (let i = 1; i < refNames.length; i++) {
    while (!refNames[i].startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (!prefix) break;
  }
  const trimIdx = prefix.lastIndexOf(' ');
  const strip = trimIdx > 0 ? prefix.slice(0, trimIdx + 1) : prefix;
  if (!strip) return sensors.map(s => ({...s}));
  return sensors.map(s => {
    let short = s.name.startsWith(strip) ? s.name.slice(strip.length) : null;
    if (!short) {
      for (let i = 1; i < strip.length; i++) {
        const tail = strip.slice(i);
        if (s.name.startsWith(tail)) { short = s.name.slice(tail.length); break; }
      }
    }
    return {...s, name: (short || s.name) || s.name};
  });
}

export function renderPanelDetails(sensors) {
  const list = document.getElementById('panel-detail-list');
  if (!sensors.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.4rem 0">No additional sensor data found for this device.</div>';
    return;
  }
  const stripped = _stripDevicePrefix(sensors, st.panelTarget ? st.panelTarget.entity_id : null);
  const groups = {};
  for (const s of stripped) {
    const g = s.group || 'other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  }
  const order = ['sensors', 'diagnostics', 'other'];
  const labels = {sensors: 'Sensors', diagnostics: 'Diagnostics', other: 'Other'};
  let html = '';
  for (const g of order) {
    if (!groups[g]) continue;
    html += `<div class="detail-group-label">${labels[g]}</div>`;
    for (const s of groups[g]) {
      html += `<div class="detail-row">
        <span class="detail-row-name">${s.name}</span>
        <span class="detail-row-value">${fmtDetailValue(s)}</span>
      </div>`;
    }
  }
  list.innerHTML = html;
}

export function fmtDetailValue(s) {
  if (s.device_class === 'timestamp') {
    try {
      const d = new Date(s.value);
      const date = d.toLocaleDateString([], {month: 'numeric', day: 'numeric', year: 'numeric'});
      const time = d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
      return `${date} ${time}`;
    } catch { return s.value; }
  }
  const v = s.value;
  if (v === 'unavailable' || v === 'unknown' || v === '') return '--';
  const num = parseFloat(v);
  if (!isNaN(num)) {
    const u = s.unit || '';
    let f;
    if (u === 'kWh') f = num.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 3});
    else if (Math.abs(num) >= 100) f = num.toFixed(1);
    else if (Math.abs(num) >= 1)   f = num.toFixed(2);
    else                           f = num.toFixed(3);
    return u ? `${f} ${u}` : f;
  }
  return v;
}

export async function loadPanelChart(entityId, range) {
  st.panelChartRange = range;
  document.querySelectorAll('.chart-range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  const svg = document.getElementById('panel-chart');
  svg.innerHTML = '<rect width="560" height="200" fill="var(--surface)"/><text x="280" y="100" text-anchor="middle" fill="var(--arc-label)" font-size="13">Loading...</text>';
  try {
    const resp = await fetch(`${window.BASE}/api/panel_chart?entity_id=${encodeURIComponent(entityId)}&range=${range}`);
    if (!resp.ok) { svg.innerHTML = '<rect width="560" height="200" fill="var(--surface)"/><text x="280" y="100" text-anchor="middle" fill="var(--arc-label)" font-size="13">Error loading data.</text>'; return; }
    renderPanelChart(await resp.json());
  } catch (e) { console.error('loadPanelChart:', e); }
}

export function renderPanelChart(data) {
  const svg = document.getElementById('panel-chart');
  const pts = (data.points || []).filter(p => p.w !== null && p.w !== undefined);
  if (!pts.length) {
    svg.innerHTML = '<rect width="560" height="200" fill="var(--surface)"/><text x="280" y="100" text-anchor="middle" fill="var(--arc-label)" font-size="13">No data for this period.</text>';
    return;
  }

  const W = 560, H = 200, ML = 52, MR = 12, MT = 12, MB = 32;
  const CW = W - ML - MR, CH = H - MT - MB;

  const maxVal = Math.max(...pts.map(p => p.w), 1);
  const yMax = Math.ceil(maxVal / 10) * 10;
  const minTs = pts[0].ts, maxTs = pts[pts.length - 1].ts;
  const tsRange = maxTs - minTs || 1;

  const px = ts => ML + ((ts - minTs) / tsRange) * CW;
  const py = w  => MT + CH - (w / yMax) * CH;

  const linePts = pts.map(p => `${px(p.ts).toFixed(1)},${py(p.w).toFixed(1)}`).join(' ');
  const fillD = `M ${px(minTs).toFixed(1)},${(MT + CH).toFixed(1)} ` +
    pts.map(p => `L ${px(p.ts).toFixed(1)},${py(p.w).toFixed(1)}`).join(' ') +
    ` L ${px(maxTs).toFixed(1)},${(MT + CH).toFixed(1)} Z`;

  let ySvg = '';
  for (let i = 0; i <= 4; i++) {
    const w = (yMax / 4) * i, y = py(w).toFixed(1);
    const lbl = w >= 1000 ? (w / 1000).toFixed(1) + 'k' : Math.round(w);
    ySvg += `<line x1="${ML}" y1="${y}" x2="${W - MR}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>
      <text x="${ML - 4}" y="${(parseFloat(y) + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--arc-label)">${lbl}W</text>`;
  }

  const numDays = (maxTs - minTs) / 86400000;
  const xCount = numDays <= 8 ? 7 : 5;
  let xSvg = '';
  for (let i = 0; i <= xCount; i++) {
    const ts = minTs + (tsRange / xCount) * i, x = px(ts).toFixed(1);
    const d = new Date(ts);
    const lbl = numDays <= 92
      ? d.toLocaleDateString([], {month: 'short', day: 'numeric'})
      : d.toLocaleDateString([], {month: 'short'});
    xSvg += `<line x1="${x}" y1="${MT}" x2="${x}" y2="${MT + CH}" stroke="var(--border)" stroke-width="0.5"/>
      <text x="${x}" y="${MT + CH + 16}" text-anchor="middle" font-size="9" fill="var(--arc-label)">${lbl}</text>`;
  }

  svg.innerHTML = `
    <rect width="${W}" height="${H}" fill="var(--surface)"/>
    ${ySvg}${xSvg}
    <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + CH}" stroke="var(--border)" stroke-width="0.5"/>
    <line x1="${ML}" y1="${MT + CH}" x2="${W - MR}" y2="${MT + CH}" stroke="var(--border)" stroke-width="0.5"/>
    <path d="${fillD}" fill="var(--arc-fill)"/>
    <polyline points="${linePts}" fill="none" stroke="var(--arc-line)" stroke-width="1.5"/>`;
}

export async function savePanelRename() {
  if (!st.panelTarget) return;
  const name = document.getElementById('panel-rename-input').value.trim();
  try {
    const resp = await fetch(`${window.BASE}/api/rename`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({entity_id: st.panelTarget.entity_id, name}),
    });
    if (!resp.ok) { console.error('Rename failed:', resp.status); return; }
    closeModal('panel-modal');
    if (name) {
      const p = st.panels.find(p => p.entity_id === st.panelTarget.entity_id);
      if (p) p.name = name;
      const cell = document.querySelector(`.panel-cell[data-entity-id="${CSS.escape(st.panelTarget.entity_id)}"]`);
      if (cell) { const el = cell.querySelector('.panel-name'); if (el) el.textContent = name; }
    } else {
      // Name cleared: ask app.js to re-fetch panels to get the integration default name back
      document.dispatchEvent(new CustomEvent('solar:refresh-panels'));
    }
  } catch (e) { console.error('savePanelRename:', e); }
}

// openModal/closeModal are defined in app.js; panels.js calls them via the global
// pattern to avoid a circular import (app.js imports panels.js).
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
