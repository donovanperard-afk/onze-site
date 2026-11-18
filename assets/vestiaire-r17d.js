import * as THREE from './r17cdeps/three.module.js?v=r17c';
import { GLTFLoader } from './r17cdeps/GLTFLoader.js?v=r17c';
import { KTX2Loader } from './r17cdeps/KTX2Loader.js?v=r17c';
import { applyCotton } from './vestiaire-r17d-cotton.js?v=r17d';
import { clampPosition, pitchOf, maxX, assertCoverage, fitFov, planRail } from './vestiaire-r17d-camera.js?v=r17d';
import { MeshoptDecoder } from './r17cdeps/meshopt_decoder.js?v=r17c';

/* ONZE vestiaire r17 (PBR static + lighting-only lightmaps): baked static room (linear irradiance atlas on uv1, full PBR UV0) + 6 live cotton tee/hanger groups */
const V = 'r17d';
const WARM_LIN = new THREE.Color().setRGB(1, .755, .552, THREE.LinearSRGBColorSpace);   // ~3500K, linear
const root = document.querySelector('[data-vestiaire]');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const $ = s => root.querySelector(s);
const stage = $('.vst-stage'), card = $('.vst-card'), picker = $('.vst-picker'), status = $('.vst-status');
const U = p => new URL('./r17/' + p + (p.includes('?') ? '&' : '?') + 'v=' + V, import.meta.url).href;
const FALLBACK_LINKS = ['../shop/t-shirt-blanc/?v=r17d', '../shop/t-shirt-noir/?v=r17d'].map(p => new URL(p, import.meta.url).href);
const ease = t => 1 - Math.pow(1 - t, 4);
const easeIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const qp = new URLSearchParams(location.search);

const missing = [];
let renderer, scene, camera, M = null, pairs = [], sel = -1, W = 0, H = 0, ready = false;
let rafId = 0, last = 0, frameCount = 0, keyLight, rimLight, roomRoot, liveRoot, newLights = [], newOn = true, shadowDirty = true, newShadowLight;
const home = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 26.5 };
const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
let glide = 0, glideTarget = 0, glideVel = 0, glideRange = 0, dolly = 0, dollyTarget = 0, DOLLY = 0;
let tween = null, spinning = false, spinAngle = 0, userSpin = 0, dragging = false;

function fail(msg) { root.classList.add('is-static'); status.textContent = msg; status.hidden = false; }
try { const t = document.createElement('canvas'); if (!(t.getContext('webgl2') || t.getContext('webgl'))) throw 0; }
catch (e) { fail('La 3D n’est pas disponible sur cet appareil. Voir les pièces dans la boutique.'); }
if (!root.classList.contains('is-static')) init().catch(e => { console.error(e); fail('La 3D n’a pas pu démarrer sur cet appareil.'); });

