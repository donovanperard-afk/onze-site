import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
const stage = document.querySelector('.hero-stage');
if (stage) boot();
function boot() {
  const canvas = document.createElement('canvas');
  canvas.className = 'ball3d';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.opacity = '0';
  let rim, rim2, renderer, scene, camera, ball, live = false, queued = false, w = 0, h = 0;
  let last = { x: 0, y: 0, size: 100, t: 0 };
  const HOLE = new THREE.Vector3(-.112, -.994, .016).normalize(); // opening, model space (glTF Y-up)
  const AXV = new THREE.Vector3(.5, .32, -.8).normalize(); // spin axis in camera space, pointing away from viewer
  window.__AXV = AXV;
  const AX = new THREE.Vector3(), tmp = new THREE.Vector3();
  const qs = new THREE.Quaternion(), qbase = new THREE.Quaternion(), qr = new THREE.Quaternion();
  const FULL_TURNS = 4, TAU = Math.PI * 2, TILT = 8 * Math.PI / 180;
  const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0), XAX = new THREE.Vector3(1, 0, 0);
  // spin is a pure function of scroll t: slight slowdown near the end, same value up or down
  const phase = t => { t = Math.min(1, Math.max(0, t)); return (t - .18 * t * t) / .82; };
  function size() {
    w = stage.clientWidth; h = stage.clientHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.left = 0; camera.right = w; camera.top = h; camera.bottom = 0; camera.updateProjectionMatrix();
  }
  function pose() {
    const p = phase(last.t) * FULL_TURNS * TAU; window.__spinAngle = p;
    // pure spin about the ball's own vertical axis; hole on the bottom pole, ball inclined slightly away from camera
    qbase.setFromUnitVectors(HOLE, DOWN);
    qs.setFromAxisAngle(UP, p);
    qr.setFromAxisAngle(XAX, TILT);
    ball.quaternion.copy(qr).multiply(qs).multiply(qbase);
    tmp.copy(HOLE).applyQuaternion(ball.quaternion);
    window.__holeZ = tmp.z; // < 0 means the opening faces away from the viewer
    ball.position.set(last.x, h - last.y, 0);
    ball.scale.setScalar(last.size);
    const g = Math.min(1, Math.max(0, (last.t - .55) / .4)); // cool neon rim grows toward the goal
    rim.intensity = 7 * g; rim2.intensity = 5 * g * g; rim2.position.set(last.gx || w * .73, h - (last.gy || h * .48), 260);
    scene.environmentIntensity = .85 + .6 * g;
  }
  function draw() {
    queued = false;
    if (!ball || !renderer) return;
    pose();
    renderer.render(scene, camera);
  }
  function request() { if (!queued) { queued = true; requestAnimationFrame(draw); } }
  function fallback() {
    live = false;
    canvas.remove();
    delete document.documentElement.dataset.ball3d;
    window.__ball3d = false;
    dispatchEvent(new Event('ball3dready')); // app repaints the sprite
  }
  async function init() {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); fallback(); });
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(0, 1, 0, 1, -2000, 2000);
    // y up, positions flipped from page pixels in pose()
    // light set tuned against the Blender render of the same blend
    const W = new THREE.Color().setRGB(.55, .62, .75, THREE.LinearSRGBColorSpace);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: W, side: THREE.BackSide })));
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(envScene, 0).texture;
    scene.environmentIntensity = 1.3;
    const key = new THREE.DirectionalLight(0xe8f2ff, 4.2);
    key.position.set(-.47, .574, .671);
    scene.add(key);
    rim = new THREE.DirectionalLight(0xd8ecff, 0); rim.position.set(.9, -.2, -.5); scene.add(rim);
    rim2 = new THREE.PointLight(0x9fe8ff, 0, 0, 0); scene.add(rim2);
    const gltf = await new GLTFLoader().loadAsync(new URL('./ball.glb', import.meta.url).href);
    const obj = gltf.scene;
    const aniso = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);
    obj.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
        const tx = m[k]; if (!tx) continue;
        tx.anisotropy = aniso; tx.generateMipmaps = true;
        tx.minFilter = THREE.LinearMipmapLinearFilter; tx.magFilter = THREE.LinearFilter; tx.needsUpdate = true;
      }
      if (m.transparent) { // repaired hole patch: feathered edge over the scan, no z fight
        m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; o.renderOrder = 1;
      }
    });
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const k = 1 / Math.max(s.x, s.y, s.z);
    obj.position.sub(c).multiplyScalar(k);
    obj.scale.multiplyScalar(k);
    ball = new THREE.Group(); ball.add(obj);
    scene.add(ball); window.__ballObj = ball;
    stage.insertBefore(canvas, document.querySelector('.ground-shadow'));
    size();
    addEventListener('resize', () => { size(); request(); }, { passive: true });
    // first real frame is drawn (textures uploaded) while the canvas is still invisible
    draw();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    draw();
    live = true;
    // atomic swap: canvas on, sprite off in the same task
    canvas.style.opacity = '1';
    window.__ball3d = true;
    document.documentElement.dataset.ball3d = '1';
    document.documentElement.dataset.ball3dState = 'ready';
    dispatchEvent(new Event('ball3dready'));
  }
  addEventListener('ball:update', e => { last = e.detail; if (ball) request(); });
  init().catch(err => { console.warn('ball3d fallback sprite', err); fallback(); });
}
