// ═══════════════════════════════════════════════════
//  persistence.js — 저장, 불러오기, 자동 저장
//
//  FIX: restoreBoard에서 DOM 요소 복원 후 핸들/이벤트 재바인딩
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { snack } from './utils.js';
import { updateMinimap } from './layout.js';
import { addRecentFile } from './startup.js';
import { clearHistory } from './history.js';
import { addHandles, attachSelectClick } from './elements.js';
import { applyT } from './transform.js';

function buildSaveData() {
  const data = {
    version: '0.01',
    strokes: S.getStrokes().map(s => ({ kind: s.kind, attrs: { ...s.attrs } })),
    elements: [],
    T: { ...S.T }
  };

  S.board.querySelectorAll('.el').forEach(el => {
    data.elements.push({
      html: el.outerHTML,
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      w: parseFloat(el.style.width),
      h: parseFloat(el.style.height),
      z: parseInt(el.style.zIndex) || 10
    });
  });

  return data;
}

export function saveBoard() {
  const data = buildSaveData();
  const filename = `canvas-${new Date().toISOString().slice(0, 10)}.json`;

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  snack('저장 완료');

  addRecentFile(filename, data);

  try { localStorage.setItem('canvas-autosave', JSON.stringify(data)); } catch (e) { /* ignore */ }
}

export function loadBoard(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      restoreBoard(data);
      snack('불러오기 완료');
      addRecentFile(file.name, data);
      clearHistory();
    } catch (err) {
      snack('파일 오류');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

export function restoreBoard(data) {
  // SVG 초기화
  while (S.svgl.firstChild) S.svgl.removeChild(S.svgl.firstChild);
  S.setStrokes([]);

  // 요소 초기화
  S.board.querySelectorAll('.el').forEach(el => el.remove());

  // 스트로크 복원
  if (data.strokes) {
    const { mkSvg, setAttrs } = _getSvgModule();
    data.strokes.forEach(s => {
      let el;
      if (s.kind === 'rect') { el = mkSvg('rect'); }
      else if (s.kind === 'ellipse') { el = mkSvg('ellipse'); }
      else if (s.kind === 'arrow') {
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
      }
      else { el = mkSvg('path'); }

      if (s.kind !== 'arrow') {
        setAttrs(el, s.attrs);
      }
      S.svgl.appendChild(el);
      S.pushStroke({ kind: s.kind, attrs: s.attrs, svgEl: el });
    });
  }

  // ★ FIX: DOM 요소 복원 + 이벤트 재바인딩
  if (data.elements) {
    data.elements.forEach(elData => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = elData.html;
      const el = wrapper.firstElementChild;
      if (!el) return;

      // 기존 핸들 제거
      const oldHandles = el.querySelector('.el-handles');
      if (oldHandles) oldHandles.remove();

      el.style.left = elData.x + 'px';
      el.style.top = elData.y + 'px';
      el.style.width = elData.w + 'px';
      el.style.height = elData.h + 'px';
      el.style.zIndex = elData.z;
      el.classList.remove('selected');

      S.board.appendChild(el);
      addHandles(el);
      attachSelectClick(el);

      // 포스트잇/카드 내부 이벤트 재바인딩
      _rebindInternalEvents(el);
    });
  }

  // Transform 복원
  if (data.T) { S.T.x = data.T.x; S.T.y = data.T.y; S.T.s = data.T.s; applyT(); }

  updateMinimap();
}

// ★ FIX: 내부 이벤트 재바인딩 (포스트잇, 카드)
function _rebindInternalEvents(el) {
  // 포스트잇
  const stickyBody = el.querySelector('.sticky-body');
  if (stickyBody) {
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
        });
      }
    });

    const ta = stickyBody.querySelector('textarea');
    if (ta) {
      ta.addEventListener('focus', () => { el.style.zIndex = S.nextZ(); });
    }
  }

  // 카드
  const cardBody = el.querySelector('.card-body');
  if (cardBody) {
    const closeBtn = cardBody.querySelector('.card-close-btn');
    if (closeBtn) {
      const clone = closeBtn.cloneNode(true);
      closeBtn.parentNode.replaceChild(clone, closeBtn);
      clone.addEventListener('click', e => {
        e.stopPropagation();
        el.remove();
        updateMinimap();
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
        _rebindSubBlock(block, subContainer);
      });
    }
  }
}

function _rebindSubBlock(block, container) {
  const delBtn = block.querySelector('.card-sub-btn-del');
  if (delBtn) {
    const clone = delBtn.cloneNode(true);
    delBtn.parentNode.replaceChild(clone, delBtn);
    clone.addEventListener('click', e => { e.stopPropagation(); block.remove(); });
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

// SVG 모듈 주입 인터페이스 (순환 참조 방지)
let _svgModule = null;
function _getSvgModule() {
  if (_svgModule) return _svgModule;
  return persistence._svg;
}
export const persistence = { _svg: null };

export function clearAll() {
  if (!confirm('모든 내용을 지우시겠습니까?')) return;
  while (S.svgl.firstChild) S.svgl.removeChild(S.svgl.firstChild);
  S.setStrokes([]);
  S.board.querySelectorAll('.el').forEach(el => el.remove());
  try { localStorage.removeItem('canvas-autosave'); } catch (e) { /* ignore */ }
  updateMinimap();
  snack('전체 삭제 완료');
  clearHistory();
}

export function autoSave() {
  setInterval(() => {
    try {
      const data = buildSaveData();
      localStorage.setItem('canvas-autosave', JSON.stringify(data));
    } catch (e) { /* ignore */ }
  }, 30000);
}

export function initPersistence() {
  document.getElementById('load-in').addEventListener('change', loadBoard);
}
