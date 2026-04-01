// ═══════════════════════════════════════════════════
//  toolOrb.js — 포인터를 따라다니는 도구 Orb (v2)
//
//  FSM 기반 재구성, 싱글탭 활성화, 수평/수직 자동 분기,
//  rAF 조건부 실행, 데스크톱 비활성화, 접근성 개선
// ═══════════════════════════════════════════════════

import { tool, pendingTool } from './state.js';
import { setTool, activatePending, revertToPan } from './tools.js';

// ── 설정 ──
const NO_ORB_TOOLS   = new Set(['text', 'edit', 'pan', 'select']);
const ORB_SIZE        = 48;   // 터치 타겟 최소 48px
const OFFSET_X        = -34;
const OFFSET_Y        = -32;
const LERP_SPEED      = 0.35;
const DRAG_THRESH     = 28;   // 도구 순환 1스텝 거리
const DIR_LOCK_DIST   = 14;   // 수평/수직 판정 거리
const LONGPRESS_MS    = 400;
const HIDE_DELAY_TOOL = 5000; // 도구 전환 직후
const HIDE_DELAY_USE  = 3000; // 그리기 완료 후
const HIDE_DELAY_IDLE = 4000; // 일반
const TAP_MOVE_THRESH = 10;
const TAP_TIME_THRESH = 280;

// ── FSM 상태 ──
const State = Object.freeze({
  HIDDEN:     'hidden',
  FOLLOWING:  'following',   // 포인터 따라다님
  HOLD:       'hold',        // Orb 위에서 포인터 다운, 방향 미결정
  RELOCATING: 'relocating',  // 수직 이동 → Orb 위치 변경
  TOOL_DRAG:  'toolDrag',    // 수평 이동 → 도구 순환
  PINNED:     'pinned',      // 사용자가 relocate한 뒤 고정
});

let fsm = State.HIDDEN;
let ctx = {};  // 각 상태의 임시 데이터

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

/** 툴바 구성이 동적으로 바뀔 경우 호출 */
export function invalidateToolOrderCache() {
  toolOrderCache = null;
}

// ── DOM ──
let orb = null;
let orbLabel = null;

// ── 위치 ──
let targetX = -200, targetY = -200;
let currentX = -200, currentY = -200;
let pinnedX = null, pinnedY = null;  // 고정 모드 좌표

// ── rAF ──
let rafId = null;

// ── 타이머 ──
let hideTimer = null;
let longPressTimer = null;

// ── 외부 공개 상태 ──
let _orbLock = false;
let _toolActivated = false;

// ── 데스크톱 판별 ──
function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

// ═══════════════════════════════════════════════════
//  외부 공개 API
// ═══════════════════════════════════════════════════

/** mouse.js / touch.js 에서 체크 — Orb 인터랙션 중이면 true */
export function isOrbLocked() { return _orbLock; }

// 하위 호환용 (기존 코드에서 orbLock 직접 참조 대비)
export { _orbLock as orbLock };

/** 도구 활성화 여부 */
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
 * 터치 탭으로 도구 활성화 시도
 * @returns {boolean} 활성화 성공 여부
 */
export function tryActivateByTap() {
  if (!pendingTool) return false;
  if (_toolActivated) return true;

  activatePending();
  _toolActivated = true;
  if (orb) orb.classList.add('orb-tool-active');
  scheduleHide(HIDE_DELAY_TOOL);
  return true;
}

/** 그리기 완료 후 호출 — 일정 시간 뒤 pan 복귀 */
export function scheduleRevertAfterUse() {
  if (!pendingTool || !_toolActivated) return;
  scheduleHide(HIDE_DELAY_USE);
}

/** 도형이 무시된 경우(너무 작음)에도 revert 보장 */
export function ensureRevertIfNeeded() {
  if (pendingTool && _toolActivated) {
    scheduleHide(HIDE_DELAY_USE);
  }
}

// ═══════════════════════════════════════════════════
//  초기화
// ═══════════════════════════════════════════════════

export function initToolOrb() {
  // 데스크톱이면 Orb 생성하지 않음
  if (!isTouchDevice()) {
    // 더미 함수들이 안전하게 동작하도록 orb = null 유지
    return;
  }

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

  // Orb 자체 이벤트
  orb.addEventListener('pointerdown', onOrbPointerDown);

  // 전역 이벤트
  window.addEventListener('pointerdown', onGlobalDown, true);
  window.addEventListener('pointermove', onGlobalMove, true);
  window.addEventListener('pointerup',   onGlobalUp,   true);
  window.addEventListener('pointercancel', onGlobalUp,  true);

  updateLabel(tool);
}

