// ═══════════════════════════════════════════════════
//  doc-main.js — 문서 캔버스 메인 (v2.0)
//  무한캔버스와 동일한 드로잉·도형·포스트잇·카드·
//  히스토리·펜패널 기능 + 문서 페이지 관리
// ═══════════════════════════════════════════════════

// ── 상태 ──────────────────────────────────────────
const DS = {
  // Transform
  T: { x: 0, y: 0, s: 1 },
  // Tool
  tool: 'pan',
  // Draw config
  color: '#1a1714',
  sw: 2,
  penCfg: { smooth: 0, opacity: 100, cap: 'round', pressure: 'none' },
  // SVG strokes: [ { kind, attrs, svgEl } ]
  strokes: [],
  // Pages: [ { id, type:'blank'|'pdf'|'image', width, height, wrapEl, pageEl } ]
  pages: [],
  // UI flags
  drawing: false,
  drawPts: [],
  livePth: null,
  shapeStart: null,
  // History
  undoStack: [],
  redoStack: [],
  // Grid
  gridVisible: true,
  // Selected element (for select tool)
  selectedEl: null,
};

// ── DOM refs ──────────────────────────────────────
let viewport, board, svgLayer, previewCanvas, previewCtx;
let penPanel, penPanelOpen = false;
let pageCtxMenu, pageCtxTarget = null;

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_SCALE = 0.05, MAX_SCALE = 8;
const BLANK_PAGE_W = 794, BLANK_PAGE_H = 1123; // A4 px @96dpi

// ═══════════════════════════════════════════════
//  SVG 유틸
// ═══════════════════════════════════════════════
function mkSvg(tag) { return document.createElementNS(SVG_NS, tag); }
function setAttrs(el, attrs) { for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v); }

function pts2path(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i-1], c = pts[i];
    d += ` Q${p.x},${p.y} ${(p.x+c.x)/2},${(p.y+c.y)/2}`;
  }
  return d;
}

function smoothPts(pts, level) {
  if (level === 0 || pts.length < 3) return pts;
  const out = [pts[0]];
  const k = Math.min(level, Math.floor(pts.length / 2));
  for (let i = 1; i < pts.length - 1; i++) {
    let sx = 0, sy = 0, cnt = 0;
    for (let j = Math.max(0, i-k); j <= Math.min(pts.length-1, i+k); j++) { sx += pts[j].x; sy += pts[j].y; cnt++; }
    out.push({ x: sx/cnt, y: sy/cnt });
  }
  out.push(pts[pts.length-1]);
  return out;
}

function buildTaperPath(pts, width, mode) {
  if (pts.length < 2) return '';
  const min = 0.18, edge = 0.22;
  function taper(t) {
    if (mode === 'start') return t < edge ? min+(1-min)*(t/edge) : 1;
    if (mode === 'end')   return t > 1-edge ? min+(1-min)*((1-t)/edge) : 1;
    if (mode === 'both') { if(t<edge) return min+(1-min)*(t/edge); if(t>1-edge) return min+(1-min)*((1-t)/edge); return 1; }
    return 1;
  }
  const left=[], right=[];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0,i-1)], next = pts[Math.min(pts.length-1,i+1)];
    let dx=next.x-prev.x, dy=next.y-prev.y;
    const len=Math.hypot(dx,dy)||1; dx/=len; dy/=len;
    const nx=-dy, ny=dx;
    const hw = Math.max(0.8, (width * taper(i/(pts.length-1))) / 2);
    left.push({ x:pts[i].x+nx*hw, y:pts[i].y+ny*hw });
    right.push({ x:pts[i].x-nx*hw, y:pts[i].y-ny*hw });
  }
  const ring=[...left,...right.reverse()];
  let d=`M${ring[0].x},${ring[0].y}`;
  for (let i=1;i<ring.length;i++) d+=` L${ring[i].x},${ring[i].y}`;
  return d+' Z';
}

// ═══════════════════════════════════════════════
//  Transform
// ═══════════════════════════════════════════════
function applyTransform() {
  board.style.transform = `translate(${DS.T.x}px,${DS.T.y}px) scale(${DS.T.s})`;
  const pill = document.getElementById('doc-zoom-pill');
  if (pill) pill.textContent = Math.round(DS.T.s * 100) + '%';
}

function setTransform(x, y, s) {
  DS.T.x = x; DS.T.y = y;
  DS.T.s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
  applyTransform();
  drawMinimap();
}

function screenToBoard(ex, ey) {
  const vr = viewport.getBoundingClientRect();
  return {
    x: (ex - vr.left - DS.T.x) / DS.T.s,
    y: (ey - vr.top  - DS.T.y) / DS.T.s,
  };
}

function boardToScreen(bx, by) {
  const vr = viewport.getBoundingClientRect();
  return {
    x: bx * DS.T.s + DS.T.x + vr.left,
    y: by * DS.T.s + DS.T.y + vr.top,
  };
}

function fitPage(pageIdx) {
  const p = DS.pages[pageIdx];
  if (!p) return;
  const vr = viewport.getBoundingClientRect();
  const s = Math.min(1, (vr.width - 80) / p.width, (vr.height - 80) / p.height);
  // 보드 내 페이지의 절대 위치 계산
  const wrapEl = p.wrapEl;
  const wr = wrapEl.getBoundingClientRect(); // 현재 transform 기준
  // 페이지의 보드 내 top/left 구하기
  let bx = wrapEl.offsetLeft;
  let by = wrapEl.offsetTop;
  const tx = vr.width/2 - bx*s - p.width*s/2;
  const ty = vr.height/2 - by*s - p.height*s/2;
  setTransform(tx, ty, s);
}

// ═══════════════════════════════════════════════
//  히스토리 (Undo/Redo)
// ═══════════════════════════════════════════════
function takeSnapshot() {
  const snap = {
    strokes: DS.strokes.map(s => ({ kind: s.kind, attrs: { ...s.attrs } })),
  };
  return JSON.stringify(snap);
}

function restoreSnapshot(json) {
  // SVG 스트로크만 관리 (페이지는 별도 관리)
  while (svgLayer.firstChild) svgLayer.removeChild(svgLayer.firstChild);
  DS.strokes = [];

  const snap = JSON.parse(json);
  if (snap.strokes) {
    snap.strokes.forEach(s => {
      let el;
      if (s.kind === 'rect')    { el = mkSvg('rect'); setAttrs(el, s.attrs); }
      else if (s.kind === 'ellipse') { el = mkSvg('ellipse'); setAttrs(el, s.attrs); }
      else if (s.kind === 'arrow')   { el = rebuildArrow(s.attrs); }
      else { el = mkSvg('path'); setAttrs(el, s.attrs); }
      svgLayer.appendChild(el);
      DS.strokes.push({ kind: s.kind, attrs: s.attrs, svgEl: el });
    });
  }
}

