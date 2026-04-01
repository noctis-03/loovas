// ═══════════════════════════════════════════════════
//  toolbar.js — 툴바 드래그 이동, 모서리 자석 스냅,
//               색상 바 반응형 위치 제어
// ═══════════════════════════════════════════════════

const SNAP_DIST = 60;   // 자석 흡착 거리 (px)
const SNAP_GAP  = 12;   // 모서리와의 갭 (px)
const DRAW_TOOLS = ['pen', 'highlight', 'eraser', 'rect', 'circle', 'arrow', 'text'];

let tb, cb;
let dragging = false;
let dragOff = { x: 0, y: 0 };

export function initToolbar() {
  tb = document.getElementById('toolbar');
  cb = document.getElementById('color-bar');

  // 초기 위치: 화면 하단 중앙
  setInitialPosition();

  // 드래그 핸들 이벤트
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

  // 창 크기 변경 시 위치 보정
  window.addEventListener('resize', () => {
    clampPosition();
    updateColorBarPosition();
  });
}

function setInitialPosition() {
  const w = tb.offsetWidth || 600;
  const h = tb.offsetHeight || 48;
  const x = Math.round((window.innerWidth - w) / 2);
  const y = window.innerHeight - h - SNAP_GAP;
  tb.style.left = x + 'px';
  tb.style.top = y + 'px';
  updateTipDir();
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
  // 화면 밖으로 나가지 않게 제한
  const maxX = window.innerWidth - tb.offsetWidth;
  const maxY = window.innerHeight - tb.offsetHeight;
  x = Math.max(0, Math.min(x, maxX));
  y = Math.max(0, Math.min(y, maxY));
  tb.style.left = x + 'px';
  tb.style.top = y + 'px';
  updateColorBarPosition();
}

function endDrag() {
  if (!dragging) return;
  dragging = false;
  tb.classList.remove('tb-dragging');
  snapToEdge();
  updateTipDir();
  updateColorBarPosition();
}

function snapToEdge() {
  const r = tb.getBoundingClientRect();
  const W = window.innerWidth;
  const H = window.innerHeight;
  const tw = r.width;
  const th = r.height;
  let x = r.left;
  let y = r.top;

  // 가장 가까운 모서리/변 계산
  const distLeft   = r.left;
  const distRight  = W - r.right;
  const distTop    = r.top;
  const distBottom = H - r.bottom;

  // 수평 스냅
  if (distLeft < SNAP_DIST) {
    x = SNAP_GAP;
  } else if (distRight < SNAP_DIST) {
    x = W - tw - SNAP_GAP;
  }

  // 수직 스냅
  if (distTop < SNAP_DIST) {
    y = SNAP_GAP;
  } else if (distBottom < SNAP_DIST) {
    y = H - th - SNAP_GAP;
  }

  // 중앙 근처면 가로 중앙 스냅
  const centerX = (W - tw) / 2;
  if (Math.abs(r.left - centerX) < SNAP_DIST) {
    x = centerX;
  }

  tb.classList.add('tb-snapping');
  tb.style.left = Math.round(x) + 'px';
  tb.style.top = Math.round(y) + 'px';

  // 트랜지션 끝나면 클래스 제거
  setTimeout(() => tb.classList.remove('tb-snapping'), 250);
}

function clampPosition() {
  const maxX = window.innerWidth - tb.offsetWidth;
  const maxY = window.innerHeight - tb.offsetHeight;
  let x = parseFloat(tb.style.left) || 0;
  let y = parseFloat(tb.style.top) || 0;
  x = Math.max(0, Math.min(x, maxX));
  y = Math.max(0, Math.min(y, maxY));
  tb.style.left = x + 'px';
  tb.style.top = y + 'px';
}

function updateTipDir() {
  const r = tb.getBoundingClientRect();
  const belowHalf = r.top > window.innerHeight / 2;
  tb.setAttribute('data-tip-dir', belowHalf ? 'up' : 'down');
}

/**
 * 색상 바를 표시/숨김하고 위치를 결정
 */
export function showColorBar() {
  if (!cb) cb = document.getElementById('color-bar');
  cb.classList.add('cb-visible');
  updateColorBarPosition();
}

export function hideColorBar() {
  if (!cb) cb = document.getElementById('color-bar');
  cb.classList.remove('cb-visible');
}

export function updateColorBarPosition() {
  if (!cb || !cb.classList.contains('cb-visible')) return;
  if (!tb) tb = document.getElementById('toolbar');

  const tr = tb.getBoundingClientRect();
  const cbW = cb.offsetWidth || 280;
  const cbH = cb.offsetHeight || 40;

  // 툴바가 화면 상반부에 있으면 → 색상 바를 아래에
  // 툴바가 화면 하반부에 있으면 → 색상 바를 위에
  const tbMidY = tr.top + tr.height / 2;
  const aboveHalf = tbMidY < window.innerHeight / 2;

  let x = tr.left + (tr.width - cbW) / 2;
  let y;

  if (aboveHalf) {
    // 색상 바를 툴바 아래에
    y = tr.bottom + 8;
  } else {
    // 색상 바를 툴바 위에
    y = tr.top - cbH - 8;
  }

  // 화면 밖 방지
  x = Math.max(SNAP_GAP, Math.min(x, window.innerWidth - cbW - SNAP_GAP));
  y = Math.max(SNAP_GAP, Math.min(y, window.innerHeight - cbH - SNAP_GAP));

  cb.style.left = Math.round(x) + 'px';
  cb.style.top = Math.round(y) + 'px';
}

/**
 * 현재 도구가 그리기 도구인지 확인
 */
export function isDrawTool(t) {
  return DRAW_TOOLS.includes(t);
}
