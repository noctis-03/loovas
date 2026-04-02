// ═══════════════════════════════════════════════════
//  drawing.js — 펜/형광펜/도형 그리기 & 지우개
//
//  ★ MODIFIED: 포스트잇/카드 위에서 그릴 때 오버레이 레이어 사용
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { s2b, b2s } from './transform.js';
import { mkSvg, setAttrs, pts2path, smoothPts, buildTaperOutlinePath } from './svg.js';
import { updateMinimap } from './layout.js';
import { pushState } from './history.js';

// ★ NEW: 현재 그리기 대상 레이어 결정
function getDrawLayer() {
  return S.drawingOnOverlay ? S.svgOverlay : S.svgl;
}

// ★ NEW: 터치/마우스 좌표에 포스트잇/카드가 있는지 확인
export function checkOverElement(screenX, screenY) {
  const el = document.elementFromPoint(screenX, screenY);
  if (el) {
    const elContainer = el.closest('.el');
    if (elContainer) {
      S.setDrawingOnOverlay(true);
      return;
    }
  }
  S.setDrawingOnOverlay(false);
}

export function startDraw(bp, screenX, screenY) {
  // ★ MODIFIED: 오버레이 확인
  if (screenX !== undefined && screenY !== undefined) {
    checkOverElement(screenX, screenY);
  } else {
    S.setDrawingOnOverlay(false);
  }

  S.setDrawing(true);
  S.setDrawPts([bp]);
  const livePth = mkSvg('path');
  livePth.setAttribute('fill', 'none');
  const col = S.tool === 'highlight' ? S.color + '99' : S.color;
  livePth.setAttribute('stroke', col);
  livePth.setAttribute('stroke-opacity', S.penCfg.opacity / 100);
  livePth.setAttribute('stroke-width', S.tool === 'highlight' ? S.sw * 4 : S.sw);
  livePth.setAttribute('stroke-linecap', S.penCfg.cap || 'round');
  livePth.setAttribute('stroke-linejoin', 'round');

  const layer = getDrawLayer(); // ★ MODIFIED
  layer.appendChild(livePth);
  S.setLivePth(livePth);
}

export function continueDraw(bp) {
  S.pushDrawPt(bp);
  if (S.livePth) S.livePth.setAttribute('d', pts2path(S.drawPts));
}

export function commitFreehandStroke() {
  const pts = S.drawPts;
  const layer = getDrawLayer(); // ★ MODIFIED

  if (pts.length <= 1) {
    if (S.livePth && S.livePth.parentNode) S.livePth.parentNode.removeChild(S.livePth);
    S.setLivePth(null);
    S.setDrawPts([]);
    S.setDrawingOnOverlay(false);
    return;
  }

  const smoothed = smoothPts(pts, S.penCfg.smooth);
  const baseW = (S.tool === 'highlight') ? S.sw * 4 : S.sw;
  const col = (S.tool === 'highlight') ? S.color + '99' : S.color;
  const opacity = S.penCfg.opacity / 100;
  const cap = S.penCfg.cap || 'round';

  let finalEl = S.livePth;
  let spec;

  if (S.penCfg.pressure && S.penCfg.pressure !== 'none') {
    spec = {
      kind: 'taper-path',
      attrs: { d: buildTaperOutlinePath(smoothed, Math.max(1, baseW), S.penCfg.pressure), fill: col, 'fill-opacity': opacity, stroke: 'none' }
    };
    if (finalEl && finalEl.parentNode) finalEl.parentNode.removeChild(finalEl);
    finalEl = mkSvg('path');
    setAttrs(finalEl, spec.attrs);
    layer.appendChild(finalEl);
  } else {
    spec = {
      kind: 'path',
      attrs: { d: pts2path(smoothed), stroke: col, 'stroke-opacity': opacity, 'stroke-width': baseW, fill: 'none', 'stroke-linecap': cap, 'stroke-linejoin': 'round' }
    };
    if (finalEl) setAttrs(finalEl, spec.attrs);
  }

  S.pushStroke({ kind: spec.kind, attrs: spec.attrs, svgEl: finalEl, overlay: S.drawingOnOverlay }); // ★ overlay 플래그 저장
  S.setLivePth(null);
  S.setDrawPts([]);
  S.setDrawingOnOverlay(false);
  pushState();
}