function rebuildArrow(attrs) {
  const g = mkSvg('g');
  const line = mkSvg('line');
  setAttrs(line, { x1:attrs.x1,y1:attrs.y1,x2:attrs.x2,y2:attrs.y2,stroke:attrs.stroke,'stroke-width':attrs['stroke-width'],'stroke-linecap':'round' });
  const path = mkSvg('path');
  setAttrs(path, { d:attrs.d,stroke:attrs.stroke,'stroke-width':attrs['stroke-width'],'stroke-linecap':'round',fill:'none' });
  g.appendChild(line); g.appendChild(path);
  return g;
}

function pushState() {
  DS.undoStack.push(takeSnapshot());
  if (DS.undoStack.length > 80) DS.undoStack.shift();
  DS.redoStack = [];
}

function undo() {
  if (DS.undoStack.length < 2) { showSnack('더 이상 되돌릴 수 없습니다'); return; }
  DS.redoStack.push(DS.undoStack.pop());
  restoreSnapshot(DS.undoStack[DS.undoStack.length - 1]);
  showSnack('실행 취소');
}

function redo() {
  if (!DS.redoStack.length) { showSnack('다시 실행할 내용이 없습니다'); return; }
  const snap = DS.redoStack.pop();
  DS.undoStack.push(snap);
  restoreSnapshot(snap);
  showSnack('다시 실행');
}

// ═══════════════════════════════════════════════
//  페이지 관리
// ═══════════════════════════════════════════════
let pageIdCounter = 0;

function createPageWrap(width, height) {
  // 외부 컨테이너 (페이지 + 버튼들을 세로로 배치)
  const wrap = document.createElement('div');
  wrap.className = 'doc-page-wrap';
  wrap.style.cssText = `position:relative;display:flex;flex-direction:column;align-items:center;flex-shrink:0;`;

  // 페이지 본체 컨테이너
  const pageContainer = document.createElement('div');
  pageContainer.style.cssText = `position:relative;width:${width}px;height:${height}px;flex-shrink:0;`;

  const page = document.createElement('div');
  page.className = 'doc-page';
  page.style.cssText = `width:${width}px;height:${height}px;`;

  // 메뉴 버튼 (페이지 컨테이너 안, 절대 위치)
  const menuBtn = document.createElement('button');
  menuBtn.className = 'doc-page-menu-btn';
  menuBtn.title = '페이지 메뉴';
  menuBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="3" r="1.2" fill="currentColor"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/><circle cx="7" cy="11" r="1.2" fill="currentColor"/></svg>`;
  menuBtn.addEventListener('click', e => { e.stopPropagation(); openPageCtx(wrap, e.clientX, e.clientY); });

  pageContainer.appendChild(page);
  pageContainer.appendChild(menuBtn);

  // 페이지 번호 뱃지 (페이지 아래 배지)
  const badge = document.createElement('div');
  badge.className = 'doc-page-badge';
  badge.style.cssText = `font-size:10px;color:var(--ink-4);font-family:var(--font-mono);white-space:nowrap;pointer-events:none;letter-spacing:0.04em;margin-top:8px;`;

  // 페이지 추가 버튼 (배지 아래)
  const addBtn = document.createElement('button');
  addBtn.className = 'doc-add-page-btn';
  addBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2V10M2 6H10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> 페이지 추가`;
  addBtn.addEventListener('click', e => {
    e.stopPropagation();
    const idx = DS.pages.findIndex(p => p.wrapEl === wrap);
    addBlankPage(idx + 1);
  });

  wrap.appendChild(pageContainer);
  wrap.appendChild(badge);
  wrap.appendChild(addBtn);

  return { wrap, page, badge };
}

function updatePageBadges() {
  DS.pages.forEach((p, i) => {
    p.badge.textContent = `${i + 1} / ${DS.pages.length}`;
  });
  const pill = document.getElementById('doc-page-count-pill');
  if (pill) {
    pill.textContent = `${DS.pages.length} 페이지`;
    pill.style.display = DS.pages.length > 0 ? '' : 'none';
  }
  updateEmptyHint();
}

function updateEmptyHint() {
  const hint = document.getElementById('doc-empty-hint');
  if (!hint) return;
  if (DS.pages.length > 0) {
    hint.classList.add('hidden');
  } else {
    hint.classList.remove('hidden');
  }
}

function addBlankPage(insertIdx = -1) {
  const { wrap, page, badge } = createPageWrap(BLANK_PAGE_W, BLANK_PAGE_H);

  // 흰 캔버스
  const canvas = document.createElement('canvas');
  canvas.width = BLANK_PAGE_W;
  canvas.height = BLANK_PAGE_H;
  canvas.style.cssText = `width:${BLANK_PAGE_W}px;height:${BLANK_PAGE_H}px;display:block;`;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, BLANK_PAGE_W, BLANK_PAGE_H);
  page.appendChild(canvas);

  const pageData = { id: ++pageIdCounter, type: 'blank', width: BLANK_PAGE_W, height: BLANK_PAGE_H, wrapEl: wrap, pageEl: page, badge };

  if (insertIdx < 0 || insertIdx >= DS.pages.length) {
    DS.pages.push(pageData);
    board.insertBefore(wrap, svgLayer);
  } else {
    DS.pages.splice(insertIdx, 0, pageData);
    const refWrap = DS.pages[insertIdx + 1]?.wrapEl;
    board.insertBefore(wrap, refWrap || svgLayer);
  }

  updatePageBadges();
  showSnack('빈 페이지 추가');
  return pageData;
}

function deletePage(wrapEl) {
  const idx = DS.pages.findIndex(p => p.wrapEl === wrapEl);
  if (idx < 0) return;
  if (DS.pages.length <= 1) { showSnack('마지막 페이지는 삭제할 수 없습니다', true); return; }
  DS.pages.splice(idx, 1);
  wrapEl.remove();
  updatePageBadges();
  showSnack('페이지 삭제');
}

function movePageUp(wrapEl) {
  const idx = DS.pages.findIndex(p => p.wrapEl === wrapEl);
  if (idx <= 0) return;
  [DS.pages[idx-1], DS.pages[idx]] = [DS.pages[idx], DS.pages[idx-1]];
  const refWrap = DS.pages[idx]?.wrapEl;
  board.insertBefore(DS.pages[idx-1].wrapEl, refWrap || svgLayer);
  updatePageBadges();
}

function movePageDown(wrapEl) {
  const idx = DS.pages.findIndex(p => p.wrapEl === wrapEl);
  if (idx < 0 || idx >= DS.pages.length - 1) return;
  [DS.pages[idx], DS.pages[idx+1]] = [DS.pages[idx+1], DS.pages[idx]];
  const refWrap = DS.pages[idx+1]?.wrapEl;
  board.insertBefore(DS.pages[idx].wrapEl, refWrap || svgLayer);
  updatePageBadges();
}

