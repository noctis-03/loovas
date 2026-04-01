// ═══════════════════════════════════════════════════
//  image.js — 이미지 삽입 처리
//
//  UPDATE: 이미지 추가 후 pushState()
// ═══════════════════════════════════════════════════

import * as S from './state.js';
import { s2b } from './transform.js';
import { makeEl, addHandles, attachSelectClick } from './elements.js';
import { updateMinimap } from './layout.js';
import { pushState } from './history.js';

export function handleImg(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const vr = S.vp.getBoundingClientRect();
      const bp = s2b(vr.left + vr.width / 2, vr.top + vr.height / 2);
      const maxW = 400, maxH = 400;
      let w = img.width, h = img.height;
      if (w > maxW) { h *= maxW / w; w = maxW; }
      if (h > maxH) { w *= maxH / h; h = maxH; }

      const el = makeEl(bp.x - w / 2, bp.y - h / 2, w, h);
      const body = document.createElement('div');
      body.className = 'el-body';
      const imgEl = document.createElement('img');
      imgEl.className = 'image-body';
      imgEl.src = ev.target.result;
      body.appendChild(imgEl);
      el.appendChild(body);
      addHandles(el);
      attachSelectClick(el);
      S.board.appendChild(el);
      updateMinimap();
      pushState();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

export function initImageInput() {
  document.getElementById('img-in').addEventListener('change', handleImg);
}
