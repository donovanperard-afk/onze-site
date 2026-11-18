/* r17c camera safety: keeps every frustum ray inside the validated room (no black void).
   Pure math, no THREE dependency. Room geometry is never touched; only camera poses are clamped. */
export const ROOM = {
  back:  { z: -0.99, x0: -3.97, x1: 3.97, y0: 0, y1: 3.2 },          /* back wall front face */
  sideL: { x: -3.97, z0: -1.15, z1: 0.9, y0: 0, y1: 3.2 },
  sideR: { x:  3.97, z0: -1.15, z1: 0.9, y0: 0, y1: 3.2 },
  floor: { y: 0, x0: -6, x1: 6, z0: -4, z1: 6 }
};
const EPS = 1e-9;
export function pitchOf(q) { /* pure x-axis rotation quaternion [x,y,z,w] */ return 2 * Math.atan2(q[0], q[3]); }

function rayCovered(o, d, R, m) {
  /* m = inward margin (m) on wall rects */
  let t = Infinity;
  if (Math.abs(d[2]) > EPS) { const s = (R.back.z - o[2]) / d[2]; if (s > 0) { const x = o[0] + d[0] * s, y = o[1] + d[1] * s; if (x >= R.back.x0 + m && x <= R.back.x1 - m && y >= R.back.y0 && y <= R.back.y1 - m) return true; } }
  /* open top: rays leaving upward above the wall are treated as dark ceiling (matches validated blender framing, which never shows the sky) */
  if (R.openTop !== false && d[1] > 0) { const s = (R.back.z - o[2]) / d[2]; if (s > 0) { const x = o[0] + d[0] * s, y = o[1] + d[1] * s; if (y > R.back.y1 - m && x >= R.back.x0 + m && x <= R.back.x1 - m) return true; } }
  if (Math.abs(d[1]) > EPS) { const s = (R.floor.y - o[1]) / d[1]; if (s > 0) { const x = o[0] + d[0] * s, z = o[2] + d[2] * s; if (x >= R.floor.x0 && x <= R.floor.x1 && z >= R.floor.z0 && z <= R.floor.z1) return true; } }
  for (const S of [R.sideL, R.sideR]) if (Math.abs(d[0]) > EPS) { const s = (S.x - o[0]) / d[0]; if (s > 0) { const y = o[1] + d[1] * s, z = o[2] + d[2] * s; if (y >= S.y0 && y <= S.y1 && z >= S.z0 && z <= S.z1) return true; } }
  return false;
}
/* sample rays across the whole frustum (border densely, interior coarsely) */
export function coverage(pos, pitch, fovDeg, aspect, opts) {
  const R = (opts && opts.room) || ROOM, m = (opts && opts.margin) || 0.03, N = (opts && opts.n) || 24;
  const th = Math.tan(fovDeg * Math.PI / 360), c = Math.cos(pitch), s = Math.sin(pitch);
  let bad = 0, tot = 0;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const border = i === 0 || j === 0 || i === N || j === N; if (!border && (i % 4 || j % 4)) continue;
    const nx = (i / N * 2 - 1) * th * aspect, ny = (j / N * 2 - 1) * th;
    /* camera space (nx,ny,-1) rotated by pitch about x */
    const dy = ny * c + s, dz = ny * s + (-1) * c;
    tot++; if (!rayCovered(pos, [nx, dy, dz], R, m)) bad++;
  }
  return { ok: bad === 0, uncovered: bad, samples: tot, fraction: 1 - bad / tot };
}
/* Clamp a desired camera position. Returns a safe position (same y/z when possible; x clamped first,
   then falls back to bisecting toward the validated home pose). */
export function clampPosition(want, home, pitch, fovDeg, aspect, opts) {
  if (coverage(want, pitch, fovDeg, aspect, opts).ok) return want.slice();
  /* 1) clamp x only: bisect between safe x range around home.x */
  const tryX = (x) => coverage([x, want[1], want[2]], pitch, fovDeg, aspect, opts).ok;
  const cx0 = Math.min(Math.max(want[0], -20), 20);
  const base = tryX(0) ? 0 : home[0];
  if (tryX(base)) { let lo = base, hi = cx0; for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (tryX(mid)) lo = mid; else hi = mid; } if (Math.abs(lo - cx0) < 1e-4 || !tryX(cx0)) return [lo, want[1], want[2]]; }
  /* 2) bisect the whole pose toward home (y/z too) */
  const at = (k) => [home[0] + (want[0] - home[0]) * k, home[1] + (want[1] - home[1]) * k, home[2] + (want[2] - home[2]) * k];
  let lo = 0, hi = 1; for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (coverage(at(mid), pitch, fovDeg, aspect, opts).ok) lo = mid; else hi = mid; }
  return at(lo);
}
/* max |x| shift allowed at the given pose y/z (symmetric); use as glideRange cap */
export function maxX(posYZ, pitch, fovDeg, aspect, opts) {
  const f = (x) => coverage([x, posYZ[0], posYZ[1]], pitch, fovDeg, aspect, opts).ok;
  if (!f(0)) return 0; let lo = 0, hi = 8; for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (f(mid)) lo = mid; else hi = mid; } return lo;
}
/* QA assertion: throws-free report; parent wires to window.__vestiaire.assertCoverage */
export function assertCoverage(camera, opts) {
  const p = camera.position, q = camera.quaternion;
  const r = coverage([p.x, p.y, p.z], pitchOf([q.x, q.y, q.z, q.w]), camera.fov, camera.aspect, opts);
  return Object.assign({ pos: [p.x, p.y, p.z], fov: camera.fov, aspect: camera.aspect }, r);
}

/* Home pose fit: if the validated wide pose already exposes void (16:9 desktop sees ~4.35m half-width vs 3.97 wall),
   narrow vertical fov just enough. Returns {fov, changed}. Pose and pitch are untouched. */
export function fitFov(pos, pitch, fovDeg, aspect, opts) {
  if (coverage(pos, pitch, fovDeg, aspect, opts).ok) return { fov: fovDeg, changed: false };
  let lo = 6, hi = fovDeg; for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (coverage(pos, pitch, mid, aspect, opts).ok) lo = mid; else hi = mid; }
  return { fov: lo, changed: true };
}
/* Rail plan: pick dolly (metres forward, <= wantDolly) and glide range so the camera can slide with no void.
   need = half-extent the glide must reach to show all tees (0 = none). Returns {dolly, range, reach}. */
export function planRail(home, pitch, fovDeg, aspect, wantDolly, need, opts) {
  let best = null;
  for (let d = wantDolly; d >= 0; d -= 0.1) {
    const r = maxX([home[1], home[2] - d], pitch, fovDeg, aspect, opts);
    if (!best || r > best.range) best = { dolly: d, range: r };
    if (r >= need) return { dolly: d, range: Math.min(r, need), reach: true };
  }
  return { dolly: best.dolly, range: best.range, reach: false };
}
