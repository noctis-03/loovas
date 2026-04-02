// ═══════════════════════════════════════════════════
//  transform.js — 팬/줌 변환, 좌표 변환, 그리드
//
//  FIX: layout.js에서 updateMinimap 직접 import 대신
//       지연 호출로 순환 참조 안전하게 처리
// ═══════════════════════════════════════════════════

import { T, vp, board, gridOn, setGridOn } from './state.js';

// 순환 참조 안전: layout.js의 updateMinimap을 지연 import
let _updateMinimap = null;

function getUpdateMinimap() {
  if (!_updateMinimap) {
    import('./layout.js').then(mod => {
      _updateMinimap = mod.updateMinimap;
    });
  }
  return _updateMinimap;
}

export function applyT() {
  board.style.transform = `translate(${T.x}px,${T.y}px) scale(${T.s})`;
  document.getElementById('zoom-pill').textContent = Math.round(T.s * 100) + '%';
  updateGrid();
  // 지연 호출로 순환 참조 안전하게 처리
  const fn = getUpdateMinimap();
  if (fn) fn();
}

export function getVpRect() {
  return vp.getBoundingClientRect();
}

/** Screen → Board 좌표 변환 */
export function s2b(sx, sy) {
  const r = getVpRect();
  return { x: (sx - r.left - T.x) / T.s, y: (sy - r.top - T.y) / T.s };
}

/** Board → Screen 좌표 변환 */
export function b2s(bx, by) {
  const r = getVpRect();
  return { x: r.left + bx * T.s + T.x, y: r.top + by * T.s + T.y };
}

export function resetView() {
  T.x = 0; T.y = 0; T.s = 1;
  applyT();
}

export function updateGrid() {
  const g = document.getElementById('grid');
  if (!gridOn) { g.style.display = 'none'; return; }
  g.style.display = 'block';
  const sz = 40 * T.s;
  g.style.backgroundSize = `${sz}px ${sz}px`;
  g.style.backgroundPosition = `${T.x % sz}px ${T.y % sz}px`;
}

export function toggleGrid() {
  setGridOn(!gridOn);
  updateGrid();
}

/** layout.js 초기화 후 직접 등록 (순환 참조 해결) */
export function registerUpdateMinimap(fn) {
  _updateMinimap = fn;
}
