// ═══════════════════════════════════════════════════════════════
//  doc-main.js — 문서형 에디터 v5.0
//  ★ 무한캔버스 패리티 달성
//    - 이동(pan) / 필기(annotate) / 텍스트(text) / 올가미(lasso) 모드
//    - 하단 플로팅 모드바 (상단 툴바 완전 제거)
//    - toolOrb v5 완전 이식 (FSM, 드래그 도구 순환, 색상/굵기 슬라이딩)
//    - 터치 입력 개선 (팜 리젝션, 스크롤↔그리기 구분, 핀치줌)
//    - Chrome 상단바 모바일 스크롤 (저장 버튼 항상 접근 가능)
// ═══════════════════════════════════════════════════════════════

/* ──────────────────────────────────────────────────
   전역 상태 DS
────────────────────────────────────────────────── */
const DS = {
  pages: [],           // { id, type, cardEl, contentEl, annotSvg, strokes[], overlayEl, overlays[] }
  currentPageIdx: -1,
  mode: 'pan',         // 'pan' | 'annotate' | 'text' | 'lasso'
  annot: { tool: 'pen', color: '#1a1714', sw: 2, opacity: 1 },
  zoom: 1,
  titleSaved: false,
};

let pageIdCounter = 0;
const SVG_NS = 'http://www.w3.org/2000/svg';

/* ──────────────────────────────────────────────────
   DOM refs (init() 에서 채워짐)
────────────────────────────────────────────────── */
let viewer, pageList, emptyState, pageCtxMenu;
let ctxTargetIdx = -1;
let snackTimer;

/* ══════════════════════════════════════════════════
   유틸
══════════════════════════════════════════════════ */
const mkSvg = tag => document.createElementNS(SVG_NS, tag);
const qs  = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

function showSnack(msg, isError = false, dur = 2600) {
  const el = document.getElementById('snack');
  if (!el) return;
  el.textContent = msg;
  el.className = 'visible' + (isError ? ' error' : '');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.className = '', dur);
}

function showLoading(msg = '불러오는 중…') {
  const t = document.getElementById('loading-text');
  if (t) t.textContent = msg;
  document.getElementById('loading-overlay')?.classList.add('active');
}
function hideLoading() {
  document.getElementById('loading-overlay')?.classList.remove('active');
}

function updateEmptyState() {
  emptyState?.classList.toggle('hidden', DS.pages.length > 0);
}

function updateZoomLabel() {
  const el = document.getElementById('zoom-label');
  if (el) el.textContent = Math.round(DS.zoom * 100) + '%';
}

/* ══════════════════════════════════════════════════
   줌
══════════════════════════════════════════════════ */
function applyZoom(z) {
  DS.zoom = Math.max(0.4, Math.min(2.5, z));
  document.querySelectorAll('.page-card').forEach(c => {
    c.style.maxWidth = Math.round(860 * DS.zoom) + 'px';
  });
  updateZoomLabel();
}

/* ══════════════════════════════════════════════════
   사이드바 페이지 목록
══════════════════════════════════════════════════ */
function rebuildPageList() {
  if (!pageList) return;
  pageList.innerHTML = '';
  DS.pages.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'page-item' + (i === DS.currentPageIdx ? ' active' : '');
    item.dataset.idx = i;

    const thumb = document.createElement('div');
    thumb.className = 'page-item-thumb';
    if (p.type === 'blank') {
      thumb.textContent = 'A'; thumb.style.fontWeight = '700'; thumb.style.color = 'var(--ink-3)';
    } else {
      const src = p.thumbCanvas || p.thumbImg;
      if (src instanceof HTMLCanvasElement) {
        const img = document.createElement('img');
        img.src = src.toDataURL('image/jpeg', 0.6);
        thumb.appendChild(img);
      } else if (src instanceof HTMLImageElement) {
        const imgCopy = document.createElement('img');
        imgCopy.src = src.src; thumb.appendChild(imgCopy);
      }
    }

    const info = document.createElement('div');
    info.className = 'page-item-info';
    const label = document.createElement('div');
    label.className = 'page-item-label';
    label.textContent = p.label || `페이지 ${i + 1}`;
    const sub = document.createElement('div');
    sub.className = 'page-item-sub';
    sub.textContent = p.type === 'pdf' ? 'PDF' : p.type === 'image' ? '이미지' : '문서';
    info.appendChild(label); info.appendChild(sub);

    const menuBtn = document.createElement('button');
    menuBtn.className = 'page-item-menu';
    menuBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <circle cx="6.5" cy="2.5" r="1" fill="currentColor"/>
      <circle cx="6.5" cy="6.5" r="1" fill="currentColor"/>
      <circle cx="6.5" cy="10.5" r="1" fill="currentColor"/>
    </svg>`;
    menuBtn.addEventListener('click', e => { e.stopPropagation(); openCtxMenu(i, e.clientX, e.clientY); });

    item.appendChild(thumb); item.appendChild(info); item.appendChild(menuBtn);
    item.addEventListener('click', () => scrollToPage(i));
    pageList.appendChild(item);
  });
  updateEmptyState();
}

function setActivePageInSidebar(idx) {
  DS.currentPageIdx = idx;
  qsa('.page-item', pageList).forEach((item, i) => item.classList.toggle('active', i === idx));
}

function scrollToPage(idx) {
  const p = DS.pages[idx];
  if (!p) return;
  p.cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setActivePageInSidebar(idx);
}

/* ══════════════════════════════════════════════════
   IntersectionObserver
══════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════
   페이지 카드 생성
══════════════════════════════════════════════════ */
function createPageCard(p, idx) {
  const card = document.createElement('div');
  card.className = 'page-card';
  card.dataset.pageIdx = idx;

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

  const stickyBtn = createActionBtn(`<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <rect x="1.5" y="1.5" width="10" height="10" rx="1" fill="#fef3c7" stroke="#d97706" stroke-width="1.2"/>
    <path d="M4 4.5H9M4 6.5H9M4 8.5H7" stroke="#d97706" stroke-width="1.1" stroke-linecap="round"/>
  </svg>`, '포스트잇 추가', () => addStickyToPage(DS.pages.indexOf(p)));

  const cardBtn = createActionBtn(`<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <rect x="1.5" y="1.5" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/>
    <rect x="1.5" y="1.5" width="10" height="3.5" rx="1.5" fill="currentColor" opacity="0.15"/>
    <path d="M4 7.5H9M4 9.5H7.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
  </svg>`, '카드 추가', () => addCardToPage(DS.pages.indexOf(p)));

  const menuBtn = document.createElement('button');
  menuBtn.className = 'page-action-btn';
  menuBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="3" r="1.2" fill="currentColor"/>
    <circle cx="7" cy="7" r="1.2" fill="currentColor"/>
    <circle cx="7" cy="11" r="1.2" fill="currentColor"/>
  </svg>`;
  menuBtn.addEventListener('click', e => { e.stopPropagation(); openCtxMenu(DS.pages.indexOf(p), e.clientX, e.clientY); });

  const upBtn   = createActionBtn(`<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 10V3M4 5.5L6.5 3L9 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`, '위로', () => movePageUp(DS.pages.indexOf(p)));
  const downBtn = createActionBtn(`<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 3V10M4 7.5L6.5 10L9 7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`, '아래로', () => movePageDown(DS.pages.indexOf(p)));
  const delBtn  = createActionBtn(`<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 4H11L10 11.5H3L2 4Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M1 4H12M4.5 4V2.5H8.5V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`, '삭제', () => deletePage(DS.pages.indexOf(p)));
  delBtn.style.color = 'var(--accent)';

  [stickyBtn, cardBtn, upBtn, downBtn, menuBtn, delBtn].forEach(b => headerActions.appendChild(b));
  header.appendChild(headerLeft);
  header.appendChild(headerActions);

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

/* ══════════════════════════════════════════════════
   SVG 주석 레이어
══════════════════════════════════════════════════ */
function createAnnotLayer(pageData, bodyEl) {
  const svgWrap = document.createElement('div');
  svgWrap.className = 'annot-svg-wrap';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;';
  svg.setAttribute('class', 'annot-overlay');
  svgWrap.appendChild(svg);
  bodyEl.style.position = 'relative';
  bodyEl.appendChild(svgWrap);

  pageData.annotSvg = svg;
  pageData.strokes  = [];

  let drawing = false, pts = [], livePath = null;
  // 팜 리젝션: 동시에 2개 이상 터치면 그리기 취소
  let activePointerId = null;

  svg.addEventListener('pointerdown', e => {
    if (DS.mode !== 'annotate') return;
    // 팜 리젝션: 이미 다른 포인터가 활성이면 무시
    if (activePointerId !== null && e.pointerId !== activePointerId) return;
    e.preventDefault(); e.stopPropagation();
    svg.setPointerCapture(e.pointerId);
    activePointerId = e.pointerId;

    const { bx, by } = clientToSvg(svg, e.clientX, e.clientY);
    if (DS.annot.tool === 'eraser') {
      eraseAt(pageData, { x: bx, y: by });
    } else {
      drawing = true;
      pts = [{ x: bx, y: by }];
      livePath = mkSvg('path');
      livePath.setAttribute('fill', 'none');
      applyStrokeStyle(livePath);
      svg.appendChild(livePath);
    }
  });

  svg.addEventListener('pointermove', e => {
    if (DS.mode !== 'annotate') return;
    if (e.pointerId !== activePointerId) return;
    const { bx, by } = clientToSvg(svg, e.clientX, e.clientY);
    if (DS.annot.tool === 'eraser' && e.buttons) {
      eraseAt(pageData, { x: bx, y: by });
    } else if (drawing) {
      pts.push({ x: bx, y: by });
      if (livePath) livePath.setAttribute('d', pts2path(pts));
    }
  });

  svg.addEventListener('pointerup', e => {
    if (e.pointerId === activePointerId) activePointerId = null;
    if (DS.annot.tool === 'eraser') return;
    if (!drawing || pts.length < 2) {
      livePath?.parentNode && livePath.remove();
      drawing = false; pts = []; livePath = null; return;
    }
    if (livePath) {
      applyStrokeStyle(livePath);
      livePath.setAttribute('d', pts2path(pts));
      pageData.strokes.push({ el: livePath, attrs: getStrokeAttrs() });
    }
    drawing = false; pts = []; livePath = null;
  });

  svg.addEventListener('pointercancel', e => {
    if (e.pointerId === activePointerId) activePointerId = null;
    drawing = false;
    if (livePath?.parentNode) livePath.remove();
    livePath = null; pts = [];
  });
}

function applyStrokeStyle(el) {
  const isHL = DS.annot.tool === 'highlight';
  const col = isHL
    ? DS.annot.color + Math.round(DS.annot.opacity * 0.55 * 255).toString(16).padStart(2,'0')
    : DS.annot.color;
  el.setAttribute('stroke', col);
  el.setAttribute('stroke-opacity', isHL ? 1 : DS.annot.opacity);
  el.setAttribute('stroke-width', isHL ? DS.annot.sw * 5 : DS.annot.sw);
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
}

function getStrokeAttrs() {
  const isHL = DS.annot.tool === 'highlight';
  const col = isHL
    ? DS.annot.color + Math.round(DS.annot.opacity * 0.55 * 255).toString(16).padStart(2,'0')
    : DS.annot.color;
  return {
    stroke: col,
    'stroke-opacity': isHL ? 1 : DS.annot.opacity,
    'stroke-width': isHL ? DS.annot.sw * 5 : DS.annot.sw,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none',
  };
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
    } catch {}
  }
}

