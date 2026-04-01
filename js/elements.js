// ═══════════════════════════════════════════════════
//  elements.js — DOM 요소 생성, 핸들, 이벤트 바인딩
//
//  FIX: duplicateEl에서 포스트잇/카드 내부 이벤트 재바인딩
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { s2b } from './transform.js';
import { select, deselectAll } from './selection.js';
import { updateMinimap } from './layout.js';
import { startLongPress, cancelLongPress } from './contextMenu.js';

export function makeEl(x, y, w, h) {
  const el = document.createElement('div');
  el.className = 'el';
  el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${S.nextZ()};`;
  return el;
}

export function addHandles(el) {
  const hc = document.createElement('div');
  hc.className = 'el-handles';

  const mv = document.createElement('div');
  mv.className = 'h-move';

  function startMove(cx, cy) {
    if (S.tool !== 'select') return;
    if (!S.selectedEls.includes(el)) {
      deselectAll();
      select(el);
    }
    el.style.zIndex = S.nextZ();
    const bp = s2b(cx, cy);
    if (S.selectedEls.length > 1) {
      S.setDragging({
        els: S.selectedEls.map(e2 => ({
          el: e2,
          ox: bp.x - parseFloat(e2.style.left),
          oy: bp.y - parseFloat(e2.style.top)
        }))
      });
    } else {
      S.setDragging({
        el,
        ox: bp.x - parseFloat(el.style.left),
        oy: bp.y - parseFloat(el.style.top)
      });
    }
  }

  mv.addEventListener('mousedown', e => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); startMove(e.clientX, e.clientY); });
  mv.addEventListener('touchstart', e => { if (e.touches.length !== 1) return; e.stopPropagation(); e.preventDefault(); startMove(e.touches[0].clientX, e.touches[0].clientY); cancelLongPress(); }, { passive: false });
  hc.appendChild(mv);

  ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(dir => {
    const rh = document.createElement('div');
    rh.className = `h-resize ${dir}`;

    function startResize(cx, cy) {
      const r0 = {
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        w: parseFloat(el.style.width),
        h: parseFloat(el.style.height)
      };
      S.setResizing({ el, dir, r0, m0: s2b(cx, cy) });
    }

    rh.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); startResize(e.clientX, e.clientY); });
    rh.addEventListener('touchstart', e => { if (e.touches.length !== 1) return; e.stopPropagation(); e.preventDefault(); startResize(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    hc.appendChild(rh);
  });

  el.appendChild(hc);
}

export function attachSelectClick(el) {
  el.addEventListener('mousedown', e => {
    if (S.tool !== 'select') return;
    e.stopPropagation();

    const additive = e.shiftKey || e.metaKey || e.ctrlKey;

    if (additive) {
      select(el, true);
    } else {
      if (!S.selectedEls.includes(el)) {
        deselectAll();
        select(el);
      }
    }

    el.style.zIndex = S.nextZ();
    const bp = s2b(e.clientX, e.clientY);

    if (S.selectedEls.length > 1) {
      S.setDragging({
        els: S.selectedEls.map(e2 => ({
          el: e2,
          ox: bp.x - parseFloat(e2.style.left),
          oy: bp.y - parseFloat(e2.style.top)
        }))
      });
    } else if (S.selectedEls.length === 1) {
      S.setDragging({
        el: S.selectedEls[0],
        ox: bp.x - parseFloat(S.selectedEls[0].style.left),
        oy: bp.y - parseFloat(S.selectedEls[0].style.top)
      });
    }
    e.preventDefault();
  });

  el.addEventListener('touchstart', e => {
    if (S.tool !== 'select' || e.touches.length !== 1) return;
    const tag = e.target.tagName;
    const isEditable = e.target.isContentEditable || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'BUTTON';
    if (isEditable) return;

    e.stopPropagation();
    const t = e.touches[0];
    startLongPress(e.target, t.clientX, t.clientY);

    if (!S.selectedEls.includes(el)) {
      deselectAll();
      select(el);
    }

    el.style.zIndex = S.nextZ();
    const bp = s2b(t.clientX, t.clientY);
    if (S.selectedEls.length > 1) {
      S.setDragging({
        els: S.selectedEls.map(e2 => ({
          el: e2,
          ox: bp.x - parseFloat(e2.style.left),
          oy: bp.y - parseFloat(e2.style.top)
        }))
      });
    } else {
      S.setDragging({
        el,
        ox: bp.x - parseFloat(el.style.left),
        oy: bp.y - parseFloat(el.style.top)
      });
    }
    e.preventDefault();
  }, { passive: false });
}

export function duplicateEl(el) {
  const clone = el.cloneNode(true);
  clone.style.left = (parseFloat(el.style.left) + 20) + 'px';
  clone.style.top = (parseFloat(el.style.top) + 20) + 'px';
  clone.style.zIndex = S.nextZ();
  clone.classList.remove('selected');
  const oldHandles = clone.querySelector('.el-handles');
  if (oldHandles) oldHandles.remove();
  S.board.appendChild(clone);
  addHandles(clone);
  attachSelectClick(clone);

  // ★ FIX: 포스트잇/카드 내부 이벤트 재바인딩
  // 동적 임포트로 순환 참조 방지
  import('./history.js').then(histMod => {
    if (clone.querySelector('.sticky-body')) {
      _rebindStickyEventsBasic(clone, histMod.pushState);
    }
    if (clone.querySelector('.card-body')) {
      _rebindCardEventsBasic(clone, histMod.pushState);
    }
  });

  updateMinimap();
}

// ── 포스트잇 재바인딩 (elements.js 내부용) ──
function _rebindStickyEventsBasic(el, pushStateFn) {
  const stickyBody = el.querySelector('.sticky-body');
  if (!stickyBody) return;

  const STICKY_COLORS = ['#fef3c7', '#fce7f3', '#d1fae5', '#dbeafe', '#ede9fe', '#fee2e2', '#fef9c3'];
  let colorIdx = 0;
  const currentBg = stickyBody.style.background || stickyBody.style.backgroundColor || '';
  STICKY_COLORS.forEach((c, i) => { if (currentBg.includes(c)) colorIdx = i; });

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
        if (pushStateFn) pushStateFn();
      });
    }
  });

  const ta = stickyBody.querySelector('textarea');
  if (ta) {
    ta.addEventListener('focus', () => { el.style.zIndex = S.nextZ(); });
  }
}

// ── 카드 재바인딩 (elements.js 내부용) ──
function _rebindCardEventsBasic(el, pushStateFn) {
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
      if (pushStateFn) pushStateFn();
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
      _rebindSubBlockBasic(block, subContainer, pushStateFn);
    });
  }
}

function _rebindSubBlockBasic(block, container, pushStateFn) {
  const delBtn = block.querySelector('.card-sub-btn-del');
  if (delBtn) {
    const clone = delBtn.cloneNode(true);
    delBtn.parentNode.replaceChild(clone, delBtn);
    clone.addEventListener('click', e => {
      e.stopPropagation();
      block.remove();
      if (pushStateFn) pushStateFn();
    });
  }

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

  // 드래그/리사이즈 핸들은 card.js에서 가져옴
  import('./card.js').then(mod => {
    const dragHandle = block.querySelector('.card-sub-drag-handle');
    if (dragHandle) {
      const clone = dragHandle.cloneNode(true);
      dragHandle.parentNode.replaceChild(clone, dragHandle);
      clone.addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        if (mod._initSubDrag) mod._initSubDrag(block, container, e.clientX, e.clientY);
      });
      clone.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        e.stopPropagation(); e.preventDefault();
        if (mod._initSubDrag) mod._initSubDrag(block, container, e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: false });
    }

    const resizeHandle = block.querySelector('.card-sub-resize-handle');
    if (resizeHandle) {
      const clone = resizeHandle.cloneNode(true);
      resizeHandle.parentNode.replaceChild(clone, resizeHandle);
      clone.addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        if (mod._initSubResize) mod._initSubResize(block, container, e.clientX, e.clientY);
      });
      clone.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        e.stopPropagation(); e.preventDefault();
        if (mod._initSubResize) mod._initSubResize(block, container, e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: false });
    }
  });
}
