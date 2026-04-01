// ═══════════════════════════════════════════════════
//  contextMenu.js — 우클릭/롱프레스 컨텍스트 메뉴
//
//  FIX: HTML의 data-action 이름과 JS 매칭 수정
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { duplicateEl } from './elements.js';
import { updateMinimap } from './layout.js';
import { pushState } from './history.js';

export function showCtxMenu(el, cx, cy) {
  S.setCtxEl(el);
  const m = document.getElementById('ctx');
  const mw = 150, mh = 160;
  let lx = cx, ly = cy;
  if (lx + mw > innerWidth) lx = innerWidth - mw - 8;
  if (ly + mh > innerHeight) ly = cy - mh - 8;
  if (lx < 4) lx = 4;
  if (ly < 4) ly = 4;
  m.style.left = lx + 'px'; m.style.top = ly + 'px'; m.style.display = 'block';
}

export function closeCtx() { document.getElementById('ctx').style.display = 'none'; }

export function ctxDo(a) {
  if (!S.ctxEl) return;
  closeCtx();
  if (a === 'del') {
    const targets = S.selectedEls.length > 0 ? [...S.selectedEls] : [S.ctxEl];
    targets.forEach(e => e.remove());
    S.setSelectedEls([]); S.setSelected(null); updateMinimap();
    pushState();
  }
  if (a === 'dup') { duplicateEl(S.ctxEl); pushState(); }
  if (a === 'front') { S.ctxEl.style.zIndex = S.nextZ(); pushState(); }
  if (a === 'back') { S.ctxEl.style.zIndex = 1; pushState(); }
}

export function startLongPress(target, cx, cy) {
  S.setLongPressTimer(setTimeout(() => {
    const el = target.closest('.el');
    if (el) showCtxMenu(el, cx, cy);
  }, 500));
}

export function cancelLongPress() {
  clearTimeout(S.longPressTimer);
  S.setLongPressTimer(null);
}

export function initContextMenu() {
  S.vp.addEventListener('contextmenu', e => {
    e.preventDefault();
    const el = e.target.closest('.el');
    if (el) showCtxMenu(el, e.clientX, e.clientY);
  });
  document.addEventListener('click', () => closeCtx());

  // ★ FIX: HTML에서 data-action을 사용하므로 .citem[data-action] 으로 선택
  document.querySelectorAll('#ctx .citem[data-action]').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      ctxDo(item.dataset.action);
    });
  });
}
