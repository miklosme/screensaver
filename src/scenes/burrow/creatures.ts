import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import { HOOP, PROFILE, floorY, footRadius, troughY, wallRelief, type Chamber, type Station } from "./build";
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

  const eyeGeo = new InstancedBufferGeometry();
  {
    const base = new SphereGeometry(1, 20, 14);
    eyeGeo.index = base.index;
    eyeGeo.setAttribute("position", base.getAttribute("position"));
    eyeGeo.setAttribute("aPos", new InstancedBufferAttribute(new Float32Array(eyePos), 4));
    eyeGeo.setAttribute("aAxis", new InstancedBufferAttribute(new Float32Array(eyeAxis), 4));
    eyeGeo.instanceCount = eyePos.length / 4;
  }
  const eyeMat = new ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: /* glsl */ `
      attribute vec4 aPos;
      attribute vec4 aAxis;
      varying vec3 vN;
      varying vec3 vW;
      varying vec3 vAxis;
      varying vec3 vGaze;
      varying float vSeed;
      varying float vAwake;
      void main() {
        vN = position;
        vW = aPos.xyz + position * aPos.w;
        vAxis = aAxis.xyz;
        vSeed = aAxis.w;
        vec3 to = cameraPosition - aPos.xyz;
        float dist = length(to);
        // an eye can only swivel so far out of its socket
        vGaze = normalize(mix(aAxis.xyz, to / dist, 0.72));
        // asleep until the lantern is close
        vAwake = smoothstep(17.0, 9.0, dist + 5.0 * (aAxis.w - 0.5) - 14.0 * max(aPos.w - 0.3, 0.0));
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      ${FOG_GLSL}
      varying vec3 vN;
      varying vec3 vW;
      varying vec3 vAxis;
      varying vec3 vGaze;
      varying float vSeed;
      varying float vAwake;
      void main() {
        vec3 n = normalize(vN);
        vec3 axis = normalize(vAxis);
        vec3 g = normalize(vGaze);
        vec3 V = cameraPosition - vW;
        float dist = length(V);
        V /= dist;

        // lids close over the eye from above and below
        vec3 lidUp = normalize(vec3(0.0, 1.0, 0.0) - axis * axis.y + vec3(1e-3, 0.0, 0.0));
        float blink = smoothstep(0.985, 1.0, sin(uTime * (0.55 + vSeed * 0.5) + vSeed * 50.0));
        float open = vAwake * (1.0 - blink) * (0.5 + 0.3 * fract(vSeed * 7.3));
        float lid = smoothstep(open - 0.03, open + 0.03, abs(dot(n, lidUp)) + 0.25 * (1.0 - dot(n, axis)));

        // iris and pupil around the gaze
        float c = dot(n, g);
        vec3 b1 = normalize(cross(g, vec3(0.0, 1.0, 0.1)));
        vec3 b2 = cross(g, b1);
        float around = atan(dot(n, b1), dot(n, b2));
        float r = acos(clamp(c, -1.0, 1.0));
        float wide = 0.2 + 0.07 * sin(uTime * 0.7 + vSeed * 20.0);
        vec3 hue = vSeed < 0.4 ? vec3(0.1, 0.95, 0.7) : vSeed < 0.7 ? vec3(1.0, 0.62, 0.15) : vSeed < 0.9 ? vec3(1.0, 0.3, 0.6) : vec3(0.55, 0.5, 1.0);
        vec3 iris = hue * (0.55 + 0.45 * sin(around * 22.0 + sin(r * 30.0))) * mix(1.25, 0.5, smoothstep(0.2, 0.6, r));
        vec3 white = vec3(1.0, 0.9, 0.86) * (0.72 + 0.28 * c);
        white = mix(white, vec3(0.95, 0.35, 0.35), 0.35 * smoothstep(0.75, 1.4, r));
        vec3 col = mix(white, iris, smoothstep(0.62, 0.58, r));
        col *= 1.0 - 0.6 * smoothstep(0.03, 0.0, abs(r - 0.6));
        col = mix(col, vec3(0.02, 0.0, 0.03), smoothstep(wide + 0.02, wide - 0.02, r));
        // wet highlight
        col += vec3(1.0) * smoothstep(0.975, 0.99, dot(n, normalize(g + 0.42 * lidUp + 0.3 * b1)));

        // lit like the walls, by the traveller's lantern, and glowing a little of its own accord
        float ndv = max(dot(n, V), 0.0);
        float lamp = (0.25 + 0.75 * ndv) / (1.0 + dist * dist / 40.0);
        col *= 0.28 + 1.1 * lamp;
        vec3 skin = vec3(0.55, 0.1, 0.16) * (0.2 + 1.2 * lamp) * (0.7 + 0.3 * dot(n, axis));
        col = mix(col, skin, lid);

        col = mix(col, uFog, fogAmount(dist));
        gl_FragColor = vec4(col, 1.0);
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
      eyeMat.dispose();
      for (const g of shroomGeos) g.dispose();
      shroomMat.dispose();
      lightTex.dispose();
    },
  };
}
