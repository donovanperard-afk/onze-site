/* r17b cotton visibility module (v2). Own file; renderer/manifest untouched. No mesh/colour changes.
   AUDIT (see /home/kit/work/vestiaire/r17b/cotton/AUDIT.md): tee UV density 0.778 uv/m x repeat 4.888 => 3.80 tiles/m => ~7790 normal texels/m.
   Normal energy sits at 256-1000+ cycles/tile (peak ~380 => stitch ~5.4 texels ~0.7mm). At 244 px/m (wide shot) that is 0.17 px/stitch: subpixel, mips average it out.
   So the repeat must go DOWN: mult ~0.04 (wide) .. 0.25 (close). Default 0.12 ~ 3 px stitch at the wide framing, oversized weave (stylised, not physical).
   API
     applyCotton(THREE, mat, {mult=0.12, strength=4, on=true})  -- call once per cotton material after buildMaterial
     window.__cotton.set({mult,strength,on})   live, no recompile; on:false = exact original sampling
     window.__cotton.readback(renderer, camera, meshes, {size=[w,h]}) -> real GPU readback stats
     window.__cotton.density(camera, meshes, viewportH) -> CPU projected texels-per-pixel from real geometry
   strength multiplies mapN.xy on top of material.normalScale (0.18 in source). */
export const DEFAULTS = { mult: 0.12, strength: 4, on: true };
const state = Object.assign({}, DEFAULTS), U = { uMult: { value: 1 }, uStr: { value: 1 } };
function sync() { U.uMult.value = state.on ? state.mult : 1; U.uStr.value = state.on ? state.strength : 1; }
export function applyCotton(THREE, m, opts) {
  Object.assign(state, opts || {}); sync();
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev && prev(sh, r); sh.uniforms.uMult = U.uMult; sh.uniforms.uStr = U.uStr;
    let f = sh.fragmentShader; const ch = THREE.ShaderChunk.normal_fragment_maps;
    const t = 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;';
    if (!ch.includes(t)) throw new Error('r17b: three normal chunk changed');
    f = f.replace('#include <normal_fragment_maps>', ch.replace(t, 'vec3 mapN = texture2D( normalMap, vNormalMapUv * uMult ).xyz * 2.0 - 1.0;\n\t\tmapN.xy *= uStr;'));
    f = f.replace('void main() {', 'uniform float uMult; uniform float uStr;\nvoid main() {');
    if (!f.includes('uStr;')) throw new Error('r17b: cotton patch failed');
    sh.fragmentShader = f; m.userData.cottonPatched = true;
  };
  m.customProgramCacheKey = () => (prevKey ? prevKey.call(m) : '') + '|r17b';
  m.needsUpdate = true;
  if (m.normalMap) { m.normalMap.wrapS = m.normalMap.wrapT = THREE.RepeatWrapping; m.normalMap.anisotropy = 16; m.normalMap.needsUpdate = true; }
  const mats = (window.__cottonMats = window.__cottonMats || []); mats.push(m);
  window.__cotton = {
    state, set(o) { Object.assign(state, o); sync(); },
    readback: (renderer, camera, meshes, o) => readback(THREE, renderer, camera, meshes, o || {}),
    density: (camera, meshes, vh) => density(THREE, camera, meshes, vh)
  };
  return m;
}
function nmap(m) { const n = (m || (window.__cottonMats || [])[0] || {}).normalMap; return n; }
/* CPU: projected normal-texels per screen pixel from actual vertices/uv, uses current mult. */
export function density(THREE, camera, meshes, vh) {
  const n = nmap(), w = n && n.image ? n.image.width : 2048, rep = n ? n.repeat.x : 4.888, k = w * rep * U.uMult.value /* density(): repeat only, offset irrelevant */, H = vh || innerHeight, res = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv, ix = g.index, vals = [];
    mesh.updateWorldMatrix(true, false);
    const nT = (ix ? ix.count : pos.count) / 3, step = Math.max(1, Math.floor(nT / 4000));
    for (let t = 0; t < nT; t += step) {
      const i = [0, 1, 2].map(j => ix ? ix.getX(t * 3 + j) : t * 3 + j);
      const P = i.map((q, j) => [a, b, c][j].fromBufferAttribute(pos, q).applyMatrix4(mesh.matrixWorld).project(camera));
      const sa = Math.abs((P[1].x - P[0].x) * (P[2].y - P[0].y) - (P[1].y - P[0].y) * (P[2].x - P[0].x)) / 2 * (H * H * camera.aspect / 4);   // px^2
      const U0 = i.map(q => [uv.getX(q), uv.getY(q)]);
      const ua = Math.abs((U0[1][0] - U0[0][0]) * (U0[2][1] - U0[0][1]) - (U0[1][1] - U0[0][1]) * (U0[2][0] - U0[0][0])) / 2;
      if (sa > 1e-3 && ua > 1e-12) vals.push(Math.sqrt(ua * k * k / sa));
    }
    vals.sort((x, y) => x - y); res.push({ mesh: mesh.name, medianTexelsPerPixel: vals[vals.length >> 1], p10: vals[Math.floor(vals.length * .1)], p90: vals[Math.floor(vals.length * .9)], samples: vals.length });
  }
  return res;
}
/* GPU readback: RG = decoded mapN.xy (real sampled/mipped, runtime uv transform * mult), B = texel density, A = coverage.
   Uses the real normalMap.matrix (offset/repeat/rotation/center), the cotton material's side, and restores renderer state in finally.
   o: {size:[w,h] (default full drawing buffer), mult (override, e.g. 1 for the 'before' state)} */
