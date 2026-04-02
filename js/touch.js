// ═══════════════════════════════════════════════════
//  touch.js — 터치 이벤트 (1-finger, 핀치줌)
//
//  ★ MODIFIED: startDraw에 화면 좌표 전달 (오버레이 레이어 판단용)
//  ★ MODIFIED: updateTouchPosition 연결 (Orb 팬 포인터 회피)
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { applyT, getVpRect, s2b } from './transform.js';
import { closeCtx, startLongPress, cancelLongPress } from './contextMenu.js';
import { deselectAll, showSelRect, highlightLasso, finalizeLasso, hideSelRect, clearLassoHover, doResize } from './selection.js';
import { startDraw, continueDraw, commitFreehandStroke, previewShape, finalizeShape, eraseAt, commitErase } from './drawing.js';
import { addText } from './text.js';
import { updateMinimap } from './layout.js';
import { focusEditableTouch } from './edit.js';
import { pushState } from './history.js';
import {
  isOrbLocked, isToolActivated, tryActivateByTap, deactivateByTap,
  scheduleRevertAfterUse, ensureRevertIfNeeded, resetOrbTimer,
  updateTouchPosition   // ★ 추가
} from './toolOrb.js';


const TAP_MOVE_THRESH = 12;
const TAP_TIME_THRESH = 250;

let tapStartX = 0;
let tapStartY = 0;
let tapStartTime = 0;
let tapPending = false;
let activatedThisTouch = false;

function cancelSingleFingerActions() {
  if (S.drawing) {
    S.setDrawing(false);
    if (S.livePth && S.livePth.parentNode) S.livePth.parentNode.removeChild(S.livePth);
    S.setLivePth(null); S.setDrawPts([]); S.setShapeA(null);
    S.pCtx.clearRect(0, 0, S.pCvs.width, S.pCvs.height);
    S.setDrawingOnOverlay(false);
  }
  if (S.touchLasso) { S.setTouchLasso(null); hideSelRect(); clearLassoHover(); }
  if (S.touchPanOrigin) { S.setTouchPanOrigin(null); document.body.classList.remove('panning'); }
  if (S.dragging) S.setDragging(null);
  if (S.resizing) S.setResizing(null);
  cancelLongPress();
}