// ── PDF 로딩 ──
let pdfjsLib = null;
async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      window['pdfjs-dist/build/pdf'].GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      pdfjsLib = window['pdfjs-dist/build/pdf'];
      resolve(pdfjsLib);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function loadPdf(arrayBuffer, insertIdx = -1) {
  showLoading('PDF 불러오는 중…');
  try {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
    const total = pdf.numPages;
    const SCALE = 1.5;
    const inserted = [];

    for (let i = 1; i <= total; i++) {
      showLoading(`PDF 불러오는 중… ${i}/${total}`);
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: SCALE });
      const w = vp.width, h = vp.height;

      const { wrap, page: pageEl, badge } = createPageWrap(w, h);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.style.cssText = `width:${w}px;height:${h}px;display:block;`;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      pageEl.appendChild(canvas);

      const pd = { id: ++pageIdCounter, type:'pdf', width:w, height:h, wrapEl:wrap, pageEl, badge };
      const actualIdx = insertIdx < 0 ? DS.pages.length : insertIdx + (i-1);
      if (actualIdx >= DS.pages.length) {
        DS.pages.push(pd);
        board.insertBefore(wrap, svgLayer);
      } else {
        DS.pages.splice(actualIdx, 0, pd);
        const ref = DS.pages[actualIdx+1]?.wrapEl;
        board.insertBefore(wrap, ref || svgLayer);
      }
      inserted.push(pd);
    }

    updatePageBadges();
    hideLoading();
    if (inserted.length) {
      const first = DS.pages.indexOf(inserted[0]);
      setTimeout(() => fitPage(first), 50);
    }
    showSnack(`PDF ${total}페이지 불러오기 완료`);
  } catch (err) {
    hideLoading();
    showSnack('PDF 불러오기 실패: ' + err.message, true);
    console.error(err);
  }
}

async function loadImageFile(file, insertIdx = -1) {
  showLoading('이미지 불러오는 중…');
  try {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsDataURL(file);
    });
    await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const MAX_W = 1400;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }

        const { wrap, page: pageEl, badge } = createPageWrap(w, h);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.style.cssText = `width:${w}px;height:${h}px;display:block;`;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        pageEl.appendChild(canvas);

        const pd = { id: ++pageIdCounter, type:'image', width:w, height:h, wrapEl:wrap, pageEl, badge };
        if (insertIdx < 0 || insertIdx >= DS.pages.length) {
          DS.pages.push(pd);
          board.insertBefore(wrap, svgLayer);
        } else {
          DS.pages.splice(insertIdx, 0, pd);
          const ref = DS.pages[insertIdx+1]?.wrapEl;
          board.insertBefore(wrap, ref || svgLayer);
        }

        updatePageBadges();
        hideLoading();
        const fi = DS.pages.indexOf(pd);
        setTimeout(() => fitPage(fi), 50);
        showSnack('이미지 불러오기 완료');
        res();
      };
      img.onerror = rej;
      img.src = dataUrl;
    });
  } catch (err) {
    hideLoading();
    showSnack('이미지 불러오기 실패: ' + err.message, true);
  }
}

async function handleFile(file, insertIdx = -1) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') {
    await loadPdf(await file.arrayBuffer(), insertIdx);
  } else if (['png','jpg','jpeg','gif','webp','bmp'].includes(ext)) {
    await loadImageFile(file, insertIdx);
  } else {
    showSnack('PDF 또는 이미지 파일을 사용하세요', true);
  }
}

// ═══════════════════════════════════════════════
//  페이지 컨텍스트 메뉴
// ═══════════════════════════════════════════════
function openPageCtx(wrapEl, cx, cy) {
  pageCtxTarget = wrapEl;
  pageCtxMenu.classList.add('visible');
  // 화면 안 배치
  const mw = 180, mh = 280;
  const x = Math.min(cx, window.innerWidth - mw - 8);
  const y = Math.min(cy, window.innerHeight - mh - 8);
  pageCtxMenu.style.left = x + 'px';
  pageCtxMenu.style.top  = y + 'px';
}

function closePageCtx() {
  pageCtxMenu.classList.remove('visible');
  pageCtxTarget = null;
}

function initPageCtx() {
  pageCtxMenu = document.getElementById('doc-page-ctx');

  document.getElementById('dpc-move-up').addEventListener('click', () => {
    if (pageCtxTarget) movePageUp(pageCtxTarget);
    closePageCtx();
  });
  document.getElementById('dpc-move-down').addEventListener('click', () => {
    if (pageCtxTarget) movePageDown(pageCtxTarget);
    closePageCtx();
  });
  document.getElementById('dpc-add-before').addEventListener('click', () => {
    if (pageCtxTarget) {
      const idx = DS.pages.findIndex(p => p.wrapEl === pageCtxTarget);
      addBlankPage(idx);
    }
    closePageCtx();
  });
  document.getElementById('dpc-add-after').addEventListener('click', () => {
    if (pageCtxTarget) {
      const idx = DS.pages.findIndex(p => p.wrapEl === pageCtxTarget);
      addBlankPage(idx + 1);
    }
    closePageCtx();
  });
  document.getElementById('dpc-fit').addEventListener('click', () => {
    if (pageCtxTarget) {
      const idx = DS.pages.findIndex(p => p.wrapEl === pageCtxTarget);
      fitPage(idx);
    }
    closePageCtx();
  });
  document.getElementById('dpc-delete').addEventListener('click', () => {
    if (pageCtxTarget) deletePage(pageCtxTarget);
    closePageCtx();
  });

  document.addEventListener('pointerdown', e => {
    if (!pageCtxMenu.contains(e.target)) closePageCtx();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePageCtx(); });
}

// ═══════════════════════════════════════════════
//  드로잉
// ═══════════════════════════════════════════════
function startDraw(bp) {
  DS.drawing = true;
  DS.drawPts = [bp];
  const livePth = mkSvg('path');
  livePth.setAttribute('fill', 'none');
  const col = DS.tool === 'highlight' ? DS.color + '99' : DS.color;
  livePth.setAttribute('stroke', col);
  livePth.setAttribute('stroke-opacity', DS.penCfg.opacity / 100);
  livePth.setAttribute('stroke-width', DS.tool === 'highlight' ? DS.sw * 4 : DS.sw);
  livePth.setAttribute('stroke-linecap', DS.penCfg.cap || 'round');
  livePth.setAttribute('stroke-linejoin', 'round');
  svgLayer.appendChild(livePth);
  DS.livePth = livePth;
}

function continueDraw(bp) {
  DS.drawPts.push(bp);
  if (DS.livePth) DS.livePth.setAttribute('d', pts2path(DS.drawPts));
}

