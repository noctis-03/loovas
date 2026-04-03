// ═══════════════════════════════════════════════════
//  doc-pages.js — PDF/이미지 문서 로딩 & 렌더링
// ═══════════════════════════════════════════════════

import * as S from './doc-state.js';
import { setTransform } from './doc-transform.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// pdfjs 로드 여부
let pdfjsLib = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  // CDN에서 pdfjs 로드
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window['pdfjs-dist/build/pdf'].GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      pdfjsLib = window['pdfjs-dist/build/pdf'];
      resolve(pdfjsLib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ── 페이지 컨테이너 생성 ──
function createPageContainer(pageNum, width, height) {
  const wrap = document.createElement('div');
  wrap.className = 'doc-page';
  wrap.dataset.page = pageNum;
  wrap.style.cssText = `
    position: relative;
    width: ${width}px;
    height: ${height}px;
    margin: 0 auto 24px;
    background: #fff;
    box-shadow: 0 2px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06);
    border-radius: 4px;
    overflow: visible;
    flex-shrink: 0;
  `;
  return wrap;
}

// ── PDF 렌더링 ──
export async function loadPdf(arrayBuffer) {
  showLoading('PDF 불러오는 중…');
  try {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;
    const pageDataList = [];

    clearBoard();

    const SCALE = 1.5; // 렌더링 해상도 배율

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: SCALE });
      const width = vp.width;
      const height = vp.height;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.style.cssText = `
        width: ${width}px;
        height: ${height}px;
        display: block;
        border-radius: 4px;
      `;

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const wrap = createPageContainer(i, width, height);
      wrap.appendChild(canvas);
      S.board.insertBefore(wrap, document.getElementById('doc-svg-layer'));

      pageDataList.push({ type: 'pdf', pageNum: i, width, height });

      // 진행률 표시
      showLoading(`PDF 불러오는 중… ${i}/${totalPages}`);
    }

    S.setPages(pageDataList);
    hideLoading();
    fitToView();
    showSnack(`PDF ${totalPages}페이지 불러오기 완료`);
  } catch (err) {
    hideLoading();
    showSnack('PDF 불러오기 실패: ' + err.message, true);
    console.error('PDF load error:', err);
  }
}

// ── 이미지 렌더링 ──
export async function loadImage(file) {
  showLoading('이미지 불러오는 중…');
  try {
    const dataUrl = await fileToDataUrl(file);

    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        clearBoard();

        const MAX_W = 1200;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.style.cssText = `width:${w}px;height:${h}px;display:block;border-radius:4px;`;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const wrap = createPageContainer(1, w, h);
        wrap.appendChild(canvas);
        S.board.insertBefore(wrap, document.getElementById('doc-svg-layer'));

        S.setPages([{ type: 'image', pageNum: 1, width: w, height: h }]);
        hideLoading();
        fitToView();
        showSnack('이미지 불러오기 완료');
        resolve();
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  } catch (err) {
    hideLoading();
    showSnack('이미지 불러오기 실패: ' + err.message, true);
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── 보드 초기화 ──
function clearBoard() {
  if (!S.board) return;
  const pages = S.board.querySelectorAll('.doc-page');
  pages.forEach(p => p.remove());
  S.setPages([]);
  S.clearStrokes();

  // SVG 드로잉 초기화
  const svg = document.getElementById('doc-svg-layer');
  if (svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }
}

// ── 뷰 맞추기 ──
function fitToView() {
  if (!S.viewport || !S.board) return;
  const vr = S.viewport.getBoundingClientRect();

  const pages = S.getPages();
  if (pages.length === 0) {
    setTransform(vr.width / 2, 60, 1);
    return;
  }

  const firstPage = pages[0];
  const scale = Math.min(1, (vr.width - 80) / firstPage.width);
  const tx = (vr.width - firstPage.width * scale) / 2;
  const ty = 60;
  setTransform(tx, ty, scale);
}

// ── 로딩 표시 ──
function showLoading(msg) {
  let el = document.getElementById('doc-loading');
  if (!el) {
    el = document.createElement('div');
    el.id = 'doc-loading';
    el.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      background:rgba(26,23,20,0.85);color:#fff;
      padding:16px 28px;border-radius:12px;
      font-family:var(--font-ui);font-size:14px;
      backdrop-filter:blur(8px);z-index:9999;
      box-shadow:0 8px 32px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
}

function hideLoading() {
  const el = document.getElementById('doc-loading');
  if (el) el.style.display = 'none';
}

// ── 스낵바 ──
function showSnack(msg, isError = false) {
  const snack = document.getElementById('doc-snack');
  if (!snack) return;
  snack.textContent = msg;
  snack.style.background = isError ? '#c84b2f' : 'rgba(26,23,20,0.9)';
  snack.classList.add('visible');
  clearTimeout(snack._t);
  snack._t = setTimeout(() => snack.classList.remove('visible'), 3000);
}
