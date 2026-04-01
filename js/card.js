// ═══════════════════════════════════════════════════
//  card.js — 카드 윈도우 & 서브블록
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { s2b } from './transform.js';
import { makeEl, addHandles, attachSelectClick } from './elements.js';
import { onTap } from './utils.js';
import { updateMinimap } from './layout.js';
import { pushState } from './history.js';

// ── 그리드 스냅 설정 ──
const GRID  = 20;
const MIN_W = 80;
const MIN_H = 50;

function snap(v) {
  return Math.round(v / GRID) * GRID;
}

function clampSnap(val, max) {
  return snap(Math.max(0, Math.min(val, max)));
}

// ═══════════════════════════════════════════════════
//  서브블록 생성
// ═══════════════════════════════════════════════════
function createSubBlock(container, x = 10, y = 10) {
  const initW = snap(160);
  const initH = snap(100);
  const sx = snap(x);
  const sy = snap(y);

  const block = document.createElement('div');
  block.className = 'card-sub-block';
  block.style.cssText = `left:${sx}px;top:${sy}px;width:${initW}px;height:${initH}px;`;

  const header = document.createElement('div');
  header.className = 'card-sub-header';

  const dragHandle = document.createElement('div');
  dragHandle.className = 'card-sub-drag-handle';
  dragHandle.textContent = '⠿';

  const title = document.createElement('div');
  title.className = 'card-sub-title';
  title.contentEditable = 'true';
  title.dataset.placeholder = '제목';

  const actions = document.createElement('div');
  actions.className = 'card-sub-actions';

  const dirBtn = document.createElement('button');
  dirBtn.className = 'card-sub-btn';
  dirBtn.textContent = '⇄';
  onTap(dirBtn, () => {
    const cur = block.dataset.dir || 'vertical';
    block.dataset.dir = cur === 'vertical' ? 'horizontal' : 'vertical';
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'card-sub-btn card-sub-btn-del';
  delBtn.textContent = '✕';
  onTap(delBtn, () => { block.remove(); pushState(); });

  actions.appendChild(dirBtn);
  actions.appendChild(delBtn);
  header.appendChild(dragHandle);
  header.appendChild(title);
  header.appendChild(actions);

  const content = document.createElement('div');
  content.className = 'card-sub-content';
  content.contentEditable = 'true';
  content.dataset.placeholder = '내용을 입력하세요...';

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'card-sub-resize-handle';

  // Sub-block resize
  resizeHandle.addEventListener('mousedown', e => {
    e.stopPropagation(); e.preventDefault();
    initSubResize(block, container, e.clientX, e.clientY);
  });
  resizeHandle.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    e.stopPropagation(); e.preventDefault();
    initSubResize(block, container, e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  // Sub-block drag
  dragHandle.addEventListener('mousedown', e => {
    e.stopPropagation(); e.preventDefault();
    initSubDrag(block, container, e.clientX, e.clientY);
  });
  dragHandle.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    e.stopPropagation(); e.preventDefault();
    initSubDrag(block, container, e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  block.appendChild(header);
  block.appendChild(content);
  block.appendChild(resizeHandle);
  container.appendChild(block);

  pushState();
}

export { createSubBlock as _createSubBlock };

// ═══════════════════════════════════════════════════
//  서브블록 리사이즈
// ═══════════════════════════════════════════════════
function initSubResize(block, container, startX, startY) {
  const w0 = block.offsetWidth, h0 = block.offsetHeight;
  block.classList.add('card-sub-resizing');

  function onMove(cx, cy) {
    const rawW = Math.max(MIN_W, w0 + (cx - startX));
    const rawH = Math.max(MIN_H, h0 + (cy - startY));
    block.style.width  = rawW + 'px';
    block.style.height = rawH + 'px';
  }

  function onEnd() {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const bx = block.offsetLeft;
    const by = block.offsetTop;

    let finalW = snap(Math.max(MIN_W, block.offsetWidth));
    let finalH = snap(Math.max(MIN_H, block.offsetHeight));

    if (bx + finalW > cw) finalW = snap(Math.max(MIN_W, cw - bx));
    if (by + finalH > ch) finalH = snap(Math.max(MIN_H, ch - by));

    block.style.width  = finalW + 'px';
    block.style.height = finalH + 'px';

    block.classList.remove('card-sub-resizing');
    window.removeEventListener('mousemove', mm);
    window.removeEventListener('mouseup', mu);
    window.removeEventListener('touchmove', tm);
    window.removeEventListener('touchend', te);
    pushState();
  }

  const mm = e => onMove(e.clientX, e.clientY);
  const mu = () => onEnd();
  const tm = e => { if (e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY); };
  const te = () => onEnd();
  window.addEventListener('mousemove', mm);
  window.addEventListener('mouseup', mu);
  window.addEventListener('touchmove', tm, { passive: false });
  window.addEventListener('touchend', te);
}

// ═══════════════════════════════════════════════════
//  서브블록 드래그
// ═══════════════════════════════════════════════════
function initSubDrag(block, container, startX, startY) {
  const ox = block.offsetLeft, oy = block.offsetTop;
  block.classList.add('card-sub-dragging');

  function onMove(cx, cy) {
    block.style.left = (ox + (cx - startX)) + 'px';
    block.style.top  = (oy + (cy - startY)) + 'px';
  }

  function onEnd() {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const bw = block.offsetWidth;
    const bh = block.offsetHeight;

    let finalX = snap(block.offsetLeft);
    let finalY = snap(block.offsetTop);

    finalX = clampSnap(finalX, Math.max(0, cw - bw));
    finalY = clampSnap(finalY, Math.max(0, ch - bh));

    block.style.left = finalX + 'px';
    block.style.top  = finalY + 'px';

    block.classList.remove('card-sub-dragging');
    window.removeEventListener('mousemove', mm);
    window.removeEventListener('mouseup', mu);
    window.removeEventListener('touchmove', tm);
    window.removeEventListener('touchend', te);
    pushState();
  }

  const mm = e => onMove(e.clientX, e.clientY);
  const mu = () => onEnd();
  const tm = e => { if (e.touches.length === 1) onMove(e.touches[0].clientX, e.touches[0].clientY); };
  const te = () => onEnd();
  window.addEventListener('mousemove', mm);
  window.addEventListener('mouseup', mu);
  window.addEventListener('touchmove', tm, { passive: false });
  window.addEventListener('touchend', te);
}

// ═══════════════════════════════════════════════════
//  서브블록 드래그/리사이즈 (외부 복원용 export)
// ═══════════════════════════════════════════════════
export { initSubDrag as _initSubDrag, initSubResize as _initSubResize };

// ═══════════════════════════════════════════════════
//  카드 윈도우 생성
// ═══════════════════════════════════════════════════
export function addCardWindow() {
  const vr = S.vp.getBoundingClientRect();
  const bp = s2b(vr.left + vr.width / 2, vr.top + vr.height / 2);
  const el = makeEl(bp.x - 150, bp.y - 120, 300, 340);

  const body = document.createElement('div');
  body.className = 'el-body card-body';

  const header = document.createElement('div');
  header.className = 'card-header';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.contentEditable = 'true';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'card-close-btn';
  closeBtn.textContent = '✕';
  onTap(closeBtn, () => { el.remove(); updateMinimap(); pushState(); });

  header.appendChild(title);
  header.appendChild(closeBtn);

  const content = document.createElement('div');
  content.className = 'card-content';
  content.contentEditable = 'true';
  content.dataset.placeholder = '본문을 입력하세요...';

  const subContainer = document.createElement('div');
  subContainer.className = 'card-sub-container';

  const addBlockBtn = document.createElement('button');
  addBlockBtn.className = 'card-add-block-btn';
  addBlockBtn.textContent = '+ 블록 추가';
  onTap(addBlockBtn, () => createSubBlock(subContainer));

  body.appendChild(header);
  body.appendChild(content);
  body.appendChild(subContainer);
  body.appendChild(addBlockBtn);
  el.appendChild(body);
  addHandles(el);
  attachSelectClick(el);
  S.board.appendChild(el);
  updateMinimap();
  pushState();
}
