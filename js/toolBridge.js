// ═══════════════════════════════════════════════════
//  toolBridge.js — tools.js ↔ toolOrb.js 순환 참조 해결용 브릿지
//
//  tools.js와 toolOrb.js가 서로 직접 import하면 순환 참조가 발생.
//  이 파일을 통해 간접 호출하여 순환을 끊는다.
// ═══════════════════════════════════════════════════

// ── toolOrb → tools 방향 콜백 ──
let _setToolFn = null;
let _activatePendingFn = null;
let _revertToPanFn = null;

export function registerToolFunctions(setTool, activatePending, revertToPan) {
  _setToolFn = setTool;
  _activatePendingFn = activatePending;
  _revertToPanFn = revertToPan;
}

export function bridgeSetTool(t) {
  if (_setToolFn) _setToolFn(t);
}

export function bridgeActivatePending() {
  if (_activatePendingFn) return _activatePendingFn();
  return false;
}

export function bridgeRevertToPan() {
  if (_revertToPanFn) _revertToPanFn();
}

// ── tools → toolOrb 방향 콜백 ──
let _notifyToolChangedFn = null;

export function registerNotifyToolChanged(fn) {
  _notifyToolChangedFn = fn;
}

export function bridgeNotifyToolChanged(t) {
  if (_notifyToolChangedFn) _notifyToolChangedFn(t);
}
