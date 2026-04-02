// ═══════════════════════════════════════════════════
//  toolOrb.js — 터치 전용 Orb v5.0
//  ★ 새 디자인 시스템에 완전 맞춤
//    - 다크 글래스모피즘 Orb
//    - SVG 아이콘 라벨 (이모지 제거)
//    - 사이드바 버튼 하이라이트 (orb-sidebar-highlight)
//    - 방향 힌트 링 + 뱃지 텍스트
//    - 스폰/디스미스 애니메이션
//    - 색상·굵기 모드별 Orb 컬러 변화
// ═══════════════════════════════════════════════════

import { tool, pendingTool } from './state.js';
import { bridgeSetTool, bridgeActivatePending, bridgeRevertToPan } from './toolBridge.js';

// ── 설정 ──
const NO_ORB_TOOLS      = new Set(['text', 'edit', 'pan', 'select']);
const ORB_SIZE           = 52;
const SPAWN_OFFSET_X     = -44;
const SPAWN_OFFSET_Y     = -54;
const DRAG_THRESH        = 30;
const DIR_LOCK_DIST      = 12;
const LONGPRESS_MS       = 380;
const TAP_TIME_THRESH    = 270;
const COLOR_DRAG_THRESH  = 56;
const STROKE_DRAG_THRESH = 56;

// Orb ↔ 터치 포인트 원형 경계
const ORB_MIN_DIST     = 78;
const ORB_MAX_DIST     = 176;
const ORB_FOLLOW_SPEED = 0.12;
const ORB_PUSH_SPEED   = 0.4;

// 순간이동 오프셋
const TELEPORT_OFFSET_X = -44;
const TELEPORT_OFFSET_Y = -54;

// 더블탭
const DOUBLE_TAP_INTERVAL = 340;
let lastTapTime       = 0;
let toolBeforeEraser  = null;

// 터치 추적
let lastTouchX  = -9999;
let lastTouchY  = -9999;
let orbFollowRAF = null;

// ── FSM 상태 ──
const State = Object.freeze({
  HIDDEN:     'hidden',
  SHOWN:      'shown',
  HOLD:       'hold',
  RELOCATING: 'relocating',
  TOOL_DRAG:  'toolDrag',
});

let fsm = State.HIDDEN;
let ctx = {};

// ── 도구 순서 캐시 ──
let toolOrderCache = null;

/**
 * 사이드바에서 도구 버튼 순서 추출
 * #left-sidebar 기준으로 data-tool / data-tool-or-panel 버튼 수집
 */
function getToolOrder() {
  if (toolOrderCache) return toolOrderCache;
  const btns = document.querySelectorAll(
    '#left-sidebar [data-tool], #left-sidebar [data-tool-or-panel]'
  );
  const order = [];
  btns.forEach(btn => {
    const t = btn.dataset.tool || btn.dataset.toolOrPanel;
    if (t && !order.includes(t) && !NO_ORB_TOOLS.has(t)) order.push(t);
  });
  toolOrderCache = order;
  return order;
}

export function invalidateToolOrderCache() {
  toolOrderCache = null;
}

// ── DOM ──
let orb      = null;
let orbLabel = null;
let orbBadge = null;
let hintRing = null;

// ── Orb 위치 ──
let orbX = -300;
let orbY = -300;

// ── 타이머 ──
let longPressTimer = null;

// ── 외부 상태 ──
let _orbLock      = false;
let _toolActivated = false;

function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function isOrbVisible() {
  return fsm === State.SHOWN || fsm === State.HOLD ||
    fsm === State.RELOCATING || fsm === State.TOOL_DRAG;
}

// ═══════════════════════════════════════════════════
//  편집 모드 화면 테두리
// ═══════════════════════════════════════════════════

let badgeTimer = null;

function showEditModeBorder() {
  const border = document.getElementById('edit-mode-border');
  const badge  = document.getElementById('edit-mode-badge');
  if (border) border.classList.add('active');
  if (badge) {
    badge.classList.add('active');
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
      badge.classList.remove('active');
      badgeTimer = null;
    }, 2800);
  }
}

function hideEditModeBorder() {
  const border = document.getElementById('edit-mode-border');
  const badge  = document.getElementById('edit-mode-badge');
  if (border) border.classList.remove('active');
  if (badge)  badge.classList.remove('active');
  if (badgeTimer) { clearTimeout(badgeTimer); badgeTimer = null; }
}

