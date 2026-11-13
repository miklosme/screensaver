import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  DataTexture,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  NearestFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import { HOOP, PROFILE, SCALE_PITCH, SCALE_W, floorY, footRadius, troughY, wallRelief, type Chamber, type Station } from "./build";
import { SHROOM_SLOTS, type Shared, type ShroomLight } from "./materials";

/**
 * What grows in the burrow: eyes set in the walls, asleep until the traveller's lantern comes
 * near and then following it past, and glowing mushrooms along the foot of every wall, with a
 * fairy ring of them around the hoop.
 *
 * Nothing here is on the line of flight: eyes are embedded in the walls, and mushrooms stand
 * well below eye level and to the side of the thread.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FOG_GLSL = /* glsl */ `
  uniform vec3 uFog;
  uniform float uFogD;
  float fogAmount(float d) { float x = d * uFogD; return 1.0 - exp(-x * x); }
`;

const inChamber = (chambers: Chamber[], p: Vector3, grow = 0) =>
  chambers.some((ch) => {
    const ey = (p.y - ch.c.y - ch.yc) / (ch.H + grow);
    return ((p.x - ch.c.x) ** 2 + (p.z - ch.c.z) ** 2) / (ch.R + grow) ** 2 + ey * ey < 1;
  });

export interface CreatureInput {
  chambers: Chamber[];
  corridorPts: Station[][];
  /** stands of tall mushrooms: the foot of the wall they grow at, and the way they lean */
  groves: { p: Vector3; lean: Vector3; tall: boolean }[];
  /** the thread's course across the floors */
  route: Vector3[];
  hoopPos: Vector3;
  /** unit vector in plan from the hoop towards the arriving camera */
  arrive: Vector3;
  /** the walls, which the eyes are set into: their shape and light round each eye are read at mount */
  corridors: BufferGeometry[];
  shells: BufferGeometry[];
}

