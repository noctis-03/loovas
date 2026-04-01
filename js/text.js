// ═══════════════════════════════════════════════════
//  text.js — 텍스트 블록 생성
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { makeEl, addHandles, attachSelectClick } from './elements.js';
import { updateMinimap } from './layout.js';

export function addText(bp) {
  const el = makeEl(bp.x, bp.y, 200, 40);

  const body = document.createElement('div');
  body.className = 'el-body text-body';
  body.contentEditable = 'true';
  body.style.fontSize = Math.max(14, S.sw * 6) + 'px';
  body.style.color = S.color;

  body.addEventListener('focus', () => { el.style.zIndex = S.nextZ(); });

  el.appendChild(body);
  addHandles(el);
  attachSelectClick(el);
  S.board.appendChild(el);
  updateMinimap();

  // 즉시 포커스
  setTimeout(() => body.focus(), 50);
}
