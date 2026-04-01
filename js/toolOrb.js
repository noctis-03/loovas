// ═══════════════════════════════════════════════════
//  toolOrb.js — 고정 위치 도구 Orb (v3)
//
//  - 이동 모드에서는 Orb를 표시하지 않음
//  - 탭으로 도구 활성화 시 탭 위치 근처에 Orb 생성 (고정)
//  - Orb는 포인터를 따라다니지 않음
//  - 수평 드래그로 도구 순환, 수직 드래그로 Orb 위치 재배치
//  - 싱글탭으로 활성/비활성 토글
//  - 일정 시간 후 pan 복귀 + Orb 숨김
// ═══════════════════════════════════════════════════

import { tool, pendingTool } from './state.js';
import { setTool, activatePending, revertToPan } from './tools.js';

// ── 설정 ──
const NO_ORB_TOOLS   = new Set(['text', 'edit', 'pan', 'select']);
const ORB_SIZE        = 48;
const SPAWN_OFFSET_X  = -40;  // 탭 위치 기준 Orb 생성 오프셋
const SPAWN_OFFSET_Y  = -50;
const DRAG_THRESH     = 28;
const DIR_LOCK_DIST   = 14;
const LONGPRESS_MS    = 400;
const HIDE_DELAY_TOOL = 6000;  // 도구 활성 후 자동 복귀
const HIDE_DELAY_USE  = 3000;  // 그리기 완료 후
const TAP_TIME_THRESH = 280;

// ── FSM 상태 ──
const State = Object.freeze({
  HIDDEN:     'hidden',
  SHOWN:      'shown',       // Orb 표시 중 (고정 위치)
  HOLD:       'hold',        // Orb 위에서 포인터 다운
  RELOCATING: 'relocating',  // 수직 → Orb 위치 이동
  TOOL_DRAG:  'toolDrag',    // 수평 → 도구 순환
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

// ═══════════════════════════════════════════════════
//  외부 API
// ═══════════════════════════════════════════════════

export function isOrbLocked() { return _orbLock; }
export { _orbLock as orbLock };

export function isToolActivated() { return _toolActivated; }
export { _toolActivated as toolActivated };

/** tools.js에서 도구 변경 시 호출 */
export function notifyToolChanged(t) {
  updateLabel(t);
  _toolActivated = false;
  if (orb) orb.classList.remove('orb-tool-active');
  if (NO_ORB_TOOLS.has(t)) {
    transition(State.HIDDEN);
  }
}

/**
 * 터치 탭으로 도구 활성화 + Orb 생성
 * @param {number} tx - 탭 X 좌표 (screen)
 * @param {number} ty - 탭 Y 좌표 (screen)
 * @returns {boolean} 활성화 성공 여부
 */
export function tryActivateByTap(tx, ty) {
  if (!pendingTool) return false;
  if (_toolActivated) return true;

  activatePending();
  _toolActivated = true;

  // Orb를 탭 위치 근처에 생성
  spawnOrbAt(tx + SPAWN_OFFSET_X, ty + SPAWN_OFFSET_Y);

  return true;
}

/**
 * 이미 활성 상태에서 재탭 시 → Orb 토글 (비활성화)
 */
export function deactivateByTap() {
  if (!_toolActivated) return;
  revertToPan();
  _toolActivated = false;
  transition(State.HIDDEN);
}

/** 그리기 완료 후 호출 */
export function scheduleRevertAfterUse() {
  if (!pendingTool || !_toolActivated) return;
  scheduleHide(HIDE_DELAY_USE);
}

/** 도형 무시 시에도 revert 보장 */
export function ensureRevertIfNeeded() {
  if (pendingTool && _toolActivated) {
    scheduleHide(HIDE_DELAY_USE);
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
//  Orb 생성 (탭 위치에 고정)
// ═══════════════════════════════════════════════════

function spawnOrbAt(x, y) {
  // 화면 밖 보정
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
//  Orb 포인터 이벤트
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

      // 화면 밖 보정
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
        // 싱글탭: 도구 활성/비활성 토글
        handleOrbSingleTap();
      }

      if (_toolActivated) {
        transition(State.SHOWN);
      } else {
        transition(State.HIDDEN);
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
  if (!pendingTool) return;

  if (_toolActivated) {
    revertToPan();
    _toolActivated = false;
    if (orb) orb.classList.remove('orb-tool-active');
    updateLabel(pendingTool);
  } else {
    activatePending();
    _toolActivated = true;
    if (orb) orb.classList.add('orb-tool-active');
    updateLabel(pendingTool);
    scheduleHide(HIDE_DELAY_TOOL);
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

  // exitState에서 orbLock 해제
  if (selectedTool) {
    setTool(selectedTool);
  }

  updateLabel(selectedTool || pendingTool || tool);
  _toolActivated = false;
  if (orb) orb.classList.remove('orb-tool-active');

  // 도구 전환 후 HIDDEN으로 (pan 모드이므로 Orb 불필요)
  transition(State.HIDDEN);
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
//  위치 적용 (고정, 애니메이션 없음)
// ═══════════════════════════════════════════════════

function applyPosition() {
  if (!orb) return;
  const half = ORB_SIZE / 2;
  orb.style.transform = `translate(${orbX - half}px, ${orbY - half}px)`;
}