// ═══════════════════════════════════════════════════
//  Orb 위치 추적 (터치 회피)
// ═══════════════════════════════════════════════════

export function updateTouchPosition(sx, sy) {
  lastTouchX = sx;
  lastTouchY = sy;
  if (!_toolActivated || !isOrbVisible()) return;
  if (fsm === State.HOLD || fsm === State.RELOCATING || fsm === State.TOOL_DRAG) return;
  startOrbFollow();
}

function startOrbFollow() {
  if (orbFollowRAF) return;
  orbFollowRAF = requestAnimationFrame(orbFollowLoop);
}

function stopOrbFollow() {
  if (orbFollowRAF) {
    cancelAnimationFrame(orbFollowRAF);
    orbFollowRAF = null;
  }
}

function orbFollowLoop() {
  orbFollowRAF = null;
  if (!_toolActivated || !isOrbVisible()) return;
  if (fsm === State.HOLD || fsm === State.RELOCATING || fsm === State.TOOL_DRAG) return;
  if (lastTouchX < -9000) return;

  const half = ORB_SIZE / 2;

  // 오른쪽에 있으면 즉시 왼쪽-위로 순간이동
  if (orbX > lastTouchX) {
    orbX = Math.max(half, Math.min(lastTouchX + TELEPORT_OFFSET_X, window.innerWidth  - half));
    orbY = Math.max(half, Math.min(lastTouchY + TELEPORT_OFFSET_Y, window.innerHeight - half));
    applyPosition();
    return;
  }

  const dx   = orbX - lastTouchX;
  const dy   = orbY - lastTouchY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  let needsMove = false;

  if (dist < ORB_MIN_DIST && dist > 0.1) {
    const angle = Math.atan2(dy, dx);
    const targetX = lastTouchX + Math.cos(angle) * ORB_MIN_DIST;
    const targetY = lastTouchY + Math.sin(angle) * ORB_MIN_DIST;
    orbX += (targetX - orbX) * ORB_PUSH_SPEED;
    orbY += (targetY - orbY) * ORB_PUSH_SPEED;
    needsMove = true;
  } else if (dist > ORB_MAX_DIST) {
    const angle = Math.atan2(dy, dx);
    const targetX = lastTouchX + Math.cos(angle) * ORB_MAX_DIST;
    const targetY = lastTouchY + Math.sin(angle) * ORB_MAX_DIST;
    orbX += (targetX - orbX) * ORB_FOLLOW_SPEED;
    orbY += (targetY - orbY) * ORB_FOLLOW_SPEED;
    needsMove = true;
  }

  if (needsMove) {
    orbX = Math.max(half, Math.min(orbX, window.innerWidth  - half));
    orbY = Math.max(half, Math.min(orbY, window.innerHeight - half));
    applyPosition();

    const dx2 = (orbX - lastTouchX);
    const dy2 = (orbY - lastTouchY);
    if (Math.abs(dx2) > 0.5 || Math.abs(dy2) > 0.5) {
      orbFollowRAF = requestAnimationFrame(orbFollowLoop);
    }
  }
}

// ═══════════════════════════════════════════════════
//  외부 API
// ═══════════════════════════════════════════════════

export function isOrbLocked()    { return _orbLock; }
export { _orbLock as orbLock };

export function isToolActivated() { return _toolActivated; }
export { _toolActivated as toolActivated };

export function notifyToolChanged(t) {
  updateLabel(t);
  if (NO_ORB_TOOLS.has(t)) {
    _toolActivated = false;
    if (orb) orb.classList.remove('orb-tool-active');
    hideEditModeBorder();
    stopOrbFollow();
    transition(State.HIDDEN);
    return;
  }
  if (isOrbVisible()) {
    if (orb) orb.classList.toggle('orb-tool-active', _toolActivated);
    return;
  }
  _toolActivated = false;
  if (orb) orb.classList.remove('orb-tool-active');
}

