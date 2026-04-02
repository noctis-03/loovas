// ═══════════════════════════════════════════════════
//  state.js — 전역 상태 & DOM 참조
//
//  ★ MODIFIED: svgOverlay 추가
// ═══════════════════════════════════════════════════

// DOM references — 지연 초기화
export let vp      = null;
export let board   = null;
export let svgl    = null;
export let svgOverlay = null; // ★ NEW: 오버레이 SVG 레이어
export let pCvs    = null;
export let pCtx    = null;
export let mmCvs   = null;
export let mmCtx   = null;
export let selRect = null;

/** main.js init()에서 가장 먼저 호출 */
export function initDomRefs() {
  vp      = document.getElementById('viewport');
  board   = document.getElementById('board');
  svgl    = document.getElementById('svg-layer');
  svgOverlay = document.getElementById('svg-overlay'); // ★ NEW
  pCvs    = document.getElementById('preview-canvas');
  pCtx    = pCvs.getContext('2d');
  mmCvs   = document.getElementById('minimap');
  mmCtx   = mmCvs.getContext('2d');
  selRect = document.getElementById('sel-rect');
}

// Transform state
export const T = { x: 0, y: 0, s: 1 };

// Tool state
export let tool  = 'select';
export let color = '#1a1714';
export let sw    = 2;

export function setToolState(t)  { tool = t; }
export function setColorState(c) { color = c; }
export function setSwState(v)    { sw = v; }

// ★ 터치 예약 도구
export let pendingTool = null;
export function setPendingTool(v) { pendingTool = v; }

// Pen config
export const penCfg = { smooth: 0, opacity: 100, cap: 'round', pressure: 'none' };
export let penPanelOpen = false;
export function setPenPanelOpen(v) { penPanelOpen = v; }

// Interaction state
export let panning       = false;
export let panOrigin     = { x: 0, y: 0 };
export let drawing       = false;
export let drawPts       = [];
export let livePth       = null;
export let shapeA        = null;
export let dragging      = null;
export let resizing      = null;
export let selected      = null;
export let selectedEls   = [];
export let lasso         = null;
export let touchLasso    = null;
export let touchPanOrigin = null;
export let ctxEl         = null;
export let strokes       = [];
export let zTop          = 10;
export let gridOn        = true;
export let longPressTimer = null;

// ★ NEW: 현재 그리기가 오버레이 레이어에서 진행 중인지 플래그
export let drawingOnOverlay = false;
export function setDrawingOnOverlay(v) { drawingOnOverlay = v; }

// Setters for mutable state
export function setPanning(v)        { panning = v; }
export function setPanOrigin(v)      { panOrigin = v; }
export function setDrawing(v)        { drawing = v; }
export function setDrawPts(v)        { drawPts = v; }
export function pushDrawPt(pt)       { drawPts.push(pt); }
export function setLivePth(v)        { livePth = v; }
export function setShapeA(v)         { shapeA = v; }
export function setDragging(v)       { dragging = v; }
export function setResizing(v)       { resizing = v; }
export function setSelected(v)       { selected = v; }
export function setSelectedEls(v)    { selectedEls = v; }
export function pushSelectedEl(el)   { selectedEls.push(el); }
export function setLasso(v)          { lasso = v; }
export function setTouchLasso(v)     { touchLasso = v; }
export function setTouchPanOrigin(v) { touchPanOrigin = v; }
export function setCtxEl(v)          { ctxEl = v; }
export function pushStroke(s)        { strokes.push(s); }
export function removeStroke(i)      { strokes.splice(i, 1); }
export function setStrokes(v)        { strokes = v; }
export function nextZ()              { return ++zTop; }
export function setZTop(v)           { zTop = v; }
export function setGridOn(v)         { gridOn = v; }
export function setLongPressTimer(v) { longPressTimer = v; }

// ★ getter 함수: import 바인딩 문제 방지용
export function getStrokes()  { return strokes; }
export function getToolState() { return tool; }

// Pinch state
export let pinchDist   = null;
export let pinchMid    = null;
export let pinchActive = false;
export function setPinchDist(v)   { pinchDist = v; }
export function setPinchMid(v)    { pinchMid = v; }
export function setPinchActive(v) { pinchActive = v; }
