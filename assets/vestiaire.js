import * as THREE from './r14deps/three.module.js?v=r14b';
import { GLTFLoader } from './r14deps/GLTFLoader.js?v=r14b';
import { MeshoptDecoder } from './r14deps/meshopt_decoder.js?v=r14b';

const root = document.querySelector('[data-vestiaire]');
const V = 'r14b';
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const $ = s => root.querySelector(s);
const stage = $('.vst-stage'), card = $('.vst-card'), picker = $('.vst-picker'), status = $('.vst-status');
const FALLBACK_LINKS = ['../shop/t-shirt-blanc/?v=r14b', '../shop/t-shirt-noir/?v=r14b'].map(p => new URL(p, import.meta.url).href);
const ease = t => 1 - Math.pow(1 - t, 4);            // ease-out quart
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let FOV = 26.5, rig, renderer, scene, camera, tees = [], sel = -1, W = 0, H = 0;
let rafId = 0, last = 0, ready = false;
const home = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
let dolly = 0, dollyTarget = 0, DOLLY = 4.4;
let glide = 0, glideTarget = 0, glideRange = 0, glideVel = 0;
let tween = null, spinning = false, userSpin = 0;

function fail(msg) {
  root.classList.add('is-static');
  status.textContent = msg;
  status.hidden = false;
}

try {
  const t = document.createElement('canvas');
  if (!(t.getContext('webgl2') || t.getContext('webgl'))) throw 0;
} catch (e) { fail('La 3D n’est pas disponible sur cet appareil. Voir les pièces dans la boutique.'); }

if (!root.classList.contains('is-static')) init().catch(e => { console.error(e); fail('La 3D n’a pas pu démarrer sur cet appareil.'); });