export function tryActivateByTap(tx, ty) {
  if (!pendingTool) return false;
  if (_toolActivated) return true;

  bridgeActivatePending();
  _toolActivated = true;
  showEditModeBorder();

  if (isOrbVisible()) {
    if (orb) orb.classList.add('orb-tool-active');
    updateLabel(pendingTool);
  } else {
    spawnOrbAt(tx + SPAWN_OFFSET_X, ty + SPAWN_OFFSET_Y);
  }
  return true;
}

export function deactivateByTap() {
  if (!_toolActivated) return;
  bridgeRevertToPan();
  _toolActivated = false;
  hideEditModeBorder();
  stopOrbFollow();
  transition(State.HIDDEN);
}

export function scheduleRevertAfterUse() { return; }
export function ensureRevertIfNeeded()   { return; }
export function resetOrbTimer()          { return; }
export function restartOrbTimer(delay)   { return; }

// ═══════════════════════════════════════════════════
//  초기화
// ═══════════════════════════════════════════════════

export function initToolOrb() {
  if (!isTouchDevice()) return;

  // ── Orb 본체 ──
  orb = document.createElement('div');
  orb.id = 'tool-orb';
  orb.style.width  = ORB_SIZE + 'px';
  orb.style.height = ORB_SIZE + 'px';
  orb.setAttribute('role', 'status');
  orb.setAttribute('aria-label', '도구 Orb');

  // 라벨 (SVG 래퍼)
  orbLabel = document.createElement('div');
  orbLabel.id = 'tool-orb-label';
  orb.appendChild(orbLabel);

  // 뱃지 (모드 텍스트)
  orbBadge = document.createElement('div');
  orbBadge.id = 'tool-orb-badge';
  orb.appendChild(orbBadge);

  document.body.appendChild(orb);

  // ── 방향 힌트 링 ──
  hintRing = document.createElement('div');
  hintRing.id = 'orb-direction-hint';
  document.body.appendChild(hintRing);

  orb.addEventListener('pointerdown', onOrbPointerDown);
  window.addEventListener('pointermove', onGlobalMove,   true);
  window.addEventListener('pointerup',   onGlobalUp,     true);
  window.addEventListener('pointercancel', onGlobalUp,   true);

  updateLabel(tool);
}

// ═══════════════════════════════════════════════════
//  Orb 생성
// ═══════════════════════════════════════════════════

function spawnOrbAt(x, y) {
  const half = ORB_SIZE / 2;
  orbX = Math.max(half, Math.min(x, window.innerWidth  - half));
  orbY = Math.max(half, Math.min(y, window.innerHeight - half));
  applyPosition(true); // true = 스폰 애니메이션
  transition(State.SHOWN);
}

// ═══════════════════════════════════════════════════
//  FSM
// ═══════════════════════════════════════════════════

function transition(newState, data) {
  exitState(fsm);
  fsm = newState;
  ctx = data || {};
  enterState(fsm);
}

function exitState(s) {
  switch (s) {
    case State.HOLD:
      cancelLongPress();
      break;
    case State.TOOL_DRAG:
      _orbLock = false;
      if (orb) {
        orb.classList.remove('orb-active');
        orb.classList.remove('orb-color-mode');
        orb.classList.remove('orb-stroke-mode');
        orb.style.removeProperty('--orb-color-accent');
      }
      clearPreviewHighlight();
      clearColorHighlight();
      clearStrokeHighlight();
      highlightColorBar(false);
      setBadge('');
      hideHintRing();
      break;
  }
}

function enterState(s) {
  switch (s) {
    case State.HIDDEN:
      hideOrbNow();
      stopOrbFollow();
      if (_toolActivated) {
        bridgeRevertToPan();
        _toolActivated = false;
        hideEditModeBorder();
      }
      break;

    case State.SHOWN:
      showOrb();
      break;

    case State.HOLD:
      break;

    case State.RELOCATING:
      break;

    case State.TOOL_DRAG: {
      _orbLock = true;
      if (orb) orb.classList.add('orb-active');

      const baseTool = pendingTool || tool;
      const order    = getToolOrder();

      ctx.baseIdx            = order.indexOf(baseTool);
      if (ctx.baseIdx === -1) ctx.baseIdx = 0;
      ctx.steps              = 0;
      ctx.previewTool        = baseTool;
      ctx.colorMode          = false;
      ctx.colorBaseResolved  = false;
      ctx.colorSteps         = 0;
      ctx.previewColorIdx    = -1;
      ctx.strokeMode         = false;
      ctx.strokeBaseResolved = false;
      ctx.strokeSteps        = 0;
      ctx.previewStrokeIdx   = -1;

      updateLabel(baseTool);
      setBadge('← 도구 →');
      previewToolHighlight(baseTool);
      showHintRing(COLOR_DRAG_THRESH);
      break;
    }
  }
}

