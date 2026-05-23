
// ── State ────────────────────────────────────────────────────────────────
let _panels = [];
let _sunData = null;
let _historyCache = {};   // date -> {panels: {entity_id: [{ts,w}]}}
let _sliderActive = false;
let _selectedDate = null; // null = today / live
let _chartRange = 'today';
let _lastChartPoints = [];
const FINE_W = 4;  // fine grid cells per panel width
const FINE_H = 3;  // fine grid cells per panel height

let _refreshTimer = null;
let _refreshInterval = 30000;
let _panelTarget = null;
let _panelChartRange = '30d';
let _gridLayout = null;
let _editMode = false;
let _editPositions = {};
let _editRotations = {};
let _editRows = 4;
let _editCols = 16;
let _dragEntityId = null;
let _dragLabelId = null;
let _editLabels = [];

// ── Utilities ────────────────────────────────────────────────────────────

// Returns [spanCols, spanRows] for a panel given its rotation state.
function getSpan(eid, rotations) {
  return (rotations[eid] || 0) ? [FINE_H, FINE_W] : [FINE_W, FINE_H];
}

function fmtW(w) {
  if (w === null || w === undefined) return '--';
  if (w >= 1000) return (w / 1000).toFixed(2) + ' kW';
  return Math.round(w) + ' W';
}

function fmtWh(wh) {
  if (wh === null || wh === undefined) return '';
  if (wh >= 1000) return (wh / 1000).toFixed(2) + ' kWh';
  return Math.round(wh) + ' Wh';
}

