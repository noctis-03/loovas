// ═══════════════════════════════════════════════════
//  selection.js — 선택, 올가미, 드래그, 리사이즈
//
//  FIX 1: Shift/Ctrl 클릭 다중 선택 토글 동작 수정
//  FIX 2: 올가미 선택 후 마우스를 놓으면 선택이 유지되지 않던 문제 수정
//         - finalizeLasso에서 deselectAll() 호출 순서 조정
//         - lasso-hover 제거 후 select 호출 보장
//         - 선택된 요소의 handles display 확실히 block으로 설정
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { b2s, s2b } from './transform.js';
import { updateMinimap } from './layout.js';

export function select(el, additive = false) {
  if (!additive) {
    deselectAll();
  }

  // additive 모드에서 이미 선택된 요소 → 토글(선택 해제)
  const idx = S.selectedEls.indexOf(el);
  if (idx !== -1) {
    if (additive) {
      S.selectedEls.splice(idx, 1);
      el.classList.remove('selected');
      const handles = el.querySelector('.el-handles');
      if (handles) handles.style.display = 'none';
      S.setSelected(S.selectedEls.length > 0 ? S.selectedEls[S.selectedEls.length - 1] : null);
    }
    return;
  }

  S.pushSelectedEl(el);
  S.setSelected(el);
  el.classList.add('selected');
  const handles = el.querySelector('.el-handles');
  if (handles) handles.style.display = 'block';
}

export function deselectAll() {
  S.selectedEls.forEach(el => {
    el.classList.remove('selected');
    const handles = el.querySelector('.el-handles');
    if (handles) handles.style.display = 'none';
  });
  S.setSelectedEls([]);
  S.setSelected(null);
}

export function showSelRect(l) {
  const x = Math.min(l.x0, l.x1), y = Math.min(l.y0, l.y1);
  const w = Math.abs(l.x1 - l.x0), h = Math.abs(l.y1 - l.y0);
  S.selRect.style.cssText = `display:block;left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
}

export function hideSelRect() { S.selRect.style.display = 'none'; }

export function highlightLasso(l) {
  const sx = Math.min(l.x0, l.x1), sy = Math.min(l.y0, l.y1);
  const ex = Math.max(l.x0, l.x1), ey = Math.max(l.y0, l.y1);
  S.board.querySelectorAll('.el').forEach(el => {
    const bx = parseFloat(el.style.left), by = parseFloat(el.style.top);
    const bw = parseFloat(el.style.width), bh = parseFloat(el.style.height);
    const s2 = b2s(bx, by), se = b2s(bx + bw, by + bh);
    const inside = se.x > sx && s2.x < ex && se.y > sy && s2.y < ey;
    el.classList.toggle('lasso-hover', inside);
  });
}

export function finalizeLasso(l) {
  const sx = Math.min(l.x0, l.x1), sy = Math.min(l.y0, l.y1);
  const ex = Math.max(l.x0, l.x1), ey = Math.max(l.y0, l.y1);

  // 먼저 모든 lasso-hover 클래스 제거
  clearLassoHover();

  // 기존 선택 초기화
  deselectAll();

  // 올가미 범위가 너무 작으면 선택하지 않음 (단순 클릭으로 간주)
  if (Math.abs(ex - sx) < 5 && Math.abs(ey - sy) < 5) return;

  // 올가미 범위 내 요소들을 수집
  const toSelect = [];
  S.board.querySelectorAll('.el').forEach(el => {
    const bx = parseFloat(el.style.left), by = parseFloat(el.style.top);
    const bw = parseFloat(el.style.width), bh = parseFloat(el.style.height);
    const s2 = b2s(bx, by), se = b2s(bx + bw, by + bh);
    if (se.x > sx && s2.x < ex && se.y > sy && s2.y < ey) {
      toSelect.push(el);
    }
  });

  // 수집된 요소들을 한번에 선택
  toSelect.forEach(el => {
    S.pushSelectedEl(el);
    el.classList.add('selected');
    const handles = el.querySelector('.el-handles');
    if (handles) handles.style.display = 'block';
  });

  // selected 변수 갱신
  if (toSelect.length > 0) {
    S.setSelected(toSelect[toSelect.length - 1]);
  }
}

export function clearLassoHover() {
  S.board.querySelectorAll('.lasso-hover').forEach(el => el.classList.remove('lasso-hover'));
}

export function doResize(cx, cy) {
  const r = S.resizing;
  if (!r) return;
  const { el, dir, r0, m0 } = r;
  const curB = s2b(cx, cy);
  const dx = curB.x - m0.x, dy = curB.y - m0.y;
  let { x, y, w, h } = r0;
  const MW = 60, MH = 40;
  if (dir.includes('e')) { w = Math.max(MW, r0.w + dx); }
  if (dir.includes('s')) { h = Math.max(MH, r0.h + dy); }
  if (dir.includes('w')) { const nw = Math.max(MW, r0.w - dx); x = r0.x + r0.w - nw; w = nw; }
  if (dir.includes('n')) { const nh = Math.max(MH, r0.h - dy); y = r0.y + r0.h - nh; h = nh; }
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.width = w + 'px'; el.style.height = h + 'px';
}