function commitDraw() {
  const pts = DS.drawPts;
  if (pts.length <= 1) {
    if (DS.livePth?.parentNode) DS.livePth.parentNode.removeChild(DS.livePth);
    DS.livePth = null; DS.drawPts = []; DS.drawing = false; return;
  }
  const smoothed = smoothPts(pts, DS.penCfg.smooth);
  const baseW = DS.tool === 'highlight' ? DS.sw * 4 : DS.sw;
  const col = DS.tool === 'highlight' ? DS.color + '99' : DS.color;
  const opacity = DS.penCfg.opacity / 100;
  const cap = DS.penCfg.cap || 'round';

  let finalEl = DS.livePth;
  let kind, attrs;

  if (DS.penCfg.pressure && DS.penCfg.pressure !== 'none') {
    kind = 'taper-path';
    attrs = { d: buildTaperPath(smoothed, Math.max(1, baseW), DS.penCfg.pressure), fill: col, 'fill-opacity': opacity, stroke: 'none' };
    if (finalEl?.parentNode) finalEl.parentNode.removeChild(finalEl);
    finalEl = mkSvg('path');
    setAttrs(finalEl, attrs);
    svgLayer.appendChild(finalEl);
  } else {
    kind = 'path';
    attrs = { d: pts2path(smoothed), stroke: col, 'stroke-opacity': opacity, 'stroke-width': baseW, fill: 'none', 'stroke-linecap': cap, 'stroke-linejoin': 'round' };
    if (finalEl) setAttrs(finalEl, attrs);
  }

  DS.strokes.push({ kind, attrs, svgEl: finalEl });
  DS.livePth = null; DS.drawPts = []; DS.drawing = false;
  pushState();
  drawMinimap();
}

function eraseAt(bp) {
  const r = 18 / DS.T.s;
  let changed = false;
  for (let i = DS.strokes.length - 1; i >= 0; i--) {
    try {
      const bb = DS.strokes[i].svgEl.getBBox();
      if (bp.x >= bb.x-r && bp.x <= bb.x+bb.width+r && bp.y >= bb.y-r && bp.y <= bb.y+bb.height+r) {
        DS.strokes[i].svgEl.parentNode?.removeChild(DS.strokes[i].svgEl);
        DS.strokes.splice(i, 1);
        changed = true;
      }
    } catch(e) {}
  }
  return changed;
}

let eraseOccurred = false;

// ── 도형 ──
let shapeStart = null;

function previewShape(a, b) {
  if (!previewCtx) return;
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  const vr = previewCanvas.getBoundingClientRect();
  function b2p(p) { const s = boardToScreen(p.x, p.y); return { x: s.x - vr.left, y: s.y - vr.top }; }
  const sa = b2p(a), sb = b2p(b);

  previewCtx.save();
  previewCtx.strokeStyle = DS.color;
  previewCtx.lineWidth = DS.sw * DS.T.s;
  previewCtx.lineCap = 'round';
  previewCtx.lineJoin = 'round';

  if (DS.tool === 'rect') previewCtx.strokeRect(sa.x, sa.y, sb.x-sa.x, sb.y-sa.y);
  if (DS.tool === 'circle') {
    const rx=(sb.x-sa.x)/2, ry=(sb.y-sa.y)/2;
    previewCtx.beginPath();
    previewCtx.ellipse(sa.x+rx, sa.y+ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI*2);
    previewCtx.stroke();
  }
  if (DS.tool === 'arrow') {
    previewCtx.beginPath(); previewCtx.moveTo(sa.x, sa.y); previewCtx.lineTo(sb.x, sb.y); previewCtx.stroke();
    const ang = Math.atan2(sb.y-sa.y, sb.x-sa.x), hl=(12+DS.sw*2)*DS.T.s;
    previewCtx.beginPath();
    previewCtx.moveTo(sb.x, sb.y); previewCtx.lineTo(sb.x-hl*Math.cos(ang-.45), sb.y-hl*Math.sin(ang-.45));
    previewCtx.moveTo(sb.x, sb.y); previewCtx.lineTo(sb.x-hl*Math.cos(ang+.45), sb.y-hl*Math.sin(ang+.45));
    previewCtx.stroke();
  }
  previewCtx.restore();
}

function finalizeShape(a, b) {
  if (previewCtx) previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  if (DS.tool === 'rect') {
    const x=Math.min(a.x,b.x), y=Math.min(a.y,b.y), w=Math.abs(b.x-a.x), h=Math.abs(b.y-a.y);
    const el = mkSvg('rect');
    const attrs = { x,y,width:w,height:h,fill:'none',stroke:DS.color,'stroke-width':DS.sw,'stroke-linecap':'round' };
    setAttrs(el, attrs); svgLayer.appendChild(el); DS.strokes.push({ kind:'rect', attrs, svgEl:el });
  }
  if (DS.tool === 'circle') {
    const cx=(a.x+b.x)/2, cy=(a.y+b.y)/2, rx=Math.abs(b.x-a.x)/2, ry=Math.abs(b.y-a.y)/2;
    const el = mkSvg('ellipse');
    const attrs = { cx,cy,rx,ry,fill:'none',stroke:DS.color,'stroke-width':DS.sw };
    setAttrs(el, attrs); svgLayer.appendChild(el); DS.strokes.push({ kind:'ellipse', attrs, svgEl:el });
  }
  if (DS.tool === 'arrow') {
    const g=mkSvg('g'), line=mkSvg('line');
    setAttrs(line, { x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:DS.color,'stroke-width':DS.sw,'stroke-linecap':'round' });
    const ang=Math.atan2(b.y-a.y,b.x-a.x), hl=12+DS.sw*2;
    const d=`M${b.x},${b.y} L${b.x-hl*Math.cos(ang-.45)},${b.y-hl*Math.sin(ang-.45)} M${b.x},${b.y} L${b.x-hl*Math.cos(ang+.45)},${b.y-hl*Math.sin(ang+.45)}`;
    const path = mkSvg('path');
    setAttrs(path, { d,stroke:DS.color,'stroke-width':DS.sw,'stroke-linecap':'round',fill:'none' });
    g.appendChild(line); g.appendChild(path); svgLayer.appendChild(g);
    DS.strokes.push({ kind:'arrow', svgEl:g, attrs:{ x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:DS.color,'stroke-width':DS.sw,hl,d } });
  }
  pushState();
  drawMinimap();
}

// ── 텍스트 ──
function addTextAt(bp) {
  const div = document.createElement('div');
  div.contentEditable = 'true';
  div.style.cssText = `
    position:absolute;
    left:${bp.x}px; top:${bp.y}px;
    min-width:120px; min-height:24px;
    font-family:var(--font-ui); font-size:${14/DS.T.s}px;
    color:${DS.color}; outline:none;
    background:transparent; border:none;
    cursor:text; white-space:pre-wrap;
    transform-origin: 0 0;
  `;
  div.dataset.docText = '1';
  board.appendChild(div);
  div.focus();

  function commit() {
    if (!div.textContent.trim()) { div.remove(); return; }
    div.contentEditable = 'false';
    div.style.cursor = 'default';
    pushState();
  }
  div.addEventListener('blur', commit);
  div.addEventListener('keydown', e => { if (e.key === 'Escape') { div.blur(); } });
}