// ═══════════════════════════════════════════════════
//  Orb 포인터 이벤트
// ═══════════════════════════════════════════════════

function onOrbPointerDown(e) {
  if (fsm === State.HIDDEN) return;
  e.stopPropagation();
  e.preventDefault();
  if (fsm === State.TOOL_DRAG) return;

  try { orb.setPointerCapture(e.pointerId); } catch (_) {}

  transition(State.HOLD, {
    startX:    e.clientX,
    startY:    e.clientY,
    orbStartX: orbX,
    orbStartY: orbY,
    pointerId: e.pointerId,
    downTime:  Date.now(),
    dirLocked: false,
  });

  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    if (fsm === State.HOLD && !ctx.dirLocked) {
      transition(State.TOOL_DRAG, { startX: ctx.startX, startY: ctx.startY });
    }
  }, LONGPRESS_MS);
}

// ═══════════════════════════════════════════════════
//  전역 포인터 이벤트
// ═══════════════════════════════════════════════════

function onGlobalMove(e) {
  if (!orb) return;

  switch (fsm) {
    case State.TOOL_DRAG: {
      e.stopPropagation();
      e.preventDefault();
      handleToolDragMove(e);
      break;
    }
    case State.HOLD: {
      e.stopPropagation();
      e.preventDefault();
      const dx   = e.clientX - ctx.startX;
      const dy   = e.clientY - ctx.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!ctx.dirLocked && dist > DIR_LOCK_DIST) {
        ctx.dirLocked = true;
        cancelLongPress();
        if (Math.abs(dx) > Math.abs(dy)) {
          // 수평 → 도구 선택 드래그
          transition(State.TOOL_DRAG, { startX: ctx.startX, startY: ctx.startY });
        } else {
          // 수직 → Orb 재배치
          transition(State.RELOCATING, {
            startX:    ctx.startX,
            startY:    ctx.startY,
            orbStartX: ctx.orbStartX,
            orbStartY: ctx.orbStartY,
            pointerId: ctx.pointerId,
          });
        }
      }
      break;
    }
    case State.RELOCATING: {
      e.stopPropagation();
      e.preventDefault();
      const dx = e.clientX - ctx.startX;
      const dy = e.clientY - ctx.startY;
      orbX = ctx.orbStartX + dx;
      orbY = ctx.orbStartY + dy;
      const half = ORB_SIZE / 2;
      orbX = Math.max(half, Math.min(orbX, window.innerWidth  - half));
      orbY = Math.max(half, Math.min(orbY, window.innerHeight - half));
      applyPosition();
      break;
    }
  }
}

function onGlobalUp(e) {
  if (!orb) return;
  cancelLongPress();

  switch (fsm) {
    case State.TOOL_DRAG: {
      e.stopPropagation();
      e.preventDefault();
      finishToolDrag();
      break;
    }
    case State.HOLD: {
      try { orb.releasePointerCapture(ctx.pointerId); } catch (_) {}
      const elapsed = Date.now() - (ctx.downTime || 0);
      if (elapsed < TAP_TIME_THRESH) {
        handleOrbSingleTap();
      } else {
        transition(_toolActivated ? State.SHOWN : State.HIDDEN);
      }
      break;
    }
    case State.RELOCATING: {
      try { orb.releasePointerCapture(ctx.pointerId || e.pointerId); } catch (_) {}
      transition(_toolActivated ? State.SHOWN : State.HIDDEN);
      break;
    }
  }
}

// ═══════════════════════════════════════════════════
//  탭 처리
// ═══════════════════════════════════════════════════

