import {
  BufferAttribute,
  BufferGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LatheGeometry,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { HOOP, PROFILE, floorY, footRadius, troughY, wallRelief, type Chamber, type Station } from "./build";
import type { Shared } from "./materials";

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

  const shroomGeo = new InstancedBufferGeometry();
  {
    const base: BufferGeometry = new LatheGeometry(
      [
        [0.055, 0],
        [0.036, 0.5],
        [0.03, 0.86],
        [0.1, 0.8],
        [0.3, 0.84],
        [0.33, 0.9],
        [0.27, 1.02],
        [0.15, 1.13],
        [0, 1.17],
      ].map(([x, y]) => new Vector2(x, y)),
      18,
    );
    shroomGeo.index = base.index;
    shroomGeo.setAttribute("position", base.getAttribute("position"));
    shroomGeo.setAttribute("normal", base.getAttribute("normal"));
    shroomGeo.setAttribute("uv", base.getAttribute("uv") as BufferAttribute);
    shroomGeo.setAttribute("aPos", new InstancedBufferAttribute(new Float32Array(shroomPos), 4));
    shroomGeo.setAttribute("aLean", new InstancedBufferAttribute(new Float32Array(shroomLean), 4));
    shroomGeo.instanceCount = shroomPos.length / 4;
  }
  const shroomMat = new ShaderMaterial({
    uniforms: { ...shared },
    vertexShader: /* glsl */ `
      attribute vec4 aPos;
      attribute vec4 aLean;
      uniform float uTime;
      varying vec3 vW;
      varying vec3 vN;
      varying vec2 vUv;
      varying float vY;
      varying float vHue;
      varying float vPhase;
      void main() {
        vec3 p = position * aPos.w;
        // stalks lean out from the wall and nod in a draught that is not there
        float bend = position.y * position.y;
        vec2 nod = aLean.xy + 0.09 * vec2(sin(uTime * 0.9 + aLean.z), cos(uTime * 0.7 + aLean.z * 1.7));
        p.xz += nod * bend * aPos.w;
        vW = aPos.xyz + p;
        vN = normal;
        vUv = uv;
        vY = position.y;
        vHue = aLean.w;
        vPhase = aLean.z;
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
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 V = cameraPosition - vW;
        float dist = length(V);
        V /= dist;
        vec3 n = normalize(vN);
        float ndv = abs(dot(n, V));
        vec3 glow = vHue < 0.55 ? vec3(0.1, 1.0, 0.72) : vHue < 0.8 ? vec3(0.75, 0.45, 1.0) : vHue < 0.93 ? vec3(1.0, 0.62, 0.2) : vec3(1.0, 0.35, 0.55);
        float breathe = 0.7 + 0.3 * sin(uTime * 1.3 + vPhase);
        // the lathe's v runs up the profile: stalk, then the gilled underside, then the cap
        float cap = smoothstep(0.52, 0.58, vUv.y);
        float gills = step(0.27, vUv.y) * (1.0 - cap);
        // stalk: pale, lit from the cap above
        vec3 col = mix(vec3(0.5, 0.2, 0.3), glow * 0.5 + 0.25, smoothstep(0.2, 0.86, vY) * 0.6) * (0.3 + 0.4 * ndv);
        // underside: bright ribbed gills
        col = mix(col, glow * (0.9 + 0.5 * sin(vUv.x * 150.0)) * breathe, gills);
        // cap: translucent, with pale spots, brightest at the rim
        vec2 sg = vec2(vUv.x * 9.0, vY * 16.0);
        float spot = smoothstep(0.3, 0.2, length(fract(sg) - 0.5)) * step(0.45, hash(floor(sg) + floor(vPhase * 10.0)));
        vec3 capCol = glow * (0.42 + 0.75 * pow(1.0 - ndv, 1.5)) * breathe;
        capCol = mix(capCol, vec3(1.0, 0.97, 0.9) * (0.6 + 0.4 * breathe), spot * 0.85);
        col = mix(col, capCol, cap);
        col = mix(col, uFog, fogAmount(dist));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const shrooms = new Mesh(shroomGeo, shroomMat);
  shrooms.frustumCulled = false;

  return {
    eyes,
    shrooms,
    /** centre + radius, and inward normal + seed, of every eye: four numbers each */
    eyeSpots: { pos: eyePos, axis: eyeAxis },
    /** foot + height, and lean + phase + hue, of every mushroom: four numbers each */
    shroomSpots: { pos: shroomPos, lean: shroomLean },
    dispose() {
      eyeGeo.dispose();
      eyeMat.dispose();
      shroomGeo.dispose();
      shroomMat.dispose();
    },
  };
}
