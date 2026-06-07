import { st, FINE_W, FINE_H } from './state.js';
import { getSpan } from './utils.js';
import { makePanelCard, renderPanels } from './panels.js';

export async function fetchGrid() {
  try {
    const resp = await fetch(`${window.BASE}/api/grid`);
    if (!resp.ok) return;
    const raw = await resp.json();
    if (!raw.fine_factor) {
      const positions = {};
      for (const [eid, pos] of Object.entries(raw.positions || {})) {
        positions[eid] = [pos[0] * FINE_H, pos[1] * FINE_W];
      }
      st.gridLayout = {
        rows: (raw.rows || 4) * FINE_H,
        cols: (raw.cols || 16) * FINE_W,
        positions,
        rotations: {},
        labels: [],
        fine_factor: [FINE_W, FINE_H],
      };
    } else {
      st.gridLayout = raw;
    }
  } catch (e) { console.error('fetchGrid:', e); }
}

export async function saveGridLayout() {
  try {
    const resp = await fetch(`${window.BASE}/api/grid`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        rows: st.editRows, cols: st.editCols,
        positions: st.editPositions, rotations: st.editRotations,
        labels: st.editLabels, fine_factor: [FINE_W, FINE_H],
      }),
    });
    if (!resp.ok) return;
    st.gridLayout = await resp.json();
  } catch (e) { console.error('saveGridLayout:', e); }
}

export function enterEditMode() {
  st.editMode = true;
  st.editPositions = Object.assign({}, (st.gridLayout || {}).positions || {});
  st.editRotations = Object.assign({}, (st.gridLayout || {}).rotations || {});
  st.editLabels = JSON.parse(JSON.stringify((st.gridLayout || {}).labels || []));
  st.editRows = (st.gridLayout || {}).rows || 4 * FINE_H;
  st.editCols = (st.gridLayout || {}).cols || 16 * FINE_W;
  document.getElementById('edit-layout-btn').classList.add('active');
  renderEditMode(st.panels);
}

export async function exitEditMode(save) {
  if (save) await saveGridLayout();
  st.editMode = false;
  document.getElementById('edit-layout-btn').classList.remove('active');
  renderPanels(st.panels);
}

