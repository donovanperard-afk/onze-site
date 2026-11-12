import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
const stage = document.querySelector('.hero-stage');
const canvas = document.createElement('canvas');
canvas.className = 'ball3d';
canvas.setAttribute('aria-hidden', 'true');
let renderer, scene, camera, ball, last = {x: 0, y: 0, size: 100, t: 0}, queued = false, w = 0, h = 0;
const AXIS = new THREE.Vector3(.35, 1, .2).normalize();
const BASE = new THREE.Euler(.5, -.4, .1);
function size() {
  w = stage.clientWidth; h = stage.clientHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  camera.left = 0; camera.right = w; camera.top = 0; camera.bottom = h; camera.updateProjectionMatrix();
}
function draw() {
  queued = false;
  if (!ball) return;
  ball.position.set(last.x, last.y, 0);
  ball.scale.setScalar(last.size);
  // tilted-axis spin: slows slightly as it flies away
  ball.quaternion.setFromEuler(BASE).multiply(new THREE.Quaternion().setFromAxisAngle(AXIS, last.t * Math.PI * 2.4));
  renderer.render(scene, camera);
}
function request() { if (!queued) { queued = true; requestAnimationFrame(draw); } }
async function init() {
  renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true, powerPreference: 'low-power'});
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(0, 1, 0, 1, -2000, 2000);
  // y down in pixel space: flip so the ball isn't mirrored
  camera.up.set(0, -1, 0);
  const key = new THREE.DirectionalLight(0xcfe2ff, 3.2); key.position.set(-1, -1.2, 1.4); scene.add(key);
  scene.add(new THREE.HemisphereLight(0x8ea4c8, 0x1a2230, 1.1));
  const rim = new THREE.DirectionalLight(0x9fb8ff, .8); rim.position.set(1, .6, -.5); scene.add(rim);
  const gltf = await new GLTFLoader().loadAsync(new URL('./ball.glb', import.meta.url).href);
  const obj = gltf.scene;
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  obj.position.sub(c);
  obj.scale.multiplyScalar(1 / Math.max(s.x, s.y, s.z));
  obj.position.multiplyScalar(1 / Math.max(s.x, s.y, s.z));
  ball = new THREE.Group(); ball.add(obj);
  scene.add(ball);
  stage.insertBefore(canvas, document.querySelector('.ground-shadow'));
  size();
  addEventListener('resize', () => { size(); request(); }, {passive: true});
  window.__ball3d = true;
  document.documentElement.dataset.ball3d = '1';
  dispatchEvent(new Event('ball3dready'));
}
addEventListener('ball:update', e => { last = e.detail; request(); });
init().catch(err => { console.warn('ball3d fallback sprite', err); });
