// ═══════════════════════════════════════════════════
//  doc-main.js — 문서형 에디터 v3.0
//  스크롤 기반 페이지 뷰 / 텍스트 편집 / PDF·이미지 뷰어 / 주석
// ═══════════════════════════════════════════════════

/* ── 상태 ─────────────────────────────────────── */
const DS = {
  pages: [],          // { id, type:'blank'|'pdf'|'image', cardEl, contentEl, annotSvg, strokes[] }
  currentPageIdx: -1,
  mode: 'text',       // 'text' | 'annotate'
  annot: {
    tool: 'pen',
    color: '#1a1714',
    sw: 2,
    opacity: 1,
  },
  zoom: 1,
  titleSaved: false,
};

let pageIdCounter = 0;
const SVG_NS = 'http://www.w3.org/2000/svg';
const BLANK_W = 794; // A4 기준 너비 (px)

/* ── DOM refs ──────────────────────────────────── */
let viewer, pageList, emptyState;
let annotToolbar, textFmtBtns;
let pageCtxMenu, ctxTargetIdx = -1;
let snackTimer;

// ═══════════════════════════════════════════════
//  유틸
// ═══════════════════════════════════════════════
function mkSvg(tag) { return document.createElementNS(SVG_NS, tag); }
function qs(sel, root = document) { return root.querySelector(sel); }
function qsa(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function showSnack(msg, isError = false) {
  const el = document.getElementById('snack');
  if (!el) return;
  el.textContent = msg;
  el.className = 'visible' + (isError ? ' error' : '');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.className = '', 2600);
}

function showLoading(msg = '불러오는 중…') {
  const overlay = document.getElementById('loading-overlay');
  document.getElementById('loading-text').textContent = msg;
  overlay.classList.add('active');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}

function updateEmptyState() {
  if (!emptyState) return;
  emptyState.classList.toggle('hidden', DS.pages.length > 0);
}

function updateZoomLabel() {
  const el = document.getElementById('zoom-label');
  if (el) el.textContent = Math.round(DS.zoom * 100) + '%';
}

// ═══════════════════════════════════════════════
//  줌
// ═══════════════════════════════════════════════
function applyZoom(z) {
  DS.zoom = Math.max(0.4, Math.min(2.5, z));
  document.querySelectorAll('.page-card').forEach(card => {
    card.style.maxWidth = Math.round(860 * DS.zoom) + 'px';
  });
  updateZoomLabel();
}

