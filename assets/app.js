(() => {
  'use strict';
  const base = document.currentScript?.src;
  const navEl = document.querySelector('.nav');
  const navState = () => navEl && navEl.classList.toggle('is-scrolled', scrollY > 10);
  addEventListener('scroll', navState, {passive:true}); navState();
  if (navEl) {
    const hov = matchMedia('(hover:hover) and (pointer:fine)');
    let lastY = scrollY, hover = false;
    const setHidden = v => navEl.classList.toggle('nav-hidden', v);
    const sync = () => {
      const y = scrollY, dy = y - lastY; lastY = y;
      if (y < 10 || navEl.matches(':focus-within') || (hov.matches && hover)) return setHidden(false);
      if (hov.matches) { if (dy > 0) setHidden(true); return; }
      if (dy < -2) setHidden(false); else if (dy > 2) setHidden(true);
    };
    addEventListener('scroll', sync, {passive:true});
    navEl.addEventListener('mouseenter', () => { hover = true; setHidden(false); });
    navEl.addEventListener('mouseleave', () => { hover = false; if (scrollY >= 10 && !navEl.matches(':focus-within')) setHidden(true); });
    addEventListener('mousemove', e => { if (hov.matches && e.clientY < 80 && scrollY >= 10) { hover = true; setHidden(false); } else if (hov.matches && e.clientY >= 100 && hover && !navEl.matches(':hover')) { hover = false; if (scrollY >= 10 && !navEl.matches(':focus-within')) setHidden(true); } }, {passive:true});
    navEl.addEventListener('focusin', () => setHidden(false));
  }
  document.querySelectorAll('.peek-btn').forEach(btn => {
    const panel = document.getElementById(btn.getAttribute('aria-controls'));
    const set = open => {
      btn.setAttribute('aria-expanded', String(open));
      if (open) { panel.hidden = false; panel.classList.remove('is-open'); void panel.offsetWidth; panel.classList.add('is-open'); }
      else { panel.hidden = true; panel.classList.remove('is-open'); }
    };
    btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
    btn.closest('.peek').addEventListener('keydown', e => { if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') { set(false); btn.focus(); } });
  });
  const dialog = document.querySelector('.contact-dialog');
  document.querySelectorAll('[data-contact]').forEach(button => button.addEventListener('click', () => dialog.showModal()));
  dialog?.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  const sizeLabel = document.querySelector('#chosen-size');
  document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-size]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    sizeLabel.textContent = button.dataset.size;
  }));
  const track = document.querySelector('.hero-track');
  if (!track) return;
  const stage = document.querySelector('.hero-stage');
  const ball = document.querySelector('.ball');
  const copy = document.querySelector('.hero-copy');
  const net = document.querySelector('.goal-net');
  const shadow = document.querySelector('.ground-shadow');
  const impact = document.querySelector('.net-impact');
  const contact = document.querySelector('.net-contact');
  const scrollLabel = document.querySelector('.scroll-label');
  const progressLine = document.querySelector('.scroll-line i');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let pre = 0, width = 0, height = 0, ratio = 1, offsetX = 0, offsetY = 0, distance = 1;
  let queued = false;
  const clamp = value => Math.min(1, Math.max(0, value));
  const mix = (a, b, t) => a + (b - a) * t;
  function measure() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    if (width <= 640) {
      ratio = Math.max(width / 3072, height / 2048);
      offsetX = (width - 3072 * ratio) * .77;
      offsetY = (height - 2048 * ratio) * .5 + 150;
      distance = Math.max(1, track.offsetHeight - height);
      pre = 0;
    } else { // full image, 3:2, no crop
      ratio = width / 3072; offsetX = 0; offsetY = 0;
      pre = Math.max(0, height - innerHeight);
      distance = Math.max(1, track.offsetHeight - height);
    }
    paint();
  }
  let cur = null, last = 0;
  const K = -Math.log(.925) * 60; // equals .075 per frame at 60fps, frame-rate independent
  function paint(now) {
    queued = false;
    const target = reduce.matches ? 0 : clamp((-track.getBoundingClientRect().top - pre) / distance);
    const dt = Math.min(.1, Math.max(0, ((now || performance.now()) - last) / 1000));
    last = now || performance.now();
    if (cur === null || reduce.matches) cur = target;
    else cur += (target - cur) * (1 - Math.exp(-K * dt));
    if (Math.abs(target - cur) < .0004) cur = target; else if (!queued && !document.hidden) { queued = true; requestAnimationFrame(paint); }
    const progress = cur;
    const mobile = width <= 640;
    const t = clamp(progress / .92);
    const e = 1 - Math.pow(1 - t, 1.25); // ease-out: fast kick, decelerating with distance
    const initial = mobile ? width * .7 : height * .4;
    const startX = mobile ? width * .4 : initial * .2;
    const startY = mobile ? height - initial * .4 : height - initial * .25;
    const targetX = offsetX + (mobile ? 2262 : 2220) * ratio;
    const targetY = offsetY + (mobile ? 768 : 770) * ratio;
    const final = ((1030 - 706) * .22) * ratio;
    // low sweep along the grass, then a gentle curve up into the front-right goal (cubic bezier)
    const dx = targetX - startX, dy = startY - targetY;
    const p1x = startX + dx * .42, p1y = startY + height * .03;
    const p2x = targetX - dx * .2, p2y = targetY + dy * .5;
    const u = 1 - e, k0 = u * u * u, k1 = 3 * u * u * e, k2 = 3 * u * e * e, k3 = e * e * e;
    const x = k0 * startX + k1 * p1x + k2 * p2x + k3 * targetX;
    const y = k0 * startY + k1 * p1y + k2 * p2y + k3 * targetY;
    const size = mix(initial, final, e);
    window.dispatchEvent(new CustomEvent('ball:update', {detail: {x, y, size, t, progress, gx: targetX, gy: targetY}}));
    if (document.documentElement.dataset.ball3d) ball.style.opacity = '0';
    else {
      ball.style.transform = `translate3d(${x - 210}px,${y - 210}px,0) scale(${size * (900 / 759) / 420})`;
      ball.style.opacity = '1';
    }
    shadow.style.transform = `translate3d(${x - 140}px,${mix(startY + initial * .42,height * .62,e) - 20}px,0) scale(${size / initial},${mix(1,.2,t)})`;
    shadow.style.opacity = String((1-t)*.8);
    // A single headline and the same two links remain, no overlapping end panel.
    copy.style.opacity = '1';
    copy.inert = false;
    const hit = clamp((progress - .88) / .04);
    impact.style.width = impact.style.height = `${128 * ratio}px`;
    impact.style.transform = `translate3d(${targetX - 64 * ratio}px,${targetY - 64 * ratio}px,0)`;
    impact.style.opacity = '0';
    net.style.opacity = String(clamp((progress - .895) / .025)); // r11: ball stays IN FRONT of the posts during approach; frame occludes only once the ball is inside the opening
    contact.style.width = contact.style.height = impact.style.width;
    contact.style.transform = impact.style.transform;
    contact.style.opacity = String(hit * .15);
    progressLine.style.transform = `scaleY(${mix(1,2.8,progress)})`;
    scrollLabel.textContent = progress >= .93 ? 'À vous de jouer' : reduce.matches ? 'Studio Onze' : 'Défiler pour jouer';
  }
  function requestPaint() {
    if (queued || document.hidden) return;
    queued = true;
    requestAnimationFrame(paint);
  }
  window.addEventListener('scroll', requestPaint, {passive:true});
  window.addEventListener('resize', measure, {passive:true});
  window.addEventListener('pageshow', measure);
  reduce.addEventListener('change', measure);
  window.addEventListener('ball3dready', measure);
  measure();
  if (base) { const l = document.createElement('script'); l.type = 'module'; l.src = new URL('ball3d.js?v=ld3', base).href; l.onerror = () => { document.documentElement.dataset.ball3dState = 'fallback'; measure(); }; document.head.appendChild(l); }
})();