// ── 포스트잇 ──
function addSticky() {
  const vr = viewport.getBoundingClientRect();
  const bp = screenToBoard(vr.left + vr.width/2, vr.top + vr.height/2);
  const w = 200, h = 160;

  const colors = ['#fef08a','#bbf7d0','#bfdbfe','#fecaca','#e9d5ff'];
  const bg = colors[Math.floor(Math.random() * colors.length)];

  const el = document.createElement('div');
  el.className = 'doc-sticky';
  el.style.cssText = `
    position:absolute; left:${bp.x - w/2}px; top:${bp.y - h/2}px;
    width:${w}px; height:${h}px; z-index:100;
    background:${bg}; border-radius:4px;
    box-shadow:0 4px 16px rgba(0,0,0,0.12),0 1px 4px rgba(0,0,0,0.06);
    display:flex; flex-direction:column; padding:10px; resize:none;
  `;
  el.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:6px;flex-shrink:0;">
      <button style="width:22px;height:22px;border:none;border-radius:50%;background:rgba(0,0,0,0.12);color:rgba(0,0,0,0.5);font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;" class="doc-sticky-close">✕</button>
    </div>
    <textarea style="flex:1;border:none;background:transparent;resize:none;font-family:var(--font-ui);font-size:13px;color:#1a1714;outline:none;cursor:text;line-height:1.6;" placeholder="메모…"></textarea>
  `;

  // 드래그
  makeDraggable(el, el.querySelector('div'));
  el.querySelector('.doc-sticky-close').addEventListener('click', () => { el.remove(); pushState(); });

  board.appendChild(el);
  el.querySelector('textarea').focus();
  pushState();
}

// ── 카드 창 ──
let cardIdCounter = 0;
function addCard() {
  const vr = viewport.getBoundingClientRect();
  const bp = screenToBoard(vr.left + vr.width/2, vr.top + vr.height/2);
  const w = 320, h = 240;
  const id = ++cardIdCounter;

  const el = document.createElement('div');
  el.className = 'doc-card';
  el.style.cssText = `
    position:absolute; left:${bp.x - w/2}px; top:${bp.y - h/2}px;
    width:${w}px; height:${h}px; z-index:100;
    background:rgba(255,255,255,0.97);
    border:1px solid rgba(26,23,20,0.1); border-radius:12px;
    box-shadow:0 8px 32px rgba(0,0,0,0.14),0 2px 8px rgba(0,0,0,0.06);
    display:flex; flex-direction:column; overflow:hidden;
    resize:both;
  `;
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(26,23,20,0.03);border-bottom:1px solid rgba(26,23,20,0.07);flex-shrink:0;cursor:move;">
      <span style="font-size:11px;font-weight:600;color:var(--ink-3);letter-spacing:0.04em;text-transform:uppercase;">카드 #${id}</span>
      <button style="width:22px;height:22px;border:none;border-radius:50%;background:rgba(26,23,20,0.06);color:var(--ink-3);font-size:10px;cursor:pointer;" class="doc-card-close">✕</button>
    </div>
    <textarea style="flex:1;border:none;background:transparent;resize:none;padding:12px;font-family:var(--font-ui);font-size:13px;color:var(--ink-1);outline:none;line-height:1.6;" placeholder="내용을 입력하세요…"></textarea>
  `;

  makeDraggable(el, el.querySelector('div'));
  el.querySelector('.doc-card-close').addEventListener('click', () => { el.remove(); pushState(); });

  board.appendChild(el);
  el.querySelector('textarea').focus();
  pushState();
}

// ── 드래그 가능 만들기 ──
function makeDraggable(el, handle) {
  let drag = null;
  handle.addEventListener('pointerdown', e => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;
    drag = { ox: e.clientX/DS.T.s - parseFloat(el.style.left||0), oy: e.clientY/DS.T.s - parseFloat(el.style.top||0) };
    handle.setPointerCapture(e.pointerId);
    e.stopPropagation();
  });
  handle.addEventListener('pointermove', e => {
    if (!drag) return;
    el.style.left = (e.clientX/DS.T.s - drag.ox) + 'px';
    el.style.top  = (e.clientY/DS.T.s - drag.oy) + 'px';
  });
  handle.addEventListener('pointerup', () => { drag = null; });
}

// ═══════════════════════════════════════════════
//  펜 설정 패널
// ═══════════════════════════════════════════════
function openPenPanel(tool) {
  penPanel = document.getElementById('doc-pen-panel');
  if (!penPanel) return;
  const btn = document.getElementById('dt-' + tool);
  if (!btn) return;

  const br = btn.getBoundingClientRect();
  const ppW = 228, ppH = 380;
  let x = br.right + 10;
  let y = br.top + br.height/2 - ppH/2;
  x = Math.max(8, Math.min(x, window.innerWidth - ppW - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - ppH - 8));

  penPanel.style.left = x + 'px';
  penPanel.style.top  = y + 'px';
  penPanel.classList.add('pp-open');
  penPanelOpen = true;

  document.getElementById('dpp-title').textContent =
    tool === 'highlight' ? '형광펜 설정' : tool === 'eraser' ? '지우개 설정' : '펜 설정';
  document.getElementById('dpp-cap-sect').style.display = tool === 'eraser' ? 'none' : '';
  document.getElementById('dpp-pressure-sect').style.display = tool === 'eraser' ? 'none' : '';

  updatePenPanelUI();
}

function closePenPanel() {
  const pp = document.getElementById('doc-pen-panel');
  if (pp) pp.classList.remove('pp-open');
  penPanelOpen = false;
}

function updatePenPanelUI() {
  const smooth = document.getElementById('dpp-smooth');
  const smoothV = document.getElementById('dpp-smooth-v');
  const opacity = document.getElementById('dpp-opacity');
  const opacityV = document.getElementById('dpp-opacity-v');
  if (smooth) { smooth.value = DS.penCfg.smooth; smoothV.textContent = DS.penCfg.smooth; }
  if (opacity) { opacity.value = DS.penCfg.opacity; opacityV.textContent = DS.penCfg.opacity + '%'; }
  document.querySelectorAll('#dpp-sc .pp-chip').forEach(c => c.classList.toggle('pp-on', +c.dataset.smooth === DS.penCfg.smooth));
  document.querySelectorAll('#doc-pen-panel .pp-cap').forEach(c => c.classList.toggle('pp-on', c.dataset.cap === DS.penCfg.cap));
  document.querySelectorAll('#dpp-pc .pp-chip').forEach(c => c.classList.toggle('pp-on', c.dataset.pressure === DS.penCfg.pressure));
  updatePenPreview();
}

function updatePenPreview() {
  const path = document.getElementById('dpp-preview-path');
  if (!path) return;
  const baseW = DS.tool === 'highlight' ? DS.sw * 4 : DS.sw;
  path.setAttribute('stroke-width', Math.max(1, Math.min(baseW, 12)));
  path.setAttribute('stroke-linecap', DS.penCfg.cap || 'round');
  path.setAttribute('stroke-opacity', DS.penCfg.opacity / 100);
  const col = DS.tool === 'highlight' ? DS.color + '99' : DS.color;
  path.setAttribute('stroke', col === DS.color ? 'rgba(255,255,255,0.7)' : col);
}

