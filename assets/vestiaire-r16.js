import * as THREE from './r14deps/three.module.js?v=r16';
import { GLTFLoader } from './r14deps/GLTFLoader.js?v=r16';
import { MeshoptDecoder } from './r14deps/meshopt_decoder.js?v=r16';

/* ONZE vestiaire r16: baked static room (atlas on uv1, unlit) + 6 live cotton tee/hanger groups */
const V = 'r16n';
const root = document.querySelector('[data-vestiaire]');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const $ = s => root.querySelector(s);
const stage = $('.vst-stage'), card = $('.vst-card'), picker = $('.vst-picker'), status = $('.vst-status');
const U = p => new URL('./r16/' + p + (p.includes('?') ? '&' : '?') + 'v=' + V, import.meta.url).href;
const FALLBACK_LINKS = ['../shop/t-shirt-blanc/?v=r16', '../shop/t-shirt-noir/?v=r16'].map(p => new URL(p, import.meta.url).href);
const ease = t => 1 - Math.pow(1 - t, 4);
const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const qp = new URLSearchParams(location.search);

let renderer, scene, camera, M = null, pairs = [], sel = -1, W = 0, H = 0, ready = false;
let rafId = 0, last = 0, frameCount = 0, keyLight, rimLight;
const home = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 26.5 };
const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
let glide = 0, glideTarget = 0, glideVel = 0, glideRange = 0, dolly = 0, dollyTarget = 0, DOLLY = 0;
let tween = null, spinning = false, spinAngle = 0, userSpin = 0, dragging = false;

function fail(msg) { root.classList.add('is-static'); status.textContent = msg; status.hidden = false; }
try { const t = document.createElement('canvas'); if (!(t.getContext('webgl2') || t.getContext('webgl'))) throw 0; }
catch (e) { fail('La 3D n’est pas disponible sur cet appareil. Voir les pièces dans la boutique.'); }
if (!root.classList.contains('is-static')) init().catch(e => { console.error(e); fail('La 3D n’a pas pu démarrer sur cet appareil.'); });

