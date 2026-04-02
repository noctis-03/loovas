// ═══════════════════════════════════════════════════
//  mouse.js — 마우스 이벤트 핸들링
//
//  ★ MODIFIED: startDraw에 화면 좌표 전달 (오버레이 레이어 판단용)
//  ★ MODIFIED: updateTouchPosition 연결 (Orb 팬 포인터 회피)
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { applyT, getVpRect, s2b } from './transform.js';
import { closeCtx } from './contextMenu.js';
import { deselectAll, showSelRect, highlightLasso, finalizeLasso, hideSelRect, clearLassoHover, doResize } from './selection.js';
import { startDraw, continueDraw, commitFreehandStroke, previewShape, finalizeShape, eraseAt, commitErase } from './drawing.js';
import { addText } from './text.js';
import { updateMinimap } from './layout.js';
import { focusEditable } from './edit.js';
import { pushState } from './history.js';
import {
  isOrbLocked,
  updateTouchPosition   // ★ 추가
} from './toolOrb.js';

let justFinishedLasso = false;

export function initMouseEvents() {
  S.vp.addEventListener('wheel', e => {
    e.preventDefault(); closeCtx();
    const f = e.deltaY < 0 ? 1.09 : 0.92;
    const ns = Math.min(8, Math.max(0.08, S.T.s * f));
    const r = getVpRect();
    const lx = e.clientX - r.left, ly = e.clientY - r.top;
    S.T.x = lx - (lx - S.T.x) * (ns / S.T.s);
    S.T.y = ly - (ly - S.T.y) * (ns / S.T.s);
    S.T.s = ns; applyT();
  }, { passive: false });

  S.vp.addEventListener('mousedown', e => {
    if (isOrbLocked()) return;
    if (e.button === 2) return;
    closeCtx();

    if (e.button === 1 || S.tool === 'pan') {
      S.setPanning(true);
      const r = getVpRect();
      S.setPanOrigin({ x: e.clientX - r.left - S.T.x, y: e.clientY - r.top - S.T.y });
      document.body.classList.add('panning');
      e.preventDefault(); return;
    }

    const bp = s2b(e.clientX, e.clientY);

    if (S.tool === 'pen' || S.tool === 'highlight') {
      // ★ 그리기 시작 시 첫 좌표 전달
      updateTouchPosition(e.clientX, e.clientY);
      startDraw(bp, e.clientX, e.clientY);
      return;
    }
    if (S.tool === 'eraser') { S.setDrawing(true); eraseAt(bp); return; }
    if (S.tool === 'rect' || S.tool === 'circle' || S.tool === 'arrow') { S.setDrawing(true); S.setShapeA(bp); return; }
    if (S.tool === 'text') { addText(bp); pushState(); return; }

    if (S.tool === 'edit') {
      const elDiv = e.target.closest('.el');
      if (elDiv) {
        focusEditable(elDiv, e);
      }
      if (!elDiv) {
        const active = document.activeElement;
        if (active && active !== document.body) active.blur();
      }
      return;
    }

    if (S.tool === 'select') {
      if (!e.target.closest('.el')) {
        clearLassoHover();
        deselectAll();
        S.setLasso({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
        showSelRect(S.lasso);
        e.preventDefault();
      }
    }
  });

  window.addEventListener('mousemove', e => {
    if (isOrbLocked()) return;
    justFinishedLasso = false;

    if (S.panning) {
      const r = getVpRect();
      S.T.x = e.clientX - r.left - S.panOrigin.x;
      S.T.y = e.clientY - r.top - S.panOrigin.y;
      applyT(); return;
    }
    if (S.dragging) {
      const bp = s2b(e.clientX, e.clientY);
      if (S.dragging.els) {
        S.dragging.els.forEach(d => { d.el.style.left = (bp.x - d.ox) + 'px'; d.el.style.top = (bp.y - d.oy) + 'px'; });
      } else {
        S.dragging.el.style.left = (bp.x - S.dragging.ox) + 'px';
        S.dragging.el.style.top = (bp.y - S.dragging.oy) + 'px';
      }
      updateMinimap(); return;
    }
    if (S.resizing) { doResize(e.clientX, e.clientY); return; }
    if (S.lasso) {
      S.lasso.x1 = e.clientX; S.lasso.y1 = e.clientY;
      showSelRect(S.lasso); highlightLasso(S.lasso); return;
    }
    if (!S.drawing) return;

    // ★ 그리기 중 매 이동마다 Orb에 좌표 전달
    updateTouchPosition(e.clientX, e.clientY);

    const bp = s2b(e.clientX, e.clientY);
    if (S.tool === 'pen' || S.tool === 'highlight') continueDraw(bp);
    if (S.tool === 'eraser') eraseAt(bp);
    if ((S.tool === 'rect' || S.tool === 'circle' || S.tool === 'arrow') && S.shapeA) previewShape(S.shapeA, bp);
  });

  window.addEventListener('mouseup', e => {
    if (isOrbLocked()) return;
    document.body.classList.remove('panning');
    if (S.panning) { S.setPanning(false); return; }
    if (S.dragging) { S.setDragging(null); updateMinimap(); pushState(); return; }
    if (S.resizing) { S.setResizing(null); updateMinimap(); pushState(); return; }
    if (S.lasso) {
      finalizeLasso(S.lasso);
      clearLassoHover();
      S.setLasso(null);
      hideSelRect();
      justFinishedLasso = true;
      return;
    }
    if (!S.drawing) return;
    S.setDrawing(false);
    S.pCtx.clearRect(0, 0, S.pCvs.width, S.pCvs.height);
    if (S.tool === 'pen' || S.tool === 'highlight') commitFreehandStroke();
    if (S.tool === 'eraser') commitErase();
    if ((S.tool === 'rect' || S.tool === 'circle' || S.tool === 'arrow') && S.shapeA) {
      const bp = s2b(e.clientX, e.clientY);
      if (Math.abs(bp.x - S.shapeA.x) > 4 || Math.abs(bp.y - S.shapeA.y) > 4) finalizeShape(S.shapeA, bp);
      S.setShapeA(null);
    }
  });
}
