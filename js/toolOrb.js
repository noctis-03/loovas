// ═══════════════════════════════════════════════════
//  toolOrb.js — 고정 위치 도구 Orb (v4.0)
//
//  ★ MODIFIED:
//    - 자동 꺼짐 기능 제거
//    - 원형 메뉴 경계 시스템 추가
//    - 위로 드래그 → 펜 굵기 선택 추가
//    - 편집 모드 화면 테두리 강조 추가
//    - 더블탭 → 지우개 전환 추가
// ═══════════════════════════════════════════════════

import { tool, pendingTool } from './state.js';
import { bridgeSetTool, bridgeActivatePending, bridgeRevertToPan } from './toolBridge.js';

// ── 설정 ──
const NO_ORB_TOOLS      = new Set(['text', 'edit', 'pan', 'select']);
const ORB_SIZE           = 48;
const SPAWN_OFFSET_X     = -40;
const SPAWN_OFFSET_Y     = -50;
const DRAG_THRESH        = 28;
const DIR_LOCK_DIST      = 14;
const LONGPRESS_MS       = 400;
const TAP_TIME_THRESH    = 280;
const COLOR_DRAG_THRESH  = 60;
const STROKE_DRAG_THRESH = 60;  // ★ NEW: 굵기 모드 진입 임계값

// ★ NEW: 원형 경계 설정
const ORB_CIRCLE_MIN_R = 80;
const ORB_CIRCLE_MAX_R = 250;

// ★ NEW: 더블탭 설정
const DOUBLE_TAP_INTERVAL = 350;
let lastTapTime = 0;
let toolBeforeEraser = null;

// ── FSM ──
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

function getToolOrder() {
  if (toolOrderCache) return toolOrderCache;
  const btns = document.querySelectorAll(
    '#tb-tools .tbtn[data-tool], #tb-tools .tbtn[data-tool-or-panel]'
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
let orb = null;
let orbLabel = null;

// ── 고정 위치 ──
let orbX = -200;
let orbY = -200;

// ── 타이머 ──
let longPressTimer = null;

// ── 외부 상태 ──
let _orbLock = false;
let _toolActivated = false;

function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/** Orb가 현재 화면에 보이는 상태인지 */
function isOrbVisible() {
  return fsm === State.SHOWN || fsm === State.HOLD ||
    fsm === State.RELOCATING || fsm === State.TOOL_DRAG;
}

// ═══════════════════════════════════════════════════
//  ★ NEW: 편집 모드 화면 테두리 강조
// ═══════════════════════════════════════════════════

let badgeTimer = null;

function showEditModeBorder() {
  const border = document.getElementById('edit-mode-border');
  const badge = document.getElementById('edit-mode-badge');
  if (border) border.classList.add('active');
  if (badge) {
    badge.classList.add('active');
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
      badge.classList.remove('active');
      badgeTimer = null;
    }, 3000);
  }
}

function hideEditModeBorder() {
  const border = document.getElementById('edit-mode-border');
  const badge = document.getElementById('edit-mode-badge');
  if (border) border.classList.remove('active');
  if (badge) badge.classList.remove('active');
  if (badgeTimer) { clearTimeout(badgeTimer); badgeTimer = null; }
}

// ═══════════════════════════════════════════════════
//  ★ NEW: 원형 메뉴 경계 시스템
// ═══════════════════════════════════════════════════