function fmtTime(ts) {
  if (!ts) return '--';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function currentMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

// Updates slider value to now and refreshes the time label; no-op in history mode.
function updateSliderToNow() {
  if (_sliderActive) return;
  const cm = currentMinutes();
  const slider = document.getElementById('time-slider');
  slider.value = cm;
  const h = Math.floor(cm / 60), m = cm % 60;
  document.getElementById('slider-label').textContent =
    `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// Returns a ms timestamp for arc rendering: always today's date + slider time-of-day.
// _sunData always holds today's sun times so the arc comparison must use today's date.
function sliderToTimestamp(sliderVal) {
  const minutes = parseInt(sliderVal);
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

// ── Panel rendering ───────────────────────────────────────────────────────

function _clearPanelsSection() {
  const section = document.getElementById('panels-section');
  for (const el of Array.from(section.children)) {
    if (el.id !== 'discovery-msg') el.remove();
  }
}

function makePanelCard(p, isDraggable) {
  const cell = document.createElement('div');
  cell.className = 'panel-cell ' + (p.color || 'gray');
  cell.dataset.entityId = p.entity_id;

  const name = document.createElement('div');
  name.className = 'panel-name';
  name.title = p.name;
  name.textContent = p.name;

  const power = document.createElement('div');
  power.className = 'panel-power';
  power.textContent = p.status === 'online' ? fmtW(p.power_w) : '--';

  cell.appendChild(name);
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
      _dragEntityId = p.entity_id;
      e.dataTransfer.effectAllowed = 'move';
    });
    cell.addEventListener('dragend', () => { _dragEntityId = null; });
  } else {
    cell.addEventListener('click', () => openPanelModal(p));
  }
  return cell;
}

function renderPanels(panels) {
  if (_editMode) return;

  const section = document.getElementById('panels-section');
  const msg = document.getElementById('discovery-msg');

  if (!panels || panels.length === 0) {
    _clearPanelsSection();
    msg.style.display = 'block';
    return;
  }
  msg.style.display = 'none';
  _clearPanelsSection();

  if (_gridLayout && Object.keys(_gridLayout.positions || {}).length > 0) {
    renderGridView(panels, section, msg);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'panel-grid';
  for (const p of panels) grid.appendChild(makePanelCard(p, false));
  section.insertBefore(grid, msg);
}

function renderGridView(panels, section, msg) {
  const { rows, cols, positions } = _gridLayout;
  const rotations = _gridLayout.rotations || {};
  const byId = {};
  for (const p of panels) byId[p.entity_id] = p;

  // Build top-left lookup and placed set
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
  grid.style.gridTemplateRows = `repeat(${rows}, 24px)`;

  for (const [key, eid] of Object.entries(panelAt)) {
    const [fr, fc] = key.split(',').map(Number);
    const [spanCols, spanRows] = getSpan(eid, rotations);
    const card = makePanelCard(byId[eid], false);
    card.style.gridColumn = `${fc + 1} / span ${spanCols}`;
    card.style.gridRow = `${fr + 1} / span ${spanRows}`;
    grid.appendChild(card);
  }

  for (const lbl of (_gridLayout.labels || [])) {
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

function renderEditMode(panels) {
  const section = document.getElementById('panels-section');
  const msg = document.getElementById('discovery-msg');
  _clearPanelsSection();
  msg.style.display = 'none';

  const byId = {};
  for (const p of panels) byId[p.entity_id] = p;

  // Build top-left lookup and occupied set (in fine coordinates)
  const posEntries = Object.entries(_editPositions).filter(
    ([eid, pos]) => pos[0] < _editRows && pos[1] < _editCols && byId[eid]
  );
  const panelAt = {};
  const occupied = new Set();
  for (const [eid, [fr, fc]] of posEntries) {
    if (eid === _dragEntityId) continue;  // exclude dragging panel so its cells become drop targets
    panelAt[`${fr},${fc}`] = eid;
    const [sc, sr] = getSpan(eid, _editRotations);
    for (let dr = 0; dr < sr; dr++)
      for (let dc = 0; dc < sc; dc++)
        occupied.add(`${fr + dr},${fc + dc}`);
  }
  for (const lbl of _editLabels) {
    if (lbl.id === _dragLabelId) continue;
    for (let dr = 0; dr < lbl.spanRows; dr++)
      for (let dc = 0; dc < lbl.spanCols; dc++)
        occupied.add(`${lbl.row + dr},${lbl.col + dc}`);
  }
  const placedIds = new Set(posEntries.map(([eid]) => eid));

  const wrapper = document.createElement('div');

  const toolbar = document.createElement('div');
  toolbar.className = 'grid-toolbar';
  toolbar.innerHTML = `
    <span class="grid-size-label">Rows:</span>
    <button class="grid-sz-btn" id="rows-dec">&#8722;</button>
    <span class="grid-sz-val" id="rows-val">${_editRows}</span>
    <button class="grid-sz-btn" id="rows-inc">+</button>
    <button class="grid-sz-btn" id="rows-ins" title="Insert one row at top; shifts all panels and labels down">&#8593;</button>
    <span class="grid-size-label" style="margin-left:0.4rem">Cols:</span>
    <button class="grid-sz-btn" id="cols-dec">&#8722;</button>
    <span class="grid-sz-val" id="cols-val">${_editCols}</span>
    <button class="grid-sz-btn" id="cols-inc">+</button>
    <button class="grid-sz-btn" id="cols-ins" title="Insert one column at left; shifts all panels and labels right">&#8592;</button>
    <button class="modal-btn" id="add-label-btn" style="margin-left:0.4rem">+ Label</button>
    <span style="flex:1"></span>
    <button class="modal-btn modal-btn-primary" id="edit-save-btn">Save Layout</button>
    <button class="modal-btn" id="edit-cancel-btn">Cancel</button>
  `;
  wrapper.appendChild(toolbar);

  const hint = document.createElement('div');
  hint.className = 'edit-hint';
  hint.textContent = 'Double-click a panel to rotate landscape/portrait. Use + Label to add section headers; drag to position, click to edit text.';
  wrapper.appendChild(hint);

  const grid = document.createElement('div');
  grid.className = 'panel-grid-pos edit-active';
  grid.style.gridTemplateColumns = `repeat(${_editCols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${_editRows}, 24px)`;

  // Helper: panel rectangle overlap check (also checks labels)
  function wouldOverlap(tr, tc, dragEid) {
    const [sc, sr] = getSpan(dragEid, _editRotations);
    if (tr + sr > _editRows || tc + sc > _editCols) return true;
    for (const [eid, [fr, fc]] of Object.entries(_editPositions)) {
      if (eid === dragEid) continue;
      const [ec, er] = getSpan(eid, _editRotations);
      if (tr < fr + er && tr + sr > fr && tc < fc + ec && tc + sc > fc) return true;
    }
    for (const lbl of _editLabels) {
      if (tr < lbl.row + lbl.spanRows && tr + sr > lbl.row &&
          tc < lbl.col + lbl.spanCols && tc + sc > lbl.col) return true;
    }
    return false;
  }

  // Helper: label rectangle overlap check (checks panels and other labels)
  function labelWouldOverlap(tr, tc, lblId, sc, sr) {
    if (tr + sr > _editRows || tc + sc > _editCols) return true;
    for (const [eid, [fr, fc]] of Object.entries(_editPositions)) {
      const [ec, er] = getSpan(eid, _editRotations);
      if (tr < fr + er && tr + sr > fr && tc < fc + ec && tc + sc > fc) return true;
    }
    for (const lbl of _editLabels) {
      if (lbl.id === lblId) continue;
      if (tr < lbl.row + lbl.spanRows && tr + sr > lbl.row &&
          tc < lbl.col + lbl.spanCols && tc + sc > lbl.col) return true;
    }
    return false;
  }

  // Render panels with explicit fine-coordinate placement
  for (const [key, eid] of Object.entries(panelAt)) {
    const [fr, fc] = key.split(',').map(Number);
    const p = byId[eid];
    const [spanCols, spanRows] = getSpan(eid, _editRotations);
    const card = makePanelCard(p, true);
    card.style.gridColumn = `${fc + 1} / span ${spanCols}`;
    card.style.gridRow = `${fr + 1} / span ${spanRows}`;
    card.dataset.row = fr;
    card.dataset.col = fc;
    card.addEventListener('dragstart', () => {
      setTimeout(() => renderEditMode(_panels), 0);
    });
    card.addEventListener('dragend', () => renderEditMode(_panels));
    card.addEventListener('dblclick', () => {
      _editRotations[p.entity_id] = (_editRotations[p.entity_id] || 0) ? 0 : 1;
      renderEditMode(_panels);
    });
    card.addEventListener('dragover', e => { if (!_dragEntityId) return; e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (!_dragEntityId || _dragEntityId === p.entity_id) return;
      const tr = parseInt(card.dataset.row), tc = parseInt(card.dataset.col);
      delete _editPositions[_dragEntityId];
      delete _editPositions[p.entity_id];
      _editPositions[_dragEntityId] = [tr, tc];
      renderEditMode(_panels);
    });
    grid.appendChild(card);
  }

  // Render label cards
  for (const lbl of _editLabels) {
    if (lbl.id === _dragLabelId) continue;
    const el = document.createElement('div');
    el.className = 'label-cell';
    el.style.gridColumn = `${lbl.col + 1} / span ${lbl.spanCols}`;
    el.style.gridRow = `${lbl.row + 1} / span ${lbl.spanRows}`;
    el.draggable = true;
    el.dataset.labelId = lbl.id;
    el.addEventListener('dragstart', e => {
      if (e.target !== el) return;
      _dragLabelId = lbl.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => renderEditMode(_panels), 0);
    });
    el.addEventListener('dragend', () => { _dragLabelId = null; renderEditMode(_panels); });

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'label-text-input';
    inp.value = lbl.text;
    inp.placeholder = 'Label';
    inp.draggable = false;
    inp.addEventListener('input', e => {
      lbl.text = e.target.value;
      const m = document.createElement('span');
      m.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:0.75rem;font-weight:600;font-family:inherit;text-transform:uppercase;letter-spacing:0.08em';
      m.textContent = e.target.value || inp.placeholder;
      document.body.appendChild(m);
      const textPx = m.offsetWidth;
      document.body.removeChild(m);
      const cellPx = el.getBoundingClientRect().width / lbl.spanCols;
      if (cellPx > 0) {
        const needed = Math.max(FINE_W, Math.ceil((textPx + 24) / cellPx));
        const capped = Math.min(needed, _editCols - lbl.col);
        if (capped !== lbl.spanCols) {
          lbl.spanCols = capped;
          el.style.gridColumn = `${lbl.col + 1} / span ${lbl.spanCols}`;
        }
      }
    });

    const del = document.createElement('button');
    del.textContent = '×';
    del.className = 'label-del-btn';
    del.draggable = false;
    del.title = 'Delete label';
    del.addEventListener('click', e => { e.stopPropagation(); _editLabels = _editLabels.filter(l => l.id !== lbl.id); renderEditMode(_panels); });

    el.appendChild(inp);
    el.appendChild(del);
    grid.appendChild(el);
  }

  // Render fine cells for all unoccupied positions
  for (let fr = 0; fr < _editRows; fr++) {
    for (let fc = 0; fc < _editCols; fc++) {
      if (occupied.has(`${fr},${fc}`)) continue;
      const cell = document.createElement('div');
      cell.className = 'pgp-cell pgp-empty';
      cell.style.gridColumn = `${fc + 1}`;
      cell.style.gridRow = `${fr + 1}`;
      cell.dataset.row = fr;
      cell.dataset.col = fc;
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', e => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        const tr = parseInt(cell.dataset.row), tc = parseInt(cell.dataset.col);
        if (_dragEntityId) {
          if (wouldOverlap(tr, tc, _dragEntityId)) return;
          delete _editPositions[_dragEntityId];
          _editPositions[_dragEntityId] = [tr, tc];
          renderEditMode(_panels);
        } else if (_dragLabelId) {
          const lbl = _editLabels.find(l => l.id === _dragLabelId);
          if (!lbl) return;
          if (labelWouldOverlap(tr, tc, _dragLabelId, lbl.spanCols, lbl.spanRows)) return;
          lbl.row = tr;
          lbl.col = tc;
          renderEditMode(_panels);
        }
      });
      grid.appendChild(cell);
    }
  }

  wrapper.appendChild(grid);

  const unplaced = panels.filter(p => !placedIds.has(p.entity_id) && p.entity_id !== _dragEntityId);
  const bank = document.createElement('div');
  bank.className = 'unplaced-bank';
  bank.addEventListener('dragover', e => { if (!_dragEntityId) return; e.preventDefault(); bank.classList.add('drag-over-bank'); });
  bank.addEventListener('dragleave', () => bank.classList.remove('drag-over-bank'));
  bank.addEventListener('drop', e => {
    e.preventDefault();
    bank.classList.remove('drag-over-bank');
    if (!_dragEntityId) return;
    if (!_editPositions[_dragEntityId]) return; // already unplaced, ignore
    delete _editPositions[_dragEntityId];
    renderEditMode(_panels);
  });
  const bankLabel = document.createElement('div');
  bankLabel.className = 'unplaced-label';
  bankLabel.textContent = unplaced.length > 0
    ? 'Drag panels to the grid above. Drop here to unplace.'
    : 'All panels placed. Drop here to unplace.';
  const tray = document.createElement('div');
  tray.className = 'unplaced-tray';
  for (const p of unplaced) {
    const bc = makePanelCard(p, true);
    bc.addEventListener('dragend', () => renderEditMode(_panels));
    tray.appendChild(bc);
  }
  bank.appendChild(bankLabel);
  bank.appendChild(tray);
  wrapper.appendChild(bank);

  section.insertBefore(wrapper, msg);

  document.getElementById('rows-dec').addEventListener('click', () => { if (_editRows > 1) { _editRows -= 1; renderEditMode(_panels); } });
  document.getElementById('rows-inc').addEventListener('click', () => { _editRows += 1; renderEditMode(_panels); });
  document.getElementById('rows-ins').addEventListener('click', () => {
    _editRows += 1;
    for (const eid of Object.keys(_editPositions)) _editPositions[eid] = [_editPositions[eid][0] + 1, _editPositions[eid][1]];
    for (const lbl of _editLabels) lbl.row += 1;
    renderEditMode(_panels);
  });
  document.getElementById('cols-dec').addEventListener('click', () => { if (_editCols > 1) { _editCols -= 1; renderEditMode(_panels); } });
  document.getElementById('cols-inc').addEventListener('click', () => { _editCols += 1; renderEditMode(_panels); });
  document.getElementById('cols-ins').addEventListener('click', () => {
    _editCols += 1;
    for (const eid of Object.keys(_editPositions)) _editPositions[eid] = [_editPositions[eid][0], _editPositions[eid][1] + 1];
    for (const lbl of _editLabels) lbl.col += 1;
    renderEditMode(_panels);
  });
  document.getElementById('add-label-btn').addEventListener('click', () => {
    _editLabels.push({id: 'lbl_' + Math.random().toString(36).slice(2, 9), text: 'Label', row: 0, col: 0, spanCols: FINE_W, spanRows: 1});
    renderEditMode(_panels);
  });
  document.getElementById('edit-save-btn').addEventListener('click', () => exitEditMode(true));
  document.getElementById('edit-cancel-btn').addEventListener('click', () => exitEditMode(false));
}

function enterEditMode() {
  _editMode = true;
  _editPositions = Object.assign({}, (_gridLayout || {}).positions || {});
  _editRotations = Object.assign({}, (_gridLayout || {}).rotations || {});
  _editLabels = JSON.parse(JSON.stringify((_gridLayout || {}).labels || []));
  _editRows = (_gridLayout || {}).rows || 4 * FINE_H;
  _editCols = (_gridLayout || {}).cols || 16 * FINE_W;
  document.getElementById('edit-layout-btn').classList.add('active');
  renderEditMode(_panels);
}

async function exitEditMode(save) {
  if (save) await saveGridLayout();
  _editMode = false;
  document.getElementById('edit-layout-btn').classList.remove('active');
  renderPanels(_panels);
}

async function fetchGrid() {
  try {
    const resp = await fetch(`${BASE}/api/grid`);
    if (!resp.ok) return;
    const raw = await resp.json();
    if (!raw.fine_factor) {
      // migrate coarse positions to fine coordinates
      const positions = {};
      for (const [eid, pos] of Object.entries(raw.positions || {})) {
        positions[eid] = [pos[0] * FINE_H, pos[1] * FINE_W];
      }
      _gridLayout = {
        rows: (raw.rows || 4) * FINE_H,
        cols: (raw.cols || 16) * FINE_W,
        positions,
        rotations: {},
        labels: [],
        fine_factor: [FINE_W, FINE_H],
      };
    } else {
      _gridLayout = raw;
    }
  } catch (e) { console.error('fetchGrid:', e); }
}

async function saveGridLayout() {
  try {
    const resp = await fetch(`${BASE}/api/grid`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({rows: _editRows, cols: _editCols, positions: _editPositions, rotations: _editRotations, labels: _editLabels, fine_factor: [FINE_W, FINE_H]}),
    });
    if (!resp.ok) return;
    _gridLayout = await resp.json();
  } catch (e) { console.error('saveGridLayout:', e); }
}

function estimateWh(series, targetMs) {
  // Trapezoidal integration of power (W) over time up to targetMs -> Wh
  if (!series || series.length < 2) return null;
  let wh = 0;
  for (let i = 1; i < series.length; i++) {
    if (series[i].ts > targetMs) break;
    const dt = (series[i].ts - series[i - 1].ts) / 3600000; // ms -> hours
    wh += (series[i - 1].w + series[i].w) / 2 * dt;
  }
  return Math.round(Math.max(0, wh));
}

function applyHistoryToPanels(panels, historyData, targetMs) {
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

function recolorPanels(panels) {
  const online = panels.filter(p => p.status === 'online' && p.power_w > 0);
  const avg = online.length ? online.reduce((s, p) => s + p.power_w, 0) / online.length : 0;
  return panels.map(p => {
    if (p.status !== 'online' || avg <= 0) return {...p, color: 'gray'};
    const r = p.power_w / avg;
    const color = r >= 0.90 ? 'green' : r >= 0.70 ? 'yellow' : 'red';
    return {...p, color};
  });
}

// ── Sun arc SVG ───────────────────────────────────────────────────────────

function renderSunArc(sun, currentMs) {
  const svg = document.getElementById('sun-arc');
  if (!sun || !sun.dawn || !sun.dusk) return;

  const W = 800, H = 220;
  const ML = 65, MR = 65;
  const AW = W - ML - MR;
  const HORIZON = 150;
  const PEAK = 28;

  const dawn_ts = sun.dawn;
  const dusk_ts = sun.dusk;
  const dayRange = dusk_ts - dawn_ts;
  if (dayRange <= 0) return;

  // Extend view ~16% of day length on each side to show night arc
  const ext = dayRange * 0.16;
  const viewStart = dawn_ts - ext;
  const viewEnd = dusk_ts + ext;
  const totalRange = viewEnd - viewStart;

  function tx(ts) {
    return ML + Math.max(0, Math.min(AW, ((ts - viewStart) / totalRange) * AW));
  }
  function ty(ts) {
    const t = (ts - dawn_ts) / dayRange;
    return HORIZON - (HORIZON - PEAK) * Math.sin(Math.PI * t);
  }
  function tyB(ts) { return Math.min(H - 3, Math.max(3, ty(ts))); }

  // Helper: generate arc point strings for a time range
  function pts(fromTs, toTs, steps) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const ts = fromTs + (i / steps) * (toTs - fromTs);
      out.push(`${tx(ts).toFixed(1)},${tyB(ts).toFixed(1)}`);
    }
    return out;
  }
  function pathFill(fromTs, toTs, steps) {
    const p = pts(fromTs, toTs, steps);
    return `M ${tx(fromTs).toFixed(1)} ${HORIZON} L ${p.join(' L ')} L ${tx(toTs).toFixed(1)} ${HORIZON} Z`;
  }

  // Pre-dawn night fill: horizon -> underground arc -> back to horizon at dawn
  const preDawnPts = pts(viewStart, dawn_ts, 25);
  const preDawnFill =
    `M ${tx(viewStart).toFixed(1)} ${HORIZON} L ${preDawnPts.join(' L ')} ` +
    `L ${tx(dawn_ts).toFixed(1)} ${HORIZON} Z`;

  // Above-horizon arc (dawn to dusk)
  const aboveArc = pts(dawn_ts, dusk_ts, 80);

  // Underground arcs (before dawn, after dusk) -- drawn thinner/lighter
  const underLeft  = pts(viewStart, dawn_ts, 20);
  const underRight = pts(dusk_ts, viewEnd, 20);

  // Production fill (sunrise to min(sunset, now))
  const sr = sun.sunrise, ss = sun.sunset;
  const nowTs = currentMs ? currentMs / 1000 : Date.now() / 1000;
  let productionFill = '';
  if (sr && ss && nowTs >= sr) {
    const fillEnd = Math.min(ss, nowTs);
    if (fillEnd > sr) productionFill = pathFill(sr, fillEnd, 60);
  }

  // Twilight fills (dawn-sunrise, sunset-dusk)
  const twi1 = (sr && sr > dawn_ts) ? pathFill(dawn_ts, sr, 20) : '';
  const twi2 = (ss && dusk_ts > ss) ? pathFill(ss, dusk_ts, 20) : '';

  // Sun icon
  const isDay = sr && ss && nowTs >= sr && nowTs <= ss;
  const aboveGround = nowTs >= dawn_ts && nowTs <= dusk_ts;
  const sunIcon = aboveGround ? `
    <circle cx="${tx(nowTs).toFixed(1)}" cy="${tyB(nowTs).toFixed(1)}" r="13"
            fill="${isDay ? '#f5a623' : '#2a2a4a'}"
            stroke="${isDay ? '#c8820a' : '#5555a0'}" stroke-width="1.5"/>` : '';

  // Moon icon -- SVG-native (no emoji, for reliable cross-browser rendering)
  function moonSvg(phase, cx, cy, r) {
    const lit  = 'rgba(230,218,165,0.95)';
    const dark = 'rgba(14,18,52,0.97)';
    const rim  = 'rgba(110,140,210,0.60)';
    const base = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${dark}" stroke="${rim}" stroke-width="1.5"/>`;
    if (phase === 'new_moon')  return base;
    if (phase === 'full_moon') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${lit}" stroke="${rim}" stroke-width="0.8"/>`;
    if (phase === 'first_quarter')
      return base + `<path d="M ${cx},${cy-r} A ${r},${r} 0 0,1 ${cx},${cy+r} L ${cx},${cy-r} Z" fill="${lit}"/>`;
    if (phase === 'last_quarter')
      return base + `<path d="M ${cx},${cy-r} A ${r},${r} 0 0,0 ${cx},${cy+r} L ${cx},${cy-r} Z" fill="${lit}"/>`;
    const rx = (r * 0.55).toFixed(1);
    if (phase === 'waxing_crescent')
      return base + `<path d="M ${cx},${cy-r} A ${r},${r} 0 0,1 ${cx},${cy+r} A ${rx},${r} 0 0,0 ${cx},${cy-r} Z" fill="${lit}"/>`;
    if (phase === 'waxing_gibbous')
      return base + `<path d="M ${cx},${cy-r} A ${r},${r} 0 0,1 ${cx},${cy+r} A ${rx},${r} 0 0,1 ${cx},${cy-r} Z" fill="${lit}"/>`;
    if (phase === 'waning_gibbous')
      return base + `<path d="M ${cx},${cy-r} A ${r},${r} 0 0,0 ${cx},${cy+r} A ${rx},${r} 0 0,0 ${cx},${cy-r} Z" fill="${lit}"/>`;
    if (phase === 'waning_crescent')
      return base + `<path d="M ${cx},${cy-r} A ${r},${r} 0 0,0 ${cx},${cy+r} A ${rx},${r} 0 0,1 ${cx},${cy-r} Z" fill="${lit}"/>`;
    return base;
  }

  let moonIcon = '';
  if (sun.moon_phase) {
    const mTs = viewStart + (dawn_ts - viewStart) * 0.5;
    const mx = tx(mTs).toFixed(1);
    const my = 52;  // upper sky, above the arc and labels
    moonIcon = moonSvg(sun.moon_phase, parseFloat(mx), my, 16);
  }

  // Labels: Sunrise and Sunset ABOVE the arc
  function aboveLabel(ts, label) {
    if (!ts) return '';
    const x = tx(ts), arcY = ty(ts);
    // Clamp so labels never escape the top of the SVG
    const timeY  = Math.max(22, arcY - 38);
    const labelY = Math.max(8,  timeY  - 15);
    return `
      <line x1="${x.toFixed(1)}" y1="${(arcY + 1).toFixed(1)}" x2="${x.toFixed(1)}" y2="${HORIZON}"
            stroke="var(--arc-marker)" stroke-width="0.8" stroke-dasharray="3,4"/>
      <text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}"
            text-anchor="middle" font-size="10" fill="var(--arc-label)">${label}</text>
      <text x="${x.toFixed(1)}" y="${timeY.toFixed(1)}"
            text-anchor="middle" font-size="13" fill="var(--arc-time)" font-weight="600">${fmtTime(ts)}</text>`;
  }

  // Labels: Dawn, Solar noon, Dusk BELOW horizon (close to it)
  const belowMarkers = [
    {ts: dawn_ts,        label: 'Dawn',       anchor: 'start', xOff:  3},
    {ts: sun.solar_noon, label: 'Solar noon', anchor: 'middle', xOff: 0},
    {ts: dusk_ts,        label: 'Dusk',       anchor: 'end',   xOff: -3},
  ].filter(m => m.ts);

  const belowSvg = belowMarkers.map(m => {
    const x = tx(m.ts);
    return `
      <line x1="${x.toFixed(1)}" y1="${HORIZON}" x2="${x.toFixed(1)}" y2="${(HORIZON + 7).toFixed(1)}"
            stroke="var(--arc-marker)" stroke-width="0.5"/>
      <text x="${(x + m.xOff).toFixed(1)}" y="${(HORIZON + 14).toFixed(1)}"
            text-anchor="${m.anchor}" font-size="10" fill="var(--arc-label)">${m.label}</text>
      <text x="${(x + m.xOff).toFixed(1)}" y="${(HORIZON + 27).toFixed(1)}"
            text-anchor="${m.anchor}" font-size="12" fill="var(--arc-time)" font-weight="500">${fmtTime(m.ts)}</text>`;
  }).join('');

  svg.innerHTML = `
    <rect width="${W}" height="${H}" fill="var(--arc-bg)"/>
    <path d="${preDawnFill}" fill="var(--arc-night)"/>
    ${twi1 ? `<path d="${twi1}" fill="var(--arc-twilight)"/>` : ''}
    ${twi2 ? `<path d="${twi2}" fill="var(--arc-twilight)"/>` : ''}
    ${productionFill ? `<path d="${productionFill}" fill="var(--arc-fill)"/>` : ''}
    <polyline points="${underLeft.join(' ')}"
              fill="none" stroke="var(--arc-line)" stroke-width="1" opacity="0.4"/>
    <polyline points="${aboveArc.join(' ')}"
              fill="none" stroke="var(--arc-line)" stroke-width="2"/>
    <polyline points="${underRight.join(' ')}"
              fill="none" stroke="var(--arc-line)" stroke-width="1" opacity="0.4"/>
    <line x1="${ML}" y1="${HORIZON}" x2="${W-MR}" y2="${HORIZON}"
          stroke="var(--arc-marker)" stroke-width="0.5"/>
    ${aboveLabel(sr, 'Sunrise')}
    ${aboveLabel(ss, 'Sunset')}
    ${belowSvg}
    ${moonIcon}
    ${sunIcon}
  `;
}

// ── Data fetching ─────────────────────────────────────────────────────────

async function fetchPanels() {
  try {
    const resp = await fetch(`${BASE}/api/panels`);
    if (!resp.ok) return;
    const data = await resp.json();

    _panels = data.panels || [];
    if (!_sliderActive) {
      document.getElementById('total-power').textContent = fmtW(data.total_w);
      const online = (data.panels || []).filter(p => p.status === 'online').length;
      document.getElementById('header-status').textContent =
        data.count ? `${online} / ${data.count} online` : 'No inverters found';
      renderPanels(_panels);
    }
  } catch (e) {
    console.error('fetchPanels:', e);
  }
}

async function fetchSun() {
  try {
    const resp = await fetch(`${BASE}/api/sun`);
    if (!resp.ok) return;
    _sunData = await resp.json();
    const currentMs = _sliderActive ? sliderToTimestamp(
      document.getElementById('time-slider').value) : null;
    renderSunArc(_sunData, currentMs);
  } catch (e) {
    console.error('fetchSun:', e);
  }
}

async function fetchHistory(dateStr) {
  if (_historyCache[dateStr]) return _historyCache[dateStr];
  try {
    document.getElementById('slider-label').textContent = 'Loading...';
    const resp = await fetch(`${BASE}/api/history?date=${dateStr}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    _historyCache[dateStr] = data;
    return data;
  } catch (e) {
    console.error('fetchHistory:', e);
    return null;
  }
}

async function fetchSettings() {
  try {
    const resp = await fetch(`${BASE}/api/settings`);
    if (!resp.ok) return;
    const s = await resp.json();
    _refreshInterval = Math.max(10, (s.refresh_interval || 30)) * 1000;
  } catch (e) { /* ignore */ }
}

// ── Array production chart ────────────────────────────────────────────────

function _drawChartMessage(msg) {
  const canvas = document.getElementById('array-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim();
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, W / 2, H / 2);
}

async function fetchArrayChart() {
  const range = _chartRange;
  let url = `${BASE}/api/array_chart?range=${range}`;
  if (range === 'today') {
    const dateVal = document.getElementById('date-picker').value;
    if (dateVal) url += `&date=${dateVal}`;
  }
  // Deferred loading indicator: only shown if fetch takes longer than 400ms.
  // Fast machines finish before the timer fires; slow ones (Raspi, older i3) see it.
  const loadingTimer = setTimeout(() => _drawChartMessage('Loading...'), 400);
  try {
    const resp = await fetch(url);
    clearTimeout(loadingTimer);
    if (!resp.ok) { _drawChartMessage('Error'); return; }
    const data = await resp.json();
    _lastChartPoints = data.points || [];
    const totalEl = document.getElementById('chart-total-kwh');
    if (totalEl) totalEl.textContent = data.total_kwh != null ? `${data.total_kwh.toFixed(1)} kWh` : '-- kWh';
    drawArrayChart(_lastChartPoints, data.range);
  } catch (e) {
    clearTimeout(loadingTimer);
    console.error('fetchArrayChart:', e);
    _drawChartMessage('Error loading data');
  }
}

function drawArrayChart(points, range) {
  const canvas = document.getElementById('array-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const style = getComputedStyle(document.documentElement);
  const accentColor = style.getPropertyValue('--accent').trim();
  const dimColor = style.getPropertyValue('--text-dim').trim();
  const mutedColor = style.getPropertyValue('--text-muted').trim();
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

  points.forEach((pt, i) => {
    if (pt.kwh <= 0) return;
    const bh = (pt.kwh / maxKwh) * chartH;
    const x = padL + i * slotW + (slotW - barW) / 2;
    const y = padT + chartH - bh;
    ctx.fillStyle = accentColor;
    ctx.fillRect(x, y, barW, bh);
  });

  // X-axis baseline
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(padL, padT + chartH);
  ctx.lineTo(W - padR, padT + chartH);
  ctx.stroke();

  // X labels (subset to avoid crowding)
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
    const x = padL + i * slotW + slotW / 2;
    ctx.fillText(pt.label, x, padT + chartH + 3);
  });
}

// ── Chart tooltip ─────────────────────────────────────────────────────────

function initChartTooltip() {
  const canvas = document.getElementById('array-chart');
  const tooltip = document.getElementById('chart-tooltip');
  if (!canvas || !tooltip) return;

  canvas.addEventListener('mousemove', (e) => {
    const points = _lastChartPoints;
    if (!points || !points.length) { tooltip.style.display = 'none'; return; }

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const padL = 2, padR = 2, padB = 18, padT = 4;
    const chartW = rect.width - padL - padR;
    const chartH = rect.height - padT - padB;
    if (mouseX < padL || mouseX > rect.width - padR || mouseY > padT + chartH) {
      tooltip.style.display = 'none'; return;
    }

    const idx = Math.floor((mouseX - padL) / (chartW / points.length));
    if (idx < 0 || idx >= points.length) { tooltip.style.display = 'none'; return; }

    const pt = points[idx];
    tooltip.textContent = `${pt.label}: ${pt.kwh} kWh`;
    tooltip.style.display = 'block';

    const wrap = canvas.parentElement;
    const wrapRect = wrap.getBoundingClientRect();
    let tx = e.clientX - wrapRect.left + 10;
    let ty = e.clientY - wrapRect.top - 34;
    if (tx + tooltip.offsetWidth > wrapRect.width) tx = e.clientX - wrapRect.left - tooltip.offsetWidth - 10;
    if (ty < 0) ty = e.clientY - wrapRect.top + 10;
    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';
  });

  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
}

// ── Refresh loop ──────────────────────────────────────────────────────────

function scheduleRefresh() {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(async () => {
    await fetchPanels();
    if (!_sliderActive) {
      updateSliderToNow();
      if (_sunData) renderSunArc(_sunData, null);
      if (_chartRange === 'today') fetchArrayChart();
    }
    scheduleRefresh();
  }, _refreshInterval);
}

// ── Slider and date picker ─────────────────────────────────────────────────

function _setLiveActive(isLive) {
  document.getElementById('live-btn').classList.toggle('active', isLive);
  document.getElementById('next-day-btn').disabled =
    document.getElementById('date-picker').value >= todayStr();
}

function onLive() {
  document.getElementById('date-picker').value = todayStr();
  _sliderActive = false;
  _historyCache = {};
  _setLiveActive(true);
  updateSliderToNow();
  renderPanels(_panels);
  if (_sunData) renderSunArc(_sunData, null);
}

function onToday() {
  const dp = document.getElementById('date-picker');
  if (dp.value === todayStr() && !_sliderActive) return;
  dp.value = todayStr();
  _historyCache = {};
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
  _historyCache = {};
  onDateChange(true); // preserve slider time for day-over-day comparison
}

async function onSliderInput() {
  const slider = document.getElementById('time-slider');
  let val = parseInt(slider.value);
  const label = document.getElementById('slider-label');
  const dateStr = document.getElementById('date-picker').value || todayStr();
  const isToday = dateStr === todayStr();

  // Clamp to current time when on today; at/past now = live mode
  if (isToday) {
    const cm = currentMinutes();
    if (val >= cm) {
      slider.value = cm;
      _sliderActive = false;
      _setLiveActive(true);
      updateSliderToNow();
      renderPanels(_panels);
      if (_sunData) renderSunArc(_sunData, null);
      return;
    }
  }

  _sliderActive = true;
  _setLiveActive(false);

  const h = Math.floor(val / 60), m = val % 60;
  const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  label.textContent = timeStr;

  // Arc uses today's date + selected time (since _sunData is always today's sun)
  renderSunArc(_sunData, sliderToTimestamp(val));

  // History lookup uses the actual selected date
  const [y, mo, d] = dateStr.split('-').map(Number);
  const sliderTs = new Date(y, mo - 1, d, h, m).getTime();

  const history = await fetchHistory(dateStr);
  label.textContent = history && history.statistics_fallback ? timeStr + ' (hourly)' : timeStr;
  if (!history) return;

  let panels = applyHistoryToPanels(_panels, history, sliderTs);
  panels = recolorPanels(panels);

  const online = panels.filter(p => p.status === 'online' && p.power_w > 0);
  document.getElementById('total-power').textContent =
    fmtW(online.reduce((s, p) => s + p.power_w, 0));

  renderPanels(panels);
}

async function onDateChange(preserveSlider = false) {
  const dateStr = document.getElementById('date-picker').value;
  if (!dateStr) return;
  _historyCache = {};
  const slider = document.getElementById('time-slider');
  if (dateStr !== todayStr() && !preserveSlider) {
    // Default to dawn time when picking a fresh date; arrow navigation keeps current position
    let dawnMin = 360;
    if (_sunData && _sunData.dawn) {
      const dd = new Date(_sunData.dawn * 1000);
      dawnMin = dd.getHours() * 60 + dd.getMinutes();
    }
    slider.value = dawnMin;
  }
  _sliderActive = true;
  _setLiveActive(false);
  await onSliderInput();
  if (_chartRange === 'today') fetchArrayChart();
}

// ── Panel detail modal ────────────────────────────────────────────────────

function openPanelModal(panel) {
  _panelTarget = panel;
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

function switchPanelTab(tab) {
  const isDetails = tab === 'details';
  document.getElementById('panel-tab-details').style.display = isDetails ? '' : 'none';
  document.getElementById('panel-tab-history').style.display = isDetails ? 'none' : '';
  document.getElementById('panel-tab-details-btn').classList.toggle('active', isDetails);
  document.getElementById('panel-tab-history-btn').classList.toggle('active', !isDetails);
  if (!isDetails && _panelTarget) loadPanelChart(_panelTarget.entity_id, _panelChartRange);
}

async function loadPanelDetails(entityId) {
  const list = document.getElementById('panel-detail-list');
  list.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.4rem 0">Loading...</div>';
  try {
    const resp = await fetch(`${BASE}/api/panel_detail?entity_id=${encodeURIComponent(entityId)}`);
    if (!resp.ok) { list.innerHTML = '<div style="color:var(--text-muted);padding:0.4rem 0">Could not load details.</div>'; return; }
    const data = await resp.json();
    renderPanelDetails(data.sensors || []);
  } catch (e) {
    console.error('loadPanelDetails:', e);
    list.innerHTML = '<div style="color:var(--text-muted);padding:0.4rem 0">Error loading details.</div>';
  }
}

function _stripDevicePrefix(sensors, mainEntityId) {
  if (sensors.length < 2) return sensors.map(s => ({...s}));
  // Exclude the main power sensor from prefix detection; user may have renamed it,
  // which would break the common-prefix computation for all other sensors.
  const refNames = sensors.filter(s => s.entity_id !== mainEntityId).map(s => s.name);
  if (!refNames.length) refNames.push(...sensors.map(s => s.name));
  let prefix = refNames[0];
  for (let i = 1; i < refNames.length; i++) {
    while (!refNames[i].startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (!prefix) break;
  }
  // Trim to last word boundary so we don't split mid-word
  const trimIdx = prefix.lastIndexOf(' ');
  const strip = trimIdx > 0 ? prefix.slice(0, trimIdx + 1) : prefix;
  if (!strip) return sensors.map(s => ({...s}));
  return sensors.map(s => {
    let short = s.name.startsWith(strip) ? s.name.slice(strip.length) : null;
    if (!short) {
      // Sensor name doesn't match the full prefix (e.g. user renamed it, dropping a word).
      // Find the longest suffix of strip that is still a prefix of this name.
      for (let i = 1; i < strip.length; i++) {
        const tail = strip.slice(i);
        if (s.name.startsWith(tail)) { short = s.name.slice(tail.length); break; }
      }
    }
    return {...s, name: (short || s.name) || s.name};
  });
}

function renderPanelDetails(sensors) {
  const list = document.getElementById('panel-detail-list');
  if (!sensors.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.4rem 0">No additional sensor data found for this device.</div>';
    return;
  }
  const stripped = _stripDevicePrefix(sensors, _panelTarget ? _panelTarget.entity_id : null);
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

function fmtDetailValue(s) {
  if (s.device_class === 'timestamp') {
    try {
      const diff = Math.round((Date.now() - new Date(s.value).getTime()) / 60000);
      if (diff < 2) return 'just now';
      if (diff < 60) return `${diff} min ago`;
      if (diff < 1440) return `${Math.round(diff / 60)} hr ago`;
      return `${Math.round(diff / 1440)} days ago`;
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

async function loadPanelChart(entityId, range) {
  _panelChartRange = range;
  document.querySelectorAll('.chart-range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  const svg = document.getElementById('panel-chart');
  svg.innerHTML = '<rect width="560" height="200" fill="var(--surface)"/><text x="280" y="100" text-anchor="middle" fill="var(--arc-label)" font-size="13">Loading...</text>';
  try {
    const resp = await fetch(`${BASE}/api/panel_chart?entity_id=${encodeURIComponent(entityId)}&range=${range}`);
    if (!resp.ok) { svg.innerHTML = '<rect width="560" height="200" fill="var(--surface)"/><text x="280" y="100" text-anchor="middle" fill="var(--arc-label)" font-size="13">Error loading data.</text>'; return; }
    renderPanelChart(await resp.json());
  } catch (e) { console.error('loadPanelChart:', e); }
}

function renderPanelChart(data) {
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

async function savePanelRename() {
  if (!_panelTarget) return;
  const name = document.getElementById('panel-rename-input').value.trim();
  try {
    const resp = await fetch(`${BASE}/api/rename`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({entity_id: _panelTarget.entity_id, name}),
    });
    if (!resp.ok) { console.error('Rename failed:', resp.status); return; }
    closeModal('panel-modal');
    if (name) {
      const p = _panels.find(p => p.entity_id === _panelTarget.entity_id);
      if (p) p.name = name;
      const cell = document.querySelector(`.panel-cell[data-entity-id="${CSS.escape(_panelTarget.entity_id)}"]`);
      if (cell) { const el = cell.querySelector('.panel-name'); if (el) el.textContent = name; }
    } else {
      await fetchPanels();
    }
  } catch (e) { console.error('savePanelRename:', e); }
}

// ── Modals ────────────────────────────────────────────────────────────────

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

async function openAbout() {
  openModal('about-modal');
  try {
    const resp = await fetch(`${BASE}/api/about`);
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
    const resp = await fetch(`${BASE}/api/settings`);
    if (!resp.ok) return;
    const s = await resp.json();
    document.getElementById('setting-interval').value = s.refresh_interval || 30;
    document.getElementById('setting-min-avg-w').value = s.min_avg_w ?? 5;
  } catch (e) { console.error('openSettings:', e); }
}

async function saveSettings() {
  const interval = parseInt(document.getElementById('setting-interval').value) || 30;
  try {
    await fetch(`${BASE}/api/settings`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        refresh_interval: interval,
        min_avg_w: Math.max(0, parseInt(document.getElementById('setting-min-avg-w').value) || 0),
      }),
    });
    _refreshInterval = Math.max(10, interval) * 1000;
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
      if (_panelTarget) loadPanelChart(_panelTarget.entity_id, btn.dataset.range);
    });
  });

  document.getElementById('version-badge').addEventListener('click', openAbout);
  document.getElementById('about-close').addEventListener('click', () => closeModal('about-modal'));
  document.getElementById('about-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('about-modal');
  });

  document.getElementById('edit-layout-btn').addEventListener('click', enterEditMode);
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', () => closeModal('settings-modal'));
  document.getElementById('settings-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal('settings-modal');
  });
  document.getElementById('settings-save-btn').addEventListener('click', saveSettings);
  document.getElementById('settings-rediscover-btn').addEventListener('click', async () => {
    document.getElementById('header-status').textContent = 'Re-discovering...';
    try {
      await fetch(`${BASE}/api/rediscover`, {method: 'POST'});
      closeModal('settings-modal');
      setTimeout(fetchPanels, 3000);
    } catch (e) { console.error(e); }
  });

  document.getElementById('settings-export-btn').addEventListener('click', async () => {
    try {
      const [lr, gr] = await Promise.all([
        fetch(`${BASE}/api/layout`),
        fetch(`${BASE}/api/grid`),
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
      await fetch(`${BASE}/api/layout`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data.layout)});
      await fetch(`${BASE}/api/grid`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data.grid)});
      location.reload();
    } catch (err) { alert('Import failed: ' + err.message); }
  });

  // Refresh sun every 5 minutes so the arc stays current
  setInterval(fetchSun, 5 * 60 * 1000);

  // Array chart
  document.querySelectorAll('.chart-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _chartRange = btn.dataset.range;
      fetchArrayChart();
    });
  });
  fetchArrayChart();
  initChartTooltip();
  window.addEventListener('resize', () => {
    if (_chartRange) drawArrayChart(_lastChartPoints || [], _chartRange);
  });

  scheduleRefresh();
}

document.addEventListener('DOMContentLoaded', init);