// ═══════════════════════════════════════════════
//  사이드바 페이지 목록
// ═══════════════════════════════════════════════
function rebuildPageList() {
  if (!pageList) return;
  pageList.innerHTML = '';
  DS.pages.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'page-item' + (i === DS.currentPageIdx ? ' active' : '');
    item.dataset.idx = i;

    // 썸네일
    const thumb = document.createElement('div');
    thumb.className = 'page-item-thumb';

    if (p.type === 'blank') {
      thumb.textContent = 'A';
      thumb.style.fontWeight = '700';
      thumb.style.color = 'var(--ink-3)';
    } else if (p.type === 'pdf' || p.type === 'image') {
      const src = p.thumbCanvas || p.thumbImg;
      if (src instanceof HTMLCanvasElement) {
        const img = document.createElement('img');
        img.src = src.toDataURL('image/jpeg', 0.6);
        thumb.appendChild(img);
      } else if (src instanceof HTMLImageElement) {
        const imgCopy = document.createElement('img');
        imgCopy.src = src.src;
        thumb.appendChild(imgCopy);
      }
    }

    // 정보
    const info = document.createElement('div');
    info.className = 'page-item-info';
    const label = document.createElement('div');
    label.className = 'page-item-label';
    label.textContent = p.label || `페이지 ${i + 1}`;
    const sub = document.createElement('div');
    sub.className = 'page-item-sub';
    sub.textContent = p.type === 'pdf' ? 'PDF' : p.type === 'image' ? '이미지' : '문서';
    info.appendChild(label);
    info.appendChild(sub);

    // 메뉴 버튼
    const menuBtn = document.createElement('button');
    menuBtn.className = 'page-item-menu';
    menuBtn.title = '페이지 메뉴';
    menuBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <circle cx="6.5" cy="2.5" r="1" fill="currentColor"/>
      <circle cx="6.5" cy="6.5" r="1" fill="currentColor"/>
      <circle cx="6.5" cy="10.5" r="1" fill="currentColor"/>
    </svg>`;
    menuBtn.addEventListener('click', e => {
      e.stopPropagation();
      openCtxMenu(i, e.clientX, e.clientY);
    });

    item.appendChild(thumb);
    item.appendChild(info);
    item.appendChild(menuBtn);
    item.addEventListener('click', () => scrollToPage(i));
    pageList.appendChild(item);
  });
  updateEmptyState();
}

function setActivePageInSidebar(idx) {
  DS.currentPageIdx = idx;
  qsa('.page-item', pageList).forEach((item, i) => {
    item.classList.toggle('active', i === idx);
  });
}

function scrollToPage(idx) {
  const p = DS.pages[idx];
  if (!p) return;
  p.cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setActivePageInSidebar(idx);
}

// ═══════════════════════════════════════════════
//  IntersectionObserver — 뷰 안에 들어온 페이지 하이라이트
// ═══════════════════════════════════════════════
let pageObserver;
function setupObserver() {
  if (pageObserver) pageObserver.disconnect();
  pageObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const idx = +entry.target.dataset.pageIdx;
        setActivePageInSidebar(idx);
        entry.target.classList.add('active-card');
      } else {
        entry.target.classList.remove('active-card');
      }
    });
  }, { root: viewer, threshold: 0.3 });
  DS.pages.forEach((p, i) => {
    p.cardEl.dataset.pageIdx = i;
    pageObserver.observe(p.cardEl);
  });
}

// ═══════════════════════════════════════════════
//  페이지 카드 생성
// ═══════════════════════════════════════════════
function createPageCard(p, idx) {
  const card = document.createElement('div');
  card.className = 'page-card';
  card.dataset.pageIdx = idx;

  // 헤더
  const header = document.createElement('div');
  header.className = 'page-header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'page-header-left';

  const badge = document.createElement('span');
  badge.className = 'page-badge';
  badge.textContent = `p.${idx + 1}`;

  const typeBadge = document.createElement('span');
  typeBadge.className = 'page-type-badge';
  typeBadge.textContent = p.type === 'pdf' ? 'PDF' : p.type === 'image' ? '이미지' : '문서';

  headerLeft.appendChild(badge);
  headerLeft.appendChild(typeBadge);

  const headerActions = document.createElement('div');
  headerActions.className = 'page-header-actions';

  // 페이지 메뉴 버튼
  const menuBtn = document.createElement('button');
  menuBtn.className = 'page-action-btn';
  menuBtn.title = '페이지 메뉴';
  menuBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="3" r="1.2" fill="currentColor"/>
    <circle cx="7" cy="7" r="1.2" fill="currentColor"/>
    <circle cx="7" cy="11" r="1.2" fill="currentColor"/>
  </svg>`;
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    const ci = DS.pages.indexOf(p);
    openCtxMenu(ci, e.clientX, e.clientY);
  });

  // 위로/아래로
  const upBtn = createActionBtn(`<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 10V3M4 5.5L6.5 3L9 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`, '위로', () => {
    const ci = DS.pages.indexOf(p);
    movePageUp(ci);
  });
  const downBtn = createActionBtn(`<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 3V10M4 7.5L6.5 10L9 7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`, '아래로', () => {
    const ci = DS.pages.indexOf(p);
    movePageDown(ci);
  });

  // 삭제 버튼
  const delBtn = createActionBtn(`<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 4H11L10 11.5H3L2 4Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M1 4H12M4.5 4V2.5H8.5V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`, '삭제', () => {
    const ci = DS.pages.indexOf(p);
    deletePage(ci);
  });
  delBtn.style.color = 'var(--accent)';

  headerActions.appendChild(upBtn);
  headerActions.appendChild(downBtn);
  headerActions.appendChild(menuBtn);
  headerActions.appendChild(delBtn);

  header.appendChild(headerLeft);
  header.appendChild(headerActions);

  // 본문
  const body = document.createElement('div');
  body.className = 'page-body';

  card.appendChild(header);
  card.appendChild(body);

  return { card, body, badge };
}