const PIXEL_RATIO_MAX = 2;
const HDR_SCALE = +(qp.get('hdr') || 3.14159265);   // Blender diffuse bake = E/pi radiance; three lightMap path divides by pi again -> compensate (calibrate w/ white patch)
const loadBytes = { total: 0, files: {} };
const qaTex = [];
let phaseStats = {}, phaseName = 'wide', phaseSamples = {};
function track(url, bytes) { loadBytes.total += bytes; loadBytes.files[url] = bytes; }
let ktx2 = null;
function getKTX2() { if (!ktx2) { ktx2 = new KTX2Loader(); ktx2.setTranscoderPath(new URL('./r17cdeps/basis/', import.meta.url).href); ktx2.setWorkerLimit(2); ktx2.detectSupport(renderer); } return ktx2; }
const isKtx2 = u => /\.ktx2(\?|$)/i.test(u);
async function fetchBuf(url) { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); const b = await r.arrayBuffer(); track(url, b.byteLength); return b; }
async function fetchBlob(url) { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url); const b = await r.blob(); track(url, b.size); return b; }
const texCache = new Map();
/* bytes per texel of the transcoded GPU format (estimate for the audit; BC/ASTC/ETC are block formats) */
function ktxBpp(f) { const n = Object.entries(THREE).filter(([k, v]) => v === f && /_Format$/.test(k)).map(([k]) => k)[0] || ''; if (/BPTC|ASTC_4x4|S3TC_DXT5|DXT5|RGBA_ETC2|PVRTC_4/.test(n) || /DXT5|BPTC|ASTC_4x4|ETC2_EAC/.test(n)) return 1; if (/DXT1|ETC1|RGB_ETC2|S3TC_DXT1|PVRTC_2/.test(n)) return .5; return 4; }
/* kind: 'srgb' | 'linear' | 'rgbm'. Never downsizes: if source exceeds GPU max texture size we fail loudly. */
function texLoad(url, o) {
  o = o || {};
  const key = url + '|' + (o.kind || 'srgb') + '|' + (o.channel || 0) + '|' + (o.repeat ? 1 : 0);
  if (texCache.has(key)) return texCache.get(key);
  if (isKtx2(url)) { const pk = fetchBuf(url).then(buf => new Promise((res, rej) => { const to = setTimeout(() => { const e = new Error('KTX2 timeout 20s: ' + url); e.code = 'KTX2TIMEOUT'; console.error(e.message); rej(e); }, 20000); getKTX2()._createTexture(buf).then(t => { clearTimeout(to); res(t); }, e => { clearTimeout(to); const er = e instanceof Error ? e : new Error('KTX2 ' + url + ': ' + e); if (!/ktx2 /i.test(er.message)) er.message += ' [' + url + ']'; console.error(er.message); rej(er); }); })).then(t => {
    const max = renderer.capabilities.maxTextureSize, w = t.image.width, h = t.image.height; if (w > max || h > max) { const e = new Error('Texture ' + w + 'x' + h + ' dépasse la limite GPU (' + max + ') : ' + url); e.code = 'MAXTEX'; throw e; }
    const kind = o.kind || 'srgb'; t.colorSpace = kind === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.flipY = false; t.premultiplyAlpha = false;
    t.magFilter = THREE.LinearFilter; if (!t.mipmaps || t.mipmaps.length < 2) t.minFilter = THREE.LinearFilter; else t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy(); if (o.channel) t.channel = o.channel; if (o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true; const fmt = t.format, bpp = ktxBpp(fmt); const px = (t.mipmaps || []).reduce((a, m) => a + m.width * m.height, 0) || w * h;
    qaTex.push({ url, w, h, kind, aniso: t.anisotropy, bitmap: false, ktx2: true, glFormat: fmt, mips: (t.mipmaps || []).length, gpuMB: +(px * bpp / 1048576).toFixed(2), npot: (w & (w - 1)) !== 0 || (h & (h - 1)) !== 0, srcFile: url }); return t; });
    texCache.set(key, pk); return pk; }
  const p = fetchBlob(url).then(async blob => {
    /* no HTMLImage path: premultiplied alpha / colour conversion would corrupt RGBM and data maps */
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const t = new THREE.Texture(bmp), w = bmp.width, h = bmp.height, max = renderer.capabilities.maxTextureSize;
    if (w > max || h > max) { bmp.close && bmp.close(); const e = new Error('Texture ' + w + 'x' + h + ' dépasse la limite GPU (' + max + ') : ' + url); e.code = 'MAXTEX'; throw e; }
    const kind = o.kind || 'srgb';
    t.colorSpace = kind === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.flipY = false; t.premultiplyAlpha = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (o.channel) t.channel = o.channel;
    if (o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true; qaTex.push({ url, w, h, kind, aniso: t.anisotropy, bitmap: true });
    return t;
  });
  texCache.set(key, p); return p;
}
/* ---- material factory driven by export-manifest.materials (CONTRACT.md) ----
   colors linear (setRGB LinearSRGB); maps.* = {file,channel,repeat,colorSpace,factor?}; UV0 untouched, repeat applied here ONCE.
   three samples roughness=G, metalness=B, clearcoat=R, clearcoatRoughness=G natively: descriptors must match, else we refuse (no silent channel guess). */
const NATIVE_CH = { map: 'rgb', normalMap: 'rgb', emissiveMap: 'rgb', clearcoatNormalMap: 'rgb', roughnessMap: 'g', metalnessMap: 'b', clearcoatMap: 'r', clearcoatRoughnessMap: 'g' };
const RGBM_RANGE = 6, LIN = THREE.LinearSRGBColorSpace;
const lin3 = (c, d) => new THREE.Color().setRGB(c ? c[0] : d, c ? c[1] : d, c ? c[2] : d, LIN);
const descCache = new Map();
const CC_ALIAS = { clearcoatMap: 1, clearcoatRoughnessMap: 1 };   // only these two accept a source-channel alias (+ invert); validated, never injected raw
const CH_SWZ = { r: 'x', g: 'y', b: 'z' };
async function matMap(def, key) {
  const d = def.maps && def.maps[key]; if (!d) return null;
  if (d.invert !== undefined && typeof d.invert !== 'boolean') throw Object.assign(new Error('invert doit être booléen pour ' + key), { code: 'CHANNEL' });
  if (d.invert && !CC_ALIAS[key]) throw Object.assign(new Error('invert non supporté pour ' + key), { code: 'CHANNEL' });
  if (CC_ALIAS[key] && d.channel !== undefined && !/^[rgb]$/.test(d.channel)) throw Object.assign(new Error('Canal ' + d.channel + ' non supporté pour ' + key + ' (r/g/b seulement)'), { code: 'CHANNEL' });
  if (!CC_ALIAS[key] && d.channel && d.channel !== NATIVE_CH[key]) throw Object.assign(new Error('Canal ' + d.channel + ' non supporté pour ' + key + ' (' + d.file + ')'), { code: 'CHANNEL' });
  const base = await texLoad(U(d.file), { kind: d.colorSpace === 'srgb' ? 'srgb' : 'linear' });
  const dk = [d.file, d.colorSpace, JSON.stringify(d.repeat || null), JSON.stringify(d.offset || null), d.factor, key, d.channel || '', d.invert ? 1 : 0].join('|');
  if (descCache.has(dk)) return descCache.get(dk);                              // same descriptor -> one Texture object -> one GPU upload
  const t = base.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping;           // clone shares the GPU Source
  t.repeat.set(d.repeat ? d.repeat[0] : 1, d.repeat ? d.repeat[1] : 1);
  if (d.offset !== undefined && !(Array.isArray(d.offset) && d.offset.length === 2 && d.offset.every(Number.isFinite))) throw new Error('Offset invalide pour ' + key + ' (' + d.file + ')');
  t.offset.fromArray(d.offset || [0, 0]);
  t.userData.factor = d.factor; if (CC_ALIAS[key]) { t.userData.srcChannel = d.channel || NATIVE_CH[key]; t.userData.invert = !!d.invert; } t.needsUpdate = true; descCache.set(dk, t); return t;
}
const COTTON_LUM = 0.4390436083233075;
async function buildMaterial(id, def, o) {
  o = o || {}; def = def || {};
  const cot = def.cotton, m = new THREE.MeshPhysicalMaterial({ name: id });
  m.color.copy(lin3(def.baseColor, 1));
  m.metalness = def.metallic || 0; m.roughness = def.roughness !== undefined ? def.roughness : 1;
  const [map, nrm, rgh, met, cc, ccr, ccn, em] = await Promise.all(['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap', 'emissiveMap'].map(k => matMap(def, k)));
  if (map) m.map = map; if (nrm) { m.normalMap = nrm; const ns = def.normalScale === undefined ? 1 : def.normalScale; m.normalScale.set(Array.isArray(ns) ? ns[0] : ns, Array.isArray(ns) ? (ns[1] !== undefined ? ns[1] : ns[0]) : ns); }
  if (rgh) m.roughnessMap = rgh;
  if (met) { const f = def.maps.metalnessMap.factor; if (f === 0) { m.metalness = 0; } else { m.metalnessMap = met; if (f !== undefined) m.metalness = f; } }
  if (def.clearcoat) { m.clearcoat = def.clearcoat; m.clearcoatRoughness = def.clearcoatRoughness !== undefined ? def.clearcoatRoughness : 0; if (cc) { m.clearcoatMap = cc; if (def.maps.clearcoatMap.factor !== undefined) m.clearcoat = def.maps.clearcoatMap.factor; } if (ccr) m.clearcoatRoughnessMap = ccr; if (ccn) { m.clearcoatNormalMap = ccn; let s = def.clearcoatNormalScale === undefined ? 1 : def.clearcoatNormalScale; const s2 = Array.isArray(s) ? (s[1] !== undefined ? s[1] : s[0]) : s; s = Array.isArray(s) ? s[0] : s; m.clearcoatNormalScale.set(s, s2); } }
  if (def.ior) m.ior = def.ior; if (def.specularIntensity !== undefined) m.specularIntensity = 2 * def.specularIntensity;
  if (def.sheen) { m.sheen = def.sheen; m.sheenRoughness = def.sheenRoughness !== undefined ? def.sheenRoughness : .5; m.sheenColor.setRGB(1, 1, 1, LIN); }
  m.side = (def.doubleSided || o.doubleSided) ? THREE.DoubleSide : THREE.FrontSide;
  if (cot) m.shadowSide = THREE.FrontSide;
  if (def.emissiveIntensity > 0) { m.emissive.copy(lin3(def.emissive, 1)); m.emissiveIntensity = def.emissiveIntensity; if (em) m.emissiveMap = em; }   // emission stays separate from the lightmap
  if (o.atlas) { m.lightMap = o.atlas; m.lightMapIntensity = Math.PI * (def.lightMapGain || 1); }
  const rgbm = o.atlas && /^rgbm$/i.test(o.atlas.userData.encoding || 'RGBM') || false, range = o.atlas && (o.atlas.userData.range || RGBM_RANGE);
  const enc = o.atlas ? String(o.atlas.userData.encoding || 'RGBM').toLowerCase() : '', sqrt = enc === 'rgbm-sqrt';
  const ccSel = (m.clearcoatMap ? [m.clearcoatMap.userData.srcChannel, !!m.clearcoatMap.userData.invert] : null), ccrSel = (m.clearcoatRoughnessMap ? [m.clearcoatRoughnessMap.userData.srcChannel, !!m.clearcoatRoughnessMap.userData.invert] : null);
  const ccKey = (ccSel ? 'cm' + ccSel[0] + (ccSel[1] ? 'i' : '') : '') + (ccrSel ? 'cr' + ccrSel[0] + (ccrSel[1] ? 'i' : '') : '');
  const static_ = !!o.atlas, [lo, hi] = cot ? cot.roughnessRange : [0, 1];
  m.onBeforeCompile = sh => {
    let f = sh.fragmentShader;
    if (static_) {
      let ch = THREE.ShaderChunk.lights_fragment_maps; const tgt = 'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;', ibl = 'iblIrradiance += getIBLIrradiance( geometryNormal );';
      if (!ch.includes(ibl)) throw new Error('r17: three env diffuse chunk changed');
      ch = ch.replace(ibl, '/onze-site/* static env diffuse removed: GI is baked */');
      if (rgbm) { if (!ch.includes(tgt)) throw new Error('r17: three lightmap chunk changed, RGBM patch cannot apply'); ch = ch.replace(tgt, 'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapTexel.a * ' + range.toFixed(4) + ' * lightMapIntensity;'); }
      if (sqrt) { if (!ch.includes(tgt)) throw new Error('r17: three lightmap chunk changed, RGBM-SQRT patch cannot apply'); ch = ch.replace(tgt, 'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapTexel.rgb * ' + range.toFixed(4) + ' * lightMapIntensity;'); }
      f = f.replace('#include <lights_fragment_maps>', ch);
    }
    if (static_) f = f.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n\treflectedLight.directDiffuse = vec3( 0.0 );');   // direct diffuse is baked; spec stays live
    if (cot) {
      f = f.replace('#include <map_fragment>', 'vec4 sampledDiffuseColor = texture2D( map, vMapUv );\n\tfloat cotLum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );\n\tdiffuseColor.rgb *= ( ' + (1 - cot.microColorAmount).toFixed(4) + ' + ' + cot.microColorAmount.toFixed(4) + ' * cotLum / ' + (cot.luminanceMean || COTTON_LUM).toFixed(10) + ' );');
      { const rc = THREE.ShaderChunk.roughnessmap_fragment, rt = 'roughnessFactor *= texelRoughness.g;'; if (!rc.includes(rt)) throw new Error('r17: three roughnessmap chunk changed'); f = f.replace('#include <roughnessmap_fragment>', rc.replace(rt, 'roughnessFactor = ' + lo.toFixed(4) + ' + ' + (hi - lo).toFixed(4) + ' * texelRoughness.g;')); }
    }
    if (ccKey) {
      let pc = THREE.ShaderChunk.lights_physical_fragment; const t1 = 'material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;', t2 = 'material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;';
      if (ccSel) { if (!pc.includes(t1)) throw new Error('r17: three clearcoat chunk changed'); const e = 'texture2D( clearcoatMap, vClearcoatMapUv ).' + CH_SWZ[ccSel[0]]; pc = pc.replace(t1, 'material.clearcoat *= ' + (ccSel[1] ? '( 1.0 - ' + e + ' )' : e) + ';'); }
      if (ccrSel) { if (!pc.includes(t2)) throw new Error('r17: three clearcoat roughness chunk changed'); const e = 'texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).' + CH_SWZ[ccrSel[0]]; pc = pc.replace(t2, 'material.clearcoatRoughness *= ' + (ccrSel[1] ? '( 1.0 - ' + e + ' )' : e) + ';'); }
      f = f.replace('#include <lights_physical_fragment>', pc);
      if (!f.includes('( 1.0 - texture2D( clearcoat') && (ccSel && ccSel[1] || ccrSel && ccrSel[1])) throw new Error('r17: clearcoat invert patch failed');
    }
    if (static_ && (!f.includes('directDiffuse = vec3( 0.0 )') || f.includes('iblIrradiance += getIBLIrradiance'))) throw new Error('r17: direct diffuse patch failed');
    if (cot && (!f.includes('cotLum') || !f.includes('roughnessFactor = ' + lo.toFixed(4) + ' + ' + (hi - lo).toFixed(4) + ' * texelRoughness.g;') || f.includes('roughnessFactor *= texelRoughness.g;'))) throw new Error('r17: cotton patch failed');
    sh.fragmentShader = f; m.userData.shaderPatched = { rgbm: !!rgbm, enc, cc: ccKey, range, static: static_, cotton: !!cot };
  };
  m.customProgramCacheKey = () => 'vst17|' + (rgbm ? 'rgbm' + range : sqrt ? 'rgbmsqrt' + range : 'n') + (static_ ? 's' : 'd') + (cot ? 'c' + lo + hi : '') + (ccKey ? '|' + ccKey : '');
  if (cot && nrm) applyCotton(THREE, m, { mult: 1, strength: 1, on: false });
  m.userData.def = id; return m;
}
async function init() {
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); renderer.debug.checkShaderErrors = true; } catch (e) { fail('La 3D n’est pas disponible sur cet appareil.'); return; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;      // single AgX pass for everything (lightmaps are linear, no tonemap before multiply)
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  stage.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  const gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  try { M = await (await fetch(new URL('./r17d/manifest.json?v=r17d', import.meta.url).href)).json(); } catch (e) { fail('Le vestiaire n’a pas pu se charger. Réessayez dans un instant.'); return; }
  const files = M.files || {};
  let roomG, liveG;
  try { [roomG, liveG] = await Promise.all([gl.loadAsync(U(files.room || 'room.glb')), gl.loadAsync(U(files.live || 'live.glb'))]); }
  catch (e) { console.error(e); fail('Le vestiaire n’a pas pu se charger. Réessayez dans un instant.'); return; }

  /* room: manifest-driven PBR (uv0) + lighting-only lightMap (uv1). Meshes = room.meshes[name].{material,atlas} */
  const at = M.room && M.room.atlases || {}, rm = M.room && M.room.meshes || {}, defs = M.materials || {};
  const allowMissing = qp.get('nolight') !== null;   // QA only
  const atl = {};
  try {
    await Promise.all(Object.keys(at).map(async k => {
      const e = at[k];
      try { const base = await texLoad(U(typeof e === 'string' ? e : e.map), { kind: 'linear', channel: e.channel === undefined ? 1 : e.channel }); base.premultiplyAlpha = false; base.userData.range = e.range || RGBM_RANGE; base.userData.encoding = e.encoding || 'RGBM'; atl[k] = base; }
      catch (er) { if (er.code === 'MAXTEX' || !allowMissing) throw er; missing.push('atlas:' + k); }
    }));
    const cache = new Map(), todo = [];
    roomG.scene.traverse(o => { if (!o.isMesh) return; const info = rm[o.name];
      if (!info || !defs[info.material]) { missing.push('mesh:' + o.name); return; }
      const ck = info.material + '|' + (info.atlas || ''); if (!cache.has(ck)) cache.set(ck, buildMaterial(info.material, defs[info.material], { atlas: info.atlas ? atl[info.atlas] : null })); o.userData.ck = ck; todo.push(o); });
    const built = new Map(await Promise.all([...cache].map(async ([k, p]) => [k, await p])));
    todo.forEach(o => { const old = o.material; o.material = built.get(o.userData.ck); if (old && old.dispose) old.dispose(); o.castShadow = false; o.receiveShadow = false; o.matrixAutoUpdate = false; o.updateMatrix(); });
  } catch (e) { console.error(e); fail(e.code === 'MAXTEX' ? 'Cet appareil ne supporte pas les textures haute définition du vestiaire (' + e.message + ').' : 'Le vestiaire n’a pas pu se charger. Réessayez dans un instant.'); return; }
  scene.add(roomG.scene); roomRoot = roomG.scene;
  scene.updateMatrixWorld(true);

  /* camera (exact original wide) */
  const c = M.camera || {};
  home.pos.fromArray(c.position || [0, 1.977, 9.4]);
  home.quat.fromArray(c.quaternion || [-.0315, 0, 0, .9995]);
  home.fov = c.fovVerticalDegrees || c.fov || 26.5;
  camera = new THREE.PerspectiveCamera(home.fov, 16 / 9, c.near || .02, c.far || 100);
  scene.add(camera);

  /* live groups pair-1..6, pivot at the hook */
  const lm = M.live && M.live.meshes || {};
  try {
    const lc = new Map(), lt = [];
    liveG.scene.traverse(o => { if (!o.isMesh) return; const info = lm[o.name]; if (!info || !defs[info.material]) { missing.push('live:' + o.name); return; } if (!lc.has(info.material)) lc.set(info.material, buildMaterial(info.material, defs[info.material], { doubleSided: true })); o.userData.lm = info.material; lt.push(o); });
    const lb = new Map(await Promise.all([...lc].map(async ([k, p]) => [k, await p])));
    lt.forEach(o => { const old = o.material; o.material = lb.get(o.userData.lm); if (old && old.dispose) old.dispose(); });
  } catch (e) { console.error(e); fail(e.code === 'MAXTEX' ? 'Textures trop grandes pour ce GPU (' + e.message + ').' : 'Le vestiaire n’a pas pu se charger.'); return; }
  scene.add(liveG.scene); liveRoot = liveG.scene;
  scene.updateMatrixWorld(true);
  for (let i = 1; i <= 6; i++) {
    const node = liveG.scene.getObjectByName('pair-' + i) || liveG.scene.getObjectByName('pair_' + i) || liveG.scene.getObjectByName('pair' + i);
    if (!node) continue;
    node.updateMatrixWorld(true);
    const meshes = [];
    node.traverse(o => { if (o.isMesh) { meshes.push(o); o.castShadow = true; o.receiveShadow = true; } });
    const mp = M.pairs && M.pairs.find(p => p.name === node.name) || {};
    const box = new THREE.Box3().setFromObject(node);
    pairs.push({ n: i, node, meshes, pos0: node.position.clone(), quat0: node.quaternion.clone(), yaw0: 0,
      size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()), meta: mp,
      hook: mp.hook ? new THREE.Vector3().fromArray(mp.hook) : node.getWorldPosition(new THREE.Vector3()) });
  }
  if (!pairs.length) { fail('Aucun modèle trouvé dans le vestiaire.'); return; }

  /* lights: fixed in world, never move with the camera. cold key (single shadow) + warm rim */
  const L = M.lights || {};
  keyLight = new THREE.SpotLight(WARM_LIN, (L.key && L.key.intensity || 3.1) * (qp.get('k') ? +qp.get('k') : 8), 0, .95, .7, 2);
  keyLight.position.fromArray(L.key && L.key.position || [-3, 5, 6]); keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024); keyLight.shadow.bias = -.0005; keyLight.shadow.normalBias = .01; keyLight.shadow.radius = 4;
  keyLight.shadow.camera.near = 1; keyLight.shadow.camera.far = 20; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  rimLight = new THREE.DirectionalLight(WARM_LIN, (L.rim && L.rim.intensity || 2) * .1);
  rimLight.position.fromArray(L.rim && L.rim.position || [3.5, 3, -4]);
  const fillL = new THREE.DirectionalLight(WARM_LIN, qp.get('f') ? +qp.get('f') : .3); fillL.position.set(0, 2.5, 6); scene.add(fillL, fillL.target); fillL.target.position.set(0, 1.5, -.24);
  const tg = new THREE.Object3D(); tg.position.set(0, 1.5, -.24); scene.add(tg, keyLight, rimLight); keyLight.target = tg; rimLight.target = tg;
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();      // env captured ONCE from the real baked room
  es.add(roomG.scene.clone(true)); es.background = new THREE.Color(0x0a0c10);
  const rt = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType }), cc = new THREE.CubeCamera(.05, 60, rt);
  cc.position.set(0, 1.8, 1); es.add(cc); cc.update(renderer, es);
  scene.environment = pm.fromCubemap(rt.texture).texture; scene.environmentIntensity = qp.get('env') ? +qp.get('env') : 1; rt.dispose(); pm.dispose();

  /* r17c: NEW warm fixed-world lights, ONLY lit in the pairs pass (room pass renders with them invisible => room pixels identical to r17b) */
  { const KI = qp.get('nk') ? +qp.get('nk') : 3.2, RI = qp.get('nr') ? +qp.get('nr') : 1.6;
    const nk = new THREE.DirectionalLight(WARM_LIN, KI); nk.position.set(-3.2, 2.6, 3.6); nk.target.position.set(0, 1.5, -.24);
    const nr = new THREE.DirectionalLight(WARM_LIN, RI); nr.position.set(3.6, 2.2, -3.2); nr.target.position.set(0, 1.5, -.24);
    const bb = new THREE.Box3(); pairs.forEach(t => bb.union(new THREE.Box3().setFromObject(t.node))); bb.expandByScalar(.6);
    nk.castShadow = true; nk.shadow.mapSize.set(2048, 2048); nk.shadow.bias = -.0004; nk.shadow.normalBias = .012; nk.shadow.radius = 3;
    const sc = nk.shadow.camera, ctr = bb.getCenter(new THREE.Vector3()), hs = bb.getSize(new THREE.Vector3()).length() / 2;
    nk.position.copy(ctr).add(new THREE.Vector3(-3.2, 2.6, 3.6).normalize().multiplyScalar(hs + 3)); nk.target.position.copy(ctr);
    sc.left = -hs; sc.right = hs; sc.top = hs; sc.bottom = -hs; sc.near = .5; sc.far = hs * 2 + 8; sc.updateProjectionMatrix();
    scene.add(nk, nk.target, nr, nr.target); newLights = [nk, nr]; newShadowLight = nk; }
  renderer.autoClear = false;   // two-pass: env capture above ran with autoClear on
  buildPicker(); bindInput();
  new ResizeObserver(resize).observe(stage); resize();
  ready = true; applyCamera(); render();
  root.classList.add('is-ready'); status.hidden = true;
}