// ═══════════════════════════════════════════════════
//  FSM 전이
// ═══════════════════════════════════════════════════

function transition(newState, data) {
  // exit 현재 상태
  exitState(fsm);
  fsm = newState;
  ctx = data || {};
  // enter 새 상태
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
    case State.RELOCATING:
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

    case State.FOLLOWING:
      showOrb();
      scheduleHide(HIDE_DELAY_IDLE);
      break;

    case State.PINNED:
      showOrb();
      scheduleHide(HIDE_DELAY_IDLE);
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
//  Orb 포인터 이벤트 (Orb 위에서)
// ═══════════════════════════════════════════════════

function onOrbPointerDown(e) {
  e.stopPropagation();
  e.preventDefault();

  if (fsm === State.TOOL_DRAG) return; // 이미 드래그 중

  try { orb.setPointerCapture(e.pointerId); } catch (_) {}

  transition(State.HOLD, {
    startX: e.clientX,
    startY: e.clientY,
    orbStartX: currentX,
    orbStartY: currentY,
    pointerId: e.pointerId,
    downTime: Date.now(),
    dirLocked: false,
    direction: null,  // 'h' | 'v' | null
  });

  // 롱프레스 → 싱글탭 타임아웃 대비 (필요시 도구 드래그 진입)
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    if (fsm === State.HOLD && !ctx.dirLocked) {
      // 롱프레스: 도구 드래그 진입
      transition(State.TOOL_DRAG, {
        startX: ctx.startX,
        baseIdx: 0,
        steps: 0,
        previewTool: '',
      });
    }
  }, LONGPRESS_MS);
}

// ═══════════════════════════════════════════════════
//  전역 포인터 이벤트
// ═══════════════════════════════════════════════════

function onGlobalDown(e) {
  if (!orb) return;

  if (fsm === State.TOOL_DRAG) {
    if (!orb.contains(e.target)) {
      e.stopPropagation();
      e.preventDefault();
    }
    return;
  }

  // UI 요소 위면 무시
  if (isUIElement(e.target)) return;

  const activeTool = pendingTool || tool;
  if (NO_ORB_TOOLS.has(activeTool)) return;

  if (fsm === State.PINNED) {
    // 고정 모드: 위치 유지, 타이머만 리셋
    scheduleHide(HIDE_DELAY_IDLE);
  } else if (fsm === State.HIDDEN || fsm === State.FOLLOWING) {
    targetX = e.clientX + OFFSET_X;
    targetY = e.clientY + OFFSET_Y;
    transition(State.FOLLOWING);
  }
}

