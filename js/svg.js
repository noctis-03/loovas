// ═══════════════════════════════════════════════════
//  svg.js — SVG 유틸리티, 패스 빌더, 스무딩
// ═══════════════════════════════════════════════════

import { tool, color, sw, penCfg } from './state.js';

export function mkSvg(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

export function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

export function pts2path(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], c = pts[i];
    d += ` Q${p.x},${p.y} ${(p.x + c.x) / 2},${(p.y + c.y) / 2}`;
  }
  return d;
}

export function smoothPts(pts, level) {
  if (level === 0 || pts.length < 3) return pts;
  const out = [pts[0]];
  const k = Math.min(level, Math.floor(pts.length / 2));
  for (let i = 1; i < pts.length - 1; i++) {
    let sx = 0, sy = 0, cnt = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(pts.length - 1, i + k); j++) {
      sx += pts[j].x; sy += pts[j].y; cnt++;
    }
    out.push({ x: sx / cnt, y: sy / cnt });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function taperMul(t, mode) {
  const min = 0.18, edge = 0.22;
  if (mode === 'start') return t < edge ? min + (1 - min) * (t / edge) : 1;
  if (mode === 'end')   return t > 1 - edge ? min + (1 - min) * ((1 - t) / edge) : 1;
  if (mode === 'both') {
    if (t < edge) return min + (1 - min) * (t / edge);
    if (t > 1 - edge) return min + (1 - min) * ((1 - t) / edge);
    return 1;
  }
  return 1;
}

export function buildTaperOutlinePath(pts, width, mode) {
  if (pts.length < 2) return '';
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    const hw = Math.max(0.8, (width * taperMul(i / (pts.length - 1), mode)) / 2);
    left.push({ x: pts[i].x + nx * hw, y: pts[i].y + ny * hw });
    right.push({ x: pts[i].x - nx * hw, y: pts[i].y - ny * hw });
  }
  const ring = [...left, ...right.reverse()];
  let d = `M${ring[0].x},${ring[0].y}`;
  for (let i = 1; i < ring.length; i++) d += ` L${ring[i].x},${ring[i].y}`;
  d += ' Z';
  return d;
}

export function buildFreehandStrokeSpec() {
  const baseW = (tool === 'highlight') ? sw * 4 : sw;
  const col = (tool === 'highlight') ? color + '99' : color;
  const opacity = penCfg.opacity / 100;
  const cap = penCfg.cap || 'round';

  if (penCfg.pressure && penCfg.pressure !== 'none') {
    return (pts) => ({
      kind: 'taper-path',
      attrs: { d: buildTaperOutlinePath(pts, Math.max(1, baseW), penCfg.pressure), fill: col, 'fill-opacity': opacity, stroke: 'none' }
    });
  }
  return (pts) => ({
    kind: 'path',
    attrs: { d: pts2path(pts), stroke: col, 'stroke-opacity': opacity, 'stroke-width': baseW, fill: 'none', 'stroke-linecap': cap, 'stroke-linejoin': 'round' }
  });
}