const MOBILE = innerWidth <= 768;
function texLoad(url, o) {
  if (MOBILE && !/\/r16\/mobile\//.test(url)) url = url.replace('/onze-site/r16/', '/onze-site/r16/mobile/');
  return new THREE.TextureLoader().loadAsync(url).then(t => {
    t.colorSpace = o && o.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.flipY = false;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); if (o && o.channel) t.channel = o.channel; if (o && o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

async function init() {
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch (e) { fail('La 3D n’est pas disponible sur cet appareil.'); return; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;      // live tees only; baked room is toneMapped=false
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  stage.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  const gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  try { M = await (await fetch(U('manifest.json'))).json(); } catch (e) { fail('Le vestiaire n’a pas pu se charger. Réessayez dans un instant.'); return; }
  const files = M.files || {};
  let roomG, liveG;
  try { [roomG, liveG] = await Promise.all([gl.loadAsync(U(files.room || 'room.glb')), gl.loadAsync(U(files.live || 'live.glb'))]); }
  catch (e) { console.error(e); fail('Le vestiaire n’a pas pu se charger. Réessayez dans un instant.'); return; }

  /* room: merged atlas meshes, static unlit, lightmap-baked colours on uv1 */
  const at = M.room && M.room.atlases || {};
  const atl = {};
  await Promise.all(Object.keys(at).map(async k => { atl[k] = await texLoad(U(typeof at[k] === 'string' ? at[k] : at[k].map), { channel: (at[k].channel === undefined ? 1 : at[k].channel) }); }));
  roomG.scene.traverse(o => {
    if (!o.isMesh) return;
    const map = atl[o.name] || atl[o.material && o.material.name] || null;
    const old = o.material;
    if (map) o.material = new THREE.MeshBasicMaterial({ map, color: 0xffffff, toneMapped: false });
    else if (old) { /* un-atlased originals (emissive strips, opal): keep original PBR material; AgX applies once */ old.side = old.side; if (old.map) { old.map.anisotropy = 4; } o.material = old; }
    if (map && old && old.dispose) old.dispose();
    o.castShadow = false; o.receiveShadow = false; o.matrixAutoUpdate = false; o.updateMatrix();
  });
  scene.add(roomG.scene);

  /* camera (exact original wide) */
  const c = M.camera || {};
  home.pos.fromArray(c.position || [0, 1.977, 9.4]);
  home.quat.fromArray(c.quaternion || [-.0315, 0, 0, .9995]);
  home.fov = c.fovVerticalDegrees || c.fov || 26.5;
  camera = new THREE.PerspectiveCamera(home.fov, 16 / 9, c.near || .02, c.far || 100);
  scene.add(camera);

  /* live groups pair-1..6, pivot at the hook */
  const cotton = M.cotton ? await Promise.all(['map', 'normalMap', 'roughnessMap'].map(k => M.cotton[k] ? texLoad(U(M.cotton[k]), { linear: k !== 'map', repeat: true }) : null)) : [];
  scene.add(liveG.scene);
  scene.updateMatrixWorld(true);
  for (let i = 1; i <= 6; i++) {
    const node = liveG.scene.getObjectByName('pair-' + i) || liveG.scene.getObjectByName('pair_' + i) || liveG.scene.getObjectByName('pair' + i);
    if (!node) continue;
    node.updateMatrixWorld(true);
    const meshes = [];
    node.traverse(o => { if (o.isMesh) { meshes.push(o); o.castShadow = true; o.receiveShadow = true; if (o.material && /^Cotton/i.test(o.material.name)) { const m = o.material; if (cotton[0]) m.map = cotton[0]; if (cotton[1]) { m.normalMap = cotton[1]; m.normalScale.set(.18, .18); } if (cotton[2]) m.roughnessMap = cotton[2]; m.roughness = 1; m.metalness = 0; m.side = THREE.DoubleSide; m.shadowSide = THREE.FrontSide; m.needsUpdate = true; } } });
    const mp = M.pairs && M.pairs.find(p => p.name === node.name) || {};
    const box = new THREE.Box3().setFromObject(node);
    pairs.push({ n: i, node, meshes, pos0: node.position.clone(), quat0: node.quaternion.clone(), yaw0: 0,
      size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()), meta: mp,
      hook: mp.hook ? new THREE.Vector3().fromArray(mp.hook) : node.getWorldPosition(new THREE.Vector3()) });
  }
  if (!pairs.length) { fail('Aucun modèle trouvé dans le vestiaire.'); return; }

  /* lights: fixed in world, never move with the camera. cold key (single shadow) + warm rim */
  const L = M.lights || {};
  keyLight = new THREE.SpotLight(L.key && L.key.color || 0xbcd2ff, (L.key && L.key.intensity || 3.1) * (qp.get('k') ? +qp.get('k') : 80), 0, .95, .7, 2);
  keyLight.position.fromArray(L.key && L.key.position || [-3, 5, 6]); keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024); keyLight.shadow.bias = -.0005; keyLight.shadow.normalBias = .01; keyLight.shadow.radius = 4;
  keyLight.shadow.camera.near = 1; keyLight.shadow.camera.far = 20; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  rimLight = new THREE.DirectionalLight(L.rim && L.rim.color || 0xffb27a, (L.rim && L.rim.intensity || 2));
  rimLight.position.fromArray(L.rim && L.rim.position || [3.5, 3, -4]);
  const fillL = new THREE.DirectionalLight(0xdfe8ff, qp.get('f') ? +qp.get('f') : 3); fillL.position.set(0, 2.5, 6); scene.add(fillL, fillL.target); fillL.target.position.set(0, 1.5, -.24);
  const tg = new THREE.Object3D(); tg.position.set(0, 1.5, -.24); scene.add(tg, keyLight, rimLight); keyLight.target = tg; rimLight.target = tg;
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();      // env captured ONCE from the real baked room
  es.add(roomG.scene.clone(true));
  const rt = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType }), cc = new THREE.CubeCamera(.05, 60, rt);
  cc.position.set(0, 1.8, 1); es.add(cc); cc.update(renderer, es);
  scene.environment = pm.fromCubemap(rt.texture).texture; scene.environmentIntensity = qp.get('env') ? +qp.get('env') : 1; rt.dispose(); pm.dispose();

  buildPicker(); bindInput();
  new ResizeObserver(resize).observe(stage); resize();
  ready = true; applyCamera(); render();
  root.classList.add('is-ready'); status.hidden = true;
}

function resize() {
  W = stage.clientWidth; H = stage.clientHeight; if (!W || !H) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.fov = W <= 768 ? (W <= 480 ? 36 : 28) : camera.aspect >= 16 / 9 ? home.fov : Math.min(95, 2 * Math.atan(Math.tan(home.fov * Math.PI / 360) * (16 / 9) / Math.max(camera.aspect, .3)) * 180 / Math.PI);
  camera.updateProjectionMatrix();
  computeRange();
  glideTarget = clamp(glideTarget, -glideRange, glideRange); glide = clamp(glide, -glideRange, glideRange);
  if (sel >= 0) focusNow(); else applyCamera();
  wake();
}
function axes() { fwd.set(0, 0, -1).applyQuaternion(home.quat); right.set(1, 0, 0).applyQuaternion(home.quat); up.set(0, 1, 0).applyQuaternion(home.quat); }
function visSize(d) { const h = 2 * Math.tan(camera.fov * Math.PI / 360) * d; return { h, w: h * camera.aspect }; }
function enterRail() { if (dollyTarget || sel >= 0) return; dollyTarget = 1; root.classList.add('is-rail'); wake(); }
function exitRail() { dollyTarget = 0; glideTarget = 0; glideVel = 0; root.classList.remove('is-rail'); if (sel >= 0) back(); wake(); }
function railPos(g, d) { axes(); return home.pos.clone().addScaledVector(fwd, d * DOLLY).addScaledVector(right, g); }
function computeRange() {
  axes();
  let lo = Infinity, hi = -Infinity, dsum = 0;
  pairs.forEach(t => { const s = t.center.dot(right); lo = Math.min(lo, s - t.size.x / 2); hi = Math.max(hi, s + t.size.x / 2); dsum += t.center.clone().sub(home.pos).dot(fwd); });
  const d0 = dsum / pairs.length;
  DOLLY = M.glide && M.glide.dolly !== undefined ? M.glide.dolly : Math.max(0, d0 - 4.8);
  const vw = visSize(d0 - DOLLY).w;
  glideRange = W <= 768 ? Math.max(0, (hi - lo + .6 - vw) / 2) : M.glide && M.glide.range !== undefined ? M.glide.range : Math.max(0, (hi - lo + .6 - vw) / 2);
  if (glideRange < .05) glideRange = 0;
}
function applyCamera() { if (sel >= 0) return; camera.position.copy(railPos(glide, dolly)); if (W <= 768) camera.position.addScaledVector(up, .55); camera.quaternion.copy(home.quat); camera.updateMatrixWorld(); }

/* ---------- focus: tee slides forward clear of the hook bar, then the whole group spins ---------- */
function clearance(t) { return (t.meta.clear !== undefined ? t.meta.clear : (M.focus && M.focus.clear !== undefined ? M.focus.clear : .45)); }
function focusPose(t) {
  axes();
  const mobile = W <= 768, tw = Math.max(t.size.x, t.size.z);
  const need = Math.max(t.size.y / (mobile ? .36 : .56), tw / (mobile ? .78 : .44) / camera.aspect);
  const dist = need / (2 * Math.tan(camera.fov * Math.PI / 360));
  const c = t.center.clone().addScaledVector(fwd, -clearance(t));
  const pos = c.clone().addScaledVector(fwd, -dist), vs = visSize(dist);
  if (mobile) pos.addScaledVector(up, -vs.h * .2); else pos.addScaledVector(right, vs.w * .15);
  return { pos, center: c };
}
function focusNow() { const p = focusPose(pairs[sel]); camera.position.copy(p.pos); camera.quaternion.copy(home.quat); camera.updateMatrixWorld(); setPair(pairs[sel], 1, 1, spinAngle); }
/* fw: forward slide 0..1 ; rot: rotation weight 0..1 ; ang: yaw. Rotation pivots at the hook (group origin). */
function setPair(t, fw, rot, ang) {
  axes();
  const par = t.node.parent; par.updateWorldMatrix(true, false);
  const wp = t.pos0.clone().applyMatrix4(par.matrixWorld).addScaledVector(fwd, -clearance(t) * fw);
  t.node.position.copy(par.worldToLocal(wp));
  t.node.quaternion.copy(t.quat0).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang * rot));
  t.node.updateMatrixWorld(true);
}
function restore(t) { t.node.position.copy(t.pos0); t.node.quaternion.copy(t.quat0); t.node.updateMatrixWorld(true); }
function run(from, to, dur, done, extra) { tween = { t0: performance.now(), d: reduce.matches ? 0 : dur, from, to, done, extra }; wake(); }

