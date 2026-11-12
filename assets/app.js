(() => {
  'use strict';
  const base = document.currentScript?.src;
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
  let width = 0, height = 0, ratio = 1, offsetX = 0, offsetY = 0, distance = 1;
  let queued = false;
  const clamp = value => Math.min(1, Math.max(0, value));
  const mix = (a, b, t) => a + (b - a) * t;
  function measure() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    ratio = Math.max(width / 3072, height / 2048);
    offsetX = (width - 3072 * ratio) * (width <= 640 ? .77 : .5);
    offsetY = (height - 2048 * ratio) * .5 + (width <= 640 ? 150 : 140);
    distance = Math.max(1, track.offsetHeight - height);
    paint();
  }
  function paint() {
    queued = false;
    const progress = reduce.matches ? 0 : clamp(-track.getBoundingClientRect().top / distance);
    const mobile = width <= 640;
    const t = clamp(progress / .92);
    const e = 1 - Math.pow(1 - t, 1.6); // ease-out: fast kick, decelerating with distance
    const initial = mobile ? width * .7 : Math.min(400, width * .4);
    const startX = width * (mobile ? .4 : .20);
    const startY = mobile ? height - initial * .4 : height * .85;
    const targetX = offsetX + 2192 * ratio;
    const targetY = offsetY + 768 * ratio;
    const final = ((1030 - 706) * .22) * ratio;
    // single parabola: peak at e=.8, slight drop into the corner
    const B = (startY - targetY) / .6, A = -1.6 * B;
    const x = mix(startX, targetX, e);
    const y = startY + A * e + B * e * e;
    const size = mix(initial, final, e);
    window.dispatchEvent(new CustomEvent('ball:update', {detail: {x, y, size, t, progress}}));
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
    net.style.opacity = '0';
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
  if (base) { const l = document.createElement('script'); l.type = 'module'; l.src = new URL('ball3d.js', base).href; document.head.appendChild(l); }
})();