function enforceCircleBoundary() {
  if (!isOrbVisible()) return;

  const targets = [
    document.getElementById('toolbar'),
    document.getElementById('mode-bar'),
    document.getElementById('ur-cluster'),
  ];

  targets.forEach(el => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const menuCx = rect.left + rect.width / 2;
    const menuCy = rect.top + rect.height / 2;

    const dx = menuCx - orbX;
    const dy = menuCy - orbY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < ORB_CIRCLE_MIN_R && dist > 0) {
      // 최소 거리 안에 있으면 → 원 밖으로 밀어냄
      const angle = Math.atan2(dy, dx);
      const pushX = orbX + Math.cos(angle) * ORB_CIRCLE_MIN_R;
      const pushY = orbY + Math.sin(angle) * ORB_CIRCLE_MIN_R;

      const offsetX = pushX - menuCx;
      const offsetY = pushY - menuCy;

      const curLeft = parseFloat(el.style.left) || 0;
      const curTop = parseFloat(el.style.top) || 0;

      let newLeft = Math.round(curLeft + offsetX);
      let newTop = Math.round(curTop + offsetY);

      // 화면 밖 방지
      newLeft = Math.max(4, Math.min(newLeft, window.innerWidth - rect.width - 4));
      newTop = Math.max(4, Math.min(newTop, window.innerHeight - rect.height - 4));

      el.style.transition = 'left 0.2s ease, top 0.2s ease';
      el.style.left = newLeft + 'px';
      el.style.top = newTop + 'px';
      setTimeout(() => { el.style.transition = ''; }, 220);
    } else if (dist > ORB_CIRCLE_MAX_R) {
      // 최대 거리 밖에 있으면 → 최대 거리까지 끌어당김
      const angle = Math.atan2(dy, dx);
      const pullX = orbX + Math.cos(angle) * ORB_CIRCLE_MAX_R;
      const pullY = orbY + Math.sin(angle) * ORB_CIRCLE_MAX_R;

      const offsetX = pullX - menuCx;
      const offsetY = pullY - menuCy;

      const curLeft = parseFloat(el.style.left) || 0;
      const curTop = parseFloat(el.style.top) || 0;

      let newLeft = Math.round(curLeft + offsetX);
      let newTop = Math.round(curTop + offsetY);

      newLeft = Math.max(4, Math.min(newLeft, window.innerWidth - rect.width - 4));
      newTop = Math.max(4, Math.min(newTop, window.innerHeight - rect.height - 4));

      el.style.transition = 'left 0.3s ease, top 0.3s ease';
      el.style.left = newLeft + 'px';
      el.style.top = newTop + 'px';
      setTimeout(() => { el.style.transition = ''; }, 320);
    }
  });
}


// ═══════════════════════════════════════════════════
//  외부 API
// ═══════════════════════════════════════════════════

export function isOrbLocked() { return _orbLock; }
export { _orbLock as orbLock };

export function isToolActivated() { return _toolActivated; }
export { _toolActivated as toolActivated };

/**
 * tools.js에서 도구 변경 시 호출 (bridgeNotifyToolChanged 경유)
 */
export function notifyToolChanged(t) {
  updateLabel(t);

  if (NO_ORB_TOOLS.has(t)) {
    _toolActivated = false;
    if (orb) orb.classList.remove('orb-tool-active');
    hideEditModeBorder(); // ★ NEW
    transition(State.HIDDEN);
    return;
  }

  if (isOrbVisible()) {
    if (orb) orb.classList.toggle('orb-tool-active', _toolActivated);
    // ★ MODIFIED: 자동 꺼짐 제거 — scheduleHide 호출하지 않음
    return;
  }

  _toolActivated = false;
  if (orb) orb.classList.remove('orb-tool-active');
}

/**
 * 터치 탭으로 도구 활성화 + Orb 생성
 */
export function tryActivateByTap(tx, ty) {
  if (!pendingTool) return false;
  if (_toolActivated) return true;

  bridgeActivatePending();
  _toolActivated = true;
  showEditModeBorder(); // ★ NEW

  if (isOrbVisible()) {
    if (orb) orb.classList.add('orb-tool-active');
    updateLabel(pendingTool);
    // ★ MODIFIED: 자동 꺼짐 제거
  } else {
    spawnOrbAt(tx + SPAWN_OFFSET_X, ty + SPAWN_OFFSET_Y);
  }

  return true;
}

/** Orb 탭으로 비활성화 */
export function deactivateByTap() {
  if (!_toolActivated) return;
  bridgeRevertToPan();
  _toolActivated = false;
  hideEditModeBorder(); // ★ NEW
  transition(State.HIDDEN);
}

/** 그리기 완료 후 — ★ MODIFIED: 자동 꺼짐 제거 (빈 함수) */
export function scheduleRevertAfterUse() {
  // 자동 꺼짐 비활성화 — 아무것도 하지 않음
  return;
}

/** 도형 무시 시 — ★ MODIFIED: 자동 꺼짐 제거 (빈 함수) */
export function ensureRevertIfNeeded() {
  // 자동 꺼짐 비활성화 — 아무것도 하지 않음
  return;
}