function initPenPanel() {
  const smooth = document.getElementById('dpp-smooth');
  const opacity = document.getElementById('dpp-opacity');

  smooth?.addEventListener('input', () => {
    DS.penCfg.smooth = +smooth.value;
    document.getElementById('dpp-smooth-v').textContent = smooth.value;
    document.querySelectorAll('#dpp-sc .pp-chip').forEach(c => c.classList.toggle('pp-on', +c.dataset.smooth === DS.penCfg.smooth));
    updatePenPreview();
  });
  opacity?.addEventListener('input', () => {
    DS.penCfg.opacity = +opacity.value;
    document.getElementById('dpp-opacity-v').textContent = opacity.value + '%';
    updatePenPreview();
  });
  document.querySelectorAll('#dpp-sc .pp-chip').forEach(c => c.addEventListener('click', () => {
    DS.penCfg.smooth = +c.dataset.smooth;
    if (smooth) smooth.value = DS.penCfg.smooth;
    document.getElementById('dpp-smooth-v').textContent = DS.penCfg.smooth;
    document.querySelectorAll('#dpp-sc .pp-chip').forEach(x => x.classList.remove('pp-on'));
    c.classList.add('pp-on');
    updatePenPreview();
  }));
  document.querySelectorAll('#doc-pen-panel .pp-cap').forEach(c => c.addEventListener('click', () => {
    DS.penCfg.cap = c.dataset.cap;
    document.querySelectorAll('#doc-pen-panel .pp-cap').forEach(x => x.classList.remove('pp-on'));
    c.classList.add('pp-on');
    updatePenPreview();
  }));
  document.querySelectorAll('#dpp-pc .pp-chip').forEach(c => c.addEventListener('click', () => {
    DS.penCfg.pressure = c.dataset.pressure;
    document.querySelectorAll('#dpp-pc .pp-chip').forEach(x => x.classList.remove('pp-on'));
    c.classList.add('pp-on');
    updatePenPreview();
  }));
  document.getElementById('dpp-close')?.addEventListener('click', closePenPanel);
}

// ═══════════════════════════════════════════════
//  도구 활성화
// ═══════════════════════════════════════════════
const DRAW_TOOLS = ['pen','highlight','eraser'];
const SHAPE_TOOLS = ['rect','circle','arrow'];
const PANEL_TOOLS = ['pen','highlight','eraser'];

function setActiveTool(t) {
  if (DS.tool === t && PANEL_TOOLS.includes(t)) {
    // 같은 도구 재클릭 → 패널 토글
    if (penPanelOpen) closePenPanel();
    else openPenPanel(t);
    return;
  }
  closePenPanel();
  DS.tool = t;
  document.body.dataset.tool = t;

  // 사이드바 버튼 active 업데이트
  document.querySelectorAll('#left-sidebar .sbtn').forEach(btn => {
    const bt = btn.dataset.tool || btn.dataset.toolOrPanel;
    btn.classList.toggle('active', bt === t);
  });

  // color tray 표시
  const ct = document.getElementById('doc-color-tray');
  ct?.classList.toggle('ct-visible', [...DRAW_TOOLS, ...SHAPE_TOOLS].includes(t));

  // 커서
  viewport.style.cursor =
    t === 'pan' ? 'grab' :
    t === 'eraser' ? 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Ccircle cx=\'12\' cy=\'12\' r=\'10\' stroke=\'%231a1714\' stroke-width=\'1.5\' fill=\'none\'/%3E%3C/svg%3E") 12 12, crosshair' :
    'crosshair';

  if (PANEL_TOOLS.includes(t)) openPenPanel(t);
}

// ═══════════════════════════════════════════════
//  포인터 이벤트
// ═══════════════════════════════════════════════
let isPanning = false, panStart = null;
let isPointerDown = false;
let activePointerId = null;

// ── Select 도구 관련 ──
let selectDrag = null;

function clearSelection() {
  if (DS.selectedEl) {
    DS.selectedEl.classList.remove('doc-el-selected');
    DS.selectedEl = null;
  }
  const box = document.getElementById('doc-sel-box');
  if (box) box.style.display = 'none';
}

function selectElement(el) {
  clearSelection();
  DS.selectedEl = el;
  el.classList.add('doc-el-selected');
}

function deleteSelected() {
  if (!DS.selectedEl) return;
  DS.selectedEl.remove();
  DS.selectedEl = null;
  pushState();
  showSnack('삭제');
}

function onPointerDown(e) {
  if (e.target.closest('#left-sidebar') ||
      e.target.closest('#doc-topbar') ||
      e.target.closest('#doc-pen-panel') ||
      e.target.closest('#doc-page-ctx') ||
      e.target.closest('#doc-save-overlay') ||
      e.target.closest('[contenteditable]')) return;

  // sticky/card는 select 도구일 때 선택, 아닐 때 기본동작
  if (DS.tool !== 'select' && (e.target.closest('.doc-sticky') || e.target.closest('.doc-card'))) return;

  e.preventDefault();

  // context menu 닫기
  closePageCtx();
  if (penPanelOpen && !e.target.closest('#doc-pen-panel')) closePenPanel();

  activePointerId = e.pointerId;
  const pt = screenToBoard(e.clientX, e.clientY);

  if (DS.tool === 'select') {
    // 포스트잇/카드 선택 & 이동
    const movable = e.target.closest('.doc-sticky') || e.target.closest('.doc-card');
    if (movable) {
      selectElement(movable);
      const ox = parseFloat(movable.style.left || 0);
      const oy = parseFloat(movable.style.top  || 0);
      selectDrag = {
        el: movable,
        startBx: pt.x, startBy: pt.y,
        origX: ox, origY: oy,
      };
      viewport.setPointerCapture(e.pointerId);
      isPointerDown = true;
    } else {
      clearSelection();
      isPanning = true;
      panStart = { x: e.clientX - DS.T.x, y: e.clientY - DS.T.y };
    }
  } else if (DS.tool === 'pen' || DS.tool === 'highlight') {
    isPointerDown = true;
    startDraw(pt);
    viewport.setPointerCapture(e.pointerId);
  } else if (DS.tool === 'eraser') {
    isPointerDown = true;
    eraseOccurred = eraseAt(pt);
    viewport.setPointerCapture(e.pointerId);
  } else if (DS.tool === 'text') {
    addTextAt(pt);
  } else if (SHAPE_TOOLS.includes(DS.tool)) {
    isPointerDown = true;
    shapeStart = pt;
    viewport.setPointerCapture(e.pointerId);
  } else {
    isPanning = true;
    panStart = { x: e.clientX - DS.T.x, y: e.clientY - DS.T.y };
  }
}

function onPointerMove(e) {
  if (!isPointerDown && !isPanning) return;
  const pt = screenToBoard(e.clientX, e.clientY);

  if (isPointerDown) {
    if (DS.tool === 'select' && selectDrag) {
      const dx = pt.x - selectDrag.startBx;
      const dy = pt.y - selectDrag.startBy;
      selectDrag.el.style.left = (selectDrag.origX + dx) + 'px';
      selectDrag.el.style.top  = (selectDrag.origY + dy) + 'px';
    } else if (DS.tool === 'pen' || DS.tool === 'highlight') {
      continueDraw(pt);
    } else if (DS.tool === 'eraser') {
      if (eraseAt(pt)) eraseOccurred = true;
    } else if (SHAPE_TOOLS.includes(DS.tool) && shapeStart) {
      previewShape(shapeStart, pt);
    }
  } else if (isPanning) {
    setTransform(e.clientX - panStart.x, e.clientY - panStart.y, DS.T.s);
  }
}

