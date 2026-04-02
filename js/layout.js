// ═══════════════════════════════════════════════════
//  layout.js — 레이아웃 동기화 & 미니맵
//
//  FIX: getStrokes() getter 사용으로 바인딩 이슈 해결
//  FIX: transform.js 순환 참조 해결 — registerUpdateMinimap 사용
// ═══════════════════════════════════════════════════

import { vp, pCvs, board, svgl, T } from './state.js';
import * as S from './state.js';
import { isMobile } from './utils.js';
import { updateGrid, registerUpdateMinimap } from './transform.js';

export function syncLayout() {
  const tb = document.getElementById('toolbar');
  const mm = document.getElementById('minimap');
  const tbRect = tb.getBoundingClientRect();

  document.documentElement.style.setProperty('--tb-w', '0px');
  document.documentElement.style.setProperty('--tb-h', '0px');

  vp.style.cssText = `top:0;left:0;right:0;bottom:0;`;
  pCvs.style.cssText = `top:0;left:0;right:0;bottom:0;width:${window.innerWidth}px;height:${window.innerHeight}px;`;
  pCvs.width = window.innerWidth;
  pCvs.height = window.innerHeight;

  if (mm) {
    mm.style.bottom = isMobile() ? `${Math.ceil(tbRect.height) + 20}px` : '16px';
    mm.style.right = '16px';
  }

  updateGrid();
  updateMinimap();
}

export function updateMinimap() {
  const mm = document.getElementById('minimap');
  if (!mm || isMobile()) return;
  if (!board) return; // ★ FIX: DOM 미초기화 방어
  const ctx = mm.getContext('2d');
  const W = mm.width, H = mm.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = '#f5f2eb';
  ctx.fillRect(0, 0, W, H);

  // ★ FIX: getter 함수로 항상 최신 strokes 참조
  const strokes = S.getStrokes();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const elRects = [];
  const strokeRects = [];

  board.querySelectorAll('.el').forEach(el => {
    const x = parseFloat(el.style.left) || 0;
    const y = parseFloat(el.style.top) || 0;
    const w = parseFloat(el.style.width) || 100;
    const h = parseFloat(el.style.height) || 60;
    elRects.push({ x, y, w, h });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  if (strokes && strokes.length > 0) {
    strokes.forEach(s => {
      try {
        if (s.svgEl && typeof s.svgEl.getBBox === 'function') {
          const bb = s.svgEl.getBBox();
          if (bb.width > 0 || bb.height > 0) {
            strokeRects.push({ x: bb.x, y: bb.y, w: bb.width, h: bb.height });
            minX = Math.min(minX, bb.x);
            minY = Math.min(minY, bb.y);
            maxX = Math.max(maxX, bb.x + bb.width);
            maxY = Math.max(maxY, bb.y + bb.height);
          }
        }
      } catch (e) { /* 무시 */ }
    });
  }

  if (!vp) return; // ★ FIX: DOM 미초기화 방어
  const vpR = vp.getBoundingClientRect();
  const vpTL = { x: (0 - T.x) / T.s, y: (0 - T.y) / T.s };
  const vpBR = { x: (vpR.width - T.x) / T.s, y: (vpR.height - T.y) / T.s };
  minX = Math.min(minX, vpTL.x);
  minY = Math.min(minY, vpTL.y);
  maxX = Math.max(maxX, vpBR.x);
  maxY = Math.max(maxY, vpBR.y);

  if (minX === Infinity) {
    minX = vpTL.x; minY = vpTL.y;
    maxX = vpBR.x; maxY = vpBR.y;
  }

  const pad = 150;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const bw = maxX - minX || 1, bh = maxY - minY || 1;
  const sc = Math.min(W / bw, H / bh);
  const offX = (W - bw * sc) / 2;
  const offY = (H - bh * sc) / 2;

  ctx.save();
  ctx.translate(offX, offY);
  ctx.scale(sc, sc);
  ctx.translate(-minX, -minY);

  elRects.forEach(r => {
    ctx.fillStyle = 'rgba(26,23,20,0.18)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = 'rgba(26,23,20,0.25)';
    ctx.lineWidth = 1 / sc;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  });

  strokeRects.forEach(r => {
    ctx.fillStyle = 'rgba(200,75,47,0.12)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  });

  ctx.strokeStyle = '#c84b2f';
  ctx.lineWidth = Math.max(2 / sc, 1);
  ctx.setLineDash([6 / sc, 4 / sc]);
  ctx.strokeRect(vpTL.x, vpTL.y, vpBR.x - vpTL.x, vpBR.y - vpTL.y);
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(200,75,47,0.06)';
  ctx.fillRect(vpTL.x, vpTL.y, vpBR.x - vpTL.x, vpBR.y - vpTL.y);

  ctx.restore();

  ctx.strokeStyle = 'rgba(26,23,20,0.1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, W, H);
}

export function initLayout() {
  // ★ FIX: transform.js에 updateMinimap 콜백 등록 (순환 참조 해결)
  registerUpdateMinimap(updateMinimap);

  window.addEventListener('resize', () => syncLayout());
  window.addEventListener('orientationchange', () => setTimeout(syncLayout, 250));
  syncLayout();
}