function select(i) {
  if (!ready || i === sel || i < 0 || i >= pairs.length) return;
  if (tween && tween.extra && tween.extra.back) restore(tween.extra.back);
  tween = null;
  const prev = sel >= 0 ? pairs[sel] : null, start = camera.position.clone();
  if (prev) restore(prev);
  const first = sel < 0; sel = i;
  const t = pairs[i], p = focusPose(t);
  const tm = t.meshes.find(m => /^tee/i.test(m.name)), fy = W <= 768 && tm ? -2 * Math.atan2(tm.quaternion.y, tm.quaternion.w) : 0;   // mobile only: turn tee face-on
  spinAngle = fy; userSpin = 0; spinning = false;
  root.classList.add('is-focus'); root.dataset.sel = i; updateCard(t); updatePicker();
  run(start, p.pos, first ? 900 : 760, () => { spinning = !reduce.matches; }, { sel: t, fy });
  status.textContent = 'T-shirt ' + t.n + ' sélectionné';
}
function back() {
  if (sel < 0) return;
  const t = pairs[sel], start = camera.position.clone(), lastI = sel;
  const wasIn = card.contains(document.activeElement);
  const ang = spinAngle - Math.round(spinAngle / (Math.PI * 2)) * Math.PI * 2;
  spinning = false; root.classList.remove('is-focus'); sel = -1; delete root.dataset.sel; updatePicker();
  run(start, railPos(glide, dolly), 760, () => { restore(t); applyCamera(); }, { back: t, ang });
  status.textContent = 'Vue d’ensemble';
  if (wasIn) { const b = picker.children[lastI]; b && b.focus(); }
}
function stepTween(now) {
  if (!tween) return false;
  const k = tween.d ? clamp((now - tween.t0) / tween.d, 0, 1) : 1, x = tween.extra || {};
  camera.position.lerpVectors(tween.from, tween.to, ease(k)); camera.quaternion.copy(home.quat);
  if (x.back) {   // unwind the spin first, then slide back onto the bar
    const kr = clamp(k / .45, 0, 1), kf = clamp((k - .35) / .65, 0, 1);
    if (k < 1) setPair(x.back, 1 - ease(kf), 1, x.ang * (1 - ease(kr)));
  } else if (x.sel) {   // slide forward first, rotation only starts after the hook is clear
    setPair(x.sel, ease(clamp(k / .55, 0, 1)), ease(clamp((k - .55) / .45, 0, 1)), x.fy || 0);
  }
  camera.updateMatrixWorld();
  if (k >= 1) { const d = tween.done; tween = null; d && d(); }
  return true;
}

