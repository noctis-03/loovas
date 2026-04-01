// ═══════════════════════════════════════════════════
//  state.js — 전역 상태 & DOM 참조
// ═══════════════════════════════════════════════════

// DOM references
export const vp      = document.getElementById('viewport');
export const board   = document.getElementById('board');
export const svgl    = document.getElementById('svg-layer');
export const pCvs    = document.getElementById('preview-canvas');
export const pCtx    = pCvs.getContext('2d');
export const mmCvs   = document.getElementById('minimap');
export const mmCtx   = mmCvs.getContext('2d');
export const selRect = document.getElementById('sel-rect');

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