async function init() {
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch (e) { fail('La 3D n’est pas disponible sur cet appareil.'); return; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  stage.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  let gltf, BAKED = false;
  try {
    gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(new URL('./vestiaire-r14b.glb?v=r14b', import.meta.url).href);
  } catch (e) { fail('Le vestiaire n’a pas pu se charger. Réessayez dans un instant.'); return; }
  let meta = null; try { meta = await (await fetch(new URL('./vestiaire-r14b-meta.json?v=r14b', import.meta.url).href)).json(); } catch (e) {}
  FOV = meta && meta.camera ? meta.camera.fovVerticalDegrees : 26.5;
  scene.add(gltf.scene);
  // r14b: tees use real Cycles AgX bakes (display-encoded, unlit, no tone mapping); shoes/balls keep their baked unlit materials
  try {
    const tl = new THREE.TextureLoader();
    const maps = await Promise.all([1,2,3,4,5,6].map(i => tl.loadAsync(new URL('./vestiaire-r14b-tee-' + i + '.webp?v=r14b', import.meta.url).href)));
    maps.forEach(t => { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4; });
    for (let i = 1; i <= 6; i++) {
      const n = gltf.scene.getObjectByName('tee-' + i); if (!n) continue;
      const mat = new THREE.MeshBasicMaterial({ map: maps[i - 1], side: THREE.DoubleSide, toneMapped: false });
      n.traverse(o => { if (o.isMesh) o.material = mat; });
    }
    BAKED = true;
  } catch (e) { BAKED = false; }
  scene.updateMatrixWorld(true);

  // camera from the file when present (matches the Cycles poster), sensible default otherwise
  const gc = gltf.cameras && gltf.cameras[0];
  camera = gc ? gc.clone() : new THREE.PerspectiveCamera(30, 16 / 9, .05, 100);
  if (gc) { gc.updateWorldMatrix(true, false); gc.matrixWorld.decompose(home.pos, home.quat, new THREE.Vector3()); }
  else if (meta && meta.camera) { home.pos.fromArray(meta.camera.position); home.quat.fromArray(meta.camera.quaternion); }
  else { home.pos.set(0, 1.977, 9.4); home.quat.identity(); }
  camera.near = Math.max(.02, camera.near || .05); camera.far = camera.far || 100;
  camera.removeFromParent(); scene.add(camera);

  // lights only if the scene brings none and materials are lit
  let lit = false, hasLight = false;
  scene.traverse(o => { if (o.isLight) hasLight = true; if (o.isMesh && o.material && o.material.isMeshStandardMaterial) lit = true; });
  // the glTF exporter drops Blender AREA lights: rebuild them as directional approximations from the metadata (tees only; room is baked/unlit)
  const qp = new URLSearchParams(location.search), LK = (qp.get('lk') !== null ? parseFloat(qp.get('lk')) : 0.5), SP = qp.get('sp') !== null ? parseFloat(qp.get('sp')) : 0.002;
  const SH = qp.get('sh') !== null ? parseFloat(qp.get('sh')) : 0;
  scene.traverse(o => { if (o.isSpotLight) o.intensity *= SP; if (o.isMesh && o.material && o.material.sheen !== undefined && o.material.sheen > 0) o.material.sheen = SH; });
  if (qp.get('tm') === 'agx') renderer.toneMapping = THREE.AgXToneMapping;
  if (qp.get('tm') === 'aces') renderer.toneMapping = THREE.ACESFilmicToneMapping;
  rig = new THREE.Group(); rig.name = 'tee-rig'; scene.add(rig);
  if (!BAKED) scene.add(new THREE.HemisphereLight(0xdde6ff, 0x3a3f52, .55 * LK));
  const tgt = new THREE.Object3D(); tgt.position.set(0, 2, -.24); scene.add(tgt);
  (BAKED ? [] : ((meta && meta.lights) || [])).filter(l => l.type === 'AREA' && !/backlight/i.test(l.name)).forEach(l => {
    const d = new THREE.DirectionalLight(new THREE.Color().fromArray(l.color), Math.min(2.6, l.energy / 70) * LK);
    d.position.fromArray(l.position); d.target = tgt; rig.add(d);
  });
  if (!BAKED && !rig.children.length) { const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(-2, 6, 8); d.target = tgt; rig.add(d); }

  scene.traverse(o => { if (o.isMesh && o.material && o.material.map) o.material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); });

  // tees (nodes tee-1..tee-6): remember EXACT original world pose
  for (let i = 1; i <= 6; i++) {
    const node = scene.getObjectByName('tee-' + i) || scene.getObjectByName('tee_' + i) || scene.getObjectByName('tee' + i);
    if (!node) continue;
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    node.matrixWorld.decompose(wp, wq, ws);
    const box = new THREE.Box3().setFromObject(node);
    const mt = meta && meta.tees && meta.tees.find(m => m.name === node.name);
    const fr = mt && mt.front ? new THREE.Vector3().fromArray(mt.front) : new THREE.Vector3(0, 0, 1);
    const yaw0 = Math.atan2(-fr.x, fr.z);
    tees.push({ yaw0, front: fr,
      node, n: i, wp, wq, ws, localPos: node.position.clone(), localQuat: node.quaternion.clone(),
      center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()),
      meta: Object.assign({}, node.userData || {}),
      meshes: (() => { const m = []; node.traverse(o => { if (o.isMesh) m.push(o); }); return m; })()
    });
  }
  if (!tees.length) { fail('Aucun modèle trouvé dans le vestiaire.'); return; }
  buildPicker();
  bindInput();
  new ResizeObserver(resize).observe(stage);
  resize();
  ready = true;
  applyCamera();
  render();
  root.classList.add('is-ready');
  status.hidden = true;
}

function resize() {
  W = stage.clientWidth; H = stage.clientHeight;
  if (!W || !H) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  // keep the whole poster composition: on narrow screens widen the vertical fov so the tees stay in frame
  const baseV = FOV;
  const vf = camera.aspect >= 16 / 9 ? baseV : Math.min(95, 2 * Math.atan(Math.tan(baseV * Math.PI / 360) * (16 / 9) / Math.max(camera.aspect, .3)) * 180 / Math.PI);
  camera.fov = baseFov(vf);
  camera.updateProjectionMatrix();
  computeRange();
  glideTarget = clamp(glideTarget, -glideRange, glideRange); glide = clamp(glide, -glideRange, glideRange);
  if (sel >= 0) focusNow(); else applyCamera();
  wake();
}
let _fov0 = null;
function baseFov(v) { return v; }

