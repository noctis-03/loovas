// ═══════════════════════════════════════════════════
//  history.js — Undo / Redo (스냅샷 기반)
//
//  FIX: 서브블록 드래그/리사이즈에서 그리드 스냅 & pushState 추가
//  FIX: 순환 참조 회피를 위한 동적 임포트 사용
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { mkSvg, setAttrs } from './svg.js';
import { addHandles, attachSelectClick } from './elements.js';
import { deselectAll } from './selection.js';
import { updateMinimap } from './layout.js';
import { snack } from './utils.js';

const MAX_HISTORY = 60;

let undoStack = [];
let redoStack = [];
let restoring = false;

// ── 스냅샷 생성 ──
function takeSnapshot() {
  const snap = {
    strokes: S.getStrokes().map(s => ({ kind: s.kind, attrs: { ...s.attrs } })),
    elements: []
  };

  S.board.querySelectorAll('.el').forEach(el => {
    snap.elements.push({
      html: el.outerHTML,
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      w: parseFloat(el.style.width),
      h: parseFloat(el.style.height),
      z: parseInt(el.style.zIndex) || 10
    });
  });

  return JSON.stringify(snap);
}

// ── 스냅샷 복원 ──
function restoreSnapshot(json) {
  restoring = true;

  deselectAll();

  const snap = JSON.parse(json);

  // SVG 스트로크 초기화 & 복원
  while (S.svgl.firstChild) S.svgl.removeChild(S.svgl.firstChild);
  S.setStrokes([]);

  if (snap.strokes) {
    snap.strokes.forEach(s => {
      let el;
      if (s.kind === 'rect') {
        el = mkSvg('rect');
        setAttrs(el, s.attrs);
      } else if (s.kind === 'ellipse') {
        el = mkSvg('ellipse');
        setAttrs(el, s.attrs);
      } else if (s.kind === 'arrow') {
        el = mkSvg('g');
        if (s.attrs.x1 !== undefined) {
          const line = mkSvg('line');
          setAttrs(line, {
            x1: s.attrs.x1, y1: s.attrs.y1,
            x2: s.attrs.x2, y2: s.attrs.y2,
            stroke: s.attrs.stroke,
            'stroke-width': s.attrs['stroke-width'],
            'stroke-linecap': 'round'
          });
          el.appendChild(line);
        }
        if (s.attrs.d) {
          const path = mkSvg('path');
          setAttrs(path, {
            d: s.attrs.d,
            stroke: s.attrs.stroke,
            'stroke-width': s.attrs['stroke-width'],
            'stroke-linecap': 'round',
            fill: 'none'
          });
          el.appendChild(path);
        }
      } else {
        el = mkSvg('path');
        setAttrs(el, s.attrs);
      }
      S.svgl.appendChild(el);
      S.pushStroke({ kind: s.kind, attrs: s.attrs, svgEl: el });
    });
  }

  // DOM 요소 초기화 & 복원
  S.board.querySelectorAll('.el').forEach(el => el.remove());

  if (snap.elements) {
    snap.elements.forEach(data => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = data.html;
      const el = wrapper.firstElementChild;
      if (!el) return;

      const oldHandles = el.querySelector('.el-handles');
      if (oldHandles) oldHandles.remove();

      el.style.left = data.x + 'px';
      el.style.top = data.y + 'px';
      el.style.width = data.w + 'px';
      el.style.height = data.h + 'px';
      el.style.zIndex = data.z;
      el.classList.remove('selected');

      S.board.appendChild(el);
      addHandles(el);
      attachSelectClick(el);

      rebindStickyEvents(el);
      rebindCardEvents(el);
    });
  }

  updateMinimap();
  restoring = false;
}

// ── 포스트잇 내부 이벤트 재바인딩 ──
function rebindStickyEvents(el) {
  const stickyBody = el.querySelector('.sticky-body');
  if (!stickyBody) return;

  const STICKY_COLORS = ['#fef3c7', '#fce7f3', '#d1fae5', '#dbeafe', '#ede9fe', '#fee2e2', '#fef9c3'];
  let colorIdx = 0;

  const currentBg = stickyBody.style.background || stickyBody.style.backgroundColor || '';
  STICKY_COLORS.forEach((c, i) => {
    if (currentBg.includes(c)) colorIdx = i;
  });

  const btns = stickyBody.querySelectorAll('.sticky-btn');
  btns.forEach(btn => {
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);

    if (clone.textContent.trim() === '🎨') {
      clone.addEventListener('click', e => {
        e.stopPropagation();
        colorIdx = (colorIdx + 1) % STICKY_COLORS.length;
        stickyBody.style.background = STICKY_COLORS[colorIdx];
      });
    }
    if (clone.textContent.trim() === '✕') {
      clone.addEventListener('click', e => {
        e.stopPropagation();
        el.remove();
        updateMinimap();
        pushState();
      });
    }
  });

  const ta = stickyBody.querySelector('textarea');
  if (ta) {
    ta.addEventListener('focus', () => { el.style.zIndex = S.nextZ(); });
  }
}

