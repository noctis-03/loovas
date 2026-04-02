// ═══════════════════════════════════════════════════
//  main.js — 애플리케이션 진입점
//
//  FIX: initDomRefs() 호출 추가
//  FIX: mode-bar 이벤트 바인딩 추가
//  FIX: toolBridge 등록
//  FIX: 자동저장 복원 기능 추가
// ═══════════════════════════════════════════════════

import { initDomRefs } from './state.js';
import { resetView, toggleGrid } from './transform.js';
import { initLayout } from './layout.js';
import { setTool, setToolOrPanel, setColor, setStroke, activatePending, revertToPan } from './tools.js';
import { initPenPanel } from './penPanel.js';
import { initMouseEvents } from './mouse.js';
import { initTouchEvents } from './touch.js';
import { initKeyboard } from './keyboard.js';
import { initContextMenu } from './contextMenu.js';
import { initImageInput } from './image.js';
import { initPersistence, saveBoard, clearAll, autoSave, persistence, restoreBoard } from './persistence.js';
import { addSticky } from './sticky.js';
import { addCardWindow } from './card.js';
import { createStartupWindow } from './startup.js';
import { mkSvg, setAttrs } from './svg.js';
import { initToolbar, updateSatellitePositions } from './toolbar.js';
import { initHistory, undo, redo } from './history.js';
import { initToolOrb, notifyToolChanged } from './toolOrb.js';
import { registerToolFunctions, registerNotifyToolChanged } from './toolBridge.js';

persistence._svg = { mkSvg, setAttrs };

function init() {
  // ★ FIX: DOM 참조 초기화를 가장 먼저 수행
  initDomRefs();

  // ★ FIX: toolBridge 콜백 등록 (순환 참조 해결)
  registerToolFunctions(setTool, activatePending, revertToPan);
  registerNotifyToolChanged(notifyToolChanged);

  initLayout();
  initPenPanel();
  initMouseEvents();
  initTouchEvents();
  initKeyboard();
  initContextMenu();
  initImageInput();
  initPersistence();
  initToolbar();
  // 위성 요소 초기 위치 (DOM 렌더 후)
  requestAnimationFrame(() => updateSatellitePositions());
  initToolOrb();

  // 줌 리셋
  document.getElementById('zoom-pill').addEventListener('click', resetView);

  // ★ FIX: mode-bar + toolbar 모두에서 도구 버튼 이벤트 등록
  document.querySelectorAll('#toolbar [data-tool], #mode-bar [data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  // 도구 또는 패널 토글 버튼
  document.querySelectorAll('#toolbar [data-tool-or-panel]').forEach(btn => {
    btn.addEventListener('click', () => setToolOrPanel(btn.dataset.toolOrPanel));
  });

  // 액션 버튼
  const actions = {
    addSticky:   () => addSticky(),
    addCard:     () => addCardWindow(),
    addImage:    () => document.getElementById('img-in').click(),
    toggleGrid:  () => toggleGrid(),
    save:        () => saveBoard(),
    load:        () => document.getElementById('load-in').click(),
    clearAll:    () => clearAll(),
    undo:        () => undo(),
    redo:        () => redo(),
  };
  document.querySelectorAll('[data-action]').forEach(btn => {
    const fn = actions[btn.dataset.action];
    if (fn) btn.addEventListener('click', fn);
  });

  // 색상 선택
  document.querySelectorAll('#color-tray .cdot').forEach(el => {
    el.addEventListener('click', () => setColor(el));
  });

  // 선 굵기 선택
  document.querySelectorAll('#color-tray .sbtn').forEach(el => {
    el.addEventListener('click', () => setStroke(el, parseInt(el.dataset.sw)));
  });

  autoSave();

  // ★ FIX: 자동저장 데이터가 있으면 복원 시도, 없으면 시작 윈도우 표시
  let hasAutosave = false;
  try {
    const saved = localStorage.getItem('canvas-autosave');
    if (saved) {
      const data = JSON.parse(saved);
      if ((data.elements && data.elements.length > 0) || (data.strokes && data.strokes.length > 0)) {
        restoreBoard(data);
        hasAutosave = true;
      }
    }
  } catch (e) { /* ignore */ }

  if (!hasAutosave) {
    createStartupWindow();
  }

  // ── 히스토리 초기화 (초기 상태 기록) ──
  setTimeout(() => initHistory(), 100);

  console.log('∞ Canvas 0.01 — Modular loaded');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