function handleOrbSingleTap() {
  const now         = Date.now();
  const isDoubleTap = (now - lastTapTime) < DOUBLE_TAP_INTERVAL;
  lastTapTime = now;

  if (isDoubleTap) { handleOrbDoubleTap(); return; }
  if (!pendingTool) { transition(State.HIDDEN); return; }

  if (_toolActivated) {
    bridgeRevertToPan();
    _toolActivated = false;
    if (orb) orb.classList.remove('orb-tool-active');
    hideEditModeBorder();
    stopOrbFollow();
    updateLabel(pendingTool);
    transition(State.HIDDEN);
  } else {
    bridgeActivatePending();
    _toolActivated = true;
    if (orb) orb.classList.add('orb-tool-active');
    showEditModeBorder();
    updateLabel(pendingTool);
    transition(State.SHOWN);
  }
}

function handleOrbDoubleTap() {
  const currentPending = pendingTool;
  if (currentPending === 'eraser') {
    if (toolBeforeEraser) {
      bridgeSetTool(toolBeforeEraser);
      updateLabel(toolBeforeEraser);
      toolBeforeEraser = null;
    }
  } else {
    toolBeforeEraser = currentPending || tool;
    bridgeSetTool('eraser');
    updateLabel('eraser');
  }
  if (!_toolActivated) {
    bridgeActivatePending();
    _toolActivated = true;
    showEditModeBorder();
  }
  if (orb) orb.classList.toggle('orb-tool-active', _toolActivated);
  transition(State.SHOWN);
}

// ═══════════════════════════════════════════════════
//  도구 순환 드래그 + 색상/굵기 모드
// ═══════════════════════════════════════════════════

function handleToolDragMove(e) {
  const totalDx = e.clientX - ctx.startX;
  const totalDy = e.clientY - ctx.startY;

  // ── 굵기 모드 진입: 위로 올림 ──
  if (!ctx.colorMode && !ctx.strokeMode && totalDy < -STROKE_DRAG_THRESH) {
    ctx.strokeMode         = true;
    ctx.strokeStartX       = e.clientX;
    ctx.strokeSteps        = 0;
    ctx.previewStrokeIdx   = -1;
    ctx.strokeBaseResolved = false;
    clearPreviewHighlight();
    if (orb) {
      orb.classList.remove('orb-color-mode');
      orb.classList.add('orb-stroke-mode');
    }
    updateLabel('stroke');
    setBadge('← 굵기 →');
    highlightColorBar(true);
    hideHintRing();
    return;
  }

  // ── 굵기 모드 중 ──
  if (ctx.strokeMode) {
    if (totalDy > -STROKE_DRAG_THRESH + 22) {
      ctx.strokeMode         = false;
      ctx.strokeBaseResolved = false;
      if (orb) orb.classList.remove('orb-stroke-mode');
      clearStrokeHighlight();
      updateLabel(ctx.previewTool || pendingTool || tool);
      setBadge('← 도구 →');
      if (ctx.previewTool) previewToolHighlight(ctx.previewTool);
      showHintRing(COLOR_DRAG_THRESH);
      return;
    }
    const strokeSteps = Math.trunc((e.clientX - ctx.strokeStartX) / DRAG_THRESH);
    if (strokeSteps !== ctx.strokeSteps) {
      ctx.strokeSteps = strokeSteps;
      selectStrokeByStep(strokeSteps);
    }
    return;
  }

  // ── 색상 모드 진입: 아래로 내림 ──
  if (!ctx.colorMode && totalDy > COLOR_DRAG_THRESH) {
    ctx.colorMode         = true;
    ctx.colorStartX       = e.clientX;
    ctx.colorSteps        = 0;
    ctx.previewColorIdx   = -1;
    ctx.colorBaseResolved = false;
    clearPreviewHighlight();
    if (orb) {
      orb.classList.remove('orb-stroke-mode');
      orb.classList.add('orb-color-mode');
    }
    updateLabel('color');
    setBadge('← 색상 →');
    highlightColorBar(true);
    hideHintRing();
    return;
  }

  // ── 색상 모드 중 ──
  if (ctx.colorMode) {
    if (totalDy < COLOR_DRAG_THRESH - 22) {
      ctx.colorMode         = false;
      ctx.colorBaseResolved = false;
      if (orb) orb.classList.remove('orb-color-mode');
      highlightColorBar(false);
      clearColorHighlight();
      updateLabel(ctx.previewTool || pendingTool || tool);
      setBadge('← 도구 →');
      if (ctx.previewTool) previewToolHighlight(ctx.previewTool);
      showHintRing(COLOR_DRAG_THRESH);
      return;
    }
    const colorSteps = Math.trunc((e.clientX - ctx.colorStartX) / DRAG_THRESH);
    if (colorSteps !== ctx.colorSteps) {
      ctx.colorSteps = colorSteps;
      selectColorByStep(colorSteps);
    }
    return;
  }

  // ── 도구 순환 (수평) ──
  const newSteps = Math.trunc(totalDx / DRAG_THRESH);
  if (newSteps !== ctx.steps) {
    ctx.steps = newSteps;
    const order = getToolOrder();
    const idx   = Math.max(0, Math.min(ctx.baseIdx + newSteps, order.length - 1));
    const newTool = order[idx];

    if (newTool !== ctx.previewTool) {
      ctx.previewTool = newTool;
      previewToolHighlight(newTool);
      updateLabel(newTool);
      if (navigator.vibrate) navigator.vibrate(6);
    }
  }
}

