// ═══════════════════════════════════════════════════
//  keyboard.js — 키보드 단축키
//
//  UPDATE: Ctrl+Z → undo, Ctrl+Shift+Z / Ctrl+Y → redo
//          Delete/Backspace 삭제 후 pushState()
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { setTool } from './tools.js';
import { toggleGrid } from './transform.js';
import { addSticky } from './sticky.js';
import { addCardWindow } from './card.js';
import { saveBoard } from './persistence.js';
import { updateMinimap } from './layout.js';
import { undo, redo, pushState } from './history.js';

export function initKeyboard() {
  window.addEventListener('keydown', e => {
    // 입력 중이면 무시
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 's') { e.preventDefault(); saveBoard(); return; }
      if (e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); return; }
      if (e.key === 'z') { e.preventDefault(); undo(); return; }
      if (e.key === 'y') { e.preventDefault(); redo(); return; }
    }

    const keyMap = {
      'v': () => setTool('select'),
      'd': () => setTool('edit'),
      'h': () => setTool('pan'),
      'p': () => setTool('pen'),
      'l': () => setTool('highlight'),
      'e': () => setTool('eraser'),
      's': () => addSticky(),
      'w': () => addCardWindow(),
      't': () => setTool('text'),
      'r': () => setTool('rect'),
      'c': () => setTool('circle'),
      'a': () => setTool('arrow'),
      'g': () => toggleGrid(),
    };

    const fn = keyMap[e.key.toLowerCase()];
    if (fn) { e.preventDefault(); fn(); }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (S.selectedEls.length > 0) {
        e.preventDefault();
        S.selectedEls.forEach(el => el.remove());
        S.setSelectedEls([]); S.setSelected(null);
        updateMinimap();
        pushState();
      }
    }

    // Space → Pan
    if (e.key === ' ' && !e.repeat) {
      e.preventDefault();
      setTool('pan');
    }
  });

  window.addEventListener('keyup', e => {
    if (e.key === ' ') {
      setTool('select');
    }
  });
}