function createActionBtn(svgStr, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'page-action-btn';
  btn.title = title;
  btn.innerHTML = svgStr;
  btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  return btn;
}

// ═══════════════════════════════════════════════
//  SVG 주석 레이어
// ═══════════════════════════════════════════════
function createAnnotLayer(pageData, bodyEl) {
  const svgWrap = document.createElement('div');
  svgWrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:10;overflow:hidden;';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;';
  svg.setAttribute('class', 'annot-overlay');
  svgWrap.appendChild(svg);
  bodyEl.style.position = 'relative';
  bodyEl.appendChild(svgWrap);

  pageData.annotSvg = svg;
  pageData.strokes = [];

  // 드로잉 이벤트
  let drawing = false, pts = [], livePath = null, eraseOccurred = false;

  svg.addEventListener('pointerdown', e => {
    if (DS.mode !== 'annotate') return;
    e.preventDefault();
    e.stopPropagation();
    svg.setPointerCapture(e.pointerId);

    const { bx, by } = clientToSvg(svg, e.clientX, e.clientY);

    if (DS.annot.tool === 'eraser') {
      eraseAt(pageData, { x: bx, y: by });
      eraseOccurred = true;
    } else {
      drawing = true;
      pts = [{ x: bx, y: by }];
      livePath = mkSvg('path');
      livePath.setAttribute('fill', 'none');
      const col = DS.annot.tool === 'highlight'
        ? DS.annot.color + Math.round(DS.annot.opacity * 0.5 * 255).toString(16).padStart(2,'0')
        : DS.annot.color;
      livePath.setAttribute('stroke', col);
      livePath.setAttribute('stroke-opacity', DS.annot.opacity);
      livePath.setAttribute('stroke-width', DS.annot.tool === 'highlight' ? DS.annot.sw * 5 : DS.annot.sw);
      livePath.setAttribute('stroke-linecap', 'round');
      livePath.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(livePath);
    }
  });

  svg.addEventListener('pointermove', e => {
    if (DS.mode !== 'annotate') return;
    if (!drawing && DS.annot.tool !== 'eraser') return;
    const { bx, by } = clientToSvg(svg, e.clientX, e.clientY);

    if (DS.annot.tool === 'eraser' && e.buttons) {
      eraseAt(pageData, { x: bx, y: by });
    } else if (drawing) {
      pts.push({ x: bx, y: by });
      if (livePath) livePath.setAttribute('d', pts2path(pts));
    }
  });

  svg.addEventListener('pointerup', () => {
    if (DS.annot.tool === 'eraser') { eraseOccurred = false; return; }
    if (!drawing || pts.length < 2) {
      if (livePath?.parentNode) livePath.remove();
      drawing = false; pts = []; livePath = null; return;
    }
    const col = DS.annot.tool === 'highlight'
      ? DS.annot.color + Math.round(DS.annot.opacity * 0.5 * 255).toString(16).padStart(2,'0')
      : DS.annot.color;
    const attrs = {
      d: pts2path(pts),
      stroke: col,
      'stroke-opacity': DS.annot.opacity,
      'stroke-width': DS.annot.tool === 'highlight' ? DS.annot.sw * 5 : DS.annot.sw,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      fill: 'none',
    };
    if (livePath) {
      for (const [k, v] of Object.entries(attrs)) livePath.setAttribute(k, v);
      pageData.strokes.push({ el: livePath, attrs });
    }
    drawing = false; pts = []; livePath = null;
  });
}

function clientToSvg(svg, cx, cy) {
  const rect = svg.getBoundingClientRect();
  return { bx: (cx - rect.left) / DS.zoom, by: (cy - rect.top) / DS.zoom };
}

