// ═══════════════════════════════════════════════════
//  edit.js — 편집 도구
//
//  편집(Edit) 도구 선택 시 요소를 클릭하면
//  해당 요소 내 편집 가능한 영역(textarea, contentEditable)에
//  즉시 포커스를 맞추어 텍스트를 편집할 수 있게 한다.
//
//  - 포스트잇: textarea에 포커스
//  - 카드 창: 클릭 위치에 가장 가까운 contentEditable 영역에 포커스
//  - 텍스트 블록: .text-body contentEditable에 포커스
//  - 이미지 등 편집 불가 요소: 아무 동작 없음
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { snack } from './utils.js';

/**
 * 요소(el) 내에서 편집 가능한 영역을 찾아 포커스한다.
 * @param {HTMLElement} elDiv - .el 컨테이너
 * @param {MouseEvent|TouchEvent} [evt] - 원본 이벤트 (클릭 위치 기반 포커스 판단)
 */
export function focusEditable(elDiv, evt) {
  // 이미 편집 가능한 요소를 직접 클릭한 경우 — 브라우저 기본 동작으로 충분
  if (evt && evt.target) {
    const t = evt.target;
    if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') {
      // z-index만 올려주고 나머지는 브라우저에게 맡김
      elDiv.style.zIndex = S.nextZ();
      return;
    }
  }

  // 요소 내 편집 가능 영역 후보 탐색 (우선순위 순)
  const candidates = [];

  // 1. 포스트잇 textarea
  const ta = elDiv.querySelector('.sticky-body textarea');
  if (ta) candidates.push(ta);

  // 2. 텍스트 블록
  const tb = elDiv.querySelector('.text-body');
  if (tb) candidates.push(tb);

  // 3. 카드: 제목 → 본문 → 서브블록 제목 → 서브블록 내용
  const cardTitle = elDiv.querySelector('.card-title');
  if (cardTitle) candidates.push(cardTitle);
  const cardContent = elDiv.querySelector('.card-content');
  if (cardContent) candidates.push(cardContent);
  elDiv.querySelectorAll('.card-sub-title').forEach(st => candidates.push(st));
  elDiv.querySelectorAll('.card-sub-content').forEach(sc => candidates.push(sc));

  if (candidates.length === 0) {
    // 편집 불가 요소 (이미지 등)
    return;
  }

  // 클릭 위치가 있으면 가장 가까운 후보를 찾아 포커스
  if (evt && typeof evt.clientX === 'number') {
    let best = candidates[0];
    let bestDist = Infinity;

    candidates.forEach(c => {
      const rect = c.getBoundingClientRect();
      // 후보 중심까지 거리
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.hypot(evt.clientX - cx, evt.clientY - cy);
      if (dist < bestDist) { bestDist = dist; best = c; }
    });

    elDiv.style.zIndex = S.nextZ();
    best.focus();

    // contentEditable인 경우 커서를 끝으로 이동
    if (best.isContentEditable) {
      placeCursorAtEnd(best);
    }
    return;
  }

  // 이벤트 없으면 첫 번째 후보에 포커스
  elDiv.style.zIndex = S.nextZ();
  candidates[0].focus();
  if (candidates[0].isContentEditable) {
    placeCursorAtEnd(candidates[0]);
  }
}

/**
 * contentEditable 요소의 커서를 맨 끝으로 이동
 */
function placeCursorAtEnd(el) {
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false); // 끝으로
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * 터치 이벤트에서 편집 포커스 처리
 * @param {HTMLElement} elDiv - .el 컨테이너
 * @param {Touch} touch - 터치 객체
 */
export function focusEditableTouch(elDiv, touch) {
  focusEditable(elDiv, { target: document.elementFromPoint(touch.clientX, touch.clientY), clientX: touch.clientX, clientY: touch.clientY });
}