function wake() { if (!rafId && ready && !document.hidden) { last = performance.now(); rafId = requestAnimationFrame(frame); } }
function frame(now) {
  rafId = 0;
  const dt = Math.min(.25, (now - last) / 1000); last = now;
  let busy = stepTween(now);
  if (sel < 0 && !tween) {
    if (Math.abs(glideVel) > .0005 && !dragging) { glideTarget = clamp(glideTarget + glideVel * dt, -glideRange, glideRange); glideVel *= Math.pow(.02, dt); if (Math.abs(glideTarget) >= glideRange) glideVel = 0; }
    dolly = reduce.matches ? dollyTarget : dolly + (dollyTarget - dolly) * (1 - Math.pow(.004, dt)); if (Math.abs(dolly - dollyTarget) < .001) dolly = dollyTarget;
    const g = reduce.matches ? glideTarget : glide + (glideTarget - glide) * (1 - Math.pow(.0008, dt));
    glide = (Math.abs(g - glideTarget) < .0004 && Math.abs(glideVel) <= .0005) ? glideTarget : g;
    applyCamera();
    busy = busy || dolly !== dollyTarget || glide !== glideTarget || Math.abs(glideVel) > .0005 || dragging;
  } else if (sel >= 0 && !tween) {
    if (spinning && !dragging) spinAngle += dt * (Math.PI * 2 / 9);
    if (userSpin) { spinAngle += userSpin; userSpin = 0; }
    setPair(pairs[sel], 1, 1, spinAngle);
    busy = busy || spinning || dragging;
  }
  render();
  if (busy) rafId = requestAnimationFrame(frame);
}
function render() { if (renderer) { if (sel >= 0 || tween) renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); frameCount++; } }
document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); else if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } });
reduce.addEventListener && reduce.addEventListener('change', () => { if (reduce.matches) spinning = false; wake(); });