export function readback(THREE, renderer, camera, meshes, o) {
  o = o || {};
  const cm = (window.__cottonMats || [])[0], n = nmap(cm);
  if (!n) throw new Error('r17b readback: no cotton normalMap (call applyCotton first)');
  const img = n.image || (n.source && n.source.data), iw = img && (img.width || img.videoWidth), ih = img && (img.height || img.videoHeight);
  if (!iw || !ih) throw new Error('r17b readback: normalMap has no decoded image size yet (texture not loaded/uploaded)');
  if (!meshes || !meshes.length) throw new Error('r17b readback: no meshes');
  const db = renderer.getDrawingBufferSize(new THREE.Vector2()), W = (o.size && o.size[0]) || db.x, H = (o.size && o.size[1]) || db.y;
  n.updateMatrix();
  const mult = o.mult !== undefined ? o.mult : U.uMult.value;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
  const mat = new THREE.ShaderMaterial({
    side: cm.side,
    uniforms: { nm: { value: n }, nmMat: { value: n.matrix }, uMult: { value: mult }, size: { value: new THREE.Vector2(iw, ih) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform sampler2D nm; uniform mat3 nmMat; uniform float uMult; uniform vec2 size; varying vec2 vUv; void main(){ vec2 u=(nmMat*vec3(vUv,1.)).xy*uMult; vec3 t=texture2D(nm,u).xyz*2.-1.; vec2 d=u*size; float rho=max(length(dFdx(d)),length(dFdy(d))); gl_FragColor=vec4(t.xy,rho,1.); }'
  });
  const sc = new THREE.Scene();
  for (const m of meshes) { const c = new THREE.Mesh(m.geometry, mat); m.updateWorldMatrix(true, false); c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); c.matrixWorld.copy(m.matrixWorld); sc.add(c); }
  const oldRT = renderer.getRenderTarget(), oldCol = new THREE.Color(), oldA = renderer.getClearAlpha(), oldTM = renderer.toneMapping, oldCS = renderer.outputColorSpace, oldAuto = renderer.autoClear;
  renderer.getClearColor(oldCol);
  let buf;
  try {
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.autoClear = true; renderer.clear(); renderer.render(sc, camera);
    buf = new Float32Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  } finally {
    renderer.setRenderTarget(oldRT); renderer.setClearColor(oldCol, oldA); renderer.autoClear = oldAuto;
    renderer.toneMapping = oldTM; renderer.outputColorSpace = oldCS; rt.dispose(); mat.dispose();
  }
  let c = 0, sx = 0, sxx = 0, sy = 0, syy = 0; const rhos = [];
  for (let i = 0; i < buf.length; i += 4) if (buf[i + 3] > 0) { c++; sx += buf[i]; sxx += buf[i] * buf[i]; sy += buf[i + 1]; syy += buf[i + 1] * buf[i + 1]; if (c % 7 === 0) rhos.push(buf[i + 2]); }
  if (c === 0) throw new Error('r17b readback: 0 covered pixels (meshes outside the camera frustum, wrong camera, or all back-facing for side=' + cm.side + ')');
  rhos.sort((a, b) => a - b);
  const vx = sxx / c - (sx / c) ** 2, vy = syy / c - (sy / c) ** 2, raw = Math.sqrt(Math.max(0, vx + vy));
  return { size: [W, H], pixels: c, coverage: c / (W * H), side: cm.side, mult, strength: U.uStr.value, normalXYrmsRaw: raw, normalXYrmsAfterScale: raw * cm.normalScale.x * U.uStr.value, medianTexelsPerPixel: rhos[rhos.length >> 1], p10: rhos[Math.floor(rhos.length * .1)], p90: rhos[Math.floor(rhos.length * .9)], note: 'Single-sided only if material side=FrontSide (back faces excluded). Compare readback(...,{mult:1}) before vs default after; texelsPerPixel>1 means minified. rms after scale uses strength of current state for both.' };
}