function finishToolDrag() {
  const wasColorMode  = ctx.colorMode;
  const wasStrokeMode = ctx.strokeMode;
  const selectedTool  = ctx.previewTool;

  if (wasColorMode || wasStrokeMode) {
    updateLabel(pendingTool || tool);
    transition(State.SHOWN);
    return;
  }

  const isDrawing = selectedTool && !NO_ORB_TOOLS.has(selectedTool);
  if (selectedTool) bridgeSetTool(selectedTool);

  if (isDrawing) {
    bridgeActivatePending();
    _toolActivated = true;
    showEditModeBorder();
    if (orb) orb.classList.add('orb-tool-active');
    updateLabel(selectedTool);
    transition(State.SHOWN);
  } else {
    _toolActivated = false;
    hideEditModeBorder();
    stopOrbFollow();
    if (orb) orb.classList.remove('orb-tool-active');
    transition(State.HIDDEN);
  }
}

// ═══════════════════════════════════════════════════
//  굵기 선택 헬퍼
// ═══════════════════════════════════════════════════

let strokeBtns    = null;
let strokeBaseIdx = 0;

function getStrokeBtns() {
  if (!strokeBtns) strokeBtns = [...document.querySelectorAll('#color-tray .sw-btn, #color-tray .sbtn')];
  return strokeBtns;
}

function selectStrokeByStep(step) {
  const btns = getStrokeBtns();
  if (btns.length === 0) return;

  if (!ctx.strokeBaseResolved) {
    ctx.strokeBaseResolved = true;
    const active = btns.findIndex(b => b.classList.contains('active'));
    strokeBaseIdx = active >= 0 ? active : 0;
  }

  const idx = Math.max(0, Math.min(strokeBaseIdx + step, btns.length - 1));
  clearStrokeHighlight();
  btns[idx].classList.add('sbtn-orb-highlight');

  if (ctx.previewStrokeIdx !== idx) {
    ctx.previewStrokeIdx = idx;
    btns[idx].click();
    if (navigator.vibrate) navigator.vibrate(6);
    const sw = btns[idx].dataset.sw;
    if (orbLabel) renderLabelContent(sw ? `${sw}px` : 'stroke');
  }
}

function clearStrokeHighlight() {
  getStrokeBtns().forEach(b => b.classList.remove('sbtn-orb-highlight'));
}

// ═══════════════════════════════════════════════════
//  색상 선택 헬퍼
// ═══════════════════════════════════════════════════

let colorDots    = null;
let colorBaseIdx = 0;

function getColorDots() {
  if (!colorDots) colorDots = [...document.querySelectorAll('#color-tray .cdot')];
  return colorDots;
}

function selectColorByStep(step) {
  const dots = getColorDots();
  if (dots.length === 0) return;

  if (!ctx.colorBaseResolved) {
    ctx.colorBaseResolved = true;
    const active = dots.findIndex(d => d.classList.contains('active'));
    colorBaseIdx = active >= 0 ? active : 0;
  }

  const idx = Math.max(0, Math.min(colorBaseIdx + step, dots.length - 1));
  clearColorHighlight();
  dots[idx].classList.add('cdot-orb-highlight');

  if (ctx.previewColorIdx !== idx) {
    ctx.previewColorIdx = idx;
    dots[idx].click();
    if (navigator.vibrate) navigator.vibrate(6);

    // Orb 배경에 선택된 색 반영
    const c = dots[idx].dataset.c;
    if (orb && c) {
      orb.style.setProperty('background', hexToOrbBg(c));
    }
    // 라벨에 색 원
    if (orbLabel) {
      orbLabel.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="${c}"/><circle cx="7" cy="7" r="6" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1"/></svg>`;
    }
  }
}

