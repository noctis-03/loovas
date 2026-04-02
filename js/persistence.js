// ═══════════════════════════════════════════════════
//  persistence.js — 저장, 불러오기, 자동 저장
//
//  ★ MODIFIED: 저장 UI 다이얼로그 추가
//  ★ MODIFIED: 오버레이 레이어 스트로크 복원 지원
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { snack } from './utils.js';
import { updateMinimap } from './layout.js';
import { addRecentFile } from './startup.js';
import { clearHistory } from './history.js';
import { addHandles, attachSelectClick } from './elements.js';
import { applyT } from './transform.js';

// ★ NEW: 마지막 저장 파일명 기억
let lastSavedFilename = null;

function buildSaveData() {
  const data = {
    version: '0.01',
    strokes: S.getStrokes().map(s => ({ kind: s.kind, attrs: { ...s.attrs }, overlay: !!s.overlay })), // ★ overlay 플래그 저장
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

// ★ MODIFIED: 저장 UI 다이얼로그 표시
export function saveBoard() {
  showSaveDialog();
}

function showSaveDialog() {
  const overlay = document.getElementById('save-overlay');
  const filenameInput = document.getElementById('save-filename');

  const defaultName = `canvas-${new Date().toISOString().slice(0, 10)}`;
  filenameInput.value = lastSavedFilename ? lastSavedFilename.replace(/\.json$/, '') : defaultName;

  overlay.style.display = 'flex';
  requestAnimationFrame(() => overlay.classList.add('open'));
  filenameInput.focus();
  filenameInput.select();
}

function closeSaveDialog() {
  const overlay = document.getElementById('save-overlay');
  overlay.classList.remove('open');
  setTimeout(() => { overlay.style.display = 'none'; }, 260);
}

function doSave(filename) {
  const data = buildSaveData();
  if (!filename.endsWith('.json')) filename += '.json';

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);

  lastSavedFilename = filename;
  snack('저장 완료');
  addRecentFile(filename, data);

  try { localStorage.setItem('canvas-autosave', JSON.stringify(data)); } catch (e) {}
  closeSaveDialog();
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
  // SVG 초기화 (두 레이어 모두)
  while (S.svgl.firstChild) S.svgl.removeChild(S.svgl.firstChild);
  if (S.svgOverlay) { while (S.svgOverlay.firstChild) S.svgOverlay.removeChild(S.svgOverlay.firstChild); } // ★ NEW
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

      // ★ NEW: overlay 플래그에 따라 적절한 레이어에 추가
      const targetLayer = (s.overlay && S.svgOverlay) ? S.svgOverlay : S.svgl;
      targetLayer.appendChild(el);
      S.pushStroke({ kind: s.kind, attrs: s.attrs, svgEl: el, overlay: !!s.overlay });
    });
  }

  // ★ FIX: DOM 요소 복원 + 이벤트 재바인딩
  if (data.elements) {
    data.elements.forEach(elData => {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = elData.html;
      const el = wrapper.firstElementChild;
      if (!el) return;

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

      _rebindInternalEvents(el);
    });
  }

  // Transform 복원
  if (data.T) { S.T.x = data.T.x; S.T.y = data.T.y; S.T.s = data.T.s; applyT(); }

  updateMinimap();
}

function _rebindInternalEvents(el) {
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

// SVG 모듈 주입 인터페이스
let _svgModule = null;
function _getSvgModule() {
  if (_svgModule) return _svgModule;
  return persistence._svg;
}
export const persistence = { _svg: null };

export function clearAll() {
  if (!confirm('모든 내용을 지우시겠습니까?')) return;
  while (S.svgl.firstChild) S.svgl.removeChild(S.svgl.firstChild);
  if (S.svgOverlay) { while (S.svgOverlay.firstChild) S.svgOverlay.removeChild(S.svgOverlay.firstChild); } // ★ NEW
  S.setStrokes([]);
  S.board.querySelectorAll('.el').forEach(el => el.remove());
  try { localStorage.removeItem('canvas-autosave'); } catch (e) {}
  updateMinimap();
  snack('전체 삭제 완료');
  clearHistory();
}

export function autoSave() {
  setInterval(() => {
    try {
      const data = buildSaveData();
      localStorage.setItem('canvas-autosave', JSON.stringify(data));
    } catch (e) {}
  }, 30000);
}

// ★ MODIFIED: 저장 다이얼로그 이벤트 바인딩 추가
export function initPersistence() {
  document.getElementById('load-in').addEventListener('change', loadBoard);

  // 저장 다이얼로그 버튼들
  document.getElementById('save-cancel-btn').addEventListener('click', closeSaveDialog);

  document.getElementById('save-quick-btn').addEventListener('click', () => {
    const name = lastSavedFilename || `canvas-${new Date().toISOString().slice(0, 10)}.json`;
    doSave(name);
  });

  document.getElementById('save-as-btn').addEventListener('click', () => {
    const name = document.getElementById('save-filename').value.trim();
    if (!name) return;
    doSave(name);
  });

  // Overlay 바깥 클릭 시 닫기
  document.getElementById('save-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'save-overlay') closeSaveDialog();
  });

  // Enter 키로 저장
  document.getElementById('save-filename').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const name = e.target.value.trim();
      if (name) doSave(name);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSaveDialog();
    }
  });
}