function resize() {
  W = stage.clientWidth; H = stage.clientHeight; if (!W || !H) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PIXEL_RATIO_MAX));
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.fov = W <= 768 ? (W <= 480 ? 36 : 28) : camera.aspect >= 16 / 9 ? home.fov : Math.min(95, 2 * Math.atan(Math.tan(home.fov * Math.PI / 360) * (16 / 9) / Math.max(camera.aspect, .3)) * 180 / Math.PI);
  { const q = home.quat, ff = fitFov(home.pos.toArray(), pitchOf([q.x, q.y, q.z, q.w]), camera.fov, camera.aspect); if (ff.changed && W > 768) camera.fov = ff.fov; }
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
  { const q = home.quat, pt = pitchOf([q.x, q.y, q.z, q.w]), h = home.pos.toArray(); if (W <= 768) h[1] += .55; const pl = planRail(h, pt, camera.fov, camera.aspect, DOLLY, glideRange); DOLLY = pl.dolly; glideRange = Math.min(glideRange, pl.range); }
  if (glideRange < .05) glideRange = 0;
}
let camPitch = 0;
function safePos(v) { const q = home.quat; camPitch = pitchOf([q.x, q.y, q.z, q.w]); const o = clampPosition(v.toArray(), home.pos.toArray(), camPitch, camera.fov, camera.aspect); v.fromArray(o); return v; }
function applyCamera() { if (sel >= 0) return; camera.position.copy(railPos(glide, dolly)); if (W <= 768) camera.position.addScaledVector(up, .55); safePos(camera.position); camera.quaternion.copy(home.quat); camera.updateMatrixWorld(); }

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
function focusNow() { const p = focusPose(pairs[sel]); camera.position.copy(safePos(p.pos)); camera.quaternion.copy(home.quat); camera.updateMatrixWorld(); setPair(pairs[sel], 1, 1, spinAngle); }
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
  camera.position.lerpVectors(tween.from, tween.to, ease(k)); safePos(camera.position); camera.quaternion.copy(home.quat);
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
let qaFlags = { key: true, rim: true }, drawCount = 0;
function setNewLights(on) { newLights.forEach((l, i) => { l.visible = !!on && (i === 0 ? qaFlags.key : qaFlags.rim); }); }
/* pass 1: room, original lights only (new lights invisible => not in light state). pass 2: pairs only, same camera, depth kept => exact occlusion; new lights + shadows */
function drawTwoPass(onNew) {
  const on = onNew === undefined ? newOn : onNew; drawCount++;
  renderer.setRenderTarget(null); renderer.clear(true, true, true);
  roomRoot.visible = true; liveRoot.visible = false; setNewLights(false); renderer.shadowMap.needsUpdate = false;
  renderer.render(scene, camera);
  roomRoot.visible = false; liveRoot.visible = true; setNewLights(on); renderer.shadowMap.needsUpdate = shadowDirty; shadowDirty = false;
  renderer.render(scene, camera);
  roomRoot.visible = true;
}
let _lt = 0; function render() { if (renderer) { phaseName = tween ? 'transition' : sel >= 0 ? 'focus' : (dollyTarget ? 'rail' : 'wide'); const _n = performance.now(); if (_lt) { const a = phaseSamples[phaseName] || (phaseSamples[phaseName] = []); if (a.length < 600) a.push(_n - _lt); } _lt = _n; if (sel >= 0 || tween) shadowDirty = true; drawTwoPass(); frameCount++; } }
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

