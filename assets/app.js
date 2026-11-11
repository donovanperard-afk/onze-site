(() => {
  'use strict';
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
  const ending = document.querySelector('.scene-end');
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
    offsetY = (height - 2048 * ratio) * .5;
    distance = Math.max(1, track.offsetHeight - height);
    paint();
  }
  function paint() {
    queued = false;
    const progress = reduce.matches ? 0 : clamp(-track.getBoundingClientRect().top / distance);
    // Perspective scale decreases quickly as the ball travels away from the camera.
    const t = clamp(progress / .92);
    const perspective = t / (1 + 2.4 * (1 - t));
    const startX = width * (width <= 640 ? .34 : .44);
    const startY = height * .75;
    const targetX = offsetX + 2235 * ratio;
    const targetY = offsetY + 780 * ratio;
    const initial = Math.min(width <= 640 ? width * .62 : width * .28, 400);
    const final = 31 * ratio;
    // Keep the approach inside the left post before crossing the goal plane.
    const x = mix(startX, targetX, perspective);
    const y = mix(startY, targetY, perspective) - Math.sin(t * Math.PI) * height * .09;
    const size = mix(initial, final, perspective);
    const rotation = -14 + t * 115;
    ball.style.transform = `translate3d(${x - 210}px,${y - 210}px,0) rotate(${rotation}deg) scale(${size / 420})`;
    ball.style.opacity = '1';
    shadow.style.transform = `translate3d(${x - 140}px,${mix(startY + initial * .42,height * .62,perspective) - 20}px,0) scale(${size / initial},${mix(1,.2,t)})`;
    shadow.style.opacity = String((1-t)*.8);
    copy.style.opacity = String(1 - clamp(progress / .38));
    copy.style.pointerEvents = progress > .36 ? 'none' : '';
    copy.inert = progress > .36;
    const endOpacity = reduce.matches ? 0 : clamp((progress - .78) / .15);
    ending.style.opacity = String(endOpacity);
    ending.inert = endOpacity < .1;
    net.style.opacity = progress >= .88 ? '1' : '0';
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
  measure();
})();