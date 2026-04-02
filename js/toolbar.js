// ═══════════════════════════════════════════════════
//  toolbar.js — 툴바 드래그 이동, 모서리 자석 스냅,
//               color-tray 인라인 확장,
//               mode-bar / ur-cluster 위치 연동
// ═══════════════════════════════════════════════════

const SNAP_DIST = 60;
const SNAP_GAP  = 12;
const DRAW_TOOLS = ['pen', 'highlight', 'eraser', 'rect', 'circle', 'arrow', 'text'];

let tb, modeBar, urCluster;
let dragging = false;
let dragOff = { x: 0, y: 0 };

export function initToolbar() {
  tb        = document.getElementById('toolbar');
  modeBar   = document.getElementById('mode-bar');
  urCluster = document.getElementById('ur-cluster');

  setInitialPosition();

  const handle = document.getElementById('tb-drag-handle');

  handle.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
  });

  handle.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    startDrag(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    moveTo(e.clientX - dragOff.x, e.clientY - dragOff.y);
  });

  window.addEventListener('touchmove', e => {
    if (!dragging || e.touches.length !== 1) return;
    e.preventDefault();
    moveTo(e.touches[0].clientX - dragOff.x, e.touches[0].clientY - dragOff.y);
  }, { passive: false });

  window.addEventListener('mouseup', endDrag);
  window.addEventListener('touchend', endDrag);

  window.addEventListener('resize', () => {
    clampPosition();
    updateSatellitePositions();
  });
}

// ── 초기 위치: 하단 중앙 ──
function setInitialPosition() {
  const w = tb.offsetWidth || 500;
  const h = tb.offsetHeight || 48;
  const x = Math.round((window.innerWidth - w) / 2);
  const y = window.innerHeight - h - SNAP_GAP;
  tb.style.left = x + 'px';
  tb.style.top  = y + 'px';
  updateTipDir();
  updateSatellitePositions();
}

function startDrag(cx, cy) {
  const r = tb.getBoundingClientRect();
  dragOff.x = cx - r.left;
  dragOff.y = cy - r.top;
  dragging = true;
  tb.classList.add('tb-dragging');
  tb.classList.remove('tb-snapping');
}

function moveTo(x, y) {
  const maxX = window.innerWidth  - tb.offsetWidth;
  const maxY = window.innerHeight - tb.offsetHeight;
  x = Math.max(0, Math.min(x, maxX));
  y = Math.max(0, Math.min(y, maxY));
  tb.style.left = x + 'px';
  tb.style.top  = y + 'px';
  updateSatellitePositions();
}

function endDrag() {
  if (!dragging) return;
  dragging = false;
  tb.classList.remove('tb-dragging');
  snapToEdge();
  updateTipDir();
  updateSatellitePositions();
}

function snapToEdge() {
  const r  = tb.getBoundingClientRect();
  const W  = window.innerWidth;
  const H  = window.innerHeight;
  const tw = r.width;
  const th = r.height;
  let x = r.left;
  let y = r.top;

  const distLeft   = r.left;
  const distRight  = W - r.right;
  const distTop    = r.top;
  const distBottom = H - r.bottom;

  if (distLeft < SNAP_DIST)        x = SNAP_GAP;
  else if (distRight < SNAP_DIST)  x = W - tw - SNAP_GAP;

  if (distTop < SNAP_DIST)         y = SNAP_GAP;
  else if (distBottom < SNAP_DIST) y = H - th - SNAP_GAP;

  const centerX = (W - tw) / 2;
  if (Math.abs(r.left - centerX) < SNAP_DIST) x = centerX;

  tb.classList.add('tb-snapping');
  tb.style.left = Math.round(x) + 'px';
  tb.style.top  = Math.round(y) + 'px';

  setTimeout(() => tb.classList.remove('tb-snapping'), 250);
}

function clampPosition() {
  const maxX = window.innerWidth  - tb.offsetWidth;
  const maxY = window.innerHeight - tb.offsetHeight;
  let x = parseFloat(tb.style.left) || 0;
  let y = parseFloat(tb.style.top)  || 0;
  x = Math.max(0, Math.min(x, maxX));
  y = Math.max(0, Math.min(y, maxY));
  tb.style.left = x + 'px';
  tb.style.top  = y + 'px';
}

function updateTipDir() {
  const r = tb.getBoundingClientRect();
  const belowHalf = r.top > window.innerHeight / 2;
  tb.setAttribute('data-tip-dir', belowHalf ? 'up' : 'down');
}

// ══════════════════════════════════════════════════════
//  위성 요소 위치 계산
// ══════════════════════════════════════════════════════
export function updateSatellitePositions() {
  if (!tb) return;
  const tr   = tb.getBoundingClientRect();
  const GAP  = 8;

  // ── mode-bar: toolbar 왼쪽 ──
  if (modeBar) {
    const mbW = modeBar.offsetWidth  || 44;
    const mbH = modeBar.offsetHeight || 140;
    let mx = tr.left - mbW - GAP;
    let my = tr.top + (tr.height - mbH) / 2;

    mx = Math.max(SNAP_GAP, Math.min(mx, window.innerWidth  - mbW - SNAP_GAP));
    my = Math.max(SNAP_GAP, Math.min(my, window.innerHeight - mbH - SNAP_GAP));

    modeBar.style.left = Math.round(mx) + 'px';
    modeBar.style.top  = Math.round(my) + 'px';
  }

  // ── ur-cluster: toolbar 오른쪽 ──
  if (urCluster) {
    const ucW = urCluster.offsetWidth  || 44;
    const ucH = urCluster.offsetHeight || 100;
    let ux = tr.right + GAP;
    let uy = tr.top + (tr.height - ucH) / 2;

    ux = Math.max(SNAP_GAP, Math.min(ux, window.innerWidth  - ucW - SNAP_GAP));
    uy = Math.max(SNAP_GAP, Math.min(uy, window.innerHeight - ucH - SNAP_GAP));

    urCluster.style.left = Math.round(ux) + 'px';
    urCluster.style.top  = Math.round(uy) + 'px';
  }
}

// ══════════════════════════════════════════════════════
//  Color Tray
// ══════════════════════════════════════════════════════
export function showColorBar() {
  const tray = document.getElementById('color-tray');
  if (tray) tray.classList.add('ct-visible');
}

export function hideColorBar() {
  const tray = document.getElementById('color-tray');
  if (tray) tray.classList.remove('ct-visible');
}

export function updateColorBarPosition() {
  // color-tray는 인라인이므로 별도 위치 계산 불필요
}

export function isDrawTool(t) {
  return DRAW_TOOLS.includes(t);
}
