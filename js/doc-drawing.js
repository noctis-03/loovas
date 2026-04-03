// ═══════════════════════════════════════════════════
//  doc-drawing.js — 문서 캔버스 펜 드로잉
// ═══════════════════════════════════════════════════

import * as S from './doc-state.js';

let isDrawing = false;
let currentPath = [];
let currentSvgPath = null;
let currentStrokeData = null;

// SVG 네임스페이스
const SVG_NS = 'http://www.w3.org/2000/svg';

// ── 스트로크 시작 ──
export function startDraw(ex, ey) {
  if (!S.svgLayer) return;
  isDrawing = true;
  currentPath = [{ x: ex, y: ey }];

  currentSvgPath = document.createElementNS(SVG_NS, 'path');
  currentSvgPath.setAttribute('fill', 'none');
  currentSvgPath.setAttribute('stroke', S.color);
  currentSvgPath.setAttribute('stroke-width', S.strokeWidth);
  currentSvgPath.setAttribute('stroke-linecap', S.penCfg.cap || 'round');
  currentSvgPath.setAttribute('stroke-linejoin', 'round');
  currentSvgPath.setAttribute('opacity', S.penCfg.opacity / 100);
  S.svgLayer.appendChild(currentSvgPath);

  currentStrokeData = {
    id: 'ds_' + Date.now(),
    color: S.color,
    width: S.strokeWidth,
    cap: S.penCfg.cap,
    opacity: S.penCfg.opacity,
    points: currentPath
  };
}

// ── 스트로크 진행 ──
export function continueDraw(ex, ey) {
  if (!isDrawing || !currentSvgPath) return;
  currentPath.push({ x: ex, y: ey });
  currentSvgPath.setAttribute('d', buildPathD(currentPath));
}

// ── 스트로크 끝 ──
export function endDraw() {
  if (!isDrawing) return;
  isDrawing = false;

  if (currentPath.length < 2) {
    // 점 — 작은 원
    if (currentSvgPath) currentSvgPath.remove();
    currentSvgPath = null;
    return;
  }

  // 스트로크 저장
  if (currentStrokeData) {
    S.addStroke(currentStrokeData);
  }

  currentSvgPath = null;
  currentStrokeData = null;
  currentPath = [];
}

export function cancelDraw() {
  if (!isDrawing) return;
  isDrawing = false;
  if (currentSvgPath) {
    currentSvgPath.remove();
    currentSvgPath = null;
  }
  currentPath = [];
  currentStrokeData = null;
}

export function isCurrentlyDrawing() { return isDrawing; }

// ── SVG path 문자열 생성 ──
function buildPathD(pts) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L${pts[i].x},${pts[i].y}`;
  }
  return d;
}

// ── 전체 스트로크 재렌더링 ──
export function redrawAllStrokes() {
  if (!S.svgLayer) return;
  // 기존 드로잉 패스 제거
  const oldPaths = S.svgLayer.querySelectorAll('path[id^="ds_"]');
  oldPaths.forEach(p => p.remove());

  S.getStrokes().forEach(stroke => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('id', stroke.id || '');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', stroke.color);
    path.setAttribute('stroke-width', stroke.width);
    path.setAttribute('stroke-linecap', stroke.cap || 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('opacity', (stroke.opacity || 100) / 100);
    path.setAttribute('d', buildPathD(stroke.points));
    S.svgLayer.appendChild(path);
  });
}

// ── 지우개 ──
export function eraseAt(ex, ey, radius = 20) {
  const strokes = S.getStrokes();
  const toRemove = [];

  strokes.forEach(stroke => {
    for (const pt of stroke.points) {
      const dx = pt.x - ex, dy = pt.y - ey;
      if (Math.sqrt(dx*dx + dy*dy) < radius) {
        toRemove.push(stroke.id);
        break;
      }
    }
  });

  if (toRemove.length === 0) return false;

  const remaining = strokes.filter(s => !toRemove.includes(s.id));
  S.setStrokes(remaining);
  redrawAllStrokes();
  return true;
}

// ── 하이라이트 (반투명 굵은 펜) ──
export function startHighlight(ex, ey) {
  if (!S.svgLayer) return;
  isDrawing = true;
  currentPath = [{ x: ex, y: ey }];

  currentSvgPath = document.createElementNS(SVG_NS, 'path');
  currentSvgPath.setAttribute('fill', 'none');
  currentSvgPath.setAttribute('stroke', S.color);
  currentSvgPath.setAttribute('stroke-width', Math.max(S.strokeWidth * 3, 12));
  currentSvgPath.setAttribute('stroke-linecap', 'square');
  currentSvgPath.setAttribute('stroke-linejoin', 'round');
  currentSvgPath.setAttribute('opacity', '0.35');
  S.svgLayer.appendChild(currentSvgPath);

  currentStrokeData = {
    id: 'ds_' + Date.now(),
    type: 'highlight',
    color: S.color,
    width: Math.max(S.strokeWidth * 3, 12),
    cap: 'square',
    opacity: 35,
    points: currentPath
  };
}