function onGlobalMove(e) {
  if (!orb) return;

  switch (fsm) {
    case State.TOOL_DRAG: {
      e.stopPropagation();
      e.preventDefault();
      handleToolDragMove(e);
      // Orb도 따라가게
      targetX = e.clientX + OFFSET_X;
      targetY = e.clientY + OFFSET_Y;
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
          // 수평 → 도구 순환
          ctx.direction = 'h';
          transition(State.TOOL_DRAG, {
            startX: ctx.startX,
            baseIdx: 0,
            steps: 0,
            previewTool: '',
          });
        } else {
          // 수직 → 위치 이동
          ctx.direction = 'v';
          transition(State.RELOCATING, {
            startX: ctx.startX,
            startY: ctx.startY,
            orbStartX: ctx.orbStartX,
            orbStartY: ctx.orbStartY,
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
      const newX = ctx.orbStartX + dx;
      const newY = ctx.orbStartY + dy;
      targetX = newX;
      targetY = newY;
      currentX = newX;
      currentY = newY;
      applyPosition();
      break;
    }

    case State.FOLLOWING: {
      if (isUIElement(e.target)) return;
      if (e.buttons > 0 || e.pointerType === 'touch') {
        const activeTool = pendingTool || tool;
        if (!NO_ORB_TOOLS.has(activeTool)) {
          targetX = e.clientX + OFFSET_X;
          targetY = e.clientY + OFFSET_Y;
        }
      }
      break;
    }

    case State.PINNED: {
      // 고정 모드: 위치 안 바뀜
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
      // 방향 결정 안 됨 → 싱글탭으로 판정
      try { orb.releasePointerCapture(ctx.pointerId); } catch (_) {}
      const elapsed = Date.now() - (ctx.downTime || 0);

      if (elapsed < TAP_TIME_THRESH) {
        // ★ 싱글탭: 바로 도구 활성화
        handleOrbSingleTap();
      }

      // following 또는 pinned로 복귀
      if (pinnedX !== null) {
        transition(State.PINNED);
      } else {
        transition(State.FOLLOWING);
      }
      break;
    }

    case State.RELOCATING: {
      try { orb.releasePointerCapture(ctx.pointerId || e.pointerId); } catch (_) {}
      // 현재 위치를 고정 좌표로 저장
      pinnedX = currentX;
      pinnedY = currentY;
      transition(State.PINNED);
      break;
    }

    default: {
      if (fsm !== State.HIDDEN) {
        scheduleHide(HIDE_DELAY_IDLE);
      }
      break;
    }
  }
}

// ═══════════════════════════════════════════════════
//  싱글탭 처리
// ═══════════════════════════════════════════════════

function handleOrbSingleTap() {
  if (!pendingTool) return;

  if (_toolActivated) {
    // 이미 활성 → 비활성화하고 pan 복귀
    revertToPan();
    _toolActivated = false;
    if (orb) orb.classList.remove('orb-tool-active');
    updateLabel(pendingTool);
  } else {
    // 미활성 → 활성화
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
  transition(State.FOLLOWING); // exitState에서 orbLock 해제됨

  if (selectedTool) {
    setTool(selectedTool);
  }

  updateLabel(selectedTool || pendingTool || tool);
  _toolActivated = false;
  if (orb) orb.classList.remove('orb-tool-active');
  scheduleHide(HIDE_DELAY_TOOL);
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

  // rAF 안에서 getBoundingClientRect — scrollLeft 반영 후
  requestAnimationFrame(() => {
    const r = btn.getBoundingClientRect();
    if (r.right < 0 || r.left > window.innerWidth) return;

    const ghost = ensureGhost();
    ghost.textContent = btn.textContent;
    ghost.className   = btn.className + ' orb-preview-ghost-active';
    const cx = r.left + r.width / 2;
    const cy = r.top  + r.height / 2;
    ghost.style.left   = cx + 'px';
    ghost.style.top    = cy + 'px';
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
//  표시/숨김
// ═══════════════════════════════════════════════════

function showOrb() {
  cancelHideTimer();
  if (!orb) return;

  const wasHidden = !orb.classList.contains('orb-visible');
  orb.classList.add('orb-visible');

  if (wasHidden) {
    currentX = targetX;
    currentY = targetY;
    applyPosition();
  }

  startAnimLoop();
}

function hideOrbNow() {
  cancelHideTimer();
  if (!orb) return;
  orb.classList.remove('orb-visible');
  orb.classList.remove('orb-tool-active');
  clearPreviewHighlight();
  stopAnimLoop();
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
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
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
  if (orb) {
    orb.setAttribute('aria-label', `현재 도구: ${ARIA_MAP[t] || t}`);
  }
}

// ═══════════════════════════════════════════════════
//  애니메이션 루프 (조건부)
// ═══════════════════════════════════════════════════

function startAnimLoop() {
  if (rafId) return;
  rafId = requestAnimationFrame(animLoop);
}

function stopAnimLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function animLoop() {
  rafId = null;

  // 비표시 상태면 루프 정지
  if (fsm === State.HIDDEN) return;

  // relocating 중에는 lerp 안 함 (즉시 위치 반영)
  if (fsm !== State.RELOCATING) {
    // 고정 모드면 타겟을 고정 좌표로
    if (fsm === State.PINNED && pinnedX !== null) {
      targetX = pinnedX;
      targetY = pinnedY;
    }

    const dx = targetX - currentX;
    const dy = targetY - currentY;

    // 왼쪽 이동은 즉시, 오른쪽은 lerp
    if (dx < -0.5) {
      currentX = targetX;
    } else {
      currentX += dx * LERP_SPEED;
    }
    currentY += dy * LERP_SPEED;
  }

  applyPosition();

  // 수렴했으면 루프 정지, 아니면 계속
  const settled = Math.abs(targetX - currentX) < 0.5 && Math.abs(targetY - currentY) < 0.5;
  if (!settled || fsm === State.FOLLOWING || fsm === State.TOOL_DRAG) {
    rafId = requestAnimationFrame(animLoop);
  }
}

function applyPosition() {
  if (!orb) return;
  const half = ORB_SIZE / 2;
  const x = Math.max(half, Math.min(currentX, window.innerWidth - half));
  const y = Math.max(half, Math.min(currentY, window.innerHeight - half));
  orb.style.transform = `translate(${x - half}px, ${y - half}px)`;
}

// ═══════════════════════════════════════════════════
//  유틸
// ═══════════════════════════════════════════════════

function isUIElement(target) {
  return target.closest('#toolbar') ||
         target.closest('#pen-panel') ||
         target.closest('#color-bar') ||
         (orb && orb.contains(target));
}