function axes() {
  fwd.set(0, 0, -1).applyQuaternion(home.quat);
  right.set(1, 0, 0).applyQuaternion(home.quat);
  up.set(0, 1, 0).applyQuaternion(home.quat);
}
function visSize(dist) {
  const h = 2 * Math.tan(camera.fov * Math.PI / 360) * dist;
  return { h, w: h * camera.aspect };
}
function enterRail() { if (dollyTarget || sel >= 0) return; dollyTarget = 1; root.classList.add('is-rail'); wake(); }
function exitRail() { dollyTarget = 0; glideTarget = 0; glideVel = 0; root.classList.remove('is-rail'); if (sel >= 0) back(); wake(); }
function railPos(g, d) { axes(); return home.pos.clone().addScaledVector(fwd, d * DOLLY).addScaledVector(right, g); }
function computeRange() {
  axes();
  let lo = Infinity, hi = -Infinity, dsum = 0;
  tees.forEach(t => { const s = t.center.dot(right); lo = Math.min(lo, s - t.size.x / 2); hi = Math.max(hi, s + t.size.x / 2); dsum += t.center.clone().sub(home.pos).dot(fwd); });
  const d0 = dsum / tees.length; DOLLY = Math.max(0, d0 - 4.8);
  const vw = visSize(d0 - DOLLY).w, span = hi - lo + .6;
  glideRange = Math.max(0, (span - vw) / 2);
  if (glideRange < .05) glideRange = 0;
}
function applyCamera() {
  if (sel >= 0) return;
  axes();
  camera.position.copy(railPos(glide, dolly));
  camera.quaternion.copy(home.quat);
  camera.updateMatrixWorld();
}

/* ---------- focus / presentation ---------- */
const poseFrom = {}, poseTo = {};
function focusPose(t) {
  axes();
  const mobile = W < 760;
  const tw = Math.max(t.size.x, t.size.z);
  const need = Math.max(t.size.y / (mobile ? .36 : .56), tw / (mobile ? .78 : .44) / camera.aspect);
  const dist = need / (2 * Math.tan(camera.fov * Math.PI / 360));
  const lift = .5;
  const c = t.center.clone().addScaledVector(fwd, -lift);
  const pos = c.clone().addScaledVector(fwd, -dist);
  const vs = visSize(dist);
  if (mobile) pos.addScaledVector(up, -vs.h * .2); else pos.addScaledVector(right, vs.w * .15);
  return { pos, lift, center: c };
}
function focusNow() { const p = focusPose(tees[sel]); camera.position.copy(p.pos); camera.quaternion.copy(home.quat); camera.updateMatrixWorld(); setTee(tees[sel], p.lift, spinAngle); }

let spinAngle = 0;
function setTee(t, liftAmt, ang, face) {
  if (face === undefined) face = 1;
  ang += t.yaw0 * face;
  // rotate about the vertical axis through the tee's centre, lifted toward the camera
  const p = new THREE.Vector3().copy(t.center).addScaledVector(fwd, -liftAmt);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
  const off = t.wp.clone().sub(t.center).applyQuaternion(q);
  const wpos = p.add(off), wq = q.multiply(t.wq.clone());
  place(t, wpos, wq);
}
function place(t, wpos, wq) {
  const par = t.node.parent;
  par.updateWorldMatrix(true, false);
  const pq = new THREE.Quaternion(); par.matrixWorld.decompose(new THREE.Vector3(), pq, new THREE.Vector3());
  t.node.position.copy(par.worldToLocal(wpos.clone()));
  t.node.quaternion.copy(pq.invert().multiply(wq));
  t.node.updateMatrixWorld(true);
}
function restore(t) { t.node.position.copy(t.localPos); t.node.quaternion.copy(t.localQuat); t.node.updateMatrixWorld(true); }

function run(from, to, dur, done, extra) {
  const d = reduce.matches ? 0 : dur;
  tween = { t0: performance.now(), d, from, to, done, extra };
  wake();
}

function select(i) {
  if (!ready || i === sel || i < 0 || i >= tees.length) return;
  if (tween && tween.extra && tween.extra.back) restore(tween.extra.back);
  tween = null;
  const prev = sel >= 0 ? tees[sel] : null;
  const startPos = camera.position.clone();
  if (prev) restore(prev);
  const first = sel < 0;
  sel = i;
  const t = tees[i], p = focusPose(t);
  spinAngle = 0; userSpin = 0; spinning = false;
  root.classList.add('is-focus'); root.dataset.sel = i;
  updateCard(t); updatePicker();
  run(startPos, p.pos, first ? 760 : 620, () => { spinning = !reduce.matches; }, { lift: p.lift, liftFrom: 0 });
  status.textContent = 'T-shirt ' + t.n + ' sélectionné';
}
function back() {
  if (sel < 0) return;
  const t = tees[sel], startPos = camera.position.clone();
  const wasIn = root.querySelector('.vst-card') && root.querySelector('.vst-card').contains(document.activeElement), lastI = sel;
  const dest = railPos(glide, dolly);
  const ang = spinAngle;
  spinning = false;
  root.classList.remove('is-focus');
  sel = -1; delete root.dataset.sel; updatePicker();
  run(startPos, dest, 560, () => { restore(t); applyCamera(); }, { back: t, ang, lift: focusPoseLift(t) });
  status.textContent = 'Vue d’ensemble';
  if (wasIn) { const b = root.querySelectorAll('[data-tee]')[lastI]; b && b.focus(); }
}
function focusPoseLift(t) { return .5; }

