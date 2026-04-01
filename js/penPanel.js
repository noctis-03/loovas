// ═══════════════════════════════════════════════════
//  penPanel.js — 펜/형광펜/지우개 설정 패널
//
//  FIX: 가로 툴바에 맞게 패널 위치 계산 수정
// ═══════════════════════════════════════════════════

import { penCfg, penPanelOpen, setPenPanelOpen, tool, color, sw } from './state.js';
import { pts2path, buildTaperOutlinePath } from './svg.js';

export function togglePenPanel(t) {
  if (penPanelOpen) { closePenPanel(); return; }
  openPenPanel(t);
}

export function openPenPanel(t) {
  const pp = document.getElementById('pen-panel');
  const titles = { pen: '✏️ 펜 설정', highlight: '🖊️ 형광펜 설정', eraser: '◻ 지우개 설정' };
  document.getElementById('pp-title-txt').textContent = titles[t] || '설정';

  const isEraser = t === 'eraser';
  document.getElementById('pp-smooth').closest('.pp-sect').style.display = isEraser ? 'none' : '';
  document.getElementById('pp-opacity').closest('.pp-sect').style.display = isEraser ? 'none' : '';
  document.getElementById('pp-cap-sect').style.display = isEraser ? 'none' : '';
  document.getElementById('pp-pressure-sect').style.display = isEraser ? 'none' : '';
  document.querySelector('#pp-preview-wrap').parentElement.style.display = isEraser ? 'none' : '';

  document.getElementById('pp-smooth').value = penCfg.smooth;
  document.getElementById('pp-smooth-v').textContent = penCfg.smooth;
  document.getElementById('pp-opacity').value = penCfg.opacity;
  document.getElementById('pp-opacity-v').textContent = penCfg.opacity + '%';
  document.querySelectorAll('.pp-cap').forEach(c => c.classList.toggle('pp-on', c.dataset.cap === penCfg.cap));
  document.querySelectorAll('#pp-pc .pp-chip').forEach(c => c.classList.toggle('pp-on', c.dataset.pressure === penCfg.pressure));

  positionPenPanel(t);
  pp.style.display = 'flex';
  requestAnimationFrame(() => pp.classList.add('pp-open'));
  setPenPanelOpen(true);
  updatePPPreview();
}

export function closePenPanel() {
  const pp = document.getElementById('pen-panel');
  pp.classList.remove('pp-open');
  setPenPanelOpen(false);
  setTimeout(() => { if (!penPanelOpen) pp.style.display = 'none'; }, 160);
}

function positionPenPanel(t) {
  const pp = document.getElementById('pen-panel');
  const tb = document.getElementById('toolbar');
  if (!tb) return;

  const tr = tb.getBoundingClientRect();
  const ppW = 228;
  const ppH = 420; // 대략 높이

  // 툴바 버튼 찾기
  const btn = document.getElementById('t-' + t);
  const br = btn ? btn.getBoundingClientRect() : tr;

  // 화면 반분 기준: 위에 있으면 아래로, 아래에 있으면 위로
  const tbMidY = tr.top + tr.height / 2;
  const above = tbMidY < window.innerHeight / 2;

  let x = br.left + br.width / 2 - ppW / 2;
  let y;

  if (above) {
    y = tr.bottom + 12;
  } else {
    y = tr.top - ppH - 12;
  }

  // 화면 밖 보정
  x = Math.max(8, Math.min(x, window.innerWidth - ppW - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - ppH - 8));

  pp.style.left = x + 'px';
  pp.style.top = y + 'px';
}

export function onPPChange() {
  penCfg.smooth = parseInt(document.getElementById('pp-smooth').value);
  penCfg.opacity = parseInt(document.getElementById('pp-opacity').value);
  document.getElementById('pp-smooth-v').textContent = penCfg.smooth;
  document.getElementById('pp-opacity-v').textContent = penCfg.opacity + '%';
  const chips = [...document.querySelectorAll('#pp-sc .pp-chip')];
  const presets = [0, 5, 10, 18];
  chips.forEach((c, i) => c.classList.toggle('pp-on', presets[i] === penCfg.smooth));
  updatePPPreview();
}

export function setPPSmooth(v, el) {
  document.querySelectorAll('#pp-sc .pp-chip').forEach(c => c.classList.remove('pp-on'));
  el.classList.add('pp-on');
  penCfg.smooth = v;
  document.getElementById('pp-smooth').value = v;
  document.getElementById('pp-smooth-v').textContent = v;
  updatePPPreview();
}

export function setPPCap(el) {
  document.querySelectorAll('.pp-cap').forEach(c => c.classList.remove('pp-on'));
  el.classList.add('pp-on');
  penCfg.cap = el.dataset.cap;
  updatePPPreview();
}

export function setPPPressure(el) {
  document.querySelectorAll('#pp-pc .pp-chip').forEach(c => c.classList.remove('pp-on'));
  el.classList.add('pp-on');
  penCfg.pressure = el.dataset.pressure;
  updatePPPreview();
}

export function updatePPPreview() {
  const p = document.getElementById('pp-preview-path');
  if (!p) return;
  const demoPts = [
    { x: 10, y: 30 }, { x: 30, y: 10 }, { x: 50, y: 22 }, { x: 70, y: 34 },
    { x: 90, y: 18 }, { x: 110, y: 8 }, { x: 130, y: 22 }, { x: 150, y: 34 },
    { x: 170, y: 16 }, { x: 192, y: 14 }
  ];
  const baseW = (tool === 'highlight') ? sw * 4 : sw;
  const col = (tool === 'highlight') ? color + '99' : color;
  const opacity = penCfg.opacity / 100;

  if (penCfg.pressure && penCfg.pressure !== 'none') {
    p.setAttribute('d', buildTaperOutlinePath(demoPts, Math.max(2, baseW), penCfg.pressure));
    p.setAttribute('fill', col);
    p.setAttribute('fill-opacity', opacity);
    p.setAttribute('stroke', 'none');
    p.removeAttribute('stroke-opacity');
    p.removeAttribute('stroke-width');
    p.removeAttribute('stroke-linecap');
  } else {
    p.setAttribute('stroke', col);
    p.setAttribute('stroke-opacity', opacity);
    p.setAttribute('stroke-linecap', penCfg.cap);
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('stroke-width', Math.max(1, baseW));
    p.setAttribute('fill', 'none');
    p.removeAttribute('fill-opacity');
    p.setAttribute('d', pts2path(demoPts));
  }
}

export function initPenPanel() {
  document.getElementById('pp-close-btn').addEventListener('click', closePenPanel);
  document.getElementById('pp-smooth').addEventListener('input', onPPChange);
  document.getElementById('pp-opacity').addEventListener('input', onPPChange);

  document.querySelectorAll('#pp-sc .pp-chip').forEach(el => {
    el.addEventListener('click', () => setPPSmooth(parseInt(el.dataset.smooth), el));
  });
  document.querySelectorAll('.pp-cap').forEach(el => {
    el.addEventListener('click', () => setPPCap(el));
  });
  document.querySelectorAll('#pp-pc .pp-chip').forEach(el => {
    el.addEventListener('click', () => setPPPressure(el));
  });
}