export function renderEditMode(panels) {
  const section = document.getElementById('panels-section');
  const msg = document.getElementById('discovery-msg');
  const _clearPanelsSection = () => {
    for (const el of Array.from(section.children)) {
      if (el.id !== 'discovery-msg') el.remove();
    }
  };
  _clearPanelsSection();
  msg.style.display = 'none';

  const byId = {};
  for (const p of panels) byId[p.entity_id] = p;

  const posEntries = Object.entries(st.editPositions).filter(
    ([eid, pos]) => pos[0] < st.editRows && pos[1] < st.editCols && byId[eid]
  );
  const panelAt = {};
  const occupied = new Set();
  for (const [eid, [fr, fc]] of posEntries) {
    if (eid === st.dragEntityId) continue;
    panelAt[`${fr},${fc}`] = eid;
    const [sc, sr] = getSpan(eid, st.editRotations);
    for (let dr = 0; dr < sr; dr++)
      for (let dc = 0; dc < sc; dc++)
        occupied.add(`${fr + dr},${fc + dc}`);
  }
  for (const lbl of st.editLabels) {
    if (lbl.id === st.dragLabelId) continue;
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
    <span class="grid-sz-val" id="rows-val">${st.editRows}</span>
    <button class="grid-sz-btn" id="rows-inc">+</button>
    <button class="grid-sz-btn" id="rows-ins" title="Insert one row at top; shifts all panels and labels down">&#8593;</button>
    <span class="grid-size-label" style="margin-left:0.4rem">Cols:</span>
    <button class="grid-sz-btn" id="cols-dec">&#8722;</button>
    <span class="grid-sz-val" id="cols-val">${st.editCols}</span>
    <button class="grid-sz-btn" id="cols-inc">+</button>
    <button class="grid-sz-btn" id="cols-ins" title="Insert one column at left; shifts all panels and labels right">&#8592;</button>
    <span class="grid-size-label" style="margin-left:0.5rem;color:var(--text-dim)">(${Math.round(st.editRows/FINE_H)} &times; ${Math.round(st.editCols/FINE_W)} panels)</span>
    <button class="modal-btn" id="add-label-btn" style="margin-left:0.4rem">+ Label</button>
    <span style="flex:1"></span>
    <button class="modal-btn" id="edit-reset-btn">Reset Layout</button>
    <button class="modal-btn modal-btn-primary" id="edit-save-btn">Save Layout</button>
    <button class="modal-btn" id="edit-cancel-btn">Cancel</button>
  `;
  wrapper.appendChild(toolbar);

  const hint = document.createElement('div');
  hint.className = 'edit-hint';
  hint.textContent = 'Panels snap by their top-left corner: drag a panel and the cell under the top-left corner is where it will land. Double-click to rotate landscape/portrait. Use + Label to add section headers.';
  wrapper.appendChild(hint);

  const grid = document.createElement('div');
  grid.className = 'panel-grid-pos edit-active';
  grid.style.gridTemplateColumns = `repeat(${st.editCols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${st.editRows}, minmax(0, 1fr))`;
  grid.style.aspectRatio = `${st.editCols} / ${st.editRows}`;

  function wouldOverlap(tr, tc, dragEid) {
    const [sc, sr] = getSpan(dragEid, st.editRotations);
    if (tr + sr > st.editRows || tc + sc > st.editCols) return true;
    for (const [eid, [fr, fc]] of Object.entries(st.editPositions)) {
      if (eid === dragEid) continue;
      const [ec, er] = getSpan(eid, st.editRotations);
      if (tr < fr + er && tr + sr > fr && tc < fc + ec && tc + sc > fc) return true;
    }
    for (const lbl of st.editLabels) {
      if (tr < lbl.row + lbl.spanRows && tr + sr > lbl.row &&
          tc < lbl.col + lbl.spanCols && tc + sc > lbl.col) return true;
    }
    return false;
  }

  function labelWouldOverlap(tr, tc, lblId, sc, sr) {
    if (tr + sr > st.editRows || tc + sc > st.editCols) return true;
    for (const [eid, [fr, fc]] of Object.entries(st.editPositions)) {
      const [ec, er] = getSpan(eid, st.editRotations);
      if (tr < fr + er && tr + sr > fr && tc < fc + ec && tc + sc > fc) return true;
    }
    for (const lbl of st.editLabels) {
      if (lbl.id === lblId) continue;
      if (tr < lbl.row + lbl.spanRows && tr + sr > lbl.row &&
          tc < lbl.col + lbl.spanCols && tc + sc > lbl.col) return true;
    }
    return false;
  }

  for (const [key, eid] of Object.entries(panelAt)) {
    const [fr, fc] = key.split(',').map(Number);
    const p = byId[eid];
    const [spanCols, spanRows] = getSpan(eid, st.editRotations);
    const card = makePanelCard(p, true);
    card.classList.add(spanRows > spanCols ? 'portrait' : 'landscape');
    card.style.gridColumn = `${fc + 1} / span ${spanCols}`;
    card.style.gridRow = `${fr + 1} / span ${spanRows}`;
    card.dataset.row = fr;
    card.dataset.col = fc;
    card.addEventListener('dragstart', (e) => {
      st.dragOffsetCol = 0;
      st.dragOffsetRow = 0;
      e.dataTransfer.setDragImage(card, 0, 0);
      setTimeout(() => renderEditMode(st.panels), 0);
    });
    card.addEventListener('dragend', () => renderEditMode(st.panels));
    card.addEventListener('dblclick', () => {
      st.editRotations[p.entity_id] = (st.editRotations[p.entity_id] || 0) ? 0 : 1;
      renderEditMode(st.panels);
    });
    card.addEventListener('dragover', e => { if (!st.dragEntityId) return; e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (!st.dragEntityId || st.dragEntityId === p.entity_id) return;
      const tr = parseInt(card.dataset.row), tc = parseInt(card.dataset.col);
      delete st.editPositions[st.dragEntityId];
      delete st.editPositions[p.entity_id];
      st.editPositions[st.dragEntityId] = [tr, tc];
      renderEditMode(st.panels);
    });
    grid.appendChild(card);
  }

  for (const lbl of st.editLabels) {
    if (lbl.id === st.dragLabelId) continue;
    const el = document.createElement('div');
    el.className = 'label-cell';
    el.style.gridColumn = `${lbl.col + 1} / span ${lbl.spanCols}`;
    el.style.gridRow = `${lbl.row + 1} / span ${lbl.spanRows}`;
    el.draggable = true;
    el.dataset.labelId = lbl.id;
    el.addEventListener('dragstart', e => {
      if (e.target !== el) return;
      st.dragLabelId = lbl.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => renderEditMode(st.panels), 0);
    });
    el.addEventListener('dragend', () => { st.dragLabelId = null; renderEditMode(st.panels); });

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
        const capped = Math.min(needed, st.editCols - lbl.col);
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
    del.addEventListener('click', e => { e.stopPropagation(); st.editLabels = st.editLabels.filter(l => l.id !== lbl.id); renderEditMode(st.panels); });

    el.appendChild(inp);
    el.appendChild(del);
    grid.appendChild(el);
  }

  for (let fr = 0; fr < st.editRows; fr++) {
    for (let fc = 0; fc < st.editCols; fc++) {
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
        if (st.dragEntityId) {
          const tr = Math.max(0, parseInt(cell.dataset.row) - st.dragOffsetRow);
          const tc = Math.max(0, parseInt(cell.dataset.col) - st.dragOffsetCol);
          if (wouldOverlap(tr, tc, st.dragEntityId)) return;
          const wasUnplaced = !(st.dragEntityId in st.editPositions);
          delete st.editPositions[st.dragEntityId];
          st.editPositions[st.dragEntityId] = [tr, tc];
          if (wasUnplaced) st.editRotations[st.dragEntityId] = st.bankDefaultRotation;
          renderEditMode(st.panels);
        } else if (st.dragLabelId) {
          const tr = parseInt(cell.dataset.row);
          const tc = parseInt(cell.dataset.col);
          const lbl = st.editLabels.find(l => l.id === st.dragLabelId);
          if (!lbl) return;
          if (labelWouldOverlap(tr, tc, st.dragLabelId, lbl.spanCols, lbl.spanRows)) return;
          lbl.row = tr;
          lbl.col = tc;
          renderEditMode(st.panels);
        }
      });
      grid.appendChild(cell);
    }
  }

  wrapper.appendChild(grid);

  const unplaced = panels.filter(p => !placedIds.has(p.entity_id) && p.entity_id !== st.dragEntityId);
  const bank = document.createElement('div');
  bank.className = 'unplaced-bank';
  bank.addEventListener('dragover', e => { if (!st.dragEntityId) return; e.preventDefault(); bank.classList.add('drag-over-bank'); });
  bank.addEventListener('dragleave', () => bank.classList.remove('drag-over-bank'));
  bank.addEventListener('drop', e => {
    e.preventDefault();
    bank.classList.remove('drag-over-bank');
    if (!st.dragEntityId) return;
    if (!st.editPositions[st.dragEntityId]) return;
    delete st.editPositions[st.dragEntityId];
    renderEditMode(st.panels);
  });
  const bankLabel = document.createElement('div');
  bankLabel.className = 'unplaced-label';
  bankLabel.style.display = 'flex';
  bankLabel.style.alignItems = 'center';
  bankLabel.style.gap = '0.5rem';
  const bankLabelText = document.createElement('span');
  bankLabelText.textContent = unplaced.length > 0
    ? 'Drag panels to the grid above. Drop here to unplace.'
    : 'All panels placed. Drop here to unplace.';
  const orientBtn = document.createElement('button');
  orientBtn.className = 'modal-btn';
  orientBtn.id = 'bank-orientation-btn';
  orientBtn.style.cssText = 'font-size:0.72rem;padding:0.15rem 0.5rem;flex-shrink:0';
  orientBtn.title = 'Default orientation for panels placed from the bank';
  orientBtn.textContent = st.bankDefaultRotation ? 'Default: Portrait' : 'Default: Landscape';
  orientBtn.addEventListener('click', e => {
    e.stopPropagation();
    st.bankDefaultRotation = st.bankDefaultRotation ? 0 : 1;
    renderEditMode(st.panels);
  });
  bankLabel.appendChild(bankLabelText);
  bankLabel.appendChild(orientBtn);
  const tray = document.createElement('div');
  tray.className = 'unplaced-tray' + (st.bankDefaultRotation ? ' portrait' : '');
  for (const p of unplaced) {
    const bc = makePanelCard(p, true);
    bc.addEventListener('dragstart', (e) => {
      st.dragOffsetCol = 0;
      st.dragOffsetRow = 0;
      e.dataTransfer.setDragImage(bc, 0, 0);
    });
    bc.addEventListener('dragend', () => renderEditMode(st.panels));
    tray.appendChild(bc);
  }
  bank.appendChild(bankLabel);
  bank.appendChild(tray);
  wrapper.appendChild(bank);

  section.insertBefore(wrapper, msg);

  document.getElementById('rows-dec').addEventListener('click', () => { if (st.editRows > 1) { st.editRows -= 1; renderEditMode(st.panels); } });
  document.getElementById('rows-inc').addEventListener('click', () => { st.editRows += 1; renderEditMode(st.panels); });
  document.getElementById('rows-ins').addEventListener('click', () => {
    st.editRows += 1;
    for (const eid of Object.keys(st.editPositions)) st.editPositions[eid] = [st.editPositions[eid][0] + 1, st.editPositions[eid][1]];
    for (const lbl of st.editLabels) lbl.row += 1;
    renderEditMode(st.panels);
  });
  document.getElementById('cols-dec').addEventListener('click', () => { if (st.editCols > 1) { st.editCols -= 1; renderEditMode(st.panels); } });
  document.getElementById('cols-inc').addEventListener('click', () => { st.editCols += 1; renderEditMode(st.panels); });
  document.getElementById('cols-ins').addEventListener('click', () => {
    st.editCols += 1;
    for (const eid of Object.keys(st.editPositions)) st.editPositions[eid] = [st.editPositions[eid][0], st.editPositions[eid][1] + 1];
    for (const lbl of st.editLabels) lbl.col += 1;
    renderEditMode(st.panels);
  });
  document.getElementById('add-label-btn').addEventListener('click', () => {
    st.editLabels.push({id: 'lbl_' + Math.random().toString(36).slice(2, 9), text: 'Label', row: 0, col: 0, spanCols: FINE_W, spanRows: 1});
    renderEditMode(st.panels);
  });
  document.getElementById('edit-reset-btn').addEventListener('click', () => {
    document.getElementById('reset-confirm-modal').classList.add('open');
  });
  document.getElementById('edit-save-btn').addEventListener('click', () => exitEditMode(true));
  document.getElementById('edit-cancel-btn').addEventListener('click', () => exitEditMode(false));
}