export function buildCreatures(world: CreatureInput, shared: Shared) {
  const { chambers, corridorPts } = world;
  const rnd = mulberry32(31337);

  // -------------------------------------------------------------------------------------------
  // eyes
  // -------------------------------------------------------------------------------------------
  const eyePos: number[] = []; // centre + radius
  const eyeAxis: number[] = []; // the wall's inward normal + seed
  const addEye = (p: Vector3, inward: Vector3, r: number, seed: number) => {
    // sunk a third of the way into the wall
    eyePos.push(p.x - inward.x * r * 0.3, p.y - inward.y * r * 0.3, p.z - inward.z * r * 0.3, r);
    eyeAxis.push(inward.x, inward.y, inward.z, seed);
  };
  const p = new Vector3();
  const n = new Vector3();
  const mid = new Vector3();
  /** an eye in a corridor's wall at one of its stations: `phi` runs from 1.3, just below the widest point, to 2.45, high on the vault */
  const wallEye = (st: Station, sgn: number, phi: number, r: number, seed = rnd()) => {
    const { c, side, up: bed, k } = st;
    const sn = Math.sin(phi);
    const cs = -Math.cos(phi);
    const up = cs >= 0;
    const e = 2 / (up ? PROFILE.nUp : PROFILE.nLo);
    const x = PROFILE.a * Math.abs(sn) ** e * 1.05 * k;
    const y = (PROFILE.hc + (up ? PROFILE.bUp * 1.05 : PROFILE.bLo) * Math.sign(cs) * Math.abs(cs) ** e) * k;
    p.copy(c).addScaledVector(side, x * sgn).addScaledVector(bed, y);
    if (inChamber(chambers, p, 0.6)) return;
    // towards the tunnel's axis, flattened a little
    mid.copy(c).addScaledVector(bed, y + (PROFILE.hc * k - y) * 0.5);
    n.copy(mid).sub(p).normalize();
    addEye(p, n, r, seed);
  };
  // The watchers of the arrival, set where the camera on the rail faces them: two or three are open
  // and in frame all the way down the first gallery. [station, side (1 = right), phi, radius, seed]
  const watchers: [number, number, number, number, number][] = [
    [50, 1, 1.75, 0.36, 0.62],
    [70, -1, 1.95, 0.3, 0.22],
    [80, 1, 2.05, 0.42, 0.86],
    [100, -1, 1.75, 0.34, 0.55],
    [110, 1, 1.8, 0.4, 0.12],
    [130, -1, 2.0, 0.44, 0.78],
    [140, 1, 1.75, 0.36, 0.33],
    [150, -1, 1.7, 0.32, 0.66],
  ];
  for (const [i, sgn, phi, r, seed] of watchers) {
    const st = corridorPts[0]![i];
    if (st) wallEye(st, sgn, phi, r, seed);
  }
  for (const pts of corridorPts) {
    // row 0, 10, 20 .. lie in the hollows between two ribs
    for (let i = 10; i < pts.length - 10; i += 10) {
      if (rnd() > 0.5) continue;
      if (pts === corridorPts[0] && watchers.some((w) => w[0] === i)) continue;
      wallEye(pts[i]!, rnd() < 0.5 ? -1 : 1, 1.3 + rnd() * 1.15, 0.13 + 0.2 * rnd() ** 2);
    }
  }
  /** an eye in a chamber's wall, `bearing` degrees round it (0 = towards -Z, positive to the left) and y above its floor */
  const domeEye = (ch: Chamber, th: number, y: number, r: number, seed = rnd()) => {
    // on the wall as it is built there, ridge or hollow
    const rho = ch.R * Math.sqrt(1 - ((y - ch.yc) / ch.H) ** 2) * wallRelief(ch, th, y);
    const dx = Math.sin(th);
    const dz = Math.cos(th);
    p.set(ch.c.x + dx * rho, ch.c.y + y, ch.c.z + dz * rho);
    n.set((-dx * rho) / (ch.R * ch.R), -(y - ch.yc) / (ch.H * ch.H), (-dz * rho) / (ch.R * ch.R)).normalize();
    addEye(p, n, r, seed);
  };
  // junction 1: the walls the camera faces as it swings round the knot, to either side of the way out
  for (const [bearing, y, r, seed] of [
    // two big light sleepers flank the far mouth: they are open, behind the knot, before the camera is in the room
    [-24, 2.9, 0.58, 0.07],
    [24, 3.6, 0.6, 0.12],
    [-36, 4.4, 0.36, 0.25],
    [-43, 2.1, 0.3, 0.8],
    [-91, 2.6, 0.42, 0.3],
    [-85, 4.9, 0.3, 0.62],
    [-102, 3.6, 0.36, 0.86],
  ] as const)
    domeEye(chambers[0]!, ((bearing + 180) * Math.PI) / 180, y, r, seed);
  for (const ch of chambers) {
    const count = Math.round(ch.R * 4.2);
    for (let k = 0, tries = 0; k < count && tries < 400; tries++) {
      // between two ridges, anywhere from knee height to most of the way up the dome
      const th = ((Math.floor(rnd() * ch.ridges) + 0.03) / ch.ridges) * Math.PI * 2;
      const y = 1.1 + rnd() ** 1.3 * (ch.yc + ch.H * 0.78 - 1.1);
      // not in a doorway
      if (ch.doors.some((d) => y < 5.2 * d.k && d.dir.x * Math.sin(th) + d.dir.z * Math.cos(th) > Math.cos((2.1 * d.k + 0.6) / ch.R))) continue;
      domeEye(ch, th, y, (0.16 + 0.3 * rnd() ** 2.5) * (ch.R > 8 ? 1.5 : 1));
      k++;
    }
  }

  // --- each eye's place in the wall -------------------------------------------------------------
  // An eye is not a ball stuck on the wall: it is a fold of the wall's own skin, its lids, with an
  // eyeball under them. So every eye learns, at mount, the wall it sits in: the shape of the wall
  // round it (a quadric fitted to the wall's vertices, so the collar of lid can settle on to it
  // and sink under it) and the wall's colour and light there (the same albedo and baked light the
  // wall's shader works from, averaged over the collar), and the lids are shaded with those.
  const nEye = eyePos.length / 4;
  const eyeUp = new Float32Array(nEye * 4); // the way the lids close (up, in the wall's plane) + when a dome eye wakes
  const eyeQuad = new Float32Array(nEye * 8); // the wall round the eye: z = q0 + q1 x + q2 y + q3 x² + q4 xy + q5 y², in eye radii
  const eyeSkin = new Float32Array(nEye * 8); // the wall's albedo, how open to light; its baked glow, its mint pool
  {
    type Src = { pos: ArrayLike<number>; nrm: ArrayLike<number>; pat: ArrayLike<number>; hgt: ArrayLike<number>; glow: ArrayLike<number>; ground: ArrayLike<number>; hTop: number; corridor: boolean };
    const srcs: Src[] = [];
    const take = (g: BufferGeometry, hTop: number, corridor: boolean) => {
      const a = (n: string) => (g.getAttribute(n) as BufferAttribute | undefined)?.array;
      const pos = a("position"), nrm = a("normal"), pat = a("pat"), hgt = a("hgt"), glow = a("glow"), ground = a("ground");
      if (pos && nrm && pat && hgt && glow && ground) srcs.push({ pos, nrm, pat, hgt, glow, ground, hTop, corridor });
    };
    for (const g of world.corridors) take(g, 4.6, true);
    world.shells.forEach((g, i) => take(g, chambers[i]!.yc + chambers[i]!.H, false));
    // the wall's vertices binned in a grid of one-unit cells
    const CELL = 1;
    const grid = new Map<string, number[]>();
    const v = new Vector3();
    srcs.forEach((s, si) => {
      for (let i = 0; i < s.pos.length / 3; i++) {
        v.set(s.pos[i * 3]!, s.pos[i * 3 + 1]!, s.pos[i * 3 + 2]!);
        // a corridor's wall is cut away inside a chamber
        if (s.corridor && inChamber(chambers, v, 0.1)) continue;
        const key = `${Math.floor(v.x / CELL)},${Math.floor(v.y / CELL)},${Math.floor(v.z / CELL)}`;
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(si, i);
      }
    });
    const ss = (a: number, b: number, x: number) => {
      const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
      return t * t * (3 - 2 * t);
    };
    const PLUM = [0.09, 0.02, 0.11], CORAL = [0.8, 0.15, 0.13], MAGENTA = [0.42, 0.03, 0.27], SHELL = [1.0, 0.3, 0.22], GROOVE = [0.32, 0.25, 0.52];
    const c = new Vector3(), ax = new Vector3(), up = new Vector3(), sd = new Vector3(), w0 = new Vector3();
    const last = chambers[chambers.length - 1]!;
    for (let e = 0; e < nEye; e++) {
      const r = eyePos[e * 4 + 3]!;
      c.set(eyePos[e * 4]!, eyePos[e * 4 + 1]!, eyePos[e * 4 + 2]!);
      ax.set(eyeAxis[e * 4]!, eyeAxis[e * 4 + 1]!, eyeAxis[e * 4 + 2]!);
      up.set(0, 1, 0).addScaledVector(ax, -ax.y);
      if (up.lengthSq() < 1e-4) up.set(1, 0, 0).addScaledVector(ax, -ax.x);
      up.normalize();
      sd.crossVectors(up, ax);
      w0.copy(c).addScaledVector(ax, r * 0.3); // where the eye meets the wall
      // a dome eye in the last chamber wakes as the camera comes in to the hoop: those on the far
      // wall, behind the hoop, first, and then on round towards the way in
      let wake = 0;
      if (inChamber([last], c, 0.5)) {
        const hx = c.x - world.hoopPos.x, hz = c.z - world.hoopPos.z;
        const ang = Math.acos(Math.max(-1, Math.min(1, (hx * world.arrive.x + hz * world.arrive.z) / Math.hypot(hx, hz))));
        wake = 20.2 + 2.2 * (1 - ang / Math.PI) + 0.4 * eyeAxis[e * 4 + 3]!;
      }
      eyeUp.set([up.x, up.y, up.z, wake], e * 4);

      // the wall round it
      const RF = Math.max(2.1 * r, 0.45); // the fit's reach
      const RC = 1.7 * r; // the colour's
      const M = new Float64Array(36), B = new Float64Array(6);
      const col = new Float64Array(8);
      let wc = 0, nFit = 0;
      for (let gx = Math.floor((w0.x - RF) / CELL); gx <= Math.floor((w0.x + RF) / CELL); gx++)
        for (let gy = Math.floor((w0.y - RF) / CELL); gy <= Math.floor((w0.y + RF) / CELL); gy++)
          for (let gz = Math.floor((w0.z - RF) / CELL); gz <= Math.floor((w0.z + RF) / CELL); gz++) {
            const list = grid.get(`${gx},${gy},${gz}`);
            if (!list) continue;
            for (let k = 0; k < list.length; k += 2) {
              const s = srcs[list[k]!]!;
              const i = list[k + 1]!;
              v.set(s.pos[i * 3]! - w0.x, s.pos[i * 3 + 1]! - w0.y, s.pos[i * 3 + 2]! - w0.z);
              const d2 = v.lengthSq();
              if (d2 > RF * RF) continue;
              const nd = Math.abs(s.nrm[i * 3]! * ax.x + s.nrm[i * 3 + 1]! * ax.y + s.nrm[i * 3 + 2]! * ax.z);
              if (nd < 0.35) continue;
              const x = v.dot(sd) / r, y = v.dot(up) / r, z = v.dot(ax) / r;
              if (Math.abs(z) > 1.5) continue;
              const w = Math.exp((-1.5 * d2) / (RF * RF)) * nd;
              const f = [1, x, y, x * x, x * y, y * y];
              for (let a = 0; a < 6; a++) {
                B[a] = B[a]! + w * f[a]! * z;
                for (let b = 0; b < 6; b++) M[a * 6 + b] = M[a * 6 + b]! + w * f[a]! * f[b]!;
              }
              nFit++;
              if (d2 < RC * RC || d2 < 0.09) {
                const wcol = Math.exp((-2 * d2) / Math.max(RC * RC, 0.09));
                const h = Math.min(Math.max(s.hgt[i]! / s.hTop, 0), 1);
                const q = s.pat[i * 2]! - Math.floor(s.pat[i * 2]!) - 0.5;
                const ridge = Math.exp((-q * q) / 0.022) * 0.7;
                const groove = ss(0.5, 0.2, Math.abs(q));
                const t1 = ss(0.02, 0.33, h), t2 = ss(0.42, 1, h);
                for (let ch = 0; ch < 3; ch++) {
                  let al = PLUM[ch]! + (CORAL[ch]! - PLUM[ch]!) * t1;
                  al += (MAGENTA[ch]! - al) * t2;
                  al += (SHELL[ch]! - al) * ridge;
                  al *= GROOVE[ch]! + (1 - GROOVE[ch]!) * groove;
                  col[ch] = col[ch]! + wcol * al;
                  col[4 + ch] = col[4 + ch]! + wcol * s.glow[i * 3 + ch]!;
                }
                col[3] = col[3]! + wcol * s.ground[i * 2]!;
                col[7] = col[7]! + wcol * s.ground[i * 2 + 1]!;
                wc += wcol;
              }
            }
          }
      // solve the weighted least squares (Gaussian elimination, a little ridge to keep it sane)
      const q = [0, 0, 0, 0, 0, 0];
      if (nFit >= 12) {
        for (let a = 0; a < 6; a++) M[a * 6 + a] = M[a * 6 + a]! + 1e-4 * (M[0] || 1);
        const A: number[][] = Array.from({ length: 6 }, (_, a) => [...M.slice(a * 6, a * 6 + 6), B[a]!]);
        let ok = true;
        for (let p = 0; p < 6 && ok; p++) {
          let best = p;
          for (let a = p + 1; a < 6; a++) if (Math.abs(A[a]![p]!) > Math.abs(A[best]![p]!)) best = a;
          [A[p], A[best]] = [A[best]!, A[p]!];
          if (Math.abs(A[p]![p]!) < 1e-12) ok = false;
          for (let a = 0; a < 6 && ok; a++) {
            if (a === p) continue;
            const f = A[a]![p]! / A[p]![p]!;
            {
              const Ra = A[a]!, Rp = A[p]!;
              for (let b = p; b < 7; b++) Ra[b] = Ra[b]! - f * Rp[b]!;
            }
          }
        }
        if (ok) for (let a = 0; a < 6; a++) q[a] = A[a]![6]! / A[a]![a]!;
        // a wall that bends away faster than this is a fit gone wrong: fall back to a plane
        if (!ok || Math.abs(q[3]!) + Math.abs(q[4]!) + Math.abs(q[5]!) > 0.6 || Math.abs(q[0]!) > 0.5) q.fill(0);
      }
      eyeQuad.set([q[0]!, q[1]!, q[2]!, q[3]!, q[4]!, q[5]!, 0, 0], e * 8);
      if (wc > 0) for (let k = 0; k < 8; k++) col[k] = col[k]! / wc;
      else col.set([0.6, 0.12, 0.12, 1, 0, 0, 0, 0]);
      eyeSkin.set(col, e * 8);
    }
  }

  // The eye's mesh: a disc of rings round the eye's axis, out to RIM radii. Its height is the lid,
  // hugging the eyeball, rolled into a collar that settles on to the wall and sinks under it.
  const RIM = 1.55;
  const eyeBase = new BufferGeometry();
  {
    const RINGS = [0, 0.2, 0.37, 0.5, 0.6, 0.68, 0.75, 0.81, 0.86, 0.9, 0.94, 0.98, 1.03, 1.09, 1.17, 1.27, 1.4, RIM];
    const SEG = 40;
    const pos: number[] = [];
    const idx: number[] = [];
    for (const rho of RINGS)
      for (let j = 0; j <= SEG; j++) {
        const th = (j / SEG) * Math.PI * 2;
        pos.push(rho * Math.cos(th), rho * Math.sin(th), 0);
      }
    for (let i = 0; i < RINGS.length - 1; i++)
      for (let j = 0; j < SEG; j++) {
        const a = i * (SEG + 1) + j;
        const b = a + SEG + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    eyeBase.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    eyeBase.setIndex(idx);
  }
  const eyeGeo = new InstancedBufferGeometry();
  {
    eyeGeo.index = eyeBase.index;
    eyeGeo.setAttribute("position", eyeBase.getAttribute("position"));
    eyeGeo.setAttribute("aPos", new InstancedBufferAttribute(new Float32Array(eyePos), 4));
    eyeGeo.setAttribute("aAxis", new InstancedBufferAttribute(new Float32Array(eyeAxis), 4));
    eyeGeo.setAttribute("aUp", new InstancedBufferAttribute(eyeUp, 4));
    const quad = new InstancedInterleavedBuffer(eyeQuad, 8);
    const skin = new InstancedInterleavedBuffer(eyeSkin, 8);
    eyeGeo.setAttribute("aQuadA", new InterleavedBufferAttribute(quad, 4, 0));
    eyeGeo.setAttribute("aQuadB", new InterleavedBufferAttribute(quad, 4, 4));
    eyeGeo.setAttribute("aAlb", new InterleavedBufferAttribute(skin, 4, 0));
    eyeGeo.setAttribute("aGlow", new InterleavedBufferAttribute(skin, 4, 4));
    eyeGeo.instanceCount = nEye;
  }
  const NS = (x: number) => x.toFixed(4);
  const eyeMat = new ShaderMaterial({
    uniforms: { ...shared, uHoop: { value: world.hoopPos.clone() } },
    transparent: true,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */ `
      attribute vec4 aPos;
      attribute vec4 aAxis;
      attribute vec4 aUp;
      attribute vec4 aQuadA;
      attribute vec4 aQuadB;
      attribute vec4 aAlb;
      attribute vec4 aGlow;
      uniform float uTime;
      uniform vec3 uHoop;
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vXY;
      varying vec4 vC;
      varying vec3 vAxis;
      varying vec3 vUp;
      varying vec3 vGaze;
      varying vec3 vSeedOpen;   // seed, how open, how bright the eyeball
      varying vec4 vAlb;
      varying vec4 vGlow;

      float gFlat = 1.0;   // a shut eye lies flatter in the wall than an open one
      float smax(float a, float b, float k) {
        float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0);
        return mix(b, a, h) + k * h * (1.0 - h);
      }
      // the height of the eye's surface over its centre, in eye radii, at (x, y) in the wall's plane
      float surf(vec2 p) {
        float rho = length(p);
        float lid = rho < 0.995 ? 0.3 + (sqrt(1.0 - rho * rho) - 0.25) * gFlat : -1.0;
        vec2 p2 = p * p;
        float wall = 0.3 + aQuadA.x + aQuadA.y * p.x + aQuadA.z * p.y + aQuadA.w * p2.x + aQuadB.x * p.x * p.y + aQuadB.y * p2.y;
        // a fleshy shoulder round the lids that settles on to the wall and goes under it
        float dr = (rho - 1.0) / 0.32;
        float collar = wall + 0.13 * exp(-dr * dr) - 0.05 * smoothstep(1.3, ${NS(RIM)}, rho);
        return smax(lid, collar, 0.14);
      }
      void main() {
        vec3 axis = aAxis.xyz;
        vec3 up = aUp.xyz;
        vec3 side = cross(up, axis);
        float r = aPos.w;
        float seed = aAxis.w;
        vec3 to = cameraPosition - aPos.xyz;
        float dist = length(to);
        float blink = smoothstep(0.985, 1.0, sin(uTime * (0.55 + seed * 0.5) + seed * 50.0));
        float open, bright = 1.0;
        if (aUp.w > 0.0) {
          // a dome eye: wakes in its turn as the camera comes in, softly, and looks at the hoop
          float awake = smoothstep(aUp.w, aUp.w + 1.6, uTime);
          vec3 th = normalize(uHoop - aPos.xyz);
          vGaze = normalize(mix(axis, th, 0.8));
          open = awake * (1.0 - blink) * (0.42 + 0.14 * fract(seed * 7.3));
          bright = 0.75;
        } else {
          // an eye can only swivel so far out of its socket
          vGaze = normalize(mix(axis, to / dist, 0.72));
          // asleep until the lantern is close
          float awake = smoothstep(17.0, 9.0, dist + 5.0 * (seed - 0.5) - 14.0 * max(r - 0.3, 0.0));
          open = awake * (1.0 - blink) * (0.5 + 0.3 * fract(seed * 7.3));
        }
        vSeedOpen = vec3(seed, open, bright);
        gFlat = mix(0.72, 1.0, smoothstep(0.0, 0.5, open));
        vec2 p = position.xy;
        float z = surf(p);
        const float E = 0.01;
        float zx = (surf(p + vec2(E, 0.0)) - surf(p - vec2(E, 0.0))) / (2.0 * E);
        float zy = (surf(p + vec2(0.0, E)) - surf(p - vec2(0.0, E))) / (2.0 * E);
        vN = normalize(axis - zx * side - zy * up);
        vW = aPos.xyz + r * (p.x * side + p.y * up + z * axis);
        vXY = p;
        vC = aPos;
        vAxis = axis;
        vUp = up;
        vAlb = aAlb;
        vGlow = aGlow;

        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      ${FOG_GLSL}
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vXY;
      varying vec4 vC;
      varying vec3 vAxis;
      varying vec3 vUp;
      varying vec3 vGaze;
      varying vec3 vSeedOpen;
      varying vec4 vAlb;
      varying vec4 vGlow;

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      const float TILT = 0.85;
      // a scale of the wall's skin (as SKIN_GLSL in materials.ts), here in rings round the eye
      float scale(float a, float N, float row, float t, out vec4 about) {
        float gx = a * N + 0.5 * row;
        float id = floor(gx);
        float rnd = hash12(vec2(mod(id, N), row));
        float r2 = fract(rnd * 7.13 + 0.37);
        float x = gx - id - 0.5 + (rnd - 0.5) * 0.14;
        float u = t - 0.72 - 0.12 * r2;
        float e = x * x * 2.9 + u * u * 1.2;
        about = vec4(e, rnd, x, u);
        return TILT * t + 1.0 - e * (0.3 + 0.7 * e) + 0.22 * (r2 - 0.5);
      }

      void main() {
        float seed = vSeedOpen.x;
        // barely parted is shut: no sliver of eyeball, just the lids' crease
        float o = vSeedOpen.y * smoothstep(0.03, 0.14, vSeedOpen.y);
        float r = vC.w;
        vec3 axis = normalize(vAxis);
        vec3 up = normalize(vUp);
        vec3 side = cross(up, axis);
        vec3 V = cameraPosition - vW;
        float dist = length(V);
        V /= dist;
        vec2 p = vXY;
        float rho = length(p);
        vec3 dpx = dFdx(vW), dpy = dFdy(vW);
        float aa = max(fwidth(p.y), 1e-4);

        // --- the lids: an almond opening, upper over lower, opened by how awake it is ---------
        const float W = 0.9;
        float xs = p.x / W;
        float s = max(1.0 - xs * xs, 0.0);
        float sp = pow(s, 0.85);
        float meet = -mix(0.3, 0.1, clamp(o / 0.6, 0.0, 1.0)) * s;                  // where they close: a soft curve, low in the middle
        float yu = meet + 1.0 * o * sp;
        float yl = meet - 0.62 * o * sp;
        float du = yu - p.y;                     // > 0 below the upper lid's edge
        float dl = p.y - yl;                     // > 0 above the lower lid's edge
        float d = min(du, dl);
        float apert = smoothstep(-aa, aa, d) * step(0.0, s - 1e-3);

        // --- the eyeball, seen through the opening -----------------------------------------
        vec3 eyeCol = vec3(0.0);
        if (apert > 0.0) {
          vec3 rd = -V;
          vec3 oc = cameraPosition - vC.xyz;
          float b = dot(oc, rd);
          float cc = dot(oc, oc) - r * r;
          float disc = b * b - cc;
          float tt = disc > 0.0 ? -b - sqrt(disc) : -b;
          vec3 n = normalize(cameraPosition + rd * tt - vC.xyz);
          vec3 g = normalize(vGaze);
          float c = dot(n, g);
          vec3 b1 = normalize(cross(g, vec3(0.0, 1.0, 0.1)));
          vec3 b2 = cross(g, b1);
          float around = atan(dot(n, b1), dot(n, b2));
          float rr = acos(clamp(c, -1.0, 1.0));
          float wide = 0.2 + 0.07 * sin(uTime * 0.7 + seed * 20.0);
          vec3 hue = seed < 0.4 ? vec3(0.1, 0.95, 0.7) : seed < 0.7 ? vec3(1.0, 0.62, 0.15) : seed < 0.9 ? vec3(1.0, 0.3, 0.6) : vec3(0.55, 0.5, 1.0);
          vec3 iris = hue * (0.55 + 0.45 * sin(around * 22.0 + sin(rr * 30.0))) * mix(1.25, 0.5, smoothstep(0.2, 0.6, rr));
          vec3 white = vec3(1.0, 0.9, 0.86) * (0.72 + 0.28 * c);
          white = mix(white, vec3(0.95, 0.35, 0.35), 0.35 * smoothstep(0.75, 1.4, rr));
          vec3 col = mix(white, iris, smoothstep(0.62, 0.58, rr));
          col *= 1.0 - 0.6 * smoothstep(0.03, 0.0, abs(rr - 0.6));
          col = mix(col, vec3(0.02, 0.0, 0.03), smoothstep(wide + 0.02, wide - 0.02, rr));
          // wet highlight
          col += vec3(1.0) * smoothstep(0.975, 0.99, dot(n, normalize(g + 0.42 * up + 0.3 * b1)));
          float ndv = max(dot(n, V), 0.0);
          float lamp = (0.25 + 0.75 * ndv) / (1.0 + dist * dist / 40.0);
          col *= (0.28 + 1.1 * lamp) * vSeedOpen.z;
          // the lids shade the eyeball where it goes in under them, the upper one most
          col *= mix(0.3, 1.0, smoothstep(0.0, 0.2, du)) * mix(0.6, 1.0, smoothstep(0.0, 0.1, dl));
          eyeCol = col;
        }

        // --- the lids and the collar: the wall's own skin --------------------------------------
        vec3 n = normalize(vN);
        // the lids' edges roll in towards the opening: the upper one over, the lower one under
        float eu = max(-du, 0.0), el = max(-dl, 0.0);
        float lidSide = step(du, dl);            // 1 on the upper lid's side of the opening
        float roll = exp(-(lidSide > 0.5 ? eu : el) / 0.13) * step(0.0, s - 1e-3);
        n = normalize(n - up * (lidSide > 0.5 ? 0.9 : -0.5) * roll);
        // the fold above the upper lid and a lighter one under the lower
        float sf = pow(max(1.0 - p.x * p.x / 1.05, 0.0), 0.8);
        float yf = meet + (0.72 + 0.28 * o) * sf + 0.06;
        float fold = exp(-pow((p.y - yf) / 0.06, 2.0)) * sf * step(0.0, p.y - meet);
        float yf2 = meet - (0.5 + 0.2 * o) * sf - 0.05;
        float fold2 = exp(-pow((p.y - yf2) / 0.06, 2.0)) * sf * step(p.y, meet);
        n = normalize(n + up * 0.45 * (fold * sign(p.y - yf) * step(abs(p.y - yf), 0.12)));

        // the scales of the wall carry on to the collar, in rings round the eye, smaller as they
        // near it, and are gone on the lids
        float a = atan(p.y, p.x) / 6.2831853;
        float N = max(8.0, floor(6.2831853 * ${NS(RIM)} * r / ${NS(SCALE_W)} + 0.5));
        float step_ = 6.2831853 / N * ${NS(SCALE_PITCH / SCALE_W)};
        float ring = (log(${NS(RIM)}) - log(max(rho, 1e-3))) / step_;
        vec2 da = vec2(dFdx(a), dFdy(a));
        da -= floor(da + 0.5);
        vec2 dr = vec2(dFdx(ring), dFdy(ring));
        float fw = max(N * max(abs(da.x), abs(da.y)), max(abs(dr.x), abs(dr.y)));
        float detail = (1.0 - smoothstep(0.13, 0.4, fw)) * smoothstep(1.0, 1.4, rho);
        float tone = 0.9;
        float wet = 0.6 * (1.0 - smoothstep(1.0, 1.4, rho));   // the lids are smooth and wet
        vec3 albedo = vAlb.rgb;
        if (detail > 0.0) {
          float row = floor(ring);
          float t = ring - row;
          vec4 aboutA, aboutB;
          float hA = scale(a, N, row - 1.0, t + 1.0, aboutA);
          float hB = scale(a, N, row, t, aboutB);
          float top = step(hB, hA);
          vec4 about = mix(aboutB, aboutA, top);
          float e = about.x;
          vec2 de = vec2(5.8 * about.z * N, 2.4 * about.w);
          vec2 g = vec2(0.0, TILT) - (0.3 + 1.4 * e) * de;
          float amp = detail * rho / ${NS(RIM)};
          vec2 dH = amp * (g.x * da + g.y * dr);
          float under = 1.0 - top;
          float crease = 1.0 - smoothstep(0.0, 0.2 + 0.7 * under + 2.5 * fw, abs(hA - hB));
          float body = 1.0 - smoothstep(0.3, 1.3, e);
          wet = max(wet, body * detail);
          float tn = (1.0 - (0.2 + 0.3 * under) * crease) * (0.8 + 0.2 * body) * (0.9 + 0.2 * about.y);
          tone = mix(0.9, tn, detail);
          albedo = mix(albedo, albedo * vec3(0.92, 0.6, 1.25), detail * smoothstep(0.72, 0.9, about.y) * 0.6);
          vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
          float det = dot(dpx, r1);
          n = normalize((abs(det) + 1e-9) * n - 0.03 * sign(det) * (dH.x * r1 + dH.y * r2));
        }
        // the socket: soft shade in the crease where the lids go in under the collar, in the
        // folds, where the lids meet, and under the upper lid's edge on the lower one
        float ao = 1.0 - 0.18 * exp(-pow((rho - 0.95) / 0.13, 2.0)) * (1.0 - apert);
        ao *= 1.0 - 0.35 * fold - 0.25 * fold2;
        float meetLine = exp(-d * d / (0.004 + aa * aa)) * step(0.0, s - 1e-3) * sqrt(s);
        ao *= 1.0 - 0.55 * meetLine * (1.0 - apert);
        ao *= 1.0 - 0.4 * exp(-el / 0.14) * step(0.0, -dl) * (1.0 - lidSide) * sqrt(s);
        albedo *= tone * ao;

        // lit as the wall is lit (WALL_FRAG in materials.ts), from the wall's own light here
        float open = vAlb.w;
        float ndl = max(dot(n, V), 0.0);
        float lantern = (0.66 + 0.34 * smoothstep(0.5, 4.5, dist)) / (1.0 + dist * dist / 36.0);
        vec3 light = vec3(0.05, 0.018, 0.07) * (0.7 + 0.3 * n.y);
        light += vec3(0.62, 0.34, 0.27) * (0.2 + 0.8 * ndl) * lantern;
        light *= open;
        light += vGlow.rgb * (0.5 * (0.5 + 0.5 * open));
        vec3 col = albedo * light;
        col /= 1.0 + 1.3 * max(max(col.r, col.g) - 0.4, 0.0);
        float graze = 1.0 - ndl;
        graze *= graze * graze;
        col = mix(col, vec3(0.08, 0.72, 0.5) * tone * open * (0.12 + 0.34 * ndl + 0.25 * graze), 0.62 * smoothstep(0.2, 1.1, vGlow.w));
        float s2 = ndl * ndl, s4 = s2 * s2, s8 = s4 * s4, s16 = s8 * s8, s32 = s16 * s16, s64 = s32 * s32;
        col += (vec3(1.0, 0.74, 0.64) * s64 * s64 * 0.45 + vec3(0.9, 0.2, 0.18) * s8 * 0.05) * wet * lantern * open;
        float far = dist * dist / (dist * dist + 12.0);
        col += vec3(0.42, 0.05, 0.30) * graze * (0.05 + 0.16 * length(vGlow.rgb) + 0.2 * far / (1.0 + dist * dist / 60.0));

        // the wet rim along each lid's edge: a thin line of the lantern
        float rimFade = 1.0 - smoothstep(0.015, 0.05, aa);
        float rim = exp(-pow((-d - 0.03) / 0.018, 2.0)) * step(0.0, s - 1e-3) * rimFade * (1.0 - apert);
        rim *= mix(0.5 * lidSide, 1.0, smoothstep(0.05, 0.3, o));
        col += vec3(1.0, 0.78, 0.72) * rim * (0.08 + 0.5 * pow(ndl, 3.0)) * lantern * open;

        col = mix(col, eyeCol, apert);

        // the collar fades into the wall, and shades it a little where it goes under
        float fogA = fogAmount(dist);
        col = mix(col, uFog, fogA);
        float cover = 1.0 - smoothstep(1.0, 1.45, rho);
        float shade = 0.07 * exp(-pow((rho - 1.3) / 0.15, 2.0)) * (1.0 - fogA);
        float alpha = cover + shade * (1.0 - cover);
        gl_FragColor = vec4(col * cover, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const eyes = new Mesh(eyeGeo, eyeMat);
  eyes.frustumCulled = false;

  // -------------------------------------------------------------------------------------------
  // mushrooms
  // -------------------------------------------------------------------------------------------
  const shroomPos: number[] = []; // foot + height
  const shroomLean: number[] = []; // lean (x, z), phase, hue
  const addShroom = (x: number, y: number, z: number, h: number, leanX: number, leanZ: number) => {
    shroomPos.push(x, y, z, h);
    shroomLean.push(leanX, leanZ, rnd() * 6.283, rnd());
  };
  /** a little family: one tall, a few small around it */
  const cluster = (x: number, y: number, z: number, h: number, leanX: number, leanZ: number) => {
    const k = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < k; i++) {
      const a = rnd() * 6.283;
      const d = i === 0 ? 0 : 0.1 + rnd() * 0.22;
      addShroom(x + Math.cos(a) * d, y, z + Math.sin(a) * d, h * (i === 0 ? 1 : 0.3 + rnd() * 0.45), leanX, leanZ);
    }
  };
  // the thread's course, to keep clear of: the camera rides right above it
  const route = world.route;
  const nearRoute = (x: number, z: number, d: number) => route.some((q) => (q.x - x) ** 2 + (q.z - z) ** 2 < d * d);
  for (const pts of corridorPts) {
    for (let i = 3; i < pts.length - 3; i += 2) {
      if (rnd() > 0.3) continue;
      const { c, side, up, k, rib } = pts[i]!;
      // not on a doorway's sill, where the trough is pressed flat
      if (rib < 0.7) continue;
      const sgn = rnd() < 0.5 ? -1 : 1;
      const x = (0.95 + rnd() * 0.5) * sgn * k;
      const h = 0.22 + rnd() ** 2 * 0.55;
      p.copy(c).addScaledVector(side, x).addScaledVector(up, troughY(x, k));
      if (inChamber(chambers, p, 0.3) || nearRoute(p.x, p.z, 1.05)) continue;
      cluster(p.x, p.y - 0.03, p.z, h, -side.x * sgn * 0.25, -side.z * sgn * 0.25);
    }
  }
  // groves: one tall mushroom and its family. In a junction they stand well off the thread and grow
  // tall; in the tunnel they keep to the foot of the wall, lean back against it and stay under the eye.
  for (const g of world.groves)
    for (let i = 0; i < 4; i++) {
      const a = rnd() * 6.283;
      const d = i === 0 ? 0 : 0.25 + rnd() * 0.35;
      const tall = g.tall ? 1.15 + rnd() * 0.3 : 0.82 + rnd() * 0.13;
      const h = i === 0 ? tall : 0.35 + rnd() * 0.4;
      const lean = g.tall ? 0.22 : -0.1;
      cluster(g.p.x + Math.cos(a) * d - g.lean.x * 0.1, g.p.y - 0.05, g.p.z + Math.sin(a) * d - g.lean.z * 0.1, h, g.lean.x * lean, g.lean.z * lean);
    }
  for (const ch of chambers) {
    const big = ch.R > 8;
    const count = Math.round(ch.R * (big ? 6 : 4));
    for (let k = 0, tries = 0; k < count && tries < 600; tries++) {
      const a = rnd() * 6.283;
      const r = Math.min(ch.R * (0.45 + 0.5 * rnd() ** 0.6), footRadius(ch) * 0.93);
      const x = ch.c.x + Math.sin(a) * r;
      const z = ch.c.z + Math.cos(a) * r;
      if (nearRoute(x, z, 2.1)) continue;
      // doorways stay open
      if (ch.doors.some((d) => d.dir.x * Math.sin(a) + d.dir.z * Math.cos(a) > Math.cos((2.4 * d.k) / r) && r > ch.R * 0.7)) continue;
      cluster(x, floorY(ch, r) - 0.02, z, (0.3 + rnd() ** 2 * (big ? 1.5 : 0.9)) * (0.6 + 0.6 * (r / ch.R)), 0, 0);
      k++;
    }
  }
  // a fairy ring around the hoop, open towards the arriving camera
  {
    const N = 26;
    const ch = chambers[chambers.length - 1]!;
    const facing = Math.atan2(world.arrive.x, world.arrive.z);
    for (let i = 0; i < N; i++) {
      const a = facing + 0.62 + ((Math.PI * 2 - 1.24) * i) / (N - 1);
      const r = HOOP.rx + 1.5 + 0.25 * Math.sin(i * 2.4);
      addShroom(world.hoopPos.x + Math.sin(a) * r, floorY(ch, r) - 0.02, world.hoopPos.z + Math.cos(a) * r, 0.42 + 0.3 * rnd(), -Math.sin(a) * 0.12, -Math.cos(a) * 0.12);
    }
  }

  // The mushroom, one unit tall: a dark foot buried in the floor, a tapering stalk, the gilled
  // underside and a domed cap with a thick, rolled rim. Each run of points is smooth; the joins
  // between them (stalk to gills, gills to rim) are creases. [radius, height] up the profile.
  const FOOT_STALK = [
    [0.105, -0.05], [0.1, 0.0], [0.088, 0.035], [0.07, 0.07],
    [0.062, 0.12], [0.056, 0.22], [0.051, 0.34], [0.046, 0.46], [0.041, 0.58], [0.037, 0.69], [0.034, 0.78], [0.034, 0.835],
  ];
  const GILLS = [[0.034, 0.845], [0.09, 0.835], [0.16, 0.822], [0.23, 0.818], [0.285, 0.828], [0.318, 0.848]];
  const CAP = [
    [0.318, 0.848], [0.333, 0.862], [0.342, 0.885], [0.341, 0.91], [0.33, 0.94], [0.31, 0.975], [0.283, 1.012], [0.25, 1.048],
    [0.21, 1.083], [0.165, 1.113], [0.115, 1.138], [0.06, 1.155], [0.0, 1.162],
  ];
  /** a lathe with creases: parts 0 foot, 1 stalk, 2 gills, 3 cap; uv = (round, along the part) */
  const shroomLathe = (radial: number, coarse: boolean) => {
    const pick = (pts: number[][], keep: (i: number) => boolean) => pts.filter((_, i) => i === 0 || i === pts.length - 1 || keep(i));
    const chains: { pts: number[][]; part: (i: number, n: number) => number }[] = [
      { pts: coarse ? pick(FOOT_STALK, (i) => i < 4 || i % 2 === 1) : FOOT_STALK, part: (i) => (i < 3 ? 0 : 1) },
      { pts: coarse ? pick(GILLS, (i) => i % 2 === 0) : GILLS, part: () => 2 },
      { pts: coarse ? pick(CAP, (i) => i % 2 === 0 || i < 4) : CAP, part: () => 3 },
    ];
    const pos: number[] = [];
    const nor: number[] = [];
    const uvs: number[] = [];
    const parts: number[] = [];
    const idx: number[] = [];
    for (const ch of chains) {
      const pts = ch.pts;
      const n = pts.length;
      // arc length along the chain, for the part's own coordinate
      const arc = [0];
      for (let i = 1; i < n; i++) arc.push(arc[i - 1]! + Math.hypot(pts[i]![0]! - pts[i - 1]![0]!, pts[i]![1]! - pts[i - 1]![1]!));
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)]!;
        const b = pts[Math.min(n - 1, i + 1)]!;
        let nr = b[1]! - a[1]!;
        let ny = -(b[0]! - a[0]!);
        const l = Math.hypot(nr, ny) || 1;
        nr /= l;
        ny /= l;
        const [r, y] = pts[i] as [number, number];
        for (let j = 0; j <= radial; j++) {
          const th = (j / radial) * Math.PI * 2;
          const s = Math.sin(th);
          const c = Math.cos(th);
          pos.push(r * s, y, r * c);
          nor.push(nr * s, ny, nr * c);
          uvs.push(j / radial, arc[i]! / arc[n - 1]!);
          parts.push(ch.part(i, n));
        }
      }
      for (let i = 0; i < n - 1; i++)
        for (let j = 0; j < radial; j++) {
          const a = base + i * (radial + 1) + j;
          const b = a + radial + 1;
          idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    g.setAttribute("part", new BufferAttribute(new Float32Array(parts), 1));
    g.setIndex(idx);
    return g;
  };

  // Those that come close to the lens get the fine lathe; the rest, never more than a thumb's width
  // on screen, the coarse one.
  const nShroom = shroomPos.length / 4;
  const near: number[] = [];
  const far: number[] = [];
  for (let i = 0; i < nShroom; i++) {
    const x = shroomPos[i * 4]!;
    const z = shroomPos[i * 4 + 2]!;
    let d2 = Infinity;
    for (const q of route) d2 = Math.min(d2, (q.x - x) ** 2 + (q.z - z) ** 2);
    (shroomPos[i * 4 + 3]! / Math.max(0.4, Math.sqrt(d2)) > 0.3 ? near : far).push(i);
  }
  const shroomGeos = [
    { ids: near, base: shroomLathe(40, false) },
    { ids: far, base: shroomLathe(13, true) },
  ].map(({ ids, base }) => {
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    for (const a of ["position", "normal", "uv", "part"]) g.setAttribute(a, base.getAttribute(a));
    const P = new Float32Array(ids.length * 4);
    const L = new Float32Array(ids.length * 4);
    ids.forEach((id, k) => {
      for (let c = 0; c < 4; c++) {
        P[k * 4 + c] = shroomPos[id * 4 + c]!;
        L[k * 4 + c] = shroomLean[id * 4 + c]!;
      }
    });
    g.setAttribute("aPos", new InstancedBufferAttribute(P, 4));
    g.setAttribute("aLean", new InstancedBufferAttribute(L, 4));
    g.instanceCount = ids.length;
    return g;
  });

  const shroomMat = new ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: /* glsl */ `
      attribute vec4 aPos;
      attribute vec4 aLean;
      attribute float part;
      uniform float uTime;
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vUv;
      varying float vY;
      varying float vHue;
      varying float vPhase;
      varying float vPart;
      const float TOP = 0.84;   // where the stalk meets the cap
      void main() {
        vec3 q = position;
        vec3 nn = normal;
        float th = uv.x * 6.2831853;
        float ph = aLean.z;
        // the cap is not quite round: its rim waves a little in and out, and up and down
        if (part > 1.5) {
          float r = length(q.xz);
          float w = smoothstep(0.08, 0.33, r);
          q.xz *= 1.0 + w * (0.045 * sin(3.0 * th + ph) + 0.03 * sin(5.0 * th + 2.0 * ph + 1.0));
          q.y += 0.04 * w * w * sin(4.0 * th + ph * 1.3);
        }
        // the stalk bends: an S from the ground to the cap, the way the family leans, and a nod
        // in a draught that is not there. The cap rides on the top of the stalk, tilted with it.
        float ys = min(q.y, TOP);
        vec2 curl = vec2(cos(ph * 3.1), sin(ph * 3.1)) * (0.04 + 0.07 * fract(ph * 5.3));
        vec2 nod = aLean.xy + 0.09 * vec2(sin(uTime * 0.9 + ph), cos(uTime * 0.7 + ph * 1.7));
        vec2 off = nod * ys * ys + curl * 0.5 * (1.0 - cos(3.14159265 * ys / TOP));
        vec2 tilt = 2.0 * TOP * nod;
        off += tilt * max(q.y - TOP, 0.0);
        q.xz += off;
        if (q.y > TOP - 0.02) nn.y -= dot(tilt, nn.xz);
        vec3 p = q * aPos.w;
        vW = aPos.xyz + p;
        vN = normalize(nn);
        vUv = uv;
        vY = position.y;
        vHue = aLean.w;
        vPhase = ph;
        vPart = part;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      ${FOG_GLSL}
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vUv;
      varying float vY;
      varying float vHue;
      varying float vPhase;
      varying float vPart;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 V = cameraPosition - vW;
        float dist = length(V);
        V /= dist;
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float ndv = clamp(dot(n, V), 0.0, 1.0);
        vec3 glow = vHue < 0.55 ? vec3(0.1, 1.0, 0.72) : vHue < 0.8 ? vec3(0.75, 0.45, 1.0) : vHue < 0.93 ? vec3(1.0, 0.62, 0.2) : vec3(1.0, 0.35, 0.55);
        float breathe = 0.7 + 0.3 * sin(uTime * 1.3 + vPhase);
        vec3 col;
        if (vPart < 1.5) {
          // the stalk: pale and fibrous, in the shade at the bottom, lit by the gills at the top and
          // a little of the cap's colour through it; the foot it stands on is dark and wet
          float fx = vUv.x * 26.0;
          float fib = 0.86 + 0.14 * sin(6.2831853 * fx + 2.6 * sin(vY * 13.0 + vUv.x * 37.0 + vPhase));
          fib = mix(fib, 0.93, smoothstep(0.25, 0.6, fwidth(fx)));
          float up = smoothstep(0.08, 0.84, vY);
          vec3 stalk = vec3(0.9, 0.7, 0.72) * (0.16 + 0.36 * ndv) * fib * (0.35 + 0.65 * up);
          stalk += glow * (0.03 + 0.32 * up * up * up) * breathe * (0.8 + 0.2 * fib);
          vec3 foot = vec3(0.06, 0.016, 0.06) * (0.6 + 0.6 * ndv) + glow * 0.025;
          col = mix(foot, stalk, smoothstep(0.2, 0.95, vPart));
        } else if (vPart < 2.5) {
          // the underside: radial gills, and between every two a shorter one from halfway out. Their
          // edges glow, brightest towards the rim; the slots between them are deep.
          float g = vUv.y;
          float x = vUv.x * 60.0;
          float fw = fwidth(x);
          float line = 1.0 - smoothstep(0.07, 0.07 + 1.3 * fw, abs(fract(x) - 0.5));
          float x2 = x + 0.5;
          float line2 = (1.0 - smoothstep(0.06, 0.06 + 1.3 * fw, abs(fract(x2) - 0.5))) * smoothstep(0.4, 0.55, g);
          float lines = max(line, line2 * 0.8);
          lines = mix(lines, 0.22 + 0.1 * g, smoothstep(0.35, 0.8, fw));
          col = glow * (0.06 + 0.16 * g) + glow * lines * (0.35 + 1.15 * g * g) * breathe;
          col *= smoothstep(0.0, 0.12, g) * 0.75 + 0.25;
        } else {
          // the cap: its own light, deeper where it is thick at the crown, coming through where it
          // is thin at the rolled rim; pale spots soft at the edge and set into it
          float s = vUv.y;                       // 0 at the rim's underside, 1 at the crown
          float thin = 1.0 - smoothstep(0.02, 0.32, s);
          float t = 1.0 - s;                     // 0 at the crown
          vec3 body = glow * (0.26 + 0.2 * ndv + 0.12 * thin) * breathe;
          body += glow * 0.5 * pow(1.0 - ndv, 2.0) * breathe;
          // the spots: rows round the crown, few at the top and more towards the rim
          float rows = 5.0;
          float ri = floor(t * rows);
          float spot = 0.0;
          float rad = 0.34 * sin(min(t * 1.4, 1.0) * 1.5707963);
          // a pixel's size in the spots' own units, for soft edges that never alias
          float aa = length(vec2(fwidth(vUv.x) * 6.2831853 * rad, fwidth(t) * 0.45));
          for (int di = -1; di <= 1; di++) {
            float row = ri + float(di);
            if (row < 0.0 || row > rows - 1.0) continue;
            float nr = 1.0 + 6.0 * row;
            float j0 = floor(vUv.x * nr);
            for (int dj = -1; dj <= 1; dj++) {
              float j = mod(j0 + float(dj), nr);
              vec2 id = vec2(j, row) + floor(vPhase * 10.0) * 7.0;
              float h1 = hash(id);
              if (h1 < 0.3) continue;
              float h2 = hash(id + 13.1);
              float uc = (j + 0.5 + 0.6 * (h1 - 0.65)) / nr;
              float tc = (row + 0.5 + 0.5 * (h2 - 0.5)) / rows;
              float du = fract(vUv.x - uc + 0.5) - 0.5;
              vec2 d = vec2(du * 6.2831853 * rad, (t - tc) * 0.45);
              float rs = 0.018 + 0.026 * hash(id + 5.7);
              float e = length(d);
              spot = max(spot, 1.0 - smoothstep(0.45 * rs, rs + aa, e));
            }
          }
          spot *= smoothstep(0.12, 0.3, s);
          vec3 spotCol = mix(vec3(1.0, 0.95, 0.88), glow, 0.25) * (0.35 + 0.45 * ndv) * (0.75 + 0.25 * breathe);
          col = mix(body, spotCol, spot * 0.9);
          // the rim lets the light through
          col += glow * (0.55 + 0.6 * (1.0 - ndv)) * thin * thin * breathe;
          // and the wet crown catches the lantern
          float s2 = ndv * ndv, s4 = s2 * s2, s16 = s4 * s4 * s4 * s4;
          col += vec3(1.0, 0.92, 0.9) * s16 * s16 * 0.18 * (1.0 - spot);
        }
        col = mix(col, uFog, fogAmount(dist));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const shrooms = new Group();
  for (const g of shroomGeos) {
    const m = new Mesh(g, shroomMat);
    m.frustumCulled = false;
    shrooms.add(m);
  }

  // --- the light they throw on the floor --------------------------------------------------------
  // A grid in plan over every mushroom's reach: each cell lists the mushrooms that can light it,
  // biggest first, as (foot x, foot y, foot z, 1 + colour + height / 4). The floor's shader reads
  // its cell (materials.ts, SHROOM) and adds a small pool of each one's colour and its dark foot.
  const CELL = 0.5;
  const K = SHROOM_SLOTS;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const reach = (h: number) => 0.25 + 0.75 * h;
  for (let i = 0; i < nShroom; i++) {
    const R = reach(shroomPos[i * 4 + 3]!);
    x0 = Math.min(x0, shroomPos[i * 4]! - R);
    x1 = Math.max(x1, shroomPos[i * 4]! + R);
    z0 = Math.min(z0, shroomPos[i * 4 + 2]! - R);
    z1 = Math.max(z1, shroomPos[i * 4 + 2]! + R);
  }
  const gw = Math.ceil((x1 - x0) / CELL) + 1;
  const gh = Math.ceil((z1 - z0) / CELL) + 1;
  const cells: number[][] = Array.from({ length: gw * gh }, () => []);
  for (let i = 0; i < nShroom; i++) {
    const x = shroomPos[i * 4]!;
    const z = shroomPos[i * 4 + 2]!;
    const R = reach(shroomPos[i * 4 + 3]!);
    for (let gx = Math.floor((x - R - x0) / CELL); gx <= Math.floor((x + R - x0) / CELL); gx++)
      for (let gz = Math.floor((z - R - z0) / CELL); gz <= Math.floor((z + R - z0) / CELL); gz++) {
        // only if the reach touches the cell
        const cx = Math.min(Math.max(x, x0 + gx * CELL), x0 + (gx + 1) * CELL);
        const cz = Math.min(Math.max(z, z0 + gz * CELL), z0 + (gz + 1) * CELL);
        if ((cx - x) ** 2 + (cz - z) ** 2 < R * R) cells[gz * gw + gx]!.push(i);
      }
  }
  const lightData = new Float32Array(gw * K * gh * 4);
  const hueIndex = (u: number) => (u < 0.55 ? 0 : u < 0.8 ? 1 : u < 0.93 ? 2 : 3);
  cells.forEach((list, c) => {
    list.sort((a, b) => shroomPos[b * 4 + 3]! - shroomPos[a * 4 + 3]!);
    const gx = c % gw;
    const gz = Math.floor(c / gw);
    for (let k = 0; k < Math.min(K, list.length); k++) {
      const i = list[k]!;
      const o = (gz * gw * K + gx * K + k) * 4;
      lightData[o] = shroomPos[i * 4]!;
      lightData[o + 1] = shroomPos[i * 4 + 1]!;
      lightData[o + 2] = shroomPos[i * 4 + 2]!;
      lightData[o + 3] = 1 + hueIndex(shroomLean[i * 4 + 3]!) + Math.min(shroomPos[i * 4 + 3]!, 3.9) / 4;
    }
  });
  const lightTex = new DataTexture(lightData, gw * K, gh, RGBAFormat, FloatType);
  lightTex.minFilter = NearestFilter;
  lightTex.magFilter = NearestFilter;
  lightTex.generateMipmaps = false;
  lightTex.needsUpdate = true;
  const shroomLight: ShroomLight = { tex: lightTex, grid: new Vector4(x0, z0, 1 / CELL, 0), size: new Vector2(gw, gh) };

  return {
    eyes,
    shrooms,
    /** centre + radius, and inward normal + seed, of every eye: four numbers each */
    eyeSpots: { pos: eyePos, axis: eyeAxis },
    /** foot + height, and lean + phase + hue, of every mushroom: four numbers each */
    shroomSpots: { pos: shroomPos, lean: shroomLean },
    /** where their light falls: for the floor's shader (setShroomLight in materials.ts) */
    shroomLight,
    dispose() {
      eyeGeo.dispose();
      eyeBase.dispose();
      eyeMat.dispose();
      for (const g of shroomGeos) g.dispose();
      shroomMat.dispose();
      lightTex.dispose();
    },
  };
}