window.__vestiaire = { assertCoverage: () => assertCoverage(camera), get loaded() { return ready; }, get ready() { return ready; }, get state() { return tween ? 'transition' : sel >= 0 ? 'focus' : 'wide'; }, get selected() { return sel >= 0 ? pairs[sel].n : null; }, get sel() { return sel; }, get frameCount() { return frameCount; }, get running() { return !!rafId; }, get rail() { return dollyTarget === 1; }, get glide() { return glide; }, get glideRange() { return glideRange; }, get camera() { return camera.position.toArray(); }, get drawCalls() { return renderer.info.render.calls; }, select, back, enterRail, exitRail, project(i) { const v = pairs[i].center.clone().project(camera); const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; } };
Object.defineProperty(window.__vestiaire, 'stats', { get() { const i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, dpr: renderer.getPixelRatio(), canvas: [renderer.domElement.width, renderer.domElement.height], frames: frameCount }; } });
if (qp.get('fps') !== null) { /* continuous render mode for capture/profiling */ const loop = () => { if (ready) { if (sel >= 0 && !tween && spinning) {} render(); } requestAnimationFrame(loop); }; requestAnimationFrame(loop); }
window.__vestiaire.dbg = () => pairs.map(t => { const b = new THREE.Box3().setFromObject(t.node); return { n: t.n, min: b.min.toArray().map(v => +v.toFixed(2)), max: b.max.toArray().map(v => +v.toFixed(2)), vis: t.node.visible, mats: t.meshes.map(m => m.name + ':' + m.material.name + ':' + (m.material.color && m.material.color.getHexString())) }; });
window.__vst = window.__vestiaire;