/**
 * 도구 사용 중 타이머 리셋 — ★ MODIFIED: 빈 함수
 */
export function resetOrbTimer() {
  // 자동 꺼짐 제거됨
  return;
}

/**
 * 도구 사용 완료 후 타이머 재시작 — ★ MODIFIED: 빈 함수
 */
export function restartOrbTimer(delay) {
  // 자동 꺼짐 제거됨
  return;
}

// ═══════════════════════════════════════════════════
//  초기화
// ═══════════════════════════════════════════════════

export function initToolOrb() {
  if (!isTouchDevice()) return;

  orb = document.createElement('div');
  orb.id = 'tool-orb';
  orb.style.width = ORB_SIZE + 'px';
  orb.style.height = ORB_SIZE + 'px';
  orb.setAttribute('role', 'status');
  orb.setAttribute('aria-label', '도구 선택 Orb');

  orbLabel = document.createElement('span');
  orbLabel.id = 'tool-orb-label';
  orb.appendChild(orbLabel);

  document.body.appendChild(orb);

  orb.addEventListener('pointerdown', onOrbPointerDown);
  window.addEventListener('pointermove', onGlobalMove, true);
  window.addEventListener('pointerup', onGlobalUp, true);
  window.addEventListener('pointercancel', onGlobalUp, true);

  updateLabel(tool);
}

// ═══════════════════════════════════════════════════
//  Orb 생성
// ═══════════════════════════════════════════════════

function spawnOrbAt(x, y) {
  const half = ORB_SIZE / 2;
  orbX = Math.max(half, Math.min(x, window.innerWidth - half));
  orbY = Math.max(half, Math.min(y, window.innerHeight - half));
  applyPosition();
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
        orb.classList.remove('orb-stroke-mode'); // ★ NEW
      }
      clearPreviewHighlight();
      clearColorHighlight();
      clearStrokeHighlight(); // ★ NEW
      highlightColorBar(false);
      const tb = document.getElementById('toolbar');
      if (tb) tb.classList.remove('tb-orb-zoom');
      break;
  }
}

function enterState(s) {
  switch (s) {
    case State.HIDDEN:
      hideOrbNow();
      if (_toolActivated) {
        bridgeRevertToPan();
        _toolActivated = false;
        hideEditModeBorder(); // ★ NEW
      }
      break;

    case State.SHOWN:
      showOrb();
      // ★ MODIFIED: 자동 꺼짐 제거 — scheduleHide 호출하지 않음
      break;

    case State.HOLD:
      // ★ MODIFIED: 자동 꺼짐 제거
      break;

    case State.RELOCATING:
      // ★ MODIFIED: 자동 꺼짐 제거
      break;

    case State.TOOL_DRAG: {
      _orbLock = true;
      if (orb) orb.classList.add('orb-active');

      const baseTool = pendingTool || tool;
      const order = getToolOrder();

      ctx.baseIdx = order.indexOf(baseTool);
      if (ctx.baseIdx === -1) ctx.baseIdx = 0;
      ctx.steps = 0;
      ctx.previewTool = baseTool;
      ctx.colorMode = false;
      ctx.colorBaseResolved = false;
      ctx.colorSteps = 0;
      ctx.previewColorIdx = -1;
      // ★ NEW: 굵기 모드 초기값
      ctx.strokeMode = false;
      ctx.strokeBaseResolved = false;
      ctx.strokeSteps = 0;
      ctx.previewStrokeIdx = -1;

      updateLabel(baseTool);
      const tbEl = document.getElementById('toolbar');
      if (tbEl) tbEl.classList.add('tb-orb-zoom');
      previewToolHighlight(baseTool);
      break;
    }
  }
}

// ═══════════════════════════════════════════════════
//  Orb 포인터
// ═══════════════════════════════════════════════════

function onOrbPointerDown(e) {
  if (fsm === State.HIDDEN) return;
  e.stopPropagation();
  e.preventDefault();

  if (fsm === State.TOOL_DRAG) return;

  try { orb.setPointerCapture(e.pointerId); } catch (_) {}

  transition(State.HOLD, {
    startX: e.clientX,
    startY: e.clientY,
    orbStartX: orbX,
    orbStartY: orbY,
    pointerId: e.pointerId,
    downTime: Date.now(),
    dirLocked: false,
  });

  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    if (fsm === State.HOLD && !ctx.dirLocked) {
      transition(State.TOOL_DRAG, {
        startX: ctx.startX,
        startY: ctx.startY,
      });
    }
  }, LONGPRESS_MS);
}