function undoAnnot(pageData) {
  if (!pageData?.strokes.length) return;
  pageData.strokes.pop().el.remove();
  showSnack('주석 취소');
}

function clearAnnot(pageData) {
  if (!pageData) return;
  if (!confirm('이 페이지의 주석을 모두 지우겠습니까?')) return;
  pageData.strokes.forEach(s => s.el.remove());
  pageData.strokes = [];
  showSnack('주석 지우기 완료');
}

/* ══════════════════════════════════════════════════
   오버레이 레이어
══════════════════════════════════════════════════ */
function ensureOverlayLayer(pageData, bodyEl) {
  if (pageData.overlayEl) return pageData.overlayEl;
  const layer = document.createElement('div');
  layer.className = 'page-overlay-layer';
  bodyEl.appendChild(layer);
  pageData.overlayEl = layer;
  pageData.overlays  = [];
  return layer;
}

/* ══════════════════════════════════════════════════
   포스트잇
══════════════════════════════════════════════════ */
const STICKY_COLORS = ['#fef3c7','#fce7f3','#d1fae5','#dbeafe','#ede9fe','#fee2e2','#fef9c3'];

function addStickyToPage(pageIdx) {
  const p = DS.pages[pageIdx];
  if (!p) { showSnack('페이지가 없습니다', true); return; }

  const layer = ensureOverlayLayer(p, p.cardEl.querySelector('.page-body'));
  let colorIdx = Math.floor(Math.random() * STICKY_COLORS.length);

  const sticky = document.createElement('div');
  sticky.className = 'doc-sticky';
  sticky.style.cssText = `left:${30 + Math.random()*60}px;top:${30+Math.random()*60}px;background:${STICKY_COLORS[colorIdx]};`;

  const bar = document.createElement('div');
  bar.className = 'doc-sticky-bar';

  const colorBtn = document.createElement('button');
  colorBtn.className = 'doc-sticky-btn';
  colorBtn.title = '색상 변경';
  colorBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" stroke-width="1.3"/>
    <circle cx="5.5" cy="5.5" r="2" fill="currentColor" opacity="0.4"/>
  </svg>`;
  colorBtn.addEventListener('click', e => {
    e.stopPropagation();
    colorIdx = (colorIdx + 1) % STICKY_COLORS.length;
    sticky.style.background = STICKY_COLORS[colorIdx];
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'doc-sticky-btn doc-sticky-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    sticky.remove();
    const i2 = p.overlays.indexOf(sticky);
    if (i2 >= 0) p.overlays.splice(i2, 1);
  });

  bar.appendChild(colorBtn); bar.appendChild(closeBtn);

  const ta = document.createElement('textarea');
  ta.className = 'doc-sticky-ta';
  ta.placeholder = '메모를 입력하세요…';

  sticky.appendChild(bar); sticky.appendChild(ta);
  makeDraggable(sticky, bar, layer);
  layer.appendChild(sticky);
  p.overlays.push(sticky);
  showSnack('포스트잇 추가');
  ta.focus();
}

/* ══════════════════════════════════════════════════
   카드 창
══════════════════════════════════════════════════ */
function addCardToPage(pageIdx) {
  const p = DS.pages[pageIdx];
  if (!p) { showSnack('페이지가 없습니다', true); return; }

  const layer = ensureOverlayLayer(p, p.cardEl.querySelector('.page-body'));

  const card = document.createElement('div');
  card.className = 'doc-card';
  card.style.cssText = `left:${40+Math.random()*80}px;top:${40+Math.random()*80}px;`;

  const header = document.createElement('div');
  header.className = 'doc-card-header';

  const title = document.createElement('div');
  title.className = 'doc-card-title';
  title.contentEditable = 'true';
  title.dataset.placeholder = '제목을 입력하세요';
  title.spellcheck = false;

  const cardActions = document.createElement('div');
  cardActions.className = 'doc-card-actions';

  const subContainer = document.createElement('div');
  subContainer.className = 'doc-card-sub-container';

  const addSubBtn = document.createElement('button');
  addSubBtn.className = 'doc-card-btn';
  addSubBtn.title = '블록 추가';
  addSubBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 2V9M2 5.5H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  addSubBtn.addEventListener('click', e => { e.stopPropagation(); addSubBlock(subContainer, card); });

  const closeCardBtn = document.createElement('button');
  closeCardBtn.className = 'doc-card-btn doc-card-close';
  closeCardBtn.textContent = '✕';
  closeCardBtn.addEventListener('click', e => {
    e.stopPropagation();
    card.remove();
    const i2 = p.overlays.indexOf(card);
    if (i2 >= 0) p.overlays.splice(i2, 1);
  });

  cardActions.appendChild(addSubBtn); cardActions.appendChild(closeCardBtn);
  header.appendChild(title); header.appendChild(cardActions);

  const body = document.createElement('div');
  body.className = 'doc-card-body';
  body.contentEditable = 'true';
  body.dataset.placeholder = '내용을 입력하세요…';
  body.spellcheck = false;

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'doc-card-resize';
  makeResizable(card, resizeHandle);

  card.appendChild(header); card.appendChild(body);
  card.appendChild(subContainer); card.appendChild(resizeHandle);

  makeDraggable(card, header, layer);
  layer.appendChild(card);
  p.overlays.push(card);

  card.addEventListener('pointerdown', () => bringToFront(card, layer));
  showSnack('카드 추가');
  title.focus();
}

function addSubBlock(container, _cardEl) {
  const sub = document.createElement('div');
  sub.className = 'doc-sub-block';

  const subHeader = document.createElement('div');
  subHeader.className = 'doc-sub-header';

  const subTitle = document.createElement('div');
  subTitle.className = 'doc-sub-title';
  subTitle.contentEditable = 'true';
  subTitle.dataset.placeholder = '블록 제목';
  subTitle.spellcheck = false;

  const subDelBtn = document.createElement('button');
  subDelBtn.className = 'doc-card-btn doc-card-close';
  subDelBtn.textContent = '✕';
  subDelBtn.addEventListener('click', e => { e.stopPropagation(); sub.remove(); });

  subHeader.appendChild(subTitle); subHeader.appendChild(subDelBtn);

  const subContent = document.createElement('div');
  subContent.className = 'doc-sub-content';
  subContent.contentEditable = 'true';
  subContent.dataset.placeholder = '내용';
  subContent.spellcheck = false;

  const subResize = document.createElement('div');
  subResize.className = 'doc-card-resize';
  makeResizable(sub, subResize);

  sub.appendChild(subHeader); sub.appendChild(subContent); sub.appendChild(subResize);
  container.appendChild(sub);
  makeDraggableInContainer(sub, subHeader, container);
  subContent.focus();
}

/* ══════════════════════════════════════════════════
   드래그 / 리사이즈 헬퍼
══════════════════════════════════════════════════ */
function makeDraggable(el, handle, container) {
  let ox, oy, sx, sy, dragging = false;

  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    e.preventDefault(); e.stopPropagation();
    dragging = true;
    ox = el.offsetLeft; oy = el.offsetTop;
    sx = e.clientX;     sy = e.clientY;
    el.style.transition = 'none';
    bringToFront(el, container);
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    el.style.left = Math.max(0, ox + e.clientX - sx) + 'px';
    el.style.top  = Math.max(0, oy + e.clientY - sy) + 'px';
  });

  handle.addEventListener('pointerup',    () => { dragging = false; });
  handle.addEventListener('pointercancel',() => { dragging = false; });
}

function makeDraggableInContainer(el, handle, container) {
  let ox, oy, sx, sy, dragging = false;

  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    e.preventDefault(); e.stopPropagation();
    dragging = true;
    ox = el.offsetLeft; oy = el.offsetTop;
    sx = e.clientX;     sy = e.clientY;
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const maxX = container.clientWidth  - el.offsetWidth;
    const maxY = container.clientHeight - el.offsetHeight;
    el.style.left = Math.max(0, Math.min(ox + e.clientX - sx, maxX)) + 'px';
    el.style.top  = Math.max(0, Math.min(oy + e.clientY - sy, maxY)) + 'px';
  });

  handle.addEventListener('pointerup',    () => { dragging = false; });
  handle.addEventListener('pointercancel',() => { dragging = false; });
}

function makeResizable(el, handle) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const w0 = el.offsetWidth, h0 = el.offsetHeight;
    const sx = e.clientX, sy = e.clientY;
    handle.setPointerCapture(e.pointerId);

    function onMove(ev) {
      el.style.width  = Math.max(160, w0 + ev.clientX - sx) + 'px';
      el.style.height = Math.max(100, h0 + ev.clientY - sy) + 'px';
    }
    function onUp() {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

function bringToFront(el, container) {
  let maxZ = 10;
  container.querySelectorAll('.doc-sticky, .doc-card').forEach(c => {
    const z = parseInt(c.style.zIndex || '10');
    if (z > maxZ) maxZ = z;
  });
  el.style.zIndex = maxZ + 1;
}

/* ══════════════════════════════════════════════════
   ════════════════════════════════════════════════
   toolOrb v5  — 무한캔버스에서 완전 이식
   FSM: HIDDEN → SHOWN → HOLD → TOOL_DRAG
   ════════════════════════════════════════════════
══════════════════════════════════════════════════ */

/* ─── 상수 ─────────────────────────────────────── */
const ORB_SIZE       = 52;
const LONGPRESS_MS   = 380;
const TAP_TIME_THRESH = 260;
const DOUBLE_TAP_MS  = 340;
const DRAG_THRESH    = 8;           // 드래그 vs 탭 구분 픽셀
const DIR_LOCK_DIST  = 14;
const STROKE_DRAG_THRESH = 56;     // 위로 드래그: 굵기 변경
const COLOR_DRAG_THRESH  = 56;     // 아래로 드래그: 색상 변경
const ORB_DIST_MIN   = 78;
const ORB_DIST_MAX   = 176;
const ORB_FOLLOW_SPEED = 0.14;
const ORB_PUSH_SPEED   = 0.38;

const ORB_FSM = { HIDDEN:'HIDDEN', SHOWN:'SHOWN', HOLD:'HOLD', TOOL_DRAG:'TOOL_DRAG' };

/* ─── Orb 색상 & 레이블 ─────────────────────────── */
const ORB_TOOL_COLORS = {
  pen:       '#1a1714',
  highlight: '#f59e0b',
  eraser:    '#6b7280',
  sticky:    '#d97706',
  card:      '#2563eb',
};
const ORB_TOOL_LABELS = {
  pen: '펜', highlight: '형광펜', eraser: '지우개', sticky: '포스트잇', card: '카드',
};
const ORB_TOOLS_LIST = ['pen','highlight','eraser','sticky','card'];

/* ─── 굵기 단계 ─────────────────────────────────── */
const STROKE_STEPS = [1, 2, 4, 7, 12, 20];
const COLOR_STEPS  = ['#1a1714','#c84b2f','#2b6cb0','#2d8a4e','#7c3d9e','#e8a320','#ffffff'];

/* ─── 상태 ──────────────────────────────────────── */
let orbFsm      = ORB_FSM.HIDDEN;
let orbEl       = null;
let orbLabelEl  = null;
let orbDotEl    = null;
let orbBadgeEl  = null;
let orbRingEl   = null;  // 방향 힌트 링 (ring CSS element)
let orbGhostEl  = null;

let orbX = -300, orbY = -300;       // 현재 시각 위치
let orbTX = -300, orbTY = -300;     // 타겟 위치
let orbRAF = null;

let orbLpTimer  = null;             // 롱프레스 타이머
let orbDownPX = 0, orbDownPY = 0;   // 포인터다운 시작점
let orbDownTime = 0;
let orbLastTapTime = 0;
let orbActiveTool = null;           // 현재 활성 도구

let orbDragOriginX = 0, orbDragOriginY = 0;
let orbDragDir = null;              // 'up' | 'down' | null
let orbToolIdx = 0;                 // 현재 도구 인덱스
let orbStrokeStep = 1;              // 굵기 단계 (index into STROKE_STEPS)
let orbColorStep  = 0;              // 색상 단계

/* ─── toolOrb 초기화 ────────────────────────────── */
function initToolOrb() {
  // --- DOM 구성 ---
  orbEl = document.getElementById('doc-orb');
  orbLabelEl = document.getElementById('doc-orb-label');
  orbBadgeEl = document.getElementById('doc-orb-badge');
  orbRingEl  = document.getElementById('doc-orb-ring');
  orbGhostEl = document.getElementById('doc-orb-ghost');

  // orb-label 내부에 dot + text 구조 구성
  orbLabelEl.innerHTML = '';
  orbDotEl = document.createElement('div');
  orbDotEl.id = 'orb-dot-inner';
  orbDotEl.style.cssText = 'width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,0.9);flex-shrink:0;transition:background .2s;';

  const orbTextEl = document.createElement('div');
  orbTextEl.id = 'orb-text';
  orbTextEl.style.cssText = 'font-size:9px;font-weight:600;color:rgba(255,255,255,0.85);letter-spacing:0.04em;margin-top:2px;white-space:nowrap;';

  orbLabelEl.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;gap:0;';
  orbLabelEl.appendChild(orbDotEl);
  orbLabelEl.appendChild(orbTextEl);

  // 포인터 이벤트
  orbEl.addEventListener('pointerdown', onOrbPointerDown);

  // 현재 도구 초기화
  _syncOrbToCurrentTool();

  // 뷰어 트리거 (터치 롱프레스 / 마우스 우클릭)
  _initOrbTrigger();

  // 전역 포인터업 → orb 닫기
  document.addEventListener('pointerdown', e => {
    if (orbFsm === ORB_FSM.HIDDEN) return;
    if (orbEl.contains(e.target)) return;
    _orbHide();
  }, { capture: false });
}

/* ─── Orb 위치 업데이트 (RAF smooth follow) ────── */
function _startOrbFollow() {
  if (orbRAF) return;
  function loop() {
    if (orbFsm === ORB_FSM.HIDDEN) { orbRAF = null; return; }
    const dx = orbTX - orbX, dy = orbTY - orbY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const spd = dist > 60 ? ORB_PUSH_SPEED : ORB_FOLLOW_SPEED;
    orbX += dx * spd; orbY += dy * spd;
    // 화면 안 클램핑
    const PAD = ORB_SIZE / 2 + 8;
    orbX = Math.max(PAD, Math.min(window.innerWidth  - PAD, orbX));
    orbY = Math.max(PAD, Math.min(window.innerHeight - PAD, orbY));
    orbEl.style.transform = `translate(calc(${orbX}px - 50%), calc(${orbY}px - 50%))`;
    orbRAF = requestAnimationFrame(loop);
  }
  orbRAF = requestAnimationFrame(loop);
}

function _stopOrbFollow() {
  if (orbRAF) { cancelAnimationFrame(orbRAF); orbRAF = null; }
}

/* ─── Orb 표시 / 숨기기 ─────────────────────────── */
function _orbShow(x, y) {
  orbX = x; orbY = y; orbTX = x; orbTY = y;
  orbEl.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;
  orbEl.classList.add('orb-visible');
  orbEl.classList.remove('orb-spawning');
  void orbEl.offsetWidth; // reflow
  orbEl.classList.add('orb-spawning');
  orbFsm = ORB_FSM.SHOWN;
  _startOrbFollow();
  _syncOrbToCurrentTool();
}

function _orbHide() {
  orbEl.classList.remove('orb-visible', 'orb-spawning', 'orb-active', 'orb-tool-on');
  orbBadgeEl.textContent = '';
  orbBadgeEl.style.opacity = '0';
  _hideOrbRing();
  _stopOrbFollow();
  orbFsm = ORB_FSM.HIDDEN;
  clearTimeout(orbLpTimer);
}

/* ─── 현재 도구를 Orb에 반영 ───────────────────── */
function _syncOrbToCurrentTool() {
  const tool = DS.annot.tool;
  const col  = ORB_TOOL_COLORS[tool] || 'rgba(255,255,255,0.9)';
  if (orbDotEl)  orbDotEl.style.background = col;
  const textEl = document.getElementById('orb-text');
  if (textEl)    textEl.textContent = ORB_TOOL_LABELS[tool] || '';
  orbActiveTool = tool;
  orbToolIdx = ORB_TOOLS_LIST.indexOf(tool);
  if (orbToolIdx < 0) orbToolIdx = 0;
}

/* ─── 방향 힌트 링 ──────────────────────────────── */
function _showOrbRing(x, y, size) {
  orbRingEl.style.cssText = `
    position:fixed; left:${x}px; top:${y}px;
    width:${size}px; height:${size}px;
    border-radius:50%; border:1.5px dashed rgba(26,23,20,.18);
    pointer-events:none; z-index:7999;
    transform:translate(-50%,-50%);
    opacity:1; transition:opacity .2s;
  `;
  orbRingEl.classList.add('hint-visible');
}

function _hideOrbRing() {
  orbRingEl?.classList.remove('hint-visible');
  if (orbRingEl) orbRingEl.style.opacity = '0';
}

/* ─── 배지 / 프리뷰 ─────────────────────────────── */
function _setBadge(txt) {
  if (!orbBadgeEl) return;
  orbBadgeEl.textContent = txt;
  orbBadgeEl.style.opacity = txt ? '1' : '0';
}

function _showGhost(txt, x, y) {
  if (!orbGhostEl) return;
  orbGhostEl.textContent = txt;
  orbGhostEl.style.left = x + 'px';
  orbGhostEl.style.top  = (y - 40) + 'px';
  orbGhostEl.classList.add('ghost-active');
}
function _hideGhost() {
  orbGhostEl?.classList.remove('ghost-active');
}

/* ─── Orb 포인터다운 ────────────────────────────── */
function onOrbPointerDown(e) {
  e.preventDefault(); e.stopPropagation();
  orbEl.setPointerCapture(e.pointerId);
  orbDownPX = e.clientX; orbDownPY = e.clientY;
  orbDownTime = Date.now();
  orbFsm = ORB_FSM.HOLD;
  orbEl.classList.add('orb-active');

  clearTimeout(orbLpTimer);
  orbLpTimer = setTimeout(() => {
    // 롱프레스 → TOOL_DRAG 모드
    orbFsm = ORB_FSM.TOOL_DRAG;
    orbDragOriginX = orbX; orbDragOriginY = orbY;
    orbDragDir = null;
    _showOrbRing(orbX, orbY, 160);
    _setBadge('↑굵기  ↓색상');
    navigator.vibrate?.(10);
  }, LONGPRESS_MS);

  orbEl.addEventListener('pointermove', _onOrbMove);
  orbEl.addEventListener('pointerup',   _onOrbUp);
  orbEl.addEventListener('pointercancel', _onOrbUp);
}

function _onOrbMove(e) {
  const dx = e.clientX - orbDownPX;
  const dy = e.clientY - orbDownPY;
  const dist = Math.sqrt(dx*dx + dy*dy);

  if (orbFsm === ORB_FSM.HOLD && dist > DRAG_THRESH) {
    clearTimeout(orbLpTimer);
    orbFsm = ORB_FSM.SHOWN; // 재위치 드래그
  }

  if (orbFsm === ORB_FSM.SHOWN) {
    // Orb 재위치: 터치 위치 따라 이동
    const nx = Math.max(ORB_SIZE/2+4, Math.min(window.innerWidth  - ORB_SIZE/2-4, e.clientX - 10));
    const ny = Math.max(ORB_SIZE/2+4, Math.min(window.innerHeight - ORB_SIZE/2-4, e.clientY - 10));
    orbTX = nx; orbTY = ny;
    return;
  }

  if (orbFsm === ORB_FSM.TOOL_DRAG) {
    const totalDy = e.clientY - orbDragOriginY;
    const totalDx = e.clientX - orbDragOriginX;

    // 방향 잠금
    if (!orbDragDir && (Math.abs(totalDy) > DIR_LOCK_DIST || Math.abs(totalDx) > DIR_LOCK_DIST)) {
      orbDragDir = Math.abs(totalDy) >= Math.abs(totalDx)
        ? (totalDy < 0 ? 'up' : 'down')
        : 'h';
    }

    if (orbDragDir === 'up') {
      // ↑ 위로: 굵기 조절
      const step = Math.floor(-totalDy / STROKE_DRAG_THRESH * STROKE_STEPS.length);
      const newStep = Math.max(0, Math.min(STROKE_STEPS.length - 1, orbStrokeStep + step));
      DS.annot.sw = STROKE_STEPS[newStep];
      _setBadge('굵기 ' + DS.annot.sw + 'px');
      _showGhost('굵기 ' + DS.annot.sw + 'px', orbX, orbY);
      _updateModeBarUI();
    } else if (orbDragDir === 'down') {
      // ↓ 아래: 색상 조절
      const step = Math.floor(totalDy / COLOR_DRAG_THRESH);
      const newStep = Math.max(0, Math.min(COLOR_STEPS.length - 1, orbColorStep + step));
      DS.annot.color = COLOR_STEPS[newStep];
      _setBadge(COLOR_STEPS[newStep]);
      if (orbDotEl) orbDotEl.style.background = COLOR_STEPS[newStep];
      _showGhost(COLOR_STEPS[newStep], orbX, orbY);
      _updateModeBarUI();
    } else if (orbDragDir === 'h') {
      // ← → 수평: 도구 변경
      const step = Math.round(totalDx / 60);
      const newIdx = ((orbToolIdx + step) % ORB_TOOLS_LIST.length + ORB_TOOLS_LIST.length) % ORB_TOOLS_LIST.length;
      const newTool = ORB_TOOLS_LIST[newIdx];
      _setBadge(ORB_TOOL_LABELS[newTool]);
      if (orbDotEl) orbDotEl.style.background = ORB_TOOL_COLORS[newTool] || 'rgba(255,255,255,0.9)';
      _showGhost(ORB_TOOL_LABELS[newTool], orbX, orbY);
    }
  }
}

function _onOrbUp(e) {
  orbEl.removeEventListener('pointermove', _onOrbMove);
  orbEl.removeEventListener('pointerup',   _onOrbUp);
  orbEl.removeEventListener('pointercancel', _onOrbUp);
  orbEl.classList.remove('orb-active');
  clearTimeout(orbLpTimer);
  _hideOrbRing();
  _hideGhost();

  const held = Date.now() - orbDownTime;
  const dx   = e.clientX - orbDownPX;
  const dy   = e.clientY - orbDownPY;
  const dist = Math.sqrt(dx*dx + dy*dy);

  if (orbFsm === ORB_FSM.TOOL_DRAG) {
    // 최종 결정
    if (orbDragDir === 'up') {
      // 굵기 확정
      const step = Math.floor(-((e.clientY - orbDragOriginY)) / STROKE_DRAG_THRESH * STROKE_STEPS.length);
      orbStrokeStep = Math.max(0, Math.min(STROKE_STEPS.length - 1, orbStrokeStep + step));
      DS.annot.sw = STROKE_STEPS[orbStrokeStep];
      showSnack('굵기 ' + DS.annot.sw + 'px');
    } else if (orbDragDir === 'down') {
      const step = Math.floor(((e.clientY - orbDragOriginY)) / COLOR_DRAG_THRESH);
      orbColorStep = Math.max(0, Math.min(COLOR_STEPS.length - 1, orbColorStep + step));
      DS.annot.color = COLOR_STEPS[orbColorStep];
      if (orbDotEl) orbDotEl.style.background = DS.annot.color;
      showSnack('색상 변경');
    } else if (orbDragDir === 'h') {
      const totalDx = e.clientX - orbDragOriginX;
      const step = Math.round(totalDx / 60);
      const newIdx = ((orbToolIdx + step) % ORB_TOOLS_LIST.length + ORB_TOOLS_LIST.length) % ORB_TOOLS_LIST.length;
      const newTool = ORB_TOOLS_LIST[newIdx];
      orbToolIdx = newIdx;
      _activateOrbTool(newTool);
    }
    _updateModeBarUI();
    orbFsm = ORB_FSM.SHOWN;
    _setBadge('');
    setTimeout(_orbHide, 800);
    return;
  }

  if (orbFsm === ORB_FSM.HOLD && held < TAP_TIME_THRESH && dist < DRAG_THRESH) {
    // 단순 탭 → 이중 탭 체크
    const now = Date.now();
    if (now - orbLastTapTime < DOUBLE_TAP_MS) {
      // 더블 탭 → 다음 도구로 순환
      orbToolIdx = (orbToolIdx + 1) % ORB_TOOLS_LIST.length;
      _activateOrbTool(ORB_TOOLS_LIST[orbToolIdx]);
    } else {
      // 단탭 → 닫기
      _orbHide(); return;
    }
    orbLastTapTime = 0;
  } else {
    orbLastTapTime = Date.now();
  }

  orbFsm = ORB_FSM.SHOWN;
}

/* ─── 도구 실제 활성화 ──────────────────────────── */
function _activateOrbTool(tool) {
  if (tool === 'sticky') {
    const idx = getCurrentVisiblePageIdx();
    if (idx >= 0) addStickyToPage(idx);
    _orbHide(); return;
  }
  if (tool === 'card') {
    const idx = getCurrentVisiblePageIdx();
    if (idx >= 0) addCardToPage(idx);
    _orbHide(); return;
  }
  // 그리기 도구
  setMode('annotate');
  DS.annot.tool = tool;
  DS.pages.forEach(updateAnnotMode);
  _syncOrbToCurrentTool();
  _updateModeBarUI();
  showSnack(ORB_TOOL_LABELS[tool] + ' 선택');
}

/* ─── Orb 트리거 설정 ───────────────────────────── */
function _initOrbTrigger() {
  // 터치: 뷰어에서 길게 누름
  let touchTimer = null, txS, tyS;
  let pinchActive = false;

  viewer.addEventListener('touchstart', e => {
    if (e.touches.length === 2) { pinchActive = true; clearTimeout(touchTimer); touchTimer = null; return; }
    if (e.touches.length !== 1 || pinchActive) return;
    txS = e.touches[0].clientX; tyS = e.touches[0].clientY;
    touchTimer = setTimeout(() => {
      if (orbFsm === ORB_FSM.HIDDEN || orbFsm === ORB_FSM.SHOWN) {
        _orbShow(txS, tyS - 54);
      }
    }, LONGPRESS_MS);
  }, { passive: true });

  viewer.addEventListener('touchmove', e => {
    if (e.touches.length === 2) { clearTimeout(touchTimer); touchTimer = null; return; }
    if (!touchTimer) return;
    const dx = e.touches[0].clientX - txS;
    const dy = e.touches[0].clientY - tyS;
    if (Math.hypot(dx, dy) > DRAG_THRESH) { clearTimeout(touchTimer); touchTimer = null; }
  }, { passive: true });

  viewer.addEventListener('touchend', () => {
    clearTimeout(touchTimer); touchTimer = null;
    setTimeout(() => { pinchActive = false; }, 100);
  }, { passive: true });

  // 마우스 우클릭: Orb 스폰
  viewer.addEventListener('contextmenu', e => {
    e.preventDefault();
    _orbShow(e.clientX, e.clientY - 54);
  });
}

/* ══════════════════════════════════════════════════
   핀치 줌 (터치 2손가락)
══════════════════════════════════════════════════ */
function initPinchZoom() {
  let lastDist = 0, pinching = false;

  viewer.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      pinching = true;
      lastDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });

  viewer.addEventListener('touchmove', e => {
    if (!pinching || e.touches.length !== 2) return;
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const delta = (dist - lastDist) / lastDist;
    if (Math.abs(delta) > 0.01) {
      applyZoom(DS.zoom * (1 + delta * 0.8));
      lastDist = dist;
    }
  }, { passive: true });

  viewer.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinching = false;
  }, { passive: true });
}

/* ══════════════════════════════════════════════════
   스크롤 vs 그리기 구분 (pan 모드에서만 스크롤)
══════════════════════════════════════════════════ */
function updateViewerTouchAction() {
  // pan 모드: 자유 스크롤, annotate 모드: 그리기를 위해 스크롤 차단
  if (DS.mode === 'pan') {
    viewer.style.touchAction = 'pan-y';
    viewer.style.overflowY   = 'auto';
  } else if (DS.mode === 'annotate') {
    viewer.style.touchAction = 'none';
    viewer.style.overflowY   = 'auto'; // 스크롤은 유지 (annotSvg의 touch-action:none이 그리기 잡음)
  } else {
    viewer.style.touchAction = 'pan-y';
    viewer.style.overflowY   = 'auto';
  }
}

/* ══════════════════════════════════════════════════
   빈 페이지 추가
══════════════════════════════════════════════════ */
function addBlankPage(insertIdx = -1) {
  const id = ++pageIdCounter;
  const pageData = {
    id, type: 'blank', label: `문서 ${id}`,
    cardEl: null, contentEl: null, annotSvg: null, strokes: [],
    overlayEl: null, overlays: [], thumbCanvas: null, thumbImg: null,
  };

  const { card, body, badge } = createPageCard(pageData, DS.pages.length);
  pageData.cardEl = card;

  const editor = document.createElement('div');
  editor.className = 'blank-editor';
  editor.contentEditable = 'true';
  editor.setAttribute('data-placeholder', '내용을 입력하세요…');
  editor.spellcheck = false;
  pageData.contentEl = editor;
  body.appendChild(editor);

  createAnnotLayer(pageData, body);
  updateAnnotMode(pageData);

  insertPage(pageData, insertIdx, card);
  updateBadges();
  rebuildPageList();
  setupObserver();
  scrollToPage(DS.pages.indexOf(pageData));
  showSnack('빈 페이지 추가');
  editor.focus();
}

/* ══════════════════════════════════════════════════
   PDF 로딩
══════════════════════════════════════════════════ */
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
    const lib  = await loadPdfJs();
    const pdf  = await lib.getDocument({ data: arrayBuffer }).promise;
    const total = pdf.numPages;
    const SCALE = 1.5;
    let firstInserted = null;

    for (let i = 1; i <= total; i++) {
      showLoading(`PDF 렌더링 중… ${i} / ${total}`);
      const pdfPage = await pdf.getPage(i);
      const vp = pdfPage.getViewport({ scale: SCALE });

      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      canvas.style.cssText = 'display:block;width:100%;height:auto;';
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

      const pageData = {
        id: ++pageIdCounter, type: 'pdf', label: `PDF p.${i}`,
        cardEl: null, contentEl: null, annotSvg: null, strokes: [],
        overlayEl: null, overlays: [], thumbCanvas: canvas, thumbImg: null,
      };

      const actualIdx = insertIdx < 0 ? DS.pages.length : insertIdx + (i - 1);
      const { card, body } = createPageCard(pageData, actualIdx);
      pageData.cardEl = card;

      const wrap = document.createElement('div');
      wrap.className = 'page-canvas-wrap';
      wrap.appendChild(canvas); body.appendChild(wrap);

      createAnnotLayer(pageData, body);
      updateAnnotMode(pageData);
      insertPage(pageData, actualIdx, card);
      if (!firstInserted) firstInserted = pageData;
    }

    updateBadges(); rebuildPageList(); setupObserver(); hideLoading();
    if (firstInserted) scrollToPage(DS.pages.indexOf(firstInserted));
    showSnack(`PDF ${total}페이지 불러오기 완료`);
  } catch (err) {
    hideLoading();
    showSnack('PDF 불러오기 실패: ' + err.message, true);
    console.error(err);
  }
}

/* ══════════════════════════════════════════════════
   이미지 로딩
══════════════════════════════════════════════════ */
async function loadImageFile(file, insertIdx = -1) {
  showLoading('이미지 불러오는 중…');
  try {
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => res(e.target.result); r.onerror = rej;
      r.readAsDataURL(file);
    });
    await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const pageData = {
          id: ++pageIdCounter, type: 'image', label: file.name.replace(/\.[^.]+$/, ''),
          cardEl: null, contentEl: null, annotSvg: null, strokes: [],
          overlayEl: null, overlays: [], thumbCanvas: null, thumbImg: img,
        };
        const actualIdx = insertIdx < 0 ? DS.pages.length : insertIdx;
        const { card, body } = createPageCard(pageData, actualIdx);
        pageData.cardEl = card;

        const wrap = document.createElement('div');
        wrap.className = 'page-canvas-wrap';
        const imgEl = document.createElement('img');
        imgEl.src = dataUrl; imgEl.alt = pageData.label; imgEl.draggable = false;
        wrap.appendChild(imgEl); body.appendChild(wrap);

        createAnnotLayer(pageData, body);
        updateAnnotMode(pageData);
        insertPage(pageData, actualIdx, card);
        updateBadges(); rebuildPageList(); setupObserver(); hideLoading();
        scrollToPage(DS.pages.indexOf(pageData));
        showSnack('이미지 불러오기 완료');
        res();
      };
      img.onerror = rej; img.src = dataUrl;
    });
  } catch (err) {
    hideLoading();
    showSnack('이미지 불러오기 실패: ' + err.message, true);
  }
}

/* ══════════════════════════════════════════════════
   파일 핸들러
══════════════════════════════════════════════════ */
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
    await handleFile(files[i], insertIdx < 0 ? -1 : insertIdx + i);
  }
}

/* ══════════════════════════════════════════════════
   페이지 관리
══════════════════════════════════════════════════ */
function insertPage(pageData, idx, cardEl) {
  if (idx < 0 || idx >= DS.pages.length) {
    DS.pages.push(pageData);
    viewer.insertBefore(cardEl, qs('#empty-state', viewer) || null);
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
  updateBadges(); rebuildPageList(); setupObserver();
  showSnack('페이지 삭제');
}

function movePageUp(idx) {
  if (idx <= 0) return;
  const [a, b] = [DS.pages[idx - 1], DS.pages[idx]];
  DS.pages[idx - 1] = b; DS.pages[idx] = a;
  viewer.insertBefore(b.cardEl, a.cardEl);
  updateBadges(); rebuildPageList(); setupObserver();
}

function movePageDown(idx) {
  if (idx >= DS.pages.length - 1) return;
  const [a, b] = [DS.pages[idx], DS.pages[idx + 1]];
  DS.pages[idx] = b; DS.pages[idx + 1] = a;
  viewer.insertBefore(b.cardEl, a.cardEl);
  updateBadges(); rebuildPageList(); setupObserver();
}

function updateBadges() {
  DS.pages.forEach((p, i) => {
    const badge = p.cardEl?.querySelector('.page-badge');
    if (badge) badge.textContent = `p.${i + 1}`;
    if (p.cardEl) p.cardEl.dataset.pageIdx = i;
  });
}

/* ══════════════════════════════════════════════════
   모드 전환
══════════════════════════════════════════════════ */
function setMode(mode) {
  DS.mode = mode;

  // 모드바 버튼 활성화
  qsa('.mb-mode').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));

  // editor-area에 mode 클래스 적용 (CSS에서 그룹 표시 제어)
  const editorArea = document.getElementById('editor-area');
  if (editorArea) {
    ['mode-pan','mode-annotate','mode-text','mode-lasso'].forEach(c => editorArea.classList.remove(c));
    editorArea.classList.add(`mode-${mode}`);
  }

  // 페이지별 상태 업데이트
  DS.pages.forEach(p => {
    if (p.contentEl) {
      p.contentEl.contentEditable = (mode === 'text') ? 'true' : 'false';
    }
    updateAnnotMode(p);
  });

  // 올가미 SVG
  const lassoSvg = document.getElementById('lasso-svg');
  if (lassoSvg) lassoSvg.classList.toggle('active', mode === 'lasso');

  // edit border badge
  const editBorder = document.getElementById('doc-edit-border');
  const editBadge  = document.getElementById('doc-edit-badge');
  if (editBorder) editBorder.classList.toggle('active', mode === 'annotate');
  if (editBadge)  {
    editBadge.classList.toggle('active', mode === 'annotate');
    editBadge.textContent = mode === 'annotate' ? '필기 모드' : mode === 'lasso' ? '올가미 모드' : '';
  }

  updateViewerTouchAction();
  _syncOrbToCurrentTool();
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

/* ══════════════════════════════════════════════════
   현재 보이는 페이지
══════════════════════════════════════════════════ */
function getCurrentVisiblePageIdx() {
  if (DS.currentPageIdx >= 0) return DS.currentPageIdx;
  if (DS.pages.length > 0) return 0;
  return -1;
}

/* ══════════════════════════════════════════════════
   컨텍스트 메뉴
══════════════════════════════════════════════════ */
function openCtxMenu(idx, cx, cy) {
  ctxTargetIdx = idx;
  pageCtxMenu.classList.add('open');
  pageCtxMenu.style.left = Math.min(cx, window.innerWidth  - 208) + 'px';
  pageCtxMenu.style.top  = Math.min(cy, window.innerHeight - 240) + 'px';
}
function closeCtxMenu() {
  pageCtxMenu.classList.remove('open');
  ctxTargetIdx = -1;
}

/* ══════════════════════════════════════════════════
   저장
══════════════════════════════════════════════════ */
function saveDoc() {
  const title = document.getElementById('doc-title-input')?.value || 'document';
  const data = {
    version: '5.0', type: 'loovas-document', title,
    timestamp: new Date().toISOString(),
    pages: DS.pages.map(p => ({
      id: p.id, type: p.type, label: p.label,
      content: p.contentEl?.innerHTML || '',
      strokes: p.strokes.map(s => ({ attrs: s.attrs })),
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = title.replace(/[^\w가-힣]/g, '-') + '.json';
  a.click();
  URL.revokeObjectURL(url);

  const status = document.getElementById('save-status');
  if (status) { status.textContent = '저장됨'; setTimeout(() => { status.textContent = ''; }, 3000); }
  showSnack('저장 완료');
}

/* ══════════════════════════════════════════════════
   텍스트 서식 명령
══════════════════════════════════════════════════ */
function execCmd(cmd, val = null) { document.execCommand(cmd, false, val); }

/* ══════════════════════════════════════════════════
   Mode Bar UI — 도구 / 색상 / 굵기 연동
══════════════════════════════════════════════════ */
function _updateModeBarUI() {
  // 도구 버튼
  qsa('.mb-tool[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === DS.annot.tool));

  // 색상 점
  qsa('.mb-cdot').forEach(d => d.classList.toggle('active', d.dataset.c === DS.annot.color));

  // 굵기
  qsa('.mb-sw').forEach(s => s.classList.toggle('active', +s.dataset.sw === DS.annot.sw));

  // 불투명도
  const opRange = document.getElementById('mb-opacity');
  const opLabel = document.getElementById('mb-opacity-label');
  if (opRange) opRange.value = Math.round(DS.annot.opacity * 100);
  if (opLabel) opLabel.textContent = Math.round(DS.annot.opacity * 100) + '%';
}

function initModeBar() {
  // 모드 버튼
  qsa('.mb-mode').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // 그리기 도구
  qsa('.mb-tool[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      DS.annot.tool = btn.dataset.tool;
      if (DS.mode !== 'annotate') setMode('annotate');
      DS.pages.forEach(updateAnnotMode);
      _updateModeBarUI();
      _syncOrbToCurrentTool();
    });
  });

  // 색상
  qsa('.mb-cdot').forEach(dot => {
    dot.addEventListener('click', () => {
      DS.annot.color = dot.dataset.c;
      const colorStep = COLOR_STEPS.indexOf(dot.dataset.c);
      if (colorStep >= 0) orbColorStep = colorStep;
      _updateModeBarUI();
    });
  });

  // 굵기
  qsa('.mb-sw').forEach(sw => {
    sw.addEventListener('click', () => {
      DS.annot.sw = +sw.dataset.sw;
      const step = STROKE_STEPS.indexOf(DS.annot.sw);
      if (step >= 0) orbStrokeStep = step;
      _updateModeBarUI();
    });
  });

  // 불투명도
  const opRange = document.getElementById('mb-opacity');
  const opLabel = document.getElementById('mb-opacity-label');
  opRange?.addEventListener('input', () => {
    DS.annot.opacity = opRange.value / 100;
    if (opLabel) opLabel.textContent = opRange.value + '%';
  });

  // 주석 undo / clear
  document.getElementById('mb-undo')?.addEventListener('click', () => undoAnnot(DS.pages[DS.currentPageIdx]));
  document.getElementById('mb-clear')?.addEventListener('click', () => clearAnnot(DS.pages[DS.currentPageIdx]));

  // 텍스트 서식
  document.getElementById('mb-bold')?.addEventListener('click', () => execCmd('bold'));
  document.getElementById('mb-italic')?.addEventListener('click', () => execCmd('italic'));
  document.getElementById('mb-ul')?.addEventListener('click', () => execCmd('insertUnorderedList'));
  document.getElementById('mb-quote')?.addEventListener('click', () => execCmd('formatBlock', 'blockquote'));
  document.getElementById('mb-tb-undo')?.addEventListener('click', () => execCmd('undo'));
  document.getElementById('mb-tb-redo')?.addEventListener('click', () => execCmd('redo'));

  const heading = document.getElementById('mb-heading');
  heading?.addEventListener('change', () => {
    const v = heading.value;
    execCmd('formatBlock', v || 'p');
    heading.value = '';
  });

  // 올가미
  document.getElementById('mb-lasso-select-all')?.addEventListener('click', () => showSnack('전체 선택 (준비 중)'));
  document.getElementById('mb-lasso-delete')?.addEventListener('click', () => showSnack('선택 삭제 (준비 중)'));

  // 포스트잇 / 카드 빠른 버튼
  document.getElementById('mb-sticky-btn')?.addEventListener('click', () => {
    const idx = getCurrentVisiblePageIdx();
    if (idx >= 0) addStickyToPage(idx);
    else showSnack('페이지를 추가하세요', true);
  });
  document.getElementById('mb-card-btn')?.addEventListener('click', () => {
    const idx = getCurrentVisiblePageIdx();
    if (idx >= 0) addCardToPage(idx);
    else showSnack('페이지를 추가하세요', true);
  });
}

/* ══════════════════════════════════════════════════
   Chrome 초기화
══════════════════════════════════════════════════ */
function initChrome() {
  const fileIn = document.getElementById('file-in');

  document.getElementById('chrome-open-btn')?.addEventListener('click', () => fileIn.click());
  document.getElementById('empty-open-btn')?.addEventListener('click', () => fileIn.click());
  fileIn?.addEventListener('change', async e => {
    const files = [...e.target.files]; fileIn.value = '';
    if (files.length) await handleFiles(files);
  });

  document.getElementById('chrome-add-blank-btn')?.addEventListener('click', () => addBlankPage());
  document.getElementById('empty-blank-btn')?.addEventListener('click', () => addBlankPage());
  document.getElementById('add-page-btn')?.addEventListener('click', () => addBlankPage());
  document.getElementById('chrome-save-btn')?.addEventListener('click', saveDoc);

  // 포스트잇 / 카드 크롬 버튼 (있을 경우)
  document.getElementById('chrome-sticky-btn')?.addEventListener('click', () => {
    const idx = getCurrentVisiblePageIdx();
    if (idx >= 0) addStickyToPage(idx); else showSnack('페이지를 추가하세요', true);
  });
  document.getElementById('chrome-card-btn')?.addEventListener('click', () => {
    const idx = getCurrentVisiblePageIdx();
    if (idx >= 0) addCardToPage(idx); else showSnack('페이지를 추가하세요', true);
  });

  const titleInput = document.getElementById('doc-title-input');
  titleInput?.addEventListener('input', () => {
    document.title = (titleInput.value || '제목 없는 문서') + ' — Loovas';
  });
}

/* ══════════════════════════════════════════════════
   컨텍스트 메뉴 초기화
══════════════════════════════════════════════════ */
function initCtxMenu() {
  pageCtxMenu = document.getElementById('page-ctx-menu');
  document.getElementById('ctx-add-before')?.addEventListener('click', () => { if (ctxTargetIdx >= 0) addBlankPage(ctxTargetIdx); closeCtxMenu(); });
  document.getElementById('ctx-add-after')?.addEventListener('click', () => { if (ctxTargetIdx >= 0) addBlankPage(ctxTargetIdx + 1); closeCtxMenu(); });
  document.getElementById('ctx-add-sticky')?.addEventListener('click', () => { if (ctxTargetIdx >= 0) addStickyToPage(ctxTargetIdx); closeCtxMenu(); });
  document.getElementById('ctx-add-card')?.addEventListener('click', () => { if (ctxTargetIdx >= 0) addCardToPage(ctxTargetIdx); closeCtxMenu(); });
  document.getElementById('ctx-move-up')?.addEventListener('click', () => { if (ctxTargetIdx >= 0) movePageUp(ctxTargetIdx); closeCtxMenu(); });
  document.getElementById('ctx-move-down')?.addEventListener('click', () => { if (ctxTargetIdx >= 0) movePageDown(ctxTargetIdx); closeCtxMenu(); });
  document.getElementById('ctx-scroll-to')?.addEventListener('click', () => { if (ctxTargetIdx >= 0) scrollToPage(ctxTargetIdx); closeCtxMenu(); });
  document.getElementById('ctx-delete')?.addEventListener('click', () => { if (ctxTargetIdx >= 0) deletePage(ctxTargetIdx); closeCtxMenu(); });
  document.addEventListener('pointerdown', e => { if (!pageCtxMenu.contains(e.target)) closeCtxMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeCtxMenu(); _orbHide(); } });
}

/* ══════════════════════════════════════════════════
   사이드바 토글
══════════════════════════════════════════════════ */
function initSidebarToggle() {
  const sidebar = document.getElementById('sidebar');
  document.getElementById('sidebar-toggle-btn')?.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });
}

/* ══════════════════════════════════════════════════
   줌 컨트롤
══════════════════════════════════════════════════ */
function initZoom() {
  document.getElementById('zc-in')?.addEventListener('click', () => applyZoom(DS.zoom + 0.1));
  document.getElementById('zc-out')?.addEventListener('click', () => applyZoom(DS.zoom - 0.1));
  document.getElementById('zc-fit')?.addEventListener('click', () => applyZoom(1));

  viewer?.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    applyZoom(DS.zoom + (e.deltaY < 0 ? 0.05 : -0.05));
  }, { passive: false });
}

/* ══════════════════════════════════════════════════
   드래그앤드롭
══════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════
   키보드 단축키
══════════════════════════════════════════════════ */
function initKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 's') { e.preventDefault(); saveDoc(); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); applyZoom(DS.zoom + 0.1); return; }
      if (e.key === '-') { e.preventDefault(); applyZoom(DS.zoom - 0.1); return; }
      if (e.key === '0') { e.preventDefault(); applyZoom(1); return; }
    }

    const target = document.activeElement;
    const isEditing = target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    if (isEditing || e.ctrlKey || e.metaKey || e.altKey) return;

    switch(e.key.toLowerCase()) {
      case 'v': setMode('pan');      break;
      case 'a': setMode('annotate'); break;
      case 't': setMode('text');     break;
      case 'l': setMode('lasso');    break;
      case 'p': setMode('annotate'); DS.annot.tool = 'pen';       DS.pages.forEach(updateAnnotMode); _updateModeBarUI(); break;
      case 'h': setMode('annotate'); DS.annot.tool = 'highlight'; DS.pages.forEach(updateAnnotMode); _updateModeBarUI(); break;
      case 'e': setMode('annotate'); DS.annot.tool = 'eraser';    DS.pages.forEach(updateAnnotMode); _updateModeBarUI(); break;
    }
  });
}

/* ══════════════════════════════════════════════════
   초기화
══════════════════════════════════════════════════ */
function init() {
  viewer     = document.getElementById('viewer');
  pageList   = document.getElementById('page-list');
  emptyState = document.getElementById('empty-state');

  initChrome();
  initModeBar();
  initCtxMenu();
  initSidebarToggle();
  initZoom();
  initDragDrop();
  initKeyboard();
  initPinchZoom();
  initToolOrb();

  // 초기 모드 설정
  setMode('pan');
  _updateModeBarUI();
  updateEmptyState();
  updateZoomLabel();

  console.log('∞ Loovas Document Editor v5.0 — pan/annotate/text/lasso + toolOrb v5 + pinch zoom');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
