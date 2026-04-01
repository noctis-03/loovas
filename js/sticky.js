// ═══════════════════════════════════════════════════
//  sticky.js — 포스트잇 생성
//
//  UPDATE: 추가/삭제 후 pushState()
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { s2b } from './transform.js';
import { makeEl, addHandles, attachSelectClick } from './elements.js';
import { onTap } from './utils.js';
import { updateMinimap } from './layout.js';
import { pushState } from './history.js';

const STICKY_COLORS = ['#fef3c7', '#fce7f3', '#d1fae5', '#dbeafe', '#ede9fe', '#fee2e2', '#fef9c3'];

export function addSticky() {
  const vr = S.vp.getBoundingClientRect();
  const bp = s2b(vr.left + vr.width / 2, vr.top + vr.height / 2);

  let colorIdx = Math.floor(Math.random() * STICKY_COLORS.length);
  const bg = STICKY_COLORS[colorIdx];

  const el = makeEl(bp.x - 100, bp.y - 70, 200, 140);

  const body = document.createElement('div');
  body.className = 'el-body sticky-body';
  body.style.background = bg;

  const bar = document.createElement('div');
  bar.className = 'sticky-bar';

  const colorBtn = document.createElement('button');
  colorBtn.className = 'sticky-btn';
  colorBtn.textContent = '🎨';
  onTap(colorBtn, () => {
    colorIdx = (colorIdx + 1) % STICKY_COLORS.length;
    body.style.background = STICKY_COLORS[colorIdx];
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sticky-btn';
  closeBtn.textContent = '✕';
  onTap(closeBtn, () => { el.remove(); updateMinimap(); pushState(); });

  bar.appendChild(colorBtn);
  bar.appendChild(closeBtn);

  const ta = document.createElement('textarea');
  ta.placeholder = '메모를 입력하세요...';
  ta.addEventListener('focus', () => { el.style.zIndex = S.nextZ(); });

  body.appendChild(bar);
  body.appendChild(ta);
  el.appendChild(body);
  addHandles(el);
  attachSelectClick(el);
  S.board.appendChild(el);
  updateMinimap();
  pushState();
}