// ═══════════════════════════════════════════════════
//  전역 포인터
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
      const dx = e.clientX - ctx.startX;
      const dy = e.clientY - ctx.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!ctx.dirLocked && dist > DIR_LOCK_DIST) {
        ctx.dirLocked = true;
        cancelLongPress();

        if (Math.abs(dx) > Math.abs(dy)) {
          transition(State.TOOL_DRAG, {
            startX: ctx.startX,
            startY: ctx.startY,
          });
        } else {
          transition(State.RELOCATING, {
            startX: ctx.startX,
            startY: ctx.startY,
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
      orbX = Math.max(half, Math.min(orbX, window.innerWidth - half));
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
        if (_toolActivated) {
          transition(State.SHOWN);
        } else {
          transition(State.HIDDEN);
        }
      }
      break;
    }

    case State.RELOCATING: {
      try { orb.releasePointerCapture(ctx.pointerId || e.pointerId); } catch (_) {}
      if (_toolActivated) {
        transition(State.SHOWN);
      } else {
        transition(State.HIDDEN);
      }
      break;
    }
  }
}

// ═══════════════════════════════════════════════════
//  ★ MODIFIED: 싱글탭 + 더블탭 감지
// ═══════════════════════════════════════════════════

function handleOrbSingleTap() {
  const now = Date.now();
  const isDoubleTap = (now - lastTapTime) < DOUBLE_TAP_INTERVAL;
  lastTapTime = now;

  if (isDoubleTap) {
    handleOrbDoubleTap();
    return;
  }

  // ── 기존 싱글탭 로직 ──
  if (!pendingTool) {
    transition(State.HIDDEN);
    return;
  }

  if (_toolActivated) {
    bridgeRevertToPan();
    _toolActivated = false;
    if (orb) orb.classList.remove('orb-tool-active');
    hideEditModeBorder(); // ★ NEW
    updateLabel(pendingTool);
    transition(State.HIDDEN);
  } else {
    bridgeActivatePending();
    _toolActivated = true;
    if (orb) orb.classList.add('orb-tool-active');
    showEditModeBorder(); // ★ NEW
    updateLabel(pendingTool);
    transition(State.SHOWN);
  }
}

// ★ NEW: 더블탭 → 지우개 전환
function handleOrbDoubleTap() {
  const currentPending = pendingTool;

  if (currentPending === 'eraser') {
    // 이미 지우개 → 이전 도구로 복귀
    if (toolBeforeEraser) {
      bridgeSetTool(toolBeforeEraser);
      updateLabel(toolBeforeEraser);
      toolBeforeEraser = null;
    }
  } else {
    // 현재 도구 기억 후 지우개로 전환
    toolBeforeEraser = currentPending || tool;
    bridgeSetTool('eraser');
    updateLabel('eraser');
  }

  // 활성화 상태 유지
  if (!_toolActivated) {
    bridgeActivatePending();
    _toolActivated = true;
    showEditModeBorder();
  }

  if (orb) orb.classList.toggle('orb-tool-active', _toolActivated);
  transition(State.SHOWN);
}

// ═══════════════════════════════════════════════════
//  ★ MODIFIED: 도구 순환 드래그 + 색상 모드 + 굵기 모드
// ═══════════════════════════════════════════════════