function clearColorHighlight() {
  getColorDots().forEach(d => d.classList.remove('cdot-orb-highlight'));
  // 색 모드 해제 시 배경 원복
  if (orb) orb.style.removeProperty('background');
}

/** hex 색상 → Orb 배경 rgba 문자열 */
function hexToOrbBg(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},0.88)`;
}

function highlightColorBar(show) {
  const cb = document.getElementById('color-tray');
  if (!cb) return;
  if (show) cb.classList.add('ct-visible', 'cb-orb-highlight');
  else      cb.classList.remove('cb-orb-highlight');
}

// ═══════════════════════════════════════════════════
//  사이드바 버튼 하이라이트 (프리뷰 고스트 대체)
// ═══════════════════════════════════════════════════

let orbGhost         = null;
let prevHighlightBtn = null;

function ensureGhost() {
  if (!orbGhost) {
    orbGhost = document.createElement('div');
    orbGhost.id = 'orb-preview-ghost';
    document.body.appendChild(orbGhost);
  }
  return orbGhost;
}

function previewToolHighlight(t) {
  clearPreviewHighlight();

  // 사이드바 버튼 찾기 (data-tool 또는 data-tool-or-panel)
  const btn = document.querySelector(
    `#left-sidebar [data-tool="${t}"], #left-sidebar [data-tool-or-panel="${t}"]`
  );
  if (!btn) return;

  // 사이드바 버튼에 하이라이트 클래스
  btn.classList.add('orb-sidebar-highlight');
  prevHighlightBtn = btn;

  // 고스트 팝업: 버튼 오른쪽에 SVG 아이콘 + 도구명
  requestAnimationFrame(() => {
    const r = btn.getBoundingClientRect();
    const ghost = ensureGhost();

    // 고스트 크기
    const ghostW = 80;
    const ghostH = 48;

    ghost.style.left   = (r.right + 10) + 'px';
    ghost.style.top    = (r.top + r.height / 2) + 'px';
    ghost.style.width  = ghostW + 'px';
    ghost.style.height = ghostH + 'px';

    // 고스트 내용: 아이콘 + 도구명
    const info = TOOL_INFO[t];
    if (info) {
      ghost.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
          <div style="width:18px;height:18px;color:rgba(255,255,255,0.9)">${info.svg}</div>
          <span style="font-family:var(--font-ui);font-size:9px;font-weight:600;
            letter-spacing:0.06em;text-transform:uppercase;
            color:rgba(255,255,255,0.6)">${info.name}</span>
        </div>`;
    }
    ghost.className = 'orb-preview-ghost-active';
  });
}

function clearPreviewHighlight() {
  if (prevHighlightBtn) {
    prevHighlightBtn.classList.remove('orb-sidebar-highlight');
    prevHighlightBtn = null;
  }
  if (orbGhost) {
    orbGhost.className = '';
    orbGhost.innerHTML = '';
  }
}

// ═══════════════════════════════════════════════════
//  표시 / 숨김
// ═══════════════════════════════════════════════════

function showOrb() {
  if (!orb) return;
  orb.classList.add('orb-visible');
  if (_toolActivated) orb.classList.add('orb-tool-active');
  applyPosition();
}

function hideOrbNow() {
  if (!orb) return;
  orb.classList.remove('orb-visible');
  orb.classList.remove('orb-tool-active');
  orb.classList.remove('orb-color-mode');
  orb.classList.remove('orb-stroke-mode');
  orb.style.removeProperty('background');
  clearPreviewHighlight();
  clearColorHighlight();
  clearStrokeHighlight();
  highlightColorBar(false);
  setBadge('');
  hideHintRing();
  stopOrbFollow();
}

function cancelLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}

// ═══════════════════════════════════════════════════
//  라벨 (SVG 아이콘)
// ═══════════════════════════════════════════════════

/**
 * 각 도구의 SVG 아이콘 + 이름 정보
 * (index.html의 사이드바와 동일한 SVG 사용)
 */
const TOOL_INFO = {
  select: {
    name: '선택',
    svg: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path d="M3 2L13 8L8.5 9.5L6.5 14L3 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`
  },
  edit: {
    name: '편집',
    svg: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path d="M10 3L13 6L6 13H3V10L10 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M8.5 4.5L11.5 7.5" stroke="currentColor" stroke-width="1.5"/>
    </svg>`
  },
  pan: {
    name: '이동',
    svg: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path d="M8 2V14M2 8H14M5 5L2 8L5 11M11 5L14 8L11 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  },
  pen: {
    name: '펜',
    svg: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path d="M11 3L13 5L5 13L2 14L3 11L11 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M9.5 4.5L11.5 6.5" stroke="currentColor" stroke-width="1.5"/>
    </svg>`
  },
  highlight: {
    name: '형광펜',
    svg: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="5" width="10" height="6" rx="2" stroke="currentColor" stroke-width="1.5"/>
      <path d="M7 11V14M9 11V14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`
  },
  eraser: {
    name: '지우개',
    svg: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path d="M3 13H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M9 4L12 7L7 12H4L3 11L8 4H9Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`
  },
  text: {
    name: '텍스트',
    svg: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path d="M3 4H13M8 4V13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`
  },
  rect: {
    name: '사각형',
    svg: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <rect x="2.5" y="4.5" width="11" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
    </svg>`
  },
  circle: {
    name: '원',
    svg: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/>
    </svg>`
  },
  arrow: {
    name: '화살표',
    svg: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path d="M3 8H13M9 4L13 8L9 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  },
  stroke: {
    name: '굵기',
    svg: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path d="M2 4H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M2 8H14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
      <path d="M2 12H14" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
    </svg>`
  },
  color: {
    name: '색상',
    svg: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/>
      <path d="M8 2.5C9.5 4 11 6 11 8C11 10 9.5 12 8 13.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
    </svg>`
  },
};

/** 라벨 내용 업데이트 (SVG 아이콘 또는 텍스트) */
function renderLabelContent(key) {
  if (!orbLabel) return;
  const info = TOOL_INFO[key];
  if (info) {
    orbLabel.innerHTML = info.svg;
  } else {
    // 폴백: 텍스트
    orbLabel.innerHTML = `<span style="font-family:var(--font-mono);font-size:11px;font-weight:600;color:rgba(255,255,255,0.9)">${key}</span>`;
  }
}

function updateLabel(t) {
  renderLabelContent(t);
  if (orb) orb.setAttribute('aria-label', `현재 도구: ${TOOL_INFO[t]?.name || t}`);
}

// ═══════════════════════════════════════════════════
//  뱃지 텍스트
// ═══════════════════════════════════════════════════

function setBadge(text) {
  if (!orbBadge) return;
  orbBadge.textContent = text;
}

// ═══════════════════════════════════════════════════
//  방향 힌트 링
// ═══════════════════════════════════════════════════

function showHintRing(radius) {
  if (!hintRing) return;
  const size = radius * 2;
  hintRing.style.width  = size + 'px';
  hintRing.style.height = size + 'px';
  hintRing.style.left   = orbX + 'px';
  hintRing.style.top    = orbY + 'px';
  hintRing.classList.add('hint-visible');
}

function hideHintRing() {
  if (!hintRing) return;
  hintRing.classList.remove('hint-visible');
}

// ═══════════════════════════════════════════════════
//  위치
// ═══════════════════════════════════════════════════

function applyPosition(spawn = false) {
  if (!orb) return;
  const half = ORB_SIZE / 2;
  orb.style.transform = `translate(${orbX - half}px, ${orbY - half}px)`;

  if (spawn) {
    orb.classList.remove('orb-spawning');
    void orb.offsetWidth; // reflow
    orb.classList.add('orb-spawning');
    const remove = () => orb.classList.remove('orb-spawning');
    orb.addEventListener('animationend', remove, { once: true });
  }

  // 힌트 링도 같이 이동
  if (hintRing && hintRing.classList.contains('hint-visible')) {
    hintRing.style.left = orbX + 'px';
    hintRing.style.top  = orbY + 'px';
  }
}