function stepTween(now) {
  if (!tween) return false;
  const k = tween.d ? clamp((now - tween.t0) / tween.d, 0, 1) : 1, e = ease(k);
  camera.position.lerpVectors(tween.from, tween.to, e);
  camera.quaternion.copy(home.quat);
  const x = tween.extra || {};
  if (x.back) {
    // tee glides back to its exact hanger pose, finishing at the original transform
    if (k < 1) setTee(x.back, x.lift * (1 - e), (x.ang - Math.round(x.ang / (Math.PI * 2)) * Math.PI * 2) * (1 - e), 1 - e);
  } else if (sel >= 0) setTee(tees[sel], x.lift * e, spinAngle, e);
  camera.updateMatrixWorld();
  if (k >= 1) { const d = tween.done; tween = null; d && d(); }
  return true;
}

/* ---------- rendering loop (only while something moves) ---------- */
function wake() { if (!rafId && ready && !document.hidden) { last = performance.now(); rafId = requestAnimationFrame(frame); } }
function frame(now) {
  rafId = 0;
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  let busy = stepTween(now);
  if (sel < 0 && !tween) {
    if (Math.abs(glideVel) > .0005 && !dragging) { glideTarget = clamp(glideTarget + glideVel * dt, -glideRange, glideRange); glideVel *= Math.pow(.02, dt); if (Math.abs(glideTarget) >= glideRange) glideVel = 0; }
    dolly = reduce.matches ? dollyTarget : dolly + (dollyTarget - dolly) * (1 - Math.pow(.004, dt)); if (Math.abs(dolly - dollyTarget) < .001) dolly = dollyTarget;
    const g = reduce.matches ? glideTarget : glide + (glideTarget - glide) * (1 - Math.pow(.0008, dt));
    if (Math.abs(g - glideTarget) < .0004 && Math.abs(glideVel) <= .0005) glide = glideTarget; else glide = g;
    applyCamera();
    busy = busy || dolly !== dollyTarget || glide !== glideTarget || Math.abs(glideVel) > .0005 || dragging;
  } else if (sel >= 0 && !tween) {
    if (spinning && !dragging) spinAngle += dt * (Math.PI * 2 / 9);
    if (userSpin) { spinAngle += userSpin; userSpin = 0; }
    setTee(tees[sel], focusPoseLift(tees[sel]), spinAngle);
    busy = busy || spinning || dragging;
  }
  render();
  if (busy || (sel < 0 && (glide !== glideTarget || dolly !== dollyTarget))) wake();
}
let frameCount = 0;
function render() { if (renderer) { renderer.render(scene, camera); frameCount++; } }
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); else if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } });
reduce.addEventListener && reduce.addEventListener('change', () => { if (reduce.matches) spinning = false; wake(); });