function onPointerUp(e) {
  if (isPointerDown) {
    if (DS.tool === 'select' && selectDrag) {
      selectDrag = null;
      pushState();
    } else if (DS.tool === 'pen' || DS.tool === 'highlight') {
      commitDraw();
    } else if (DS.tool === 'eraser') {
      if (eraseOccurred) { pushState(); eraseOccurred = false; }
    } else if (SHAPE_TOOLS.includes(DS.tool) && shapeStart) {
      const pt = screenToBoard(e.clientX, e.clientY);
      finalizeShape(shapeStart, pt);
      shapeStart = null;
    }
    isPointerDown = false;
  }
  if (isPanning) { isPanning = false; panStart = null; }
}

// ── 터치 (핀치 줌) ──
let lastPinchDist = null;

function onTouchStart(e) {
  if (e.touches.length === 2) {
    lastPinchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  }
}

function onTouchMove(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    if (lastPinchDist) {
      const factor = dist / lastPinchDist;
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, DS.T.s * factor));
      const nx = cx - (cx - DS.T.x) * (ns / DS.T.s);
      const ny = cy - (cy - DS.T.y) * (ns / DS.T.s);
      setTransform(nx, ny, ns);
    }
    lastPinchDist = dist;
  }
}
function onTouchEnd(e) { if (e.touches.length < 2) lastPinchDist = null; }

// ── 휠 ──
function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, DS.T.s * factor));
    const nx = e.clientX - (e.clientX - DS.T.x) * (ns / DS.T.s);
    const ny = e.clientY - (e.clientY - DS.T.y) * (ns / DS.T.s);
    setTransform(nx, ny, ns);
  } else {
    setTransform(DS.T.x - e.deltaX, DS.T.y - e.deltaY, DS.T.s);
  }
}

// ═══════════════════════════════════════════════
//  색상 트레이
// ═══════════════════════════════════════════════
function initColorTray() {
  document.querySelectorAll('#doc-color-tray .cdot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('#doc-color-tray .cdot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      DS.color = dot.dataset.c;
      updatePenPreview();
    });
  });
  document.querySelectorAll('#doc-color-tray .sw-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#doc-color-tray .sw-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      DS.sw = parseFloat(btn.dataset.sw);
      updatePenPreview();
    });
  });
}

// ═══════════════════════════════════════════════
//  사이드바 이벤트
// ═══════════════════════════════════════════════
function initSidebar() {
  // 도구 버튼 (data-tool)
  document.querySelectorAll('#left-sidebar .sbtn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
  });
  // 도구+패널 버튼 (data-tool-or-panel)
  document.querySelectorAll('#left-sidebar .sbtn[data-tool-or-panel]').forEach(btn => {
    btn.addEventListener('click', () => setActiveTool(btn.dataset.toolOrPanel));
  });
  // 액션 버튼 (data-action)
  document.querySelectorAll('#left-sidebar .sbtn[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.action;
      if (a === 'addSticky') addSticky();
      if (a === 'addCard') addCard();
      if (a === 'addDocImage') document.getElementById('doc-img-in').click();
    });
  });

  // 파일 열기
  const openBtn = document.getElementById('doc-open-btn');
  const fileIn  = document.getElementById('doc-file-in');
  if (openBtn && fileIn) {
    openBtn.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', async e => {
      const file = e.target.files[0];
      fileIn.value = '';
      if (file) await handleFile(file);
    });
  }

  // 이미지 삽입
  const imgIn = document.getElementById('doc-img-in');
  imgIn?.addEventListener('change', async e => {
    const file = e.target.files[0];
    imgIn.value = '';
    if (file) await loadImageFile(file);
  });

  // 빈 페이지 추가
  document.getElementById('doc-add-blank-btn')?.addEventListener('click', () => addBlankPage());

  // 저장
  document.getElementById('doc-save-btn')?.addEventListener('click', openSaveDialog);

  // 그리드 토글
  document.getElementById('doc-grid-toggle-btn')?.addEventListener('click', toggleGrid);

  // 전체 삭제
  document.getElementById('doc-clear-btn')?.addEventListener('click', () => {
    if (!confirm('모든 페이지와 주석을 삭제하시겠습니까?')) return;
    DS.pages.forEach(p => p.wrapEl.remove());
    DS.pages = [];
    DS.strokes = [];
    while (svgLayer.firstChild) svgLayer.removeChild(svgLayer.firstChild);
    updatePageBadges();
    showSnack('전체 삭제');
    DS.undoStack = [];
    DS.redoStack = [];
    pushState();
  });

  // Undo/Redo
  document.getElementById('doc-undo-btn')?.addEventListener('click', undo);
  document.getElementById('doc-redo-btn')?.addEventListener('click', redo);

  // 줌 리셋
  document.getElementById('doc-zoom-pill')?.addEventListener('click', () => {
    if (DS.pages.length) fitPage(0);
    else setTransform(0, 0, 1);
  });

  // 힌트 버튼
  document.getElementById('doc-hint-open-btn')?.addEventListener('click', () => fileIn?.click());
  document.getElementById('doc-hint-blank-btn')?.addEventListener('click', () => addBlankPage());
}

// ═══════════════════════════════════════════════
//  키보드
// ═══════════════════════════════════════════════
function initKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === 'Escape') { setActiveTool('pan'); closePenPanel(); closePageCtx(); clearSelection(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (DS.selectedEl && DS.tool === 'select') { deleteSelected(); return; }
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); openSaveDialog(); return; }
      if (e.key === '0') { e.preventDefault(); DS.pages.length ? fitPage(0) : setTransform(0,0,1); return; }
    }
    switch (e.key) {
      case 'h': case 'H': setActiveTool('pan'); break;
      case 'v': case 'V': setActiveTool('select'); break;
      case 'p': case 'P': setActiveTool('pen'); break;
      case 'l': case 'L': setActiveTool('highlight'); break;
      case 'e': case 'E': setActiveTool('eraser'); break;
      case 't': case 'T': setActiveTool('text'); break;
      case 'r': case 'R': setActiveTool('rect'); break;
      case 'c': case 'C': setActiveTool('circle'); break;
      case 'a': case 'A': setActiveTool('arrow'); break;
      case 's': case 'S': addSticky(); break;
      case 'w': case 'W': addCard(); break;
      case 'g': case 'G': toggleGrid(); break;
    }
  });
}

// ═══════════════════════════════════════════════
//  드래그앤드롭
// ═══════════════════════════════════════════════
function initDragDrop() {
  viewport.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  viewport.addEventListener('drop', async e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  });
}