/* ---------- input ---------- */
let pid = null, sx = 0, sy = 0, lx = 0, moved = false, lt = 0;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(pairs.flatMap(t => t.meshes), false)[0];
  return hit ? pairs.findIndex(t => t.meshes.includes(hit.object)) : -1;
}
function bindInput() {
  const el = stage;
  el.addEventListener('pointerdown', e => { if (e.button > 0) return; pid = e.pointerId; sx = lx = e.clientX; sy = e.clientY; moved = false; dragging = false; glideVel = 0; lt = performance.now(); });
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
      const d = visSize(pairs[0].center.clone().sub(home.pos).dot(fwd) - DOLLY * dolly).w, dg = -dx / W * d;
      glideTarget = clamp(glideTarget + dg, -glideRange, glideRange); glide = glideTarget;
      glideVel = glideVel * .6 + (dg / dtm * 1000) * .4;
    } else userSpin += dx / W * Math.PI * 2.2;
    wake();
  });
  const end = e => {
    if (e.pointerId !== pid) return;
    const wasMoved = moved; pid = null; dragging = false; root.classList.remove('is-dragging');
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    if (performance.now() - lt > 90) glideVel = 0;
    if (!wasMoved && e.type === 'pointerup') {
      if (e.target.closest('.vst-card,.vst-picker,.vst-close,.vst-hint')) return;
      const i = pick(e); if (i >= 0) select(i); else if (sel >= 0) back();
    }
    wake();
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', e => {
    if (sel >= 0) return;
    enterRail(); e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
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
  else { select((sel + dir + pairs.length) % pairs.length); const b = picker.children[sel]; b && b.focus({ preventScroll: true }); e.preventDefault(); }
}

/* ---------- ui ---------- */
function buildPicker() {
  picker.innerHTML = '';
  pairs.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'vst-dot'; b.dataset.tee = String(t.n); b.textContent = String(t.n);
    b.setAttribute('aria-label', 'Voir le t-shirt ' + t.n); b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => select(i)); picker.appendChild(b);
  });
}
function updatePicker() { [...picker.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === sel))); }
function updateCard(t) {
  const m = t.meta, sizes = m.sizes || ['S', 'M', 'L', 'XL'];
  $('.vst-name').textContent = m.title || 'T-shirt Onze ' + String(t.n).padStart(2, '0');
  $('.vst-sub').textContent = m.subtitle || 'Prototype · Vente fermée';
  $('.vst-price').textContent = m.price || 'Prix à définir';
  $('.vst-link').href = m.href || FALLBACK_LINKS[(t.n - 1) % 2];
  card.setAttribute('aria-label', 'T-shirt ' + t.n);
  const sz = card.querySelector('.vst-sizes');
  if (sz.children.length !== sizes.length || [...sz.children].some((b, i) => b.dataset.vstSize !== sizes[i])) {
    sz.innerHTML = ''; sizes.forEach(s => { const b = document.createElement('button'); b.type = 'button'; b.className = 'vst-size'; b.dataset.vstSize = s; b.textContent = s; b.addEventListener('click', () => setSize(s)); sz.appendChild(b); });
  }
  setSize(sizes.includes('M') ? 'M' : sizes[0]);
}
function setSize(s) { card.querySelectorAll('.vst-size').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vstSize === s))); $('.vst-chosen').textContent = s; }
card.querySelectorAll('.vst-size').forEach(b => b.addEventListener('click', () => setSize(b.dataset.vstSize)));
$('.vst-close').addEventListener('click', back);
$('.vst-overview').addEventListener('click', exitRail);

window.__vestiaire = { get loaded() { return ready; }, get ready() { return ready; }, get state() { return tween ? 'transition' : sel >= 0 ? 'focus' : 'wide'; }, get selected() { return sel >= 0 ? pairs[sel].n : null; }, get sel() { return sel; }, get frameCount() { return frameCount; }, get running() { return !!rafId; }, get rail() { return dollyTarget === 1; }, get glide() { return glide; }, get glideRange() { return glideRange; }, get camera() { return camera.position.toArray(); }, get drawCalls() { return renderer.info.render.calls; }, select, back, enterRail, exitRail, project(i) { const v = pairs[i].center.clone().project(camera); const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; } };
Object.defineProperty(window.__vestiaire, 'stats', { get() { const i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, dpr: renderer.getPixelRatio(), canvas: [renderer.domElement.width, renderer.domElement.height], frames: frameCount }; } });
if (qp.get('fps') !== null) { /* continuous render mode for capture/profiling */ const loop = () => { if (ready) { if (sel >= 0 && !tween && spinning) {} render(); } requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
window.__vestiaire.dbg = () => pairs.map(t => { const b = new THREE.Box3().setFromObject(t.node); return { n: t.n, min: b.min.toArray().map(v => +v.toFixed(2)), max: b.max.toArray().map(v => +v.toFixed(2)), vis: t.node.visible, mats: t.meshes.map(m => m.name + ':' + m.material.name + ':' + (m.material.color && m.material.color.getHexString())) }; });
window.__vst = window.__vestiaire;
