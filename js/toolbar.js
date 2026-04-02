// ═══════════════════════════════════════════════════
//  toolbar.js — 새 사이드바 레이아웃
//  모든 툴은 #left-sidebar에 고정, 툴바 드래그 불필요
//  color-tray: 사이드바 왼쪽 하단 플로팅 팔레트
// ═══════════════════════════════════════════════════

const DRAW_TOOLS = ['pen', 'highlight', 'eraser', 'rect', 'circle', 'arrow', 'text'];

export function initToolbar() {
  // 새 레이아웃에서는 사이드바가 고정이므로 드래그 로직 불필요
  // color-tray 위치도 CSS로 고정
  window.addEventListener('resize', () => {
    updateSatellitePositions();
  });
}

// ── 위성 위치: 새 레이아웃에서는 CSS 고정이므로 JS 처리 최소화 ──
export function updateSatellitePositions() {
  // 미니맵 위치 조정 (오른쪽 하단 고정)
  const mm = document.getElementById('minimap');
  if (mm) {
    mm.style.right = '16px';
    mm.style.bottom = '20px';
  }
}

// ── Color Tray 토글 ──
export function showColorBar() {
  const tray = document.getElementById('color-tray');
  if (tray) tray.classList.add('ct-visible');
}

export function hideColorBar() {
  const tray = document.getElementById('color-tray');
  if (tray) tray.classList.remove('ct-visible');
}

export function updateColorBarPosition() {
  // CSS fixed position으로 처리됨
}

export function isDrawTool(t) {
  return DRAW_TOOLS.includes(t);
}