// ═══════════════════════════════════════════════
//  미니맵
// ═══════════════════════════════════════════════
function drawMinimap() {
  const canvas = document.getElementById('doc-minimap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cw = canvas.width, ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#f5f4f2';
  ctx.fillRect(0, 0, cw, ch);

  if (DS.pages.length === 0) return;

  // 전체 보드 범위 계산
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  DS.pages.forEach(p => {
    const x = p.wrapEl.offsetLeft, y = p.wrapEl.offsetTop;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + p.width); maxY = Math.max(maxY, y + p.height);
  });
  const pad = 40;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const bW = maxX - minX, bH = maxY - minY;
  const scale = Math.min(cw / bW, ch / bH) * 0.9;
  const ox = (cw - bW*scale)/2 - minX*scale;
  const oy = (ch - bH*scale)/2 - minY*scale;

  // 페이지 그리기
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(26,23,20,0.12)';
  ctx.lineWidth = 0.5;
  DS.pages.forEach(p => {
    const x = p.wrapEl.offsetLeft * scale + ox;
    const y = p.wrapEl.offsetTop  * scale + oy;
    const w = p.width  * scale;
    const h = p.height * scale;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  });

  // 뷰포트 표시
  const vr = viewport.getBoundingClientRect();
  const vx = (-DS.T.x / DS.T.s) * scale + ox;
  const vy = (-DS.T.y / DS.T.s) * scale + oy;
  const vw = (vr.width / DS.T.s) * scale;
  const vh = (vr.height / DS.T.s) * scale;
  ctx.strokeStyle = 'rgba(200,75,47,0.7)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(vx, vy, vw, vh);
  ctx.fillStyle = 'rgba(200,75,47,0.05)';
  ctx.fillRect(vx, vy, vw, vh);
}

// ═══════════════════════════════════════════════
//  그리드 토글
// ═══════════════════════════════════════════════
function toggleGrid() {
  const grid = document.getElementById('doc-grid');
  if (!grid) return;
  DS.gridVisible = !DS.gridVisible;
  grid.style.backgroundImage = DS.gridVisible
    ? 'radial-gradient(circle, var(--canvas-dot) 1.4px, transparent 1.4px)'
    : 'none';
  const btn = document.getElementById('doc-grid-toggle-btn');
  if (btn) btn.classList.toggle('active', DS.gridVisible);
  showSnack(DS.gridVisible ? '그리드 표시' : '그리드 숨김');
}

// ═══════════════════════════════════════════════
//  저장 (JSON)
// ═══════════════════════════════════════════════
function openSaveDialog() {
  const overlay = document.getElementById('doc-save-overlay');
  if (!overlay) { exportPng(); return; }
  const input = document.getElementById('doc-save-filename');
  const d = new Date();
  const ts = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if (input) input.value = `document-${ts}`;
  overlay.style.display = 'flex';
  input?.focus();
  input?.select();
}

function closeSaveDialog() {
  const overlay = document.getElementById('doc-save-overlay');
  if (overlay) overlay.style.display = 'none';
}

function exportPng() {
  if (DS.pages.length === 0) { showSnack('내보낼 페이지가 없습니다', true); return; }
  const firstPage = DS.pages[0];
  const canvas = firstPage.pageEl.querySelector('canvas');
  if (!canvas) { showSnack('내보낼 캔버스를 찾을 수 없습니다', true); return; }
  const link = document.createElement('a');
  link.download = 'document-export.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
  showSnack('PNG로 내보내기 완료');
}

function saveDoc(filename) {
  const data = {
    version: '1.0',
    type: 'document-canvas',
    timestamp: new Date().toISOString(),
    strokes: DS.strokes.map(s => ({ kind: s.kind, attrs: { ...s.attrs } })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = (filename || 'document') + '.json';
  link.click();
  URL.revokeObjectURL(url);
  showSnack(`저장 완료: ${link.download}`);
}

function initSaveDialog() {
  const cancelBtn = document.getElementById('doc-save-cancel-btn');
  const confirmBtn = document.getElementById('doc-save-confirm-btn');
  const overlay = document.getElementById('doc-save-overlay');
  const input = document.getElementById('doc-save-filename');

  cancelBtn?.addEventListener('click', closeSaveDialog);
  overlay?.addEventListener('click', e => { if (e.target === overlay) closeSaveDialog(); });
  confirmBtn?.addEventListener('click', () => {
    const name = input?.value.trim() || 'document';
    saveDoc(name);
    closeSaveDialog();
  });
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmBtn?.click();
    if (e.key === 'Escape') closeSaveDialog();
  });
}

// ═══════════════════════════════════════════════
//  UI 유틸
// ═══════════════════════════════════════════════
function showSnack(msg, isError = false) {
  const snack = document.getElementById('doc-snack');
  if (!snack) return;
  snack.textContent = msg;
  snack.style.background = isError ? '#c84b2f' : 'rgba(26,23,20,0.9)';
  snack.classList.add('visible');
  clearTimeout(snack._t);
  snack._t = setTimeout(() => snack.classList.remove('visible'), 2800);
}

function showLoading(msg) {
  let el = document.getElementById('doc-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'doc-loading';
    el.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(26,23,20,0.88);color:#fff;padding:14px 28px;border-radius:12px;font-family:var(--font-ui);font-size:14px;backdrop-filter:blur(10px);z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.3);`;
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
}

function hideLoading() {
  const el = document.getElementById('doc-loading');
  if (el) el.style.display = 'none';
}

// ── 프리뷰 캔버스 리사이즈 ──
function syncPreviewCanvas() {
  if (!previewCanvas) return;
  previewCanvas.width  = viewport.offsetWidth;
  previewCanvas.height = viewport.offsetHeight;
}

// ═══════════════════════════════════════════════
//  초기화
// ═══════════════════════════════════════════════
function init() {
  viewport      = document.getElementById('doc-viewport');
  board         = document.getElementById('doc-board');
  svgLayer      = document.getElementById('doc-svg-layer');

  // 프리뷰 캔버스 동적 생성
  previewCanvas = document.createElement('canvas');
  previewCanvas.style.cssText = `position:fixed;top:0;left:var(--sidebar-w);right:0;bottom:0;pointer-events:none;z-index:500;`;
  document.body.appendChild(previewCanvas);
  previewCtx = previewCanvas.getContext('2d');
  syncPreviewCanvas();

  if (!viewport) { console.error('doc-viewport not found'); return; }

  // 초기 transform
  const vr = viewport.getBoundingClientRect();
  setTransform(vr.width/2 - BLANK_PAGE_W/2, 60, 1);

  // 기본 도구
  setActiveTool('pan');

  // 이벤트
  viewport.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('touchstart', onTouchStart, { passive: true });
  viewport.addEventListener('touchmove', onTouchMove, { passive: false });
  viewport.addEventListener('touchend', onTouchEnd, { passive: true });

  window.addEventListener('resize', () => { syncPreviewCanvas(); drawMinimap(); });

  initColorTray();
  initSidebar();
  initKeyboard();
  initDragDrop();
  initPenPanel();
  initPageCtx();
  initSaveDialog();

  // 초기 히스토리
  setTimeout(() => pushState(), 100);

  updateEmptyHint();
  console.log('∞ Loovas Document Canvas v2.0 — initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