export function initTouchEvents() {
  S.vp.addEventListener('touchstart', e => {
    if (isOrbLocked()) { e.preventDefault(); return; }
    cancelLongPress();
    activatedThisTouch = false;

    if (e.touches.length === 2) {
      cancelSingleFingerActions();
      const t0 = e.touches[0], t1 = e.touches[1];
      S.setPinchDist(Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY));
      S.setPinchMid({ x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 });
      S.setPinchActive(true);
      e.preventDefault();
      return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    closeCtx();

    if (S.pendingTool && !isToolActivated()) {
      tapStartX = t.clientX;
      tapStartY = t.clientY;
      tapStartTime = Date.now();
      tapPending = true;

      const r = getVpRect();
      S.setTouchPanOrigin({ x: t.clientX - r.left - S.T.x, y: t.clientY - r.top - S.T.y });
      document.body.classList.add('panning');
      e.preventDefault();
      return;
    }

    if (S.pendingTool && isToolActivated()) {
      // ★ 그리기 시작 시 첫 좌표 전달
      updateTouchPosition(t.clientX, t.clientY);

      if (S.tool === 'pen' || S.tool === 'highlight') { resetOrbTimer(); startDraw(s2b(t.clientX, t.clientY), t.clientX, t.clientY); e.preventDefault(); return; }
      if (S.tool === 'eraser') { resetOrbTimer(); S.setDrawing(true); eraseAt(s2b(t.clientX, t.clientY)); e.preventDefault(); return; }
      if (S.tool === 'rect' || S.tool === 'circle' || S.tool === 'arrow') { resetOrbTimer(); S.setDrawing(true); S.setShapeA(s2b(t.clientX, t.clientY)); e.preventDefault(); return; }
      if (S.tool === 'text') { resetOrbTimer(); addText(s2b(t.clientX, t.clientY)); pushState(); e.preventDefault(); return; }

      if (S.tool === 'select') {
        if (!e.target.closest('.el')) {
          deselectAll();
          S.setTouchLasso({ x0: t.clientX, y0: t.clientY, x1: t.clientX, y1: t.clientY });
          startLongPress(e.target, t.clientX, t.clientY);
          showSelRect(S.touchLasso);
          e.preventDefault();
        }
        return;
      }
      if (S.tool === 'edit') {
        const elDiv = e.target.closest('.el');
        if (elDiv) focusEditableTouch(elDiv, t);
        else { const active = document.activeElement; if (active && active !== document.body) active.blur(); }
        return;
      }
      e.preventDefault();
      return;
    }

    if (S.tool === 'pan') {
      const r = getVpRect();
      S.setTouchPanOrigin({ x: t.clientX - r.left - S.T.x, y: t.clientY - r.top - S.T.y });
      document.body.classList.add('panning');
      e.preventDefault(); return;
    }

    if (S.tool === 'edit') {
      const r = getVpRect();
      S.setTouchPanOrigin({ x: t.clientX - r.left - S.T.x, y: t.clientY - r.top - S.T.y });
      document.body.classList.add('panning');
      tapStartX = t.clientX;
      tapStartY = t.clientY;
      tapStartTime = Date.now();
      tapPending = true;
      e.preventDefault(); return;
    }

    const bp = s2b(t.clientX, t.clientY);
    if (S.tool === 'pen' || S.tool === 'highlight') { startDraw(bp, t.clientX, t.clientY); e.preventDefault(); return; }
    if (S.tool === 'eraser') { S.setDrawing(true); eraseAt(bp); e.preventDefault(); return; }
    if (S.tool === 'rect' || S.tool === 'circle' || S.tool === 'arrow') { S.setDrawing(true); S.setShapeA(bp); e.preventDefault(); return; }
    if (S.tool === 'text') { addText(bp); pushState(); e.preventDefault(); return; }

    if (S.tool === 'select') {
      if (!e.target.closest('.el')) {
        deselectAll();
        S.setTouchLasso({ x0: t.clientX, y0: t.clientY, x1: t.clientX, y1: t.clientY });
        startLongPress(e.target, t.clientX, t.clientY);
        showSelRect(S.touchLasso);
        e.preventDefault();
      }
    }
  }, { passive: false });

  window.addEventListener('touchmove', e => {
    if (isOrbLocked()) { e.preventDefault(); return; }

    if (e.touches.length === 2 && S.pinchActive) {
      e.preventDefault();
      tapPending = false;
      const t0 = e.touches[0], t1 = e.touches[1];
      const newDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const newMid = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
      if (S.pinchMid) { S.T.x += newMid.x - S.pinchMid.x; S.T.y += newMid.y - S.pinchMid.y; }
      if (S.pinchDist && S.pinchDist > 0) {
        const ratio = newDist / S.pinchDist;
        const ns = Math.min(8, Math.max(0.08, S.T.s * ratio));
        const r = getVpRect();
        const mx = newMid.x - r.left, my = newMid.y - r.top;
        S.T.x = mx - (mx - S.T.x) * (ns / S.T.s);
        S.T.y = my - (my - S.T.y) * (ns / S.T.s);
        S.T.s = ns;
      }
      S.setPinchDist(newDist); S.setPinchMid(newMid);
      applyT(); return;
    }

    if (e.touches.length !== 1) return;
    cancelLongPress();
    const t = e.touches[0];

    if (tapPending) {
      const dx = t.clientX - tapStartX;
      const dy = t.clientY - tapStartY;
      if (Math.sqrt(dx * dx + dy * dy) > TAP_MOVE_THRESH) {
        tapPending = false;
      }
    }

    if (S.tool === 'edit' && !S.touchPanOrigin) return;

    if (S.touchPanOrigin) {
      const r = getVpRect();
      S.T.x = t.clientX - r.left - S.touchPanOrigin.x;
      S.T.y = t.clientY - r.top - S.touchPanOrigin.y;
      applyT(); e.preventDefault(); return;
    }
    if (S.dragging) {
      const bp = s2b(t.clientX, t.clientY);
      if (S.dragging.els) { S.dragging.els.forEach(d => { d.el.style.left = (bp.x - d.ox) + 'px'; d.el.style.top = (bp.y - d.oy) + 'px'; }); }
      else { S.dragging.el.style.left = (bp.x - S.dragging.ox) + 'px'; S.dragging.el.style.top = (bp.y - S.dragging.oy) + 'px'; }
      updateMinimap(); e.preventDefault(); return;
    }
    if (S.resizing) { doResize(t.clientX, t.clientY); updateMinimap(); e.preventDefault(); return; }
    if (S.touchLasso) {
      S.touchLasso.x1 = t.clientX; S.touchLasso.y1 = t.clientY;
      showSelRect(S.touchLasso); highlightLasso(S.touchLasso); e.preventDefault(); return;
    }
    if (!S.drawing) return;
    e.preventDefault();

    // ★ 그리기 중 매 이동마다 Orb에 좌표 전달
    if (isToolActivated()) {
      updateTouchPosition(t.clientX, t.clientY);
    }

    const bp = s2b(t.clientX, t.clientY);
    if (S.tool === 'pen' || S.tool === 'highlight') continueDraw(bp);
    if (S.tool === 'eraser') eraseAt(bp);
    if ((S.tool === 'rect' || S.tool === 'circle' || S.tool === 'arrow') && S.shapeA) previewShape(S.shapeA, bp);
  }, { passive: false });

  window.addEventListener('touchend', e => {
    if (isOrbLocked()) return;
    cancelLongPress();
    document.body.classList.remove('panning');

    if (e.touches.length === 0 && S.pinchActive) {
      S.setPinchActive(false); S.setPinchDist(null); S.setPinchMid(null);
    }

    if (tapPending) {
      tapPending = false;
      const elapsed = Date.now() - tapStartTime;
      S.setTouchPanOrigin(null);

      if (elapsed < TAP_TIME_THRESH) {
        if (S.tool === 'edit' && !S.pendingTool) {
          const lastT = e.changedTouches[0];
          if (lastT) {
            const elDiv = document.elementFromPoint(lastT.clientX, lastT.clientY);
            const elContainer = elDiv ? elDiv.closest('.el') : null;
            if (elContainer) focusEditableTouch(elContainer, lastT);
            else { const active = document.activeElement; if (active && active !== document.body) active.blur(); }
          }
          return;
        }

        const lastT = e.changedTouches[0];
        const tapX = lastT ? lastT.clientX : tapStartX;
        const tapY = lastT ? lastT.clientY : tapStartY;

        const activated = tryActivateByTap(tapX, tapY);
        if (activated) {
          activatedThisTouch = true;
          if (S.tool === 'text' || S.pendingTool === 'text') {
            if (lastT) {
              addText(s2b(lastT.clientX, lastT.clientY));
              pushState();
              scheduleRevertAfterUse();
            }
          }
          return;
        }
      }
      return;
    }

    if (S.touchPanOrigin) { S.setTouchPanOrigin(null); return; }
    if (S.dragging) { S.setDragging(null); updateMinimap(); pushState(); return; }
    if (S.resizing) { S.setResizing(null); updateMinimap(); pushState(); return; }
    if (S.touchLasso) { finalizeLasso(S.touchLasso); S.setTouchLasso(null); hideSelRect(); clearLassoHover(); return; }
    if (!S.drawing) return;
    S.setDrawing(false);
    S.pCtx.clearRect(0, 0, S.pCvs.width, S.pCvs.height);
    const lastT = e.changedTouches[0];

    if (S.tool === 'pen' || S.tool === 'highlight') {
      commitFreehandStroke();
      scheduleRevertAfterUse();
    }
    if (S.tool === 'eraser') {
      commitErase();
      scheduleRevertAfterUse();
    }
    if ((S.tool === 'rect' || S.tool === 'circle' || S.tool === 'arrow') && S.shapeA) {
      if (lastT) {
        const bp = s2b(lastT.clientX, lastT.clientY);
        if (Math.abs(bp.x - S.shapeA.x) > 4 || Math.abs(bp.y - S.shapeA.y) > 4) {
          finalizeShape(S.shapeA, bp);
          scheduleRevertAfterUse();
        } else {
          ensureRevertIfNeeded();
        }
      } else {
        ensureRevertIfNeeded();
      }
      S.setShapeA(null);
    }
  });
}