// ── 카드 내부 이벤트 재바인딩 ──
function rebindCardEvents(el) {
  const cardBody = el.querySelector('.card-body');
  if (!cardBody) return;

  const closeBtn = cardBody.querySelector('.card-close-btn');
  if (closeBtn) {
    const clone = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(clone, closeBtn);
    clone.addEventListener('click', e => {
      e.stopPropagation();
      el.remove();
      updateMinimap();
      pushState();
    });
  }

  const subContainer = cardBody.querySelector('.card-sub-container');
  const addBlockBtn = cardBody.querySelector('.card-add-block-btn');
  if (addBlockBtn && subContainer) {
    const clone = addBlockBtn.cloneNode(true);
    addBlockBtn.parentNode.replaceChild(clone, addBlockBtn);
    clone.addEventListener('click', e => {
      e.stopPropagation();
      import('./card.js').then(mod => {
        if (mod._createSubBlock) mod._createSubBlock(subContainer);
      });
    });
  }

  if (subContainer) {
    subContainer.querySelectorAll('.card-sub-block').forEach(block => {
      rebindSubBlockEvents(block, subContainer);
    });
  }
}

function rebindSubBlockEvents(block, container) {
  // 삭제 버튼
  const delBtn = block.querySelector('.card-sub-btn-del');
  if (delBtn) {
    const clone = delBtn.cloneNode(true);
    delBtn.parentNode.replaceChild(clone, delBtn);
    clone.addEventListener('click', e => {
      e.stopPropagation();
      block.remove();
      pushState(); // ★ FIX: pushState 호출 추가
    });
  }

  // 방향 전환 버튼
  const dirBtns = block.querySelectorAll('.card-sub-btn:not(.card-sub-btn-del)');
  dirBtns.forEach(btn => {
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    clone.addEventListener('click', e => {
      e.stopPropagation();
      const cur = block.dataset.dir || 'vertical';
      block.dataset.dir = cur === 'vertical' ? 'horizontal' : 'vertical';
    });
  });

  // ★ FIX: 드래그/리사이즈에서 card.js의 실제 함수 사용 (그리드 스냅 포함)
  // 동적 임포트로 순환 참조 회피
  import('./card.js').then(mod => {
    // 드래그 핸들
    const dragHandle = block.querySelector('.card-sub-drag-handle');
    if (dragHandle) {
      const clone = dragHandle.cloneNode(true);
      dragHandle.parentNode.replaceChild(clone, dragHandle);
      clone.addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        if (mod._initSubDrag) {
          mod._initSubDrag(block, container, e.clientX, e.clientY);
        }
      });
      clone.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        e.stopPropagation(); e.preventDefault();
        if (mod._initSubDrag) {
          mod._initSubDrag(block, container, e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });
    }

    // 리사이즈 핸들
    const resizeHandle = block.querySelector('.card-sub-resize-handle');
    if (resizeHandle) {
      const clone = resizeHandle.cloneNode(true);
      resizeHandle.parentNode.replaceChild(clone, resizeHandle);
      clone.addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        if (mod._initSubResize) {
          mod._initSubResize(block, container, e.clientX, e.clientY);
        }
      });
      clone.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        e.stopPropagation(); e.preventDefault();
        if (mod._initSubResize) {
          mod._initSubResize(block, container, e.touches[0].clientX, e.touches[0].clientY);
        }
      }, { passive: false });
    }
  });
}

// ═══════════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════════

export function pushState() {
  if (restoring) return;

  const snapshot = takeSnapshot();

  if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snapshot) return;

  undoStack.push(snapshot);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();

  redoStack = [];
}

export function undo() {
  if (undoStack.length <= 1) {
    snack('더 이상 실행 취소할 수 없습니다');
    return;
  }

  redoStack.push(undoStack.pop());

  const prev = undoStack[undoStack.length - 1];
  restoreSnapshot(prev);
  snack('실행 취소');
}

export function redo() {
  if (redoStack.length === 0) {
    snack('다시 실행할 수 없습니다');
    return;
  }

  const next = redoStack.pop();
  undoStack.push(next);
  restoreSnapshot(next);
  snack('다시 실행');
}

export function clearHistory() {
  undoStack = [];
  redoStack = [];
  pushState();
}

export function initHistory() {
  pushState();
}

export function isRestoring() {
  return restoring;
}