function pctl(a, p) { if (!a || !a.length) return null; const b = [...a].sort((x, y) => x - y); return +b[Math.min(b.length - 1, Math.floor(b.length * p))].toFixed(2); }
Object.defineProperties(window.__vestiaire, Object.getOwnPropertyDescriptors({
  get scene() { return scene; }, get cam() { return camera; }, get renderer() { return renderer; }, get manifest() { return M; },
  get loadBytes() { return loadBytes; }, get textures() { return qaTex; }, get missing() { return missing; },
  get materials() { const o = []; scene.traverse(m => { if (m.isMesh && m.material) { const x = m.material; o.push({ mesh: m.name, mat: x.name, type: x.type, map: !!x.map, normal: !!x.normalMap, rough: !!x.roughnessMap, lightMap: !!x.lightMap, aniso: x.map && x.map.anisotropy }); } }); return o; },
  phaseFPS() { const out = {}; Object.keys(phaseSamples).forEach(k => { const a = phaseSamples[k]; out[k] = { n: a.length, medianMs: pctl(a, .5), p95Ms: pctl(a, .95), medianFps: a.length ? +(1000 / pctl(a, .5)).toFixed(1) : null }; }); return out; },
  setPhase(n) { phaseName = n; },
  version: 'r17d', hdrScale: HDR_SCALE
}));