// ── 도형 프리뷰 ──
export function previewShape(a, b) {
  S.pCtx.clearRect(0, 0, S.pCvs.width, S.pCvs.height);
  const cr = S.pCvs.getBoundingClientRect();
  const sa = b2s(a.x, a.y), sb = b2s(b.x, b.y);
  const ssa = { x: sa.x - cr.left, y: sa.y - cr.top };
  const ssb = { x: sb.x - cr.left, y: sb.y - cr.top };

  S.pCtx.save();
  S.pCtx.strokeStyle = S.color;
  S.pCtx.lineWidth = S.sw * S.T.s;
  S.pCtx.lineCap = 'round';
  S.pCtx.lineJoin = 'round';

  if (S.tool === 'rect') S.pCtx.strokeRect(ssa.x, ssa.y, ssb.x - ssa.x, ssb.y - ssa.y);
  if (S.tool === 'circle') {
    const rx = (ssb.x - ssa.x) / 2, ry = (ssb.y - ssa.y) / 2;
    S.pCtx.beginPath();
    S.pCtx.ellipse(ssa.x + rx, ssa.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    S.pCtx.stroke();
  }
  if (S.tool === 'arrow') {
    S.pCtx.beginPath(); S.pCtx.moveTo(ssa.x, ssa.y); S.pCtx.lineTo(ssb.x, ssb.y); S.pCtx.stroke();
    const ang = Math.atan2(ssb.y - ssa.y, ssb.x - ssa.x), hl = (12 + S.sw * 2) * S.T.s;
    S.pCtx.beginPath();
    S.pCtx.moveTo(ssb.x, ssb.y); S.pCtx.lineTo(ssb.x - hl * Math.cos(ang - .45), ssb.y - hl * Math.sin(ang - .45));
    S.pCtx.moveTo(ssb.x, ssb.y); S.pCtx.lineTo(ssb.x - hl * Math.cos(ang + .45), ssb.y - hl * Math.sin(ang + .45));
    S.pCtx.stroke();
  }
  S.pCtx.restore();
}

export function finalizeShape(a, b) {
  if (S.tool === 'rect') {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    const el = mkSvg('rect');
    const attrs = { x, y, width: w, height: h, fill: 'none', stroke: S.color, 'stroke-width': S.sw, 'stroke-linecap': 'round' };
    setAttrs(el, attrs); S.svgl.appendChild(el); S.pushStroke({ kind: 'rect', attrs, svgEl: el });
  }
  if (S.tool === 'circle') {
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
    const el = mkSvg('ellipse');
    const attrs = { cx, cy, rx, ry, fill: 'none', stroke: S.color, 'stroke-width': S.sw };
    setAttrs(el, attrs); S.svgl.appendChild(el); S.pushStroke({ kind: 'ellipse', attrs, svgEl: el });
  }
  if (S.tool === 'arrow') {
    const g = mkSvg('g'), line = mkSvg('line');
    setAttrs(line, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: S.color, 'stroke-width': S.sw, 'stroke-linecap': 'round' });
    const ang = Math.atan2(b.y - a.y, b.x - a.x), hl = 12 + S.sw * 2;
    const d = `M${b.x},${b.y} L${b.x - hl * Math.cos(ang - .45)},${b.y - hl * Math.sin(ang - .45)} M${b.x},${b.y} L${b.x - hl * Math.cos(ang + .45)},${b.y - hl * Math.sin(ang + .45)}`;
    const path = mkSvg('path');
    setAttrs(path, { d, stroke: S.color, 'stroke-width': S.sw, 'stroke-linecap': 'round', fill: 'none' });
    g.appendChild(line); g.appendChild(path); S.svgl.appendChild(g);
    S.pushStroke({ kind: 'arrow', svgEl: g, attrs: { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: S.color, 'stroke-width': S.sw, hl, d } });
  }
  updateMinimap();
  pushState();
}

// ── 지우개 ──
let eraseOccurred = false;

export function eraseAt(bp) {
  const r = 18 / S.T.s;
  // 기본 레이어와 오버레이 레이어 모두 검사
  for (let i = S.strokes.length - 1; i >= 0; i--) {
    try {
      const bb = S.strokes[i].svgEl.getBBox();
      if (bp.x >= bb.x - r && bp.x <= bb.x + bb.width + r && bp.y >= bb.y - r && bp.y <= bb.y + bb.height + r) {
        S.strokes[i].svgEl.parentNode.removeChild(S.strokes[i].svgEl); // ★ MODIFIED: parentNode 사용
        S.removeStroke(i);
        eraseOccurred = true;
      }
    } catch (e) { /* ignore */ }
  }
}

/** 지우개 동작이 끝났을 때 호출 */
export function commitErase() {
  if (eraseOccurred) {
    pushState();
    eraseOccurred = false;
  }
}
