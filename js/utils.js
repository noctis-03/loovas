// ═══════════════════════════════════════════════════
//  utils.js — 범용 유틸리티 함수
// ═══════════════════════════════════════════════════

/**
 * 모바일 터치 호환 탭 이벤트 바인딩.
 * click + touchend 모두 처리하여 ghost click 방지.
 */
export function onTap(el, callback) {
  let touchMoved = false;
  let touchStartTime = 0;

  el.addEventListener('click', function (e) {
    e.stopPropagation();
    callback(e);
  });

  el.addEventListener('touchstart', function (e) {
    touchMoved = false;
    touchStartTime = Date.now();
    e.stopPropagation();
  }, { passive: true });

  el.addEventListener('touchmove', function () {
    touchMoved = true;
  }, { passive: true });

  el.addEventListener('touchend', function (e) {
    e.stopPropagation();
    if (!touchMoved && (Date.now() - touchStartTime) < 400) {
      e.preventDefault();
      callback(e);
    }
  });
}

/**
 * 하단 스낵바 메시지 표시
 */
export function snack(msg) {
  const el = document.getElementById('snack');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 1800);
}

export const MOBILE_BP = 767;
export function isMobile() { return window.innerWidth <= MOBILE_BP; }