/* runtime GL readback of a lightmap (raw texel, alpha, decoded RGBM) on a 64x64 sample grid: proves no premultiply corruption */
window.__vestiaire.lightmapStats = function (key) {
  const e = M.room.atlases[key], base = texCache.get([...texCache.keys()].find(k => k.startsWith(U(typeof e === 'string' ? e : e.map)))); if (!base) return Promise.resolve(null);
  return base.then(tex => {
    const N = 64, rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, depthBuffer: false, colorSpace: THREE.NoColorSpace });
    const mat = new THREE.ShaderMaterial({ uniforms: { t: { value: tex } }, vertexShader: 'varying vec2 u; void main(){ u = uv; gl_Position = vec4(position.xy*2.0-1.0 + vec2(0.0), 0.0, 1.0); }', fragmentShader: 'uniform sampler2D t; varying vec2 u; void main(){ gl_FragColor = texture2D(t, u); }', depthTest: false, toneMapped: false });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(.5, .5, 0), mat), sc = new THREE.Scene(); sc.add(q);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), prev = renderer.getRenderTarget(), ptm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(rt); renderer.render(sc, cam); renderer.setRenderTarget(prev); renderer.toneMapping = ptm;
    const px = new Float32Array(N * N * 4); renderer.readRenderTargetPixels(rt, 0, 0, N, N, px); rt.dispose(); mat.dispose();
    let amin = 9, amax = 0, lmax = 0, lsum = 0, lowA = 0; const range = tex.userData.range || 1, enc = String(tex.userData.encoding || 'RGBM').toLowerCase(), sq = enc === 'rgbm-sqrt';
    for (let i = 0; i < N * N; i++) { const a = px[i * 4 + 3], mx = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]), l = sq ? mx * mx * range : mx * a * range; amin = Math.min(amin, a); amax = Math.max(amax, a); lmax = Math.max(lmax, l); lsum += l; if (a < 1 / 16) lowA++; }
    return { key, size: [tex.image.width, tex.image.height], alpha: [amin, amax], lowAlphaFraction: lowA / (N * N), decodedMax: lmax, decodedMean: lsum / (N * N), range, encoding: enc, bitmap: tex.image instanceof ImageBitmap };
  });
};