function pts2path(pts) {
  if (pts.length < 2) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i-1], c = pts[i];
    d += ` Q${p.x},${p.y} ${(p.x+c.x)/2},${(p.y+c.y)/2}`;
  }
  return d;
}

function eraseAt(pageData, pt) {
  const r = 20;
  for (let i = pageData.strokes.length - 1; i >= 0; i--) {
    try {
      const bb = pageData.strokes[i].el.getBBox();
      if (pt.x >= bb.x - r && pt.x <= bb.x + bb.width + r &&
          pt.y >= bb.y - r && pt.y <= bb.y + bb.height + r) {
        pageData.strokes[i].el.remove();
        pageData.strokes.splice(i, 1);
      }
    } catch (e) {}
  }
}

function undoAnnot(pageData) {
  if (!pageData.strokes.length) return;
  const last = pageData.strokes.pop();
  last.el.remove();
  showSnack('주석 취소');
}

function clearAnnot(pageData) {
  if (!confirm('이 페이지의 주석을 모두 지우겠습니까?')) return;
  pageData.strokes.forEach(s => s.el.remove());
  pageData.strokes = [];
  showSnack('주석 지우기 완료');
}

// ═══════════════════════════════════════════════
//  빈 페이지 추가
// ═══════════════════════════════════════════════
function addBlankPage(insertIdx = -1) {
  const id = ++pageIdCounter;
  const pageData = {
    id, type: 'blank', label: `문서 ${id}`,
    cardEl: null, contentEl: null, annotSvg: null, strokes: [],
    thumbCanvas: null, thumbImg: null,
  };

  const { card, body, badge } = createPageCard(pageData, DS.pages.length);
  pageData.cardEl = card;

  // 편집 가능 영역
  const editor = document.createElement('div');
  editor.className = 'blank-editor';
  editor.contentEditable = 'true';
  editor.setAttribute('data-placeholder', '내용을 입력하세요…');
  editor.spellcheck = false;
  pageData.contentEl = editor;
  body.appendChild(editor);

  // 주석 레이어
  createAnnotLayer(pageData, body);
  updateAnnotMode(pageData);

  // 삽입
  insertPage(pageData, insertIdx, card);
  updateBadges();
  rebuildPageList();
  setupObserver();
  scrollToPage(DS.pages.indexOf(pageData));
  showSnack('빈 페이지 추가');
  editor.focus();
}

// ═══════════════════════════════════════════════
//  PDF 로딩
// ═══════════════════════════════════════════════
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
    let firstInserted = null;

    for (let i = 1; i <= total; i++) {
      showLoading(`PDF 렌더링 중… ${i} / ${total}`);
      const pdfPage = await pdf.getPage(i);
      const vp = pdfPage.getViewport({ scale: SCALE });

      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.cssText = `display:block;width:100%;height:auto;`;
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

      const pageData = {
        id: ++pageIdCounter,
        type: 'pdf',
        label: `PDF p.${i}`,
        cardEl: null, contentEl: null, annotSvg: null, strokes: [],
        thumbCanvas: canvas, thumbImg: null,
      };

      const actualIdx = insertIdx < 0 ? DS.pages.length : insertIdx + (i - 1);
      const { card, body } = createPageCard(pageData, actualIdx);
      pageData.cardEl = card;

      const wrap = document.createElement('div');
      wrap.className = 'page-canvas-wrap';
      wrap.appendChild(canvas);
      body.appendChild(wrap);

      createAnnotLayer(pageData, body);
      updateAnnotMode(pageData);
      insertPage(pageData, actualIdx, card);

      if (!firstInserted) firstInserted = pageData;
    }

    updateBadges();
    rebuildPageList();
    setupObserver();
    hideLoading();
    if (firstInserted) scrollToPage(DS.pages.indexOf(firstInserted));
    showSnack(`PDF ${total}페이지 불러오기 완료`);
  } catch (err) {
    hideLoading();
    showSnack('PDF 불러오기 실패: ' + err.message, true);
    console.error(err);
  }
}