function handleToolDragMove(e) {
  const totalDx = e.clientX - ctx.startX;
  const totalDy = e.clientY - ctx.startY;

  // ── ★ NEW: 굵기 모드 진입: 위로 충분히 올림 ──
  if (!ctx.colorMode && !ctx.strokeMode && totalDy < -STROKE_DRAG_THRESH) {
    ctx.strokeMode = true;
    ctx.strokeStartX = e.clientX;
    ctx.strokeSteps = 0;
    ctx.previewStrokeIdx = -1;
    ctx.strokeBaseResolved = false;

    clearPreviewHighlight();
    if (orb) orb.classList.add('orb-stroke-mode');
    updateLabel('📏');
    highlightColorBar(true);
    return;
  }

  // ── ★ NEW: 굵기 모드 중 ──
  if (ctx.strokeMode) {
    // 아래로 돌아오면 도구 모드 복귀
    if (totalDy > -STROKE_DRAG_THRESH + 20) {
      ctx.strokeMode = false;
      ctx.strokeBaseResolved = false;
      if (orb) orb.classList.remove('orb-stroke-mode');
      clearStrokeHighlight();
      updateLabel(ctx.previewTool || pendingTool || tool);
      if (ctx.previewTool) previewToolHighlight(ctx.previewTool);
      return;
    }

    // 좌우로 굵기 순환
    const strokeDx = e.clientX - ctx.strokeStartX;
    const strokeSteps = Math.trunc(strokeDx / DRAG_THRESH);

    if (strokeSteps !== ctx.strokeSteps) {
      ctx.strokeSteps = strokeSteps;
      selectStrokeByStep(strokeSteps);
    }
    return;
  }

  // ── 색상 모드 진입: 아래로 충분히 내림 ──
  if (!ctx.colorMode && totalDy > COLOR_DRAG_THRESH) {
    ctx.colorMode = true;
    ctx.colorStartX = e.clientX;
    ctx.colorSteps = 0;
    ctx.previewColorIdx = -1;
    ctx.colorBaseResolved = false;

    clearPreviewHighlight();
    if (orb) orb.classList.add('orb-color-mode');
    updateLabel('🎨');
    highlightColorBar(true);
    return;
  }

  // ── 색상 모드 중 ──
  if (ctx.colorMode) {
    // 위로 돌아가면 도구 모드 복귀
    if (totalDy < COLOR_DRAG_THRESH - 20) {
      ctx.colorMode = false;
      ctx.colorBaseResolved = false;
      if (orb) orb.classList.remove('orb-color-mode');
      highlightColorBar(false);
      clearColorHighlight();
      updateLabel(ctx.previewTool || pendingTool || tool);
      if (ctx.previewTool) previewToolHighlight(ctx.previewTool);
      return;
    }

    // 좌우로 색상 순환
    const colorDx = e.clientX - ctx.colorStartX;
    const colorSteps = Math.trunc(colorDx / DRAG_THRESH);

    if (colorSteps !== ctx.colorSteps) {
      ctx.colorSteps = colorSteps;
      selectColorByStep(colorSteps);
    }
    return;
  }

  // ── 기존 도구 순환 ──
  const newSteps = Math.trunc(totalDx / DRAG_THRESH);

  if (newSteps !== ctx.steps) {
    ctx.steps = newSteps;
    const order = getToolOrder();
    const idx = Math.max(0, Math.min(ctx.baseIdx + newSteps, order.length - 1));
    const newTool = order[idx];

    if (newTool !== ctx.previewTool) {
      ctx.previewTool = newTool;
      previewToolHighlight(newTool);
      updateLabel(newTool);
      if (navigator.vibrate) navigator.vibrate(8);
    }
  }
}

function finishToolDrag() {
  const wasColorMode = ctx.colorMode;
  const wasStrokeMode = ctx.strokeMode; // ★ NEW
  const selectedTool = ctx.previewTool;

  if (wasColorMode || wasStrokeMode) { // ★ MODIFIED
    updateLabel(pendingTool || tool);
    transition(State.SHOWN);
    return;
  }

  const isDrawing = selectedTool && !NO_ORB_TOOLS.has(selectedTool);

  if (selectedTool) {
    bridgeSetTool(selectedTool);
  }

  if (isDrawing) {
    bridgeActivatePending();
    _toolActivated = true;
    showEditModeBorder(); // ★ NEW
    if (orb) orb.classList.add('orb-tool-active');
    updateLabel(selectedTool);
    transition(State.SHOWN);
  } else {
    _toolActivated = false;
    hideEditModeBorder(); // ★ NEW
    if (orb) orb.classList.remove('orb-tool-active');
    transition(State.HIDDEN);
  }
}

// ═══════════════════════════════════════════════════
//  ★ NEW: 굵기 선택 헬퍼
// ═══════════════════════════════════════════════════

let strokeBtns = null;
let strokeBaseIdx = 0;