/* r17 KTX2 audit: per-texture source dims, GPU format, mips, memory estimate, unique uploads */
window.__vestiaire.textureAudit = function () {
  const rows = qaTex.map(t => ({ url: t.url, src: t.w + 'x' + t.h, kind: t.kind, ktx2: !!t.ktx2, glFormat: t.glFormat, mips: t.mips, npot: t.npot, aniso: t.aniso, gpuMB: t.gpuMB !== undefined ? t.gpuMB : +(t.w * t.h * 4 * 4 / 3 / 1048576).toFixed(2) }));
  return { count: rows.length, totalGpuMB: +rows.reduce((a, r) => a + r.gpuMB, 0).toFixed(1), descriptorTextures: descCache.size, networkBytes: loadBytes.total, rows };
};
/* roughness variance readback: mean/variance of green channel on a 64x64 grid (proves roughness detail survives compression) */
window.__vestiaire.channelVariance = function (url, ch) {
  const k = [...texCache.keys()].find(x => x.startsWith(url)); if (!k) return Promise.resolve(null);
  return texCache.get(k).then(tex => {
    const N = 64, rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, depthBuffer: false, colorSpace: THREE.NoColorSpace });
    const mat = new THREE.ShaderMaterial({ uniforms: { t: { value: tex } }, vertexShader: 'varying vec2 u; void main(){ u = uv; gl_Position = vec4(position.xy*2.0-1.0, 0.0, 1.0); }', fragmentShader: 'uniform sampler2D t; varying vec2 u; void main(){ gl_FragColor = texture2D(t, u); }', depthTest: false, toneMapped: false });
    const sc = new THREE.Scene(); sc.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(.5, .5, 0), mat));
    const prev = renderer.getRenderTarget(), ptm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(rt); renderer.render(sc, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); renderer.setRenderTarget(prev); renderer.toneMapping = ptm;
    const px = new Float32Array(N * N * 4); renderer.readRenderTargetPixels(rt, 0, 0, N, N, px); rt.dispose(); mat.dispose();
    const c = ch === undefined ? 1 : ch; let s = 0, s2 = 0; for (let i = 0; i < N * N; i++) { const v = px[i * 4 + c]; s += v; s2 += v * v; }
    const m = s / (N * N); return { url, channel: c, mean: m, variance: s2 / (N * N) - m * m };
  });
};

/* r17c QA hooks. Everything renders synchronously and reads pixels in the same task (no stopped-render artefacts). */
function qaRead() { const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, b = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); return { w, h, b }; }
function qaMask() { const bo = new THREE.MeshBasicMaterial({ color: 0, toneMapped: false }), wh = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  renderer.clear(true, true, true); roomRoot.visible = true; liveRoot.visible = false; scene.overrideMaterial = bo; renderer.render(scene, camera);
  roomRoot.visible = false; liveRoot.visible = true; scene.overrideMaterial = wh; renderer.render(scene, camera); scene.overrideMaterial = null; roomRoot.visible = true; bo.dispose(); wh.dispose();
  const r = qaRead(); return r; }
function idOf(m) { const t = pairs.find(p => p.meshes.includes(m)); return (t.n * 2 + (/hanger/i.test(m.name) ? 1 : 0)) * 15 + 30; }
function qaIdMask() { const mats = []; const bo = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(10 / 255, 0, 0, THREE.LinearSRGBColorSpace), toneMapped: false });
  renderer.clear(true, true, true); roomRoot.visible = true; liveRoot.visible = false; scene.overrideMaterial = bo; renderer.render(scene, camera); scene.overrideMaterial = null;
  roomRoot.visible = false; liveRoot.visible = true; const saved = [];
  pairs.forEach(t => t.meshes.forEach(m => { saved.push([m, m.material]); const v = idOf(m) / 255; m.material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(v, 0, 0, THREE.LinearSRGBColorSpace), toneMapped: false, side: THREE.DoubleSide }); }));
  renderer.render(scene, camera); saved.forEach(([m, o]) => { m.material.dispose(); m.material = o; }); roomRoot.visible = true; bo.dispose(); return qaRead(); }
function qaSetYaw(deg) { pairs.forEach(t => { t.node.quaternion.copy(t.quat0).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg * Math.PI / 180)); t.node.updateMatrixWorld(true); }); shadowDirty = true; }
function qaFrame(on) { drawTwoPass(on); return qaRead(); }
/* qa.compare(yawDeg): same pose, light off vs on. returns pixel counts changed in tee/hanger mask and in room mask */
function qaCompare(yaw, thr) { thr = thr || 3; const saved = pairs.map(t => t.node.quaternion.clone()); qaSetYaw(yaw); const m = qaCoverage(false); const A = qaFrame(false); const B = qaFrame(true);
  let pairPx = 0, pairChanged = 0, roomPx = 0, roomChanged = 0, maxRoom = 0, maxPair = 0, sumPair = 0;
  for (let i = 0; i < A.b.length; i += 4) { const inPair = m.b[i] > 0; let d = Math.max(Math.abs(A.b[i] - B.b[i]), Math.abs(A.b[i + 1] - B.b[i + 1]), Math.abs(A.b[i + 2] - B.b[i + 2]));
    if (inPair) { pairPx++; sumPair += d; if (d > maxPair) maxPair = d; if (d >= thr) pairChanged++; } else { roomPx++; if (d > maxRoom) maxRoom = d; if (d) roomChanged++; } }
  pairs.forEach((t, k) => { t.node.quaternion.copy(saved[k]); t.node.updateMatrixWorld(true); }); shadowDirty = true; render();
  return { yaw, pairPx, pairChanged, meanPairDelta: +(sumPair / Math.max(1, pairPx)).toFixed(3), maxPair, roomPx, roomChanged, maxRoom }; }
Object.assign(window.__vestiaire, { qa: { get drawCount() { return drawCount; }, setLight(name, v) { qaFlags[name] = !!v; shadowDirty = true; render(); }, get flags() { return { ...qaFlags, shadow: !!(newShadowLight && newShadowLight.castShadow), newOn }; }, setShadow(v) { newShadowLight.castShadow = !!v; shadowDirty = true; render(); }, shadowDiag() { const sh = newShadowLight.shadow; return { cast: newShadowLight.castShadow, mapAllocated: !!sh.map, mapSize: sh.map ? [sh.map.width, sh.map.height] : null, autoUpdate: renderer.shadowMap.autoUpdate, receivers: pairs.map(t => t.meshes.every(m => m.receiveShadow)), casters: pairs.map(t => t.meshes.every(m => m.castShadow)), drawCount, frames: frameCount }; }, idLabels() { const o = { room: 10 }; pairs.forEach(t => t.meshes.forEach(m => { o[m.name] = idOf(m); })); return o; }, idMask: qaIdMask, meshNames() { return pairs.map(t => ({ pair: t.n, meshes: t.meshes.map(m => m.name) })); }, lightNames: () => ({ key: 'new key DirectionalLight', rim: 'new rim DirectionalLight', baseline: ['keyLight spot', 'rimLight dir', 'fill dir'] }), freezeShadow(v) { shadowDirty = !!v; }, setNewLights(v) { newOn = !!v; shadowDirty = true; render(); }, get newLights() { return newOn; }, setYaw(d) { qaSetYaw(d); render(); }, frame: qaFrame, mask: qaMask, compare: qaCompare, read: qaRead, get lights() { return newLights.map(l => ({ type: l.type, i: l.intensity, color: l.color.toArray(), shadow: l.castShadow, pos: l.position.toArray() })); }, get shadowMapSize() { return newShadowLight && newShadowLight.shadow.mapSize.toArray(); } }, qaVersion: 'r17c-twopass-v2' });