/* ---------- input: drag/swipe glide, tap to pick ---------- */
let dragging = false, pid = null, sx = 0, sy = 0, lx = 0, moved = false, lt = 0;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const objs = tees.flatMap(t => t.meshes);
  const hit = ray.intersectObjects(objs, false)[0];
  if (!hit) return -1;
  return tees.findIndex(t => t.meshes.includes(hit.object));
}
function bindInput() {
  const el = stage;
  el.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button > 0) return;
    pid = e.pointerId; sx = lx = e.clientX; sy = e.clientY; moved = false; dragging = false; glideVel = 0; lt = performance.now();
  });
  el.addEventListener('pointermove', e => {
    if (pid === null) { if (e.pointerType === 'mouse' && ready) { const i = sel < 0 ? pick(e) : -1; el.style.cursor = i >= 0 ? 'pointer' : (sel < 0 && glideRange ? 'grab' : ''); } return; }
    if (e.pointerId !== pid) return;
    const dx = e.clientX - lx;
    if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) { moved = true; if (sel < 0) enterRail(); dragging = true; try { el.setPointerCapture(pid); } catch (_) {} root.classList.add('is-dragging'); }
    if (!moved) return;
    lx = e.clientX;
    const now = performance.now(), dtm = Math.max(1, now - lt); lt = now;
    if (sel < 0) {
      axes();
      const d = tees.length ? visSize(tees[0].center.clone().sub(home.pos).dot(fwd) - DOLLY * dolly).w : 1;
      const dg = -dx / W * d;
      glideTarget = clamp(glideTarget + dg, -glideRange, glideRange);
      glide = glideTarget;
      glideVel = glideVel * .6 + (dg / dtm * 1000) * .4;
    } else userSpin += dx / W * Math.PI * 2.2;
    wake();
  });
  const end = e => {
    if (e.pointerId !== pid) return;
    const wasMoved = moved;
    pid = null; dragging = false; root.classList.remove('is-dragging');
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    if (performance.now() - lt > 90) glideVel = 0;
    if (!wasMoved && e.type === 'pointerup') {
      if (e.target.closest('.vst-card,.vst-picker,.vst-close,.vst-hint')) return;
      const i = pick(e);
      if (i >= 0) select(i); else if (sel >= 0) back();
    }
    wake();
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', e => {
    if (sel >= 0) return;
    enterRail();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    e.preventDefault();
    glideTarget = clamp(glideTarget + d * .0022 * visSize(4).w / 4, -glideRange, glideRange); wake();
  }, { passive: false });
  window.addEventListener('keydown', onKey);
}
function onKey(e) {
  if (e.target.closest && e.target.closest('dialog')) return;
  if (e.key === 'Escape') { if (sel >= 0) back(); else if (dollyTarget) exitRail(); return; }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (e.target.matches && e.target.matches('input,textarea')) return;
  const dir = e.key === 'ArrowRight' ? 1 : -1;
  if (sel < 0) { enterRail(); if (!glideRange) return; glideTarget = clamp(glideTarget + dir * glideRange * .4, -glideRange, glideRange); e.preventDefault(); wake(); }
  else { select((sel + dir + tees.length) % tees.length); const b = picker.children[sel]; b && b.focus({ preventScroll: true }); e.preventDefault(); }
}

/* ---------- ui ---------- */
function buildPicker() {
  picker.innerHTML = '';
  tees.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'vst-dot'; b.dataset.tee = String(t.n); b.textContent = String(t.n);
    b.setAttribute('aria-label', 'Voir le t-shirt ' + t.n); b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => select(i));
    picker.appendChild(b);
  });
}
function updatePicker() { [...picker.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === sel))); }
function updateCard(t) {
  $('.vst-name').textContent = t.meta.title || 'T-shirt Onze ' + String(t.n).padStart(2, '0');
  $('.vst-sub').textContent = t.meta.subtitle || 'Prototype · Vente fermée';
  $('.vst-price').textContent = t.meta.price || 'Prix à définir';
  const link = $('.vst-link');
  link.href = t.meta.href || FALLBACK_LINKS[(t.n - 1) % 2];
  card.setAttribute('aria-label', 'T-shirt ' + t.n);
  card.querySelectorAll('.vst-size').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vstSize === 'M')));
  $('.vst-chosen').textContent = 'M';
}
card.querySelectorAll('.vst-size').forEach(b => b.addEventListener('click', () => {
  card.querySelectorAll('.vst-size').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $('.vst-chosen').textContent = b.dataset.vstSize;
}));
$('.vst-close').addEventListener('click', back);
$('.vst-overview').addEventListener('click', exitRail);

window.__vestiaire = { get rail() { return dollyTarget === 1; }, get dolly() { return dolly; }, get glideRange() { return glideRange; }, get loaded() { return ready; }, get state() { return tween ? 'transition' : sel >= 0 ? 'focus' : 'wide'; }, get selected() { return sel >= 0 ? tees[sel].n : null; }, get frameCount() { return frameCount; }, get running() { return !!rafId; }, get camera() { return camera.position.toArray(); }, poses() { return tees.map(t => { t.node.updateMatrixWorld(true); const p = new THREE.Vector3(), q = new THREE.Quaternion(); t.node.matrixWorld.decompose(p, q, new THREE.Vector3()); return { n: t.n, p: p.toArray(), q: q.toArray(), p0: t.wp.toArray(), q0: t.wq.toArray() }; }); }, get ready() { return ready; }, get sel() { return sel; }, select, back, enterRail, exitRail, get glide() { return glide; }, exact() { return tees.every(t => { t.node.updateMatrixWorld(true); const p = new THREE.Vector3(), q = new THREE.Quaternion(); t.node.matrixWorld.decompose(p, q, new THREE.Vector3()); return (sel >= 0 && tees[sel] === t) || (p.distanceTo(t.wp) < 1e-5 && Math.abs(q.dot(t.wq)) > 1 - 1e-8); }); }, project(i) { const v = tees[i].center.clone().project(camera); const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; } };

window.__vst = window.__vestiaire;
