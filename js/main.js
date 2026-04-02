// ═══════════════════════════════════════════════════
//  main.js — 애플리케이션 진입점 (새 사이드바 레이아웃)
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
  initDomRefs();

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

  requestAnimationFrame(() => updateSatellitePositions());
  initToolOrb();

  // 줌 리셋
  document.getElementById('zoom-pill').addEventListener('click', resetView);

  // ── 사이드바 툴 버튼 이벤트 ──
  // data-tool 버튼 (left-sidebar)
  document.querySelectorAll('#left-sidebar [data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  // 레거시 (hidden) toolbar/mode-bar도 유지
  document.querySelectorAll('#toolbar [data-tool], #mode-bar [data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  // data-tool-or-panel 버튼 (펜/형광펜/지우개)
  document.querySelectorAll('#left-sidebar [data-tool-or-panel]').forEach(btn => {
    btn.addEventListener('click', () => setToolOrPanel(btn.dataset.toolOrPanel));
  });
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

  // 색상 선택 (새 color-tray)
  document.querySelectorAll('#color-tray .cdot').forEach(el => {
    el.addEventListener('click', () => setColor(el));
  });

  // 선 굵기 선택 (새 sw-btn)
  document.querySelectorAll('#color-tray .sw-btn').forEach(el => {
    el.addEventListener('click', () => setStroke(el, parseInt(el.dataset.sw)));
  });

  autoSave();

  // 자동저장 복원
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

  setTimeout(() => initHistory(), 100);

  console.log('∞ Canvas — New Sidebar Layout loaded');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