function getStrokeBtns() {
  if (!strokeBtns) {
    strokeBtns = [...document.querySelectorAll('#color-tray .sbtn')];
  }
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
    if (navigator.vibrate) navigator.vibrate(8);

    if (orbLabel) {
      const sw = btns[idx].dataset.sw;
      orbLabel.textContent = `${sw}px`;
    }
  }
}

function clearStrokeHighlight() {
  getStrokeBtns().forEach(b => b.classList.remove('sbtn-orb-highlight'));
}

// ═══════════════════════════════════════════════════
//  툴바 하이라이트
// ═══════════════════════════════════════════════════

let orbGhost = null;

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
  const btn = document.querySelector(
    `#tb-tools .tbtn[data-tool="${t}"], #tb-tools .tbtn[data-tool-or-panel="${t}"]`
  );
  if (!btn) return;

  const container = document.getElementById('tb-tools');
  if (container) {
    const btnLeft   = btn.offsetLeft;
    const btnWidth  = btn.offsetWidth;
    const contWidth = container.offsetWidth;
    const target    = btnLeft - (contWidth - btnWidth) / 2;
    container.scrollLeft = Math.max(0, target);
  }

  requestAnimationFrame(() => {
    const r = btn.getBoundingClientRect();
    if (r.right < 0 || r.left > window.innerWidth) return;

    const ghost = ensureGhost();
    ghost.textContent = btn.textContent;
    ghost.className   = btn.className + ' orb-preview-ghost-active';
    ghost.style.left   = (r.left + r.width / 2) + 'px';
    ghost.style.top    = (r.top  + r.height / 2) + 'px';
    ghost.style.width  = r.width  + 'px';
    ghost.style.height = r.height + 'px';
  });
}

function clearPreviewHighlight() {
  document.querySelectorAll('.orb-preview').forEach(b => b.classList.remove('orb-preview'));
  if (orbGhost) {
    orbGhost.className = '';
    orbGhost.textContent = '';
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
  orb.classList.remove('orb-stroke-mode'); // ★ NEW
  clearPreviewHighlight();
  clearColorHighlight();
  clearStrokeHighlight(); // ★ NEW
  highlightColorBar(false);
}

function cancelLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}

// ═══════════════════════════════════════════════════
//  라벨 & 접근성
// ═══════════════════════════════════════════════════

const LABEL_MAP = {
  select: '⊹', edit: '✎', pan: '✋',
  pen: '✏️', highlight: '🖊️', eraser: '◻',
  text: 'T', rect: '□', circle: '○', arrow: '→',
};

const ARIA_MAP = {
  select: '선택', edit: '편집', pan: '이동',
  pen: '펜', highlight: '형광펜', eraser: '지우개',
  text: '텍스트', rect: '사각형', circle: '원', arrow: '화살표',
};

function updateLabel(t) {
  if (!orbLabel) return;
  orbLabel.textContent = LABEL_MAP[t] || t;
  if (orb) orb.setAttribute('aria-label', `현재 도구: ${ARIA_MAP[t] || t}`);
}

// ═══════════════════════════════════════════════════
//  위치 (고정) — ★ MODIFIED: 원형 경계 적용
// ═══════════════════════════════════════════════════

function applyPosition() {
  if (!orb) return;
  const half = ORB_SIZE / 2;
  orb.style.transform = `translate(${orbX - half}px, ${orbY - half}px)`;
  enforceCircleBoundary(); // ★ NEW
}

// ═══════════════════════════════════════════════════
//  색상 선택 헬퍼
// ═══════════════════════════════════════════════════

let colorDots = null;
let colorBaseIdx = 0;

function getColorDots() {
  if (!colorDots) {
    colorDots = [...document.querySelectorAll('#color-tray .cdot')];
  }
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
    if (navigator.vibrate) navigator.vibrate(8);

    if (orb && orbLabel) {
      const color = dots[idx].dataset.c;
      orbLabel.style.color = color;
      orbLabel.textContent = '●';
    }
  }
}

function clearColorHighlight() {
  const dots = getColorDots();
  dots.forEach(d => d.classList.remove('cdot-orb-highlight'));
  if (orbLabel) orbLabel.style.color = '';
}

function highlightColorBar(show) {
  const cb = document.getElementById('color-tray');
  if (!cb) return;
  if (show) {
    cb.classList.add('ct-visible', 'cb-orb-highlight');
  } else {
    cb.classList.remove('cb-orb-highlight');
  }
}
