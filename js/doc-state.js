// ═══════════════════════════════════════════════════
//  doc-state.js — 문서 캔버스 전역 상태
// ═══════════════════════════════════════════════════

// DOM refs
export let viewport = null;
export let board    = null;
export let svgLayer = null;
export let previewCanvas = null;
export let minimap  = null;

// Transform
export const T = { x: 0, y: 0, s: 1 };

// Tool
export let tool = 'pan';
export function setTool(t) { tool = t; }

// Color / stroke
export let color = '#1a1714';
export let strokeWidth = 2;
export function setColor(c) { color = c; }
export function setStrokeWidth(w) { strokeWidth = w; }

// Pen config
export const penCfg = { smooth: 0, opacity: 100, cap: 'round', pressure: 'none' };

// Strokes drawn on doc canvas (per-page)
export let strokes = [];
export function addStroke(s) { strokes.push(s); }
export function setStrokes(arr) { strokes = arr; }
export function getStrokes() { return strokes; }
export function clearStrokes() { strokes = []; }

// Elements (annotations, stickies, etc.)
export let elements = [];
export function addElement(el) { elements.push(el); }
export function setElements(arr) { elements = arr; }
export function getElements() { return elements; }

// Document pages
export let pages = [];         // Array of { type: 'pdf'|'image', src, width, height, pageNum }
export function setPages(arr) { pages = arr; }
export function getPages() { return pages; }

// History
export let historyStack = [];
export let historyIndex = -1;

// Z-index counter
let zCounter = 100;
export function nextZ() { return ++zCounter; }

// Init DOM refs
export function initDomRefs() {
  viewport      = document.getElementById('doc-viewport');
  board         = document.getElementById('doc-board');
  svgLayer      = document.getElementById('doc-svg-layer');
  previewCanvas = document.getElementById('doc-preview-canvas');
  minimap       = document.getElementById('doc-minimap');
}
