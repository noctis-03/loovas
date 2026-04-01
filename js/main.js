// ═══════════════════════════════════════════════════
//  main.js — 애플리케이션 진입점
//
//  UPDATE: history 모듈 초기화 추가
//  UPDATE: undo/redo 액션 버튼 연결
//  UPDATE: toolOrb 모듈 추가
// ═══════════════════════════════════════════════════

import { resetView, toggleGrid } from './transform.js';
import { initLayout } from './layout.js';
import { setTool, setToolOrPanel, setColor, setStroke } from './tools.js';
import { initPenPanel } from './penPanel.js';
import { initMouseEvents } from './mouse.js';
import { initTouchEvents } from './touch.js';
import { initKeyboard } from './keyboard.js';
import { initContextMenu } from './contextMenu.js';
import { initImageInput } from './image.js';
import { initPersistence, saveBoard, clearAll, autoSave, persistence } from './persistence.js';
import { addSticky } from './sticky.js';
import { addCardWindow } from './card.js';
import { createStartupWindow } from './startup.js';
import { mkSvg, setAttrs } from './svg.js';
import { initToolbar } from './toolbar.js';
import { initHistory, undo, redo } from './history.js';
import { initToolOrb } from './toolOrb.js';  // ← NEW

persistence._svg = { mkSvg, setAttrs };

function init() {
  initLayout();
  initPenPanel();
  initMouseEvents();
  initTouchEvents();
  initKeyboard();
  initContextMenu();
  initImageInput();
  initPersistence();
  initToolbar();
  initToolOrb();   // ← NEW

  // 줌 리셋
  document.getElementById('zoom-pill').addEventListener('click', resetView);

  // 도구 선택 버튼
  document.querySelectorAll('#toolbar [data-tool]').forEach(btn => {
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
  document.querySelectorAll('#color-bar .cdot').forEach(el => {
    el.addEventListener('click', () => setColor(el));
  });

  // 선 굵기 선택
  document.querySelectorAll('#color-bar .sbtn').forEach(el => {
    el.addEventListener('click', () => setStroke(el, parseInt(el.dataset.sw)));
  });

  autoSave();
  createStartupWindow();

  // ── 히스토리 초기화 (초기 상태 기록) ──
  setTimeout(() => initHistory(), 100);

  console.log('∞ Canvas 0.01 — Modular loaded');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