// ═══════════════════════════════════════════════
//  이미지 로딩
// ═══════════════════════════════════════════════
async function loadImageFile(file, insertIdx = -1) {
  showLoading('이미지 불러오는 중…');
  try {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => res(e.target.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

    await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const pageData = {
          id: ++pageIdCounter,
          type: 'image',
          label: file.name.replace(/\.[^.]+$/, ''),
          cardEl: null, contentEl: null, annotSvg: null, strokes: [],
          thumbCanvas: null, thumbImg: img,
        };

        const actualIdx = insertIdx < 0 ? DS.pages.length : insertIdx;
        const { card, body } = createPageCard(pageData, actualIdx);
        pageData.cardEl = card;

        const wrap = document.createElement('div');
        wrap.className = 'page-canvas-wrap';
        const imgEl = document.createElement('img');
        imgEl.src = dataUrl;
        imgEl.alt = pageData.label;
        imgEl.draggable = false;
        wrap.appendChild(imgEl);
        body.appendChild(wrap);

        createAnnotLayer(pageData, body);
        updateAnnotMode(pageData);
        insertPage(pageData, actualIdx, card);
        updateBadges();
        rebuildPageList();
        setupObserver();
        hideLoading();
        scrollToPage(DS.pages.indexOf(pageData));
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

// ═══════════════════════════════════════════════
//  파일 핸들러
// ═══════════════════════════════════════════════
async function handleFile(file, insertIdx = -1) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') {
    await loadPdf(await file.arrayBuffer(), insertIdx);
  } else if (['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext)) {
    await loadImageFile(file, insertIdx);
  } else {
    showSnack('PDF 또는 이미지 파일을 사용하세요', true);
  }
}

async function handleFiles(files, insertIdx = -1) {
  for (let i = 0; i < files.length; i++) {
    const idx = insertIdx < 0 ? -1 : insertIdx + i;
    await handleFile(files[i], idx);
  }
}

// ═══════════════════════════════════════════════
//  페이지 삽입 / 삭제 / 이동
// ═══════════════════════════════════════════════
function insertPage(pageData, idx, cardEl) {
  if (idx < 0 || idx >= DS.pages.length) {
    DS.pages.push(pageData);
    viewer.appendChild(cardEl);
  } else {
    DS.pages.splice(idx, 0, pageData);
    const refCard = DS.pages[idx + 1]?.cardEl;
    viewer.insertBefore(cardEl, refCard || null);
  }
}

function deletePage(idx) {
  const p = DS.pages[idx];
  if (!p) return;
  if (DS.pages.length === 1) { showSnack('마지막 페이지는 삭제할 수 없습니다', true); return; }
  p.cardEl.remove();
  DS.pages.splice(idx, 1);
  updateBadges();
  rebuildPageList();
  setupObserver();
  showSnack('페이지 삭제');
}

function movePageUp(idx) {
  if (idx <= 0) return;
  const tmp = DS.pages[idx - 1];
  DS.pages[idx - 1] = DS.pages[idx];
  DS.pages[idx] = tmp;
  // DOM 재배치
  const ref = DS.pages[idx].cardEl;
  viewer.insertBefore(DS.pages[idx - 1].cardEl, ref);
  updateBadges();
  rebuildPageList();
  setupObserver();
}

function movePageDown(idx) {
  if (idx >= DS.pages.length - 1) return;
  const tmp = DS.pages[idx + 1];
  DS.pages[idx + 1] = DS.pages[idx];
  DS.pages[idx] = tmp;
  const ref = DS.pages[idx + 1]?.cardEl;
  viewer.insertBefore(DS.pages[idx].cardEl, ref || null);
  updateBadges();
  rebuildPageList();
  setupObserver();
}

function updateBadges() {
  DS.pages.forEach((p, i) => {
    const badge = p.cardEl?.querySelector('.page-badge');
    if (badge) badge.textContent = `p.${i + 1}`;
    p.cardEl.dataset.pageIdx = i;
    const sideItem = pageList?.children[i];
    if (sideItem) {
      const lbl = sideItem.querySelector('.page-item-label');
      if (lbl) lbl.textContent = p.label || `페이지 ${i + 1}`;
    }
  });
}

// ═══════════════════════════════════════════════
//  모드 전환 (text ↔ annotate)
// ═══════════════════════════════════════════════
function setMode(mode) {
  DS.mode = mode;
  qsa('.mode-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const textFmt = document.getElementById('text-fmt-btns');
  if (mode === 'text') {
    annotToolbar.classList.remove('visible');
    if (textFmt) textFmt.style.display = 'flex';
    // 텍스트 편집 가능
    DS.pages.forEach(p => {
      if (p.contentEl) p.contentEl.contentEditable = 'true';
      if (p.annotSvg) {
        p.annotSvg.classList.remove('drawing-mode', 'eraser-mode');
        p.annotSvg.style.pointerEvents = 'none';
      }
    });
  } else {
    annotToolbar.classList.add('visible');
    if (textFmt) textFmt.style.display = 'none';
    // 텍스트 편집 불가 (주석 그리기)
    DS.pages.forEach(p => {
      if (p.contentEl) p.contentEl.contentEditable = 'false';
      updateAnnotMode(p);
    });
  }
}

function updateAnnotMode(pageData) {
  if (!pageData.annotSvg) return;
  if (DS.mode === 'annotate') {
    pageData.annotSvg.classList.remove('drawing-mode', 'eraser-mode');
    pageData.annotSvg.classList.add(DS.annot.tool === 'eraser' ? 'eraser-mode' : 'drawing-mode');
    pageData.annotSvg.style.pointerEvents = 'all';
  } else {
    pageData.annotSvg.classList.remove('drawing-mode', 'eraser-mode');
    pageData.annotSvg.style.pointerEvents = 'none';
  }
}

// ═══════════════════════════════════════════════
//  컨텍스트 메뉴
// ═══════════════════════════════════════════════
function openCtxMenu(idx, cx, cy) {
  ctxTargetIdx = idx;
  pageCtxMenu.classList.add('open');
  const mw = 200, mh = 220;
  const x = Math.min(cx, window.innerWidth - mw - 8);
  const y = Math.min(cy, window.innerHeight - mh - 8);
  pageCtxMenu.style.left = x + 'px';
  pageCtxMenu.style.top = y + 'px';
}

function closeCtxMenu() {
  pageCtxMenu.classList.remove('open');
  ctxTargetIdx = -1;
}

// ═══════════════════════════════════════════════
//  저장 (JSON)
// ═══════════════════════════════════════════════
function saveDoc() {
  const title = document.getElementById('doc-title-input')?.value || 'document';
  const data = {
    version: '3.0', type: 'loovas-document',
    title,
    timestamp: new Date().toISOString(),
    pages: DS.pages.map(p => ({
      id: p.id, type: p.type, label: p.label,
      content: p.contentEl?.innerHTML || '',
      strokes: p.strokes.map(s => ({ attrs: s.attrs })),
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = title.replace(/[^\w가-힣]/g, '-') + '.json';
  a.click();
  URL.revokeObjectURL(url);

  const status = document.getElementById('save-status');
  if (status) {
    status.textContent = '저장됨';
    setTimeout(() => { status.textContent = ''; }, 3000);
  }
  showSnack('저장 완료');
}

// ═══════════════════════════════════════════════
//  텍스트 서식 명령
// ═══════════════════════════════════════════════
function execCmd(cmd, val = null) {
  document.execCommand(cmd, false, val);
}

function initTextToolbar() {
  document.getElementById('tb-bold')?.addEventListener('click', () => execCmd('bold'));
  document.getElementById('tb-italic')?.addEventListener('click', () => execCmd('italic'));
  document.getElementById('tb-underline')?.addEventListener('click', () => execCmd('underline'));
  document.getElementById('tb-strike')?.addEventListener('click', () => execCmd('strikeThrough'));
  document.getElementById('tb-ul')?.addEventListener('click', () => execCmd('insertUnorderedList'));
  document.getElementById('tb-ol')?.addEventListener('click', () => execCmd('insertOrderedList'));
  document.getElementById('tb-quote')?.addEventListener('click', () => execCmd('formatBlock', 'blockquote'));
  document.getElementById('tb-code')?.addEventListener('click', () => {
    const sel = window.getSelection();
    if (sel && sel.toString()) {
      const code = document.createElement('code');
      const range = sel.getRangeAt(0);
      code.textContent = sel.toString();
      range.deleteContents();
      range.insertNode(code);
    }
  });
  document.getElementById('tb-hr')?.addEventListener('click', () => execCmd('insertHorizontalRule'));
  document.getElementById('tb-align-left')?.addEventListener('click', () => execCmd('justifyLeft'));
  document.getElementById('tb-align-center')?.addEventListener('click', () => execCmd('justifyCenter'));
  document.getElementById('tb-link')?.addEventListener('click', () => {
    const url = prompt('링크 URL을 입력하세요:');
    if (url) execCmd('createLink', url);
  });
  document.getElementById('tb-undo')?.addEventListener('click', () => execCmd('undo'));
  document.getElementById('tb-redo')?.addEventListener('click', () => execCmd('redo'));

  // 헤딩
  const headingSel = document.getElementById('tb-heading');
  headingSel?.addEventListener('change', () => {
    const val = headingSel.value;
    if (val) execCmd('formatBlock', val);
    else execCmd('formatBlock', 'p');
    headingSel.value = '';
  });
}

// ═══════════════════════════════════════════════
//  주석 툴바
// ═══════════════════════════════════════════════
function initAnnotToolbar() {
  // 도구 탭
  qsa('#annot-toolbar [data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      DS.annot.tool = btn.dataset.tool;
      qsa('#annot-toolbar [data-tool]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      DS.pages.forEach(updateAnnotMode);
    });
  });

  // 색상
  qsa('#annot-colors .annot-color').forEach(dot => {
    dot.addEventListener('click', () => {
      qsa('#annot-colors .annot-color').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      DS.annot.color = dot.dataset.c;
    });
  });

  // 굵기
  qsa('#annot-sws .annot-sw').forEach(sw => {
    sw.addEventListener('click', () => {
      qsa('#annot-sws .annot-sw').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      DS.annot.sw = +sw.dataset.sw;
    });
  });

  // 불투명도
  const opacityRange = document.getElementById('annot-opacity');
  const opacityLabel = document.getElementById('annot-opacity-label');
  opacityRange?.addEventListener('input', () => {
    DS.annot.opacity = opacityRange.value / 100;
    if (opacityLabel) opacityLabel.textContent = opacityRange.value + '%';
  });

  // 취소 / 지우기
  document.getElementById('at-undo')?.addEventListener('click', () => {
    const p = DS.pages[DS.currentPageIdx];
    if (p) undoAnnot(p);
  });
  document.getElementById('at-clear')?.addEventListener('click', () => {
    const p = DS.pages[DS.currentPageIdx];
    if (p) clearAnnot(p);
  });
}

// ═══════════════════════════════════════════════
//  사이드바 토글
// ═══════════════════════════════════════════════
function initSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('sidebar-toggle-btn');
  btn?.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });
}

// ═══════════════════════════════════════════════
//  줌 컨트롤
// ═══════════════════════════════════════════════
function initZoom() {
  document.getElementById('zc-in')?.addEventListener('click', () => applyZoom(DS.zoom + 0.1));
  document.getElementById('zc-out')?.addEventListener('click', () => applyZoom(DS.zoom - 0.1));
  document.getElementById('zc-fit')?.addEventListener('click', () => applyZoom(1));

  // 트랙패드 / Ctrl+휠
  viewer?.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    applyZoom(DS.zoom + (e.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });
}

// ═══════════════════════════════════════════════
//  드래그앤드롭
// ═══════════════════════════════════════════════
function initDragDrop() {
  let cnt = 0;
  const overlay = document.getElementById('drop-overlay');
  document.addEventListener('dragenter', () => { cnt++; overlay.classList.add('active'); });
  document.addEventListener('dragleave', () => { cnt = Math.max(0, cnt - 1); if (!cnt) overlay.classList.remove('active'); });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', async e => {
    e.preventDefault();
    cnt = 0; overlay.classList.remove('active');
    const files = [...e.dataTransfer.files];
    if (files.length) await handleFiles(files);
  });
}

