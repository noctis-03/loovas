// ═══════════════════════════════════════════════════
//  toolOrb.js — 고정 위치 도구 Orb (v3.1)
//
//  - 이동 모드에서는 Orb 미표시
//  - 탭으로 도구 활성화 시 탭 위치 근처에 Orb 생성 (고정)
//  - Orb는 포인터를 따라다니지 않음
//  - 수평 드래그로 도구 순환, 수직 드래그로 위치 재배치
//  - 도구 변경 시 Orb 타이머 초기화 및 유지
// ═══════════════════════════════════════════════════

import { tool, pendingTool } from './state.js';
import { setTool, activatePending, revertToPan } from './tools.js';

// ── 설정 ──
const NO_ORB_TOOLS   = new Set(['text', 'edit', 'pan', 'select']);
const ORB_SIZE        = 48;
const SPAWN_OFFSET_X  = -40;
const SPAWN_OFFSET_Y  = -50;
const DRAG_THRESH     = 28;
const DIR_LOCK_DIST   = 14;
const LONGPRESS_MS    = 400;
const HIDE_DELAY_TOOL = 6000;
const HIDE_DELAY_USE  = 3000;
const TAP_TIME_THRESH = 280;

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
let hideTimer = null;
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
//  외부 API
// ═══════════════════════════════════════════════════

export function isOrbLocked() { return _orbLock; }
export { _orbLock as orbLock };

export function isToolActivated() { return _toolActivated; }
export { _toolActivated as toolActivated };

/**
 * tools.js에서 도구 변경 시 호출
 *
 * ★ 핵심 변경: Orb가 보이는 상태에서 그리기 도구로 전환하면
 *   Orb를 유지하고 타이머만 리셋한다.
 */
export function notifyToolChanged(t) {
  updateLabel(t);

  // select/pan/edit 등 비그리기 도구 → Orb 숨김
  if (NO_ORB_TOOLS.has(t)) {
    _toolActivated = false;
    if (orb) orb.classList.remove('orb-tool-active');
    transition(State.HIDDEN);
    return;
  }

  // 그리기 도구로 변경됨
  if (isOrbVisible()) {
    // ★ Orb가 보이는 중 → 유지 + 타이머 초기화
    // pendingTool이 갱신되었으므로 활성 상태도 유지
    _toolActivated = false;  // 새 도구이므로 아직 미활성 (탭 필요)
    if (orb) orb.classList.remove('orb-tool-active');
    scheduleHide(HIDE_DELAY_TOOL);
    return;
  }

  // Orb가 숨겨진 상태 → 그대로 숨김 유지 (탭으로 활성화해야 함)
  _toolActivated = false;
  if (orb) orb.classList.remove('orb-tool-active');
}

/**
 * 터치 탭으로 도구 활성화 + Orb 생성
 */
export function tryActivateByTap(tx, ty) {
  if (!pendingTool) return false;
  if (_toolActivated) return true;

  activatePending();
  _toolActivated = true;

  if (isOrbVisible()) {
    // ★ Orb가 이미 보이면 위치 유지, 상태만 갱신 + 타이머 리셋
    if (orb) orb.classList.add('orb-tool-active');
    updateLabel(pendingTool);
    scheduleHide(HIDE_DELAY_TOOL);
  } else {
    // Orb가 숨겨진 상태 → 탭 위치에 생성
    spawnOrbAt(tx + SPAWN_OFFSET_X, ty + SPAWN_OFFSET_Y);
  }

  return true;
}

/** Orb 탭으로 비활성화 */
export function deactivateByTap() {
  if (!_toolActivated) return;
  revertToPan();
  _toolActivated = false;
  transition(State.HIDDEN);
}

/** 그리기 완료 후 */
export function scheduleRevertAfterUse() {
  if (!pendingTool || !_toolActivated) return;
  scheduleHide(HIDE_DELAY_USE);
}

/** 도형 무시 시 revert 보장 */
export function ensureRevertIfNeeded() {
  if (pendingTool && _toolActivated) {
    scheduleHide(HIDE_DELAY_USE);
  }
}

/**
 * ★ 외부에서 호출: 도구 사용 중 타이머 리셋
 *   (그리기 시작 시 호출하면 그리는 동안 Orb가 사라지지 않음)
 */
export function resetOrbTimer() {
  if (isOrbVisible() && _toolActivated) {
    cancelHideTimer();
  }
}