/* r17c QA v3: side-exact coverage masks + hanger parts. QA only, no visual change. */
function maskMatFor(orig, v) { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(v, 0, 0, THREE.LinearSRGBColorSpace), toneMapped: false, fog: false });
  const o = Array.isArray(orig) ? orig[0] : orig; if (o) { m.side = o.side; m.depthTest = o.depthTest; m.depthWrite = o.depthWrite; m.polygonOffset = o.polygonOffset; m.polygonOffsetFactor = o.polygonOffsetFactor; m.polygonOffsetUnits = o.polygonOffsetUnits; m.alphaTest = o.alphaTest || 0; if (o.alphaTest > 0 && o.map) m.map = o.map; m.transparent = false; m.blending = THREE.NoBlending; } return m; }
function withMaskMats(root, idFn, fn) { const saved = []; root.traverse(m => { if (m.isMesh) { saved.push([m, m.material, m.visible]); m.material = maskMatFor(m.material, idFn(m)); } }); try { fn(); } finally { saved.forEach(([m, o]) => { m.material.dispose(); m.material = o; m.visible = o === undefined ? true : m.visible; }); } }
function qaCoverage(ids) { /* ids=true: pairs get per-mesh id in R; false: pairs 255. room always 10 (ids) or 0. Raw MSAA framebuffer, exact per-mesh side/depth state. */
  renderer.clear(true, true, true);
  roomRoot.visible = true; liveRoot.visible = false; withMaskMats(roomRoot, () => (ids ? 10 : 0) / 255, () => renderer.render(scene, camera));
  roomRoot.visible = false; liveRoot.visible = true; withMaskMats(liveRoot, m => (ids ? idOf(m) : 255) / 255, () => renderer.render(scene, camera));
  roomRoot.visible = true; return qaRead(); }
function partInfo(n) { const t = pairs.find(p => p.n === n), m = t.meshes.find(x => /hanger/i.test(x.name)), g = m.geometry, pos = g.attributes.position, idx = g.index;
  const nt = idx ? idx.count / 3 : pos.count / 3, c = []; const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < nt; i++) { const i0 = idx ? idx.getX(i * 3) : i * 3, i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1, i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2; a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); d.fromBufferAttribute(pos, i2); c.push(a.add(b).add(d).multiplyScalar(1 / 3).toArray()); }
  const out = { name: m.name, tris: nt, bbox: [0, 1, 2].map(k => [Math.min(...c.map(x => x[k])), Math.max(...c.map(x => x[k]))].map(v => +v.toFixed(4))), axes: [] };
  for (let k = 0; k < 3; k++) { const s = c.map(x => x[k]).sort((p, q) => p - q); const gaps = []; for (let i = 1; i < s.length; i++) gaps.push([+(s[i] - s[i - 1]).toFixed(5), +((s[i] + s[i - 1]) / 2).toFixed(5), i]); gaps.sort((p, q) => q[0] - p[0]); out.axes.push({ axis: 'xyz'[k], top3Gaps: gaps.slice(0, 3), range: +(s[s.length - 1] - s[0]).toFixed(4) }); }
  return out; }
function qaIdParts(n, axis, thr, hookAbove) { /* hook = triangles whose local centroid on axis is >thr (or <thr if hookAbove false). ids: room 10, tees as idOf, hook 200, body 220, other hangers idOf. Clone only, original untouched. */
  const t = pairs.find(p => p.n === n), m = t.meshes.find(x => /hanger/i.test(x.name)), g = m.geometry, pos = g.attributes.position, idx = g.index, k = 'xyz'.indexOf(axis);
  const nt = idx ? idx.count / 3 : pos.count / 3, hk = [], bd = [], tmp = new THREE.Vector3(), tr = [0, 0, 0];
  for (let i = 0; i < nt; i++) { let s = 0; for (let j = 0; j < 3; j++) { const vi = idx ? idx.getX(i * 3 + j) : i * 3 + j; tr[j] = vi; tmp.fromBufferAttribute(pos, vi); s += tmp.getComponent(k); } s /= 3; ((hookAbove === false ? s < thr : s > thr) ? hk : bd).push(...tr); }
  const g2 = g.clone(); g2.setIndex(hk.concat(bd)); g2.clearGroups(); g2.addGroup(0, hk.length, 0); g2.addGroup(hk.length, bd.length, 1);
  const mats = [maskMatFor(m.material, 200 / 255), maskMatFor(m.material, 220 / 255)], clone = new THREE.Mesh(g2, mats);
  m.updateWorldMatrix(true, false); clone.matrixAutoUpdate = false; clone.matrix.copy(m.matrixWorld); clone.matrixWorld.copy(m.matrixWorld); clone.frustumCulled = false;
  const wasVis = m.visible; m.visible = false; scene.add(clone);
  try { var r = qaCoverage(true);  /* hanger original hidden: re-render with clone only */ } finally { scene.remove(clone); m.visible = wasVis; mats.forEach(x => x.dispose()); g2.dispose(); }
  return { hookTris: hk.length / 3, bodyTris: bd.length / 3, img: r }; }
Object.assign(window.__vestiaire.qa, { mask() { return qaCoverage(false); }, idMask() { return qaCoverage(true); }, partInfo, idParts: qaIdParts, qaV: 3 });
window.__vestiaire.qaVersion = 'r17c-twopass-v3';