// ═══════════════════════════════════════════════
//  크롬 버튼
// ═══════════════════════════════════════════════
function initChrome() {
  const fileIn = document.getElementById('file-in');

  // 열기
  document.getElementById('chrome-open-btn')?.addEventListener('click', () => fileIn.click());
  document.getElementById('empty-open-btn')?.addEventListener('click', () => fileIn.click());

  fileIn?.addEventListener('change', async e => {
    const files = [...e.target.files];
    fileIn.value = '';
    if (files.length) await handleFiles(files);
  });

  // 빈 페이지 추가
  document.getElementById('chrome-add-blank-btn')?.addEventListener('click', () => addBlankPage());
  document.getElementById('empty-blank-btn')?.addEventListener('click', () => addBlankPage());
  document.getElementById('add-page-btn')?.addEventListener('click', () => addBlankPage());

  // 저장
  document.getElementById('chrome-save-btn')?.addEventListener('click', saveDoc);

  // 제목 변경
  const titleInput = document.getElementById('doc-title-input');
  titleInput?.addEventListener('input', () => {
    document.title = (titleInput.value || '제목 없는 문서') + ' — Loovas';
  });
}

// ═══════════════════════════════════════════════
//  컨텍스트 메뉴
// ═══════════════════════════════════════════════
function initCtxMenu() {
  pageCtxMenu = document.getElementById('page-ctx-menu');

  document.getElementById('ctx-add-before')?.addEventListener('click', () => {
    if (ctxTargetIdx >= 0) addBlankPage(ctxTargetIdx);
    closeCtxMenu();
  });
  document.getElementById('ctx-add-after')?.addEventListener('click', () => {
    if (ctxTargetIdx >= 0) addBlankPage(ctxTargetIdx + 1);
    closeCtxMenu();
  });
  document.getElementById('ctx-move-up')?.addEventListener('click', () => {
    if (ctxTargetIdx >= 0) movePageUp(ctxTargetIdx);
    closeCtxMenu();
  });
  document.getElementById('ctx-move-down')?.addEventListener('click', () => {
    if (ctxTargetIdx >= 0) movePageDown(ctxTargetIdx);
    closeCtxMenu();
  });
  document.getElementById('ctx-scroll-to')?.addEventListener('click', () => {
    if (ctxTargetIdx >= 0) scrollToPage(ctxTargetIdx);
    closeCtxMenu();
  });
  document.getElementById('ctx-delete')?.addEventListener('click', () => {
    if (ctxTargetIdx >= 0) deletePage(ctxTargetIdx);
    closeCtxMenu();
  });

  document.addEventListener('pointerdown', e => {
    if (!pageCtxMenu.contains(e.target)) closeCtxMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCtxMenu();
  });
}

// ═══════════════════════════════════════════════
//  모드 탭
// ═══════════════════════════════════════════════
function initModeTabs() {
  qsa('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
}

// ═══════════════════════════════════════════════
//  키보드 단축키
// ═══════════════════════════════════════════════
function initKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 's') { e.preventDefault(); saveDoc(); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); applyZoom(DS.zoom + 0.1); return; }
      if (e.key === '-') { e.preventDefault(); applyZoom(DS.zoom - 0.1); return; }
      if (e.key === '0') { e.preventDefault(); applyZoom(1); return; }
    }
  });
}

// ═══════════════════════════════════════════════
//  초기화
// ═══════════════════════════════════════════════
function init() {
  viewer = document.getElementById('viewer');
  pageList = document.getElementById('page-list');
  emptyState = document.getElementById('empty-state');
  annotToolbar = document.getElementById('annot-toolbar');
  textFmtBtns = document.getElementById('text-fmt-btns');

  initChrome();
  initTextToolbar();
  initAnnotToolbar();
  initModeTabs();
  initCtxMenu();
  initSidebarToggle();
  initZoom();
  initDragDrop();
  initKeyboard();

  updateEmptyState();
  console.log('∞ Loovas Document Editor v3.0 — initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