/**
 * ★ 외부에서 호출: 도구 사용 완료 후 타이머 재시작
 */
export function restartOrbTimer(delay) {
  if (isOrbVisible()) {
    scheduleHide(delay || HIDE_DELAY_USE);
  }
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
      if (orb) orb.classList.remove('orb-active');
      clearPreviewHighlight();
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
        revertToPan();
        _toolActivated = false;
      }
      break;

    case State.SHOWN:
      showOrb();
      scheduleHide(HIDE_DELAY_TOOL);
      break;

    case State.HOLD:
      cancelHideTimer();
      break;

    case State.RELOCATING:
      cancelHideTimer();
      break;

    case State.TOOL_DRAG: {
      cancelHideTimer();
      _orbLock = true;
      if (orb) orb.classList.add('orb-active');

      const baseTool = pendingTool || tool;
      const order = getToolOrder();
      ctx.baseIdx = order.indexOf(baseTool);
      if (ctx.baseIdx === -1) ctx.baseIdx = 0;
      ctx.steps = 0;
      ctx.previewTool = baseTool;

      updateLabel(baseTool);
      const tb = document.getElementById('toolbar');
      if (tb) tb.classList.add('tb-orb-zoom');
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
        // 롱프레스가 도구드래그로 안 갔으면 그냥 유지
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
//  싱글탭
// ═══════════════════════════════════════════════════

function handleOrbSingleTap() {
  if (!pendingTool) {
    transition(State.HIDDEN);
    return;
  }

  if (_toolActivated) {
    // 활성 → 비활성
    revertToPan();
    _toolActivated = false;
    if (orb) orb.classList.remove('orb-tool-active');
    updateLabel(pendingTool);
    transition(State.HIDDEN);
  } else {
    // 비활성 → 활성
    activatePending();
    _toolActivated = true;
    if (orb) orb.classList.add('orb-tool-active');
    updateLabel(pendingTool);
    transition(State.SHOWN);
  }
}

// ═══════════════════════════════════════════════════
//  도구 순환 드래그
// ═══════════════════════════════════════════════════

function handleToolDragMove(e) {
  const totalDx = e.clientX - ctx.startX;
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
  const selectedTool = ctx.previewTool;
  const isDrawing = selectedTool && !NO_ORB_TOOLS.has(selectedTool);

  // exitState에서 orbLock 해제, preview 정리

  if (selectedTool) {
    setTool(selectedTool);
    // setTool → notifyToolChanged가 호출됨
    // notifyToolChanged에서 isOrbVisible() 체크 시
    // 아직 TOOL_DRAG 상태이므로 true → Orb 유지 + 타이머 리셋
  }

  // ★ 그리기 도구로 전환 → Orb 유지, 미활성 상태 (탭으로 활성화)
  if (isDrawing) {
    _toolActivated = false;
    if (orb) orb.classList.remove('orb-tool-active');
    updateLabel(selectedTool);
    transition(State.SHOWN);
  } else {
    // 비그리기 도구 → Orb 숨김
    _toolActivated = false;
    if (orb) orb.classList.remove('orb-tool-active');
    transition(State.HIDDEN);
  }
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
  cancelHideTimer();
  if (!orb) return;
  orb.classList.add('orb-visible');
  if (_toolActivated) orb.classList.add('orb-tool-active');
  applyPosition();
}

function hideOrbNow() {
  cancelHideTimer();
  if (!orb) return;
  orb.classList.remove('orb-visible');
  orb.classList.remove('orb-tool-active');
  clearPreviewHighlight();
}

function scheduleHide(ms) {
  cancelHideTimer();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (fsm === State.TOOL_DRAG || fsm === State.HOLD || fsm === State.RELOCATING) return;
    transition(State.HIDDEN);
  }, ms);
}

function cancelHideTimer() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
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
  orbLabel.textContent = LABEL_MAP[t] || t.charAt(0).toUpperCase();
  if (orb) orb.setAttribute('aria-label', `현재 도구: ${ARIA_MAP[t] || t}`);
}

// ═══════════════════════════════════════════════════
//  위치 (고정)
// ═══════════════════════════════════════════════════

function applyPosition() {
  if (!orb) return;
  const half = ORB_SIZE / 2;
  orb.style.transform = `translate(${orbX - half}px, ${orbY - half}px)`;
}
