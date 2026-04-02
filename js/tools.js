// ═══════════════════════════════════════════════════
//  tools.js — 도구, 색상, 선 굵기 전환
//
//  FIX: toolOrb.js 직접 import 제거 → toolBridge.js 사용
// ═══════════════════════════════════════════════════

import { tool, pendingTool, setToolState, setColorState, setSwState, setPendingTool } from './state.js';
import { deselectAll } from './selection.js';
import { closeCtx } from './contextMenu.js';
import { closePenPanel, togglePenPanel } from './penPanel.js';
import { showColorBar, hideColorBar, isDrawTool } from './toolbar.js';
import { bridgeNotifyToolChanged } from './toolBridge.js';

const DIRECT_TOOLS = new Set(['pan', 'select', 'edit']);

const isTouch = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

function applyInternal(t) {
  setToolState(t);
  document.body.setAttribute('data-tool', t);
}

function applyVisual(t) {
  // toolbar + mode-bar 전체 tbtn 초기화
  document.querySelectorAll('.tbtn[id^="t-"]').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('t-' + t);
  if (btn) btn.classList.add('active');
}

export function setTool(t) {
  const prev = tool;

  if (isTouch() && !DIRECT_TOOLS.has(t)) {
    setPendingTool(t);
    applyVisual(t);
    applyInternal('pan');
    bridgeNotifyToolChanged(t);
    closeCtx();
    closePenPanel();
    if (isDrawTool(t)) showColorBar(); else hideColorBar();
    return;
  }

  setPendingTool(null);
  applyInternal(t);
  applyVisual(t);
  bridgeNotifyToolChanged(t);

  if (t !== 'select' && t !== 'edit') deselectAll();

  if (prev === 'edit' && t !== 'edit') {
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      active.blur();
    }
  }

  closeCtx();
  closePenPanel();
  if (isDrawTool(t)) showColorBar(); else hideColorBar();
}

export function activatePending() {
  if (!pendingTool) return false;
  applyInternal(pendingTool);
  if (pendingTool !== 'select' && pendingTool !== 'edit') deselectAll();
  closeCtx();
  closePenPanel();
  if (isDrawTool(pendingTool)) showColorBar(); else hideColorBar();
  return true;
}

export function revertToPan() {
  if (!pendingTool) return;
  applyInternal('pan');
}

export function setToolOrPanel(t) {
  if (isTouch() && pendingTool === t) {
    togglePenPanel(t);
    return;
  }
  if (tool === t) {
    togglePenPanel(t);
  } else {
    setTool(t);
  }
}

export function setColor(el) {
  document.querySelectorAll('#color-tray .cdot').forEach(d => d.classList.remove('active'));
  el.classList.add('active');
  setColorState(el.dataset.c);
}

export function setStroke(el, v) {
  document.querySelectorAll('#color-tray .sbtn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  setSwState(v);
}
