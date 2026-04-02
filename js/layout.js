// ═══════════════════════════════════════════════════
//  layout.js — 레이아웃 동기화 & 미니맵
//  새 사이드바 레이아웃: 뷰포트가 사이드바 오른쪽에 위치
// ═══════════════════════════════════════════════════

import { vp, pCvs, board, svgl, T } from './state.js';
import * as S from './state.js';
import { isMobile } from './utils.js';
import { updateGrid, registerUpdateMinimap } from './transform.js';

// 사이드바 너비 가져오기
function getSidebarWidth() {
  const sidebar = document.getElementById('left-sidebar');
  if (sidebar) return sidebar.offsetWidth;
  return isMobile() ? 50 : 56;
}

export function syncLayout() {
  const sw = getSidebarWidth();

  // Preview canvas: 사이드바 오른쪽 영역
  const vpW = window.innerWidth - sw;
  const vpH = window.innerHeight;

  if (vp) {
    vp.style.cssText = `top:0; left:${sw}px; right:0; bottom:0;`;
  }

  if (pCvs) {
    pCvs.style.cssText = `
      position:fixed;
      top:0; left:${sw}px;
      width:${vpW}px; height:${vpH}px;
      pointer-events:none; z-index:500;
    `;
    pCvs.width  = vpW;
    pCvs.height = vpH;
  }

  updateGrid();
  updateMinimap();
}

export function updateMinimap() {
  const mm = document.getElementById('minimap');
  if (!mm || isMobile()) return;
  if (!board) return;

  const ctx = mm.getContext('2d');
  const W = mm.width, H = mm.height;
  ctx.clearRect(0, 0, W, H);

  // 배경
  ctx.fillStyle = '#f7f5f0';
  ctx.fillRect(0, 0, W, H);

  const strokes = S.getStrokes();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const elRects = [];
  const strokeRects = [];

  board.querySelectorAll('.el').forEach(el => {
    const x = parseFloat(el.style.left) || 0;
    const y = parseFloat(el.style.top)  || 0;
    const w = parseFloat(el.style.width)  || 100;
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

  if (!vp) return;
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

  // 요소 렌더링
  elRects.forEach(r => {
    ctx.fillStyle = 'rgba(26,23,20,0.15)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = 'rgba(26,23,20,0.2)';
    ctx.lineWidth = 1 / sc;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  });

  // 스트로크 렌더링
  strokeRects.forEach(r => {
    ctx.fillStyle = 'rgba(200,75,47,0.12)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  });

  // 뷰포트 표시
  ctx.strokeStyle = 'rgba(200,75,47,0.7)';
  ctx.lineWidth = Math.max(1.5 / sc, 0.5);
  ctx.setLineDash([5 / sc, 3 / sc]);
  ctx.strokeRect(vpTL.x, vpTL.y, vpBR.x - vpTL.x, vpBR.y - vpTL.y);
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(200,75,47,0.04)';
  ctx.fillRect(vpTL.x, vpTL.y, vpBR.x - vpTL.x, vpBR.y - vpTL.y);

  ctx.restore();

  // 미니맵 외곽선
  ctx.strokeStyle = 'rgba(26,23,20,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, W, H);
}

export function initLayout() {
  registerUpdateMinimap(updateMinimap);
  window.addEventListener('resize', () => syncLayout());
  window.addEventListener('orientationchange', () => setTimeout(syncLayout, 300));
  syncLayout();
}
