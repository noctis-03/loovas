// ═══════════════════════════════════════════════════
//  doc-transform.js — 문서 캔버스 뷰포트 변환
// ═══════════════════════════════════════════════════

import * as S from './doc-state.js';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

function applyTransform() {
  if (!S.board) return;
  S.board.style.transform = `translate(${S.T.x}px, ${S.T.y}px) scale(${S.T.s})`;
  // zoom pill
  const pill = document.getElementById('doc-zoom-pill');
  if (pill) pill.textContent = Math.round(S.T.s * 100) + '%';
}

export function setTransform(x, y, s) {
  S.T.x = x;
  S.T.y = y;
  S.T.s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
  applyTransform();
  updatePreviewCanvas();
}

export function pan(dx, dy) {
  setTransform(S.T.x + dx, S.T.y + dy, S.T.s);
}

export function zoomAt(cx, cy, factor) {
  const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, S.T.s * factor));
  const nx = cx - (cx - S.T.x) * (ns / S.T.s);
  const ny = cy - (cy - S.T.y) * (ns / S.T.s);
  setTransform(nx, ny, ns);
}

export function resetZoom() {
  // fit-to-view: fit the board content to viewport
  if (!S.viewport) return;
  const vr = S.viewport.getBoundingClientRect();
  setTransform(vr.width / 2, 40, 1);
}

// Stub for canvas update (실제 드로잉은 doc-drawing.js에서)
function updatePreviewCanvas() {
  // intentionally light-weight: just clear for now
  if (!S.previewCanvas) return;
}
