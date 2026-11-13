import { BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3 } from "three";
import { COMMON, TONE, type Shared } from "./glsl";
import { CENTRE, COLUMN, FLOOR_Y, LIP_R, TAU, UNDER_Y, inHole, rng, type Layout } from "./layout";

/**
 * Painted eggs that drift up like bubbles. Each one has a column, a period and a phase, and over
 * one period it rises out of the dark, slows and docks under the ceiling like a bubble under glass,
 * passes up through the slab, rocks on the glaze like a roly-poly toy, then lifts off and dwindles
 * into the dark above. Eggs in the hole rise straight through. One instanced draw, placed in the
 * vertex shader from the clock alone, and kept out of a cone ahead of the eye.
 */

function eggGeometry() {
  const rows = 12;
  const segs = 18;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  // an egg 1.4 tall and 1 wide, fuller at the bottom; y = 0 at its middle
  const prof = (k: number): [number, number] => {
    const a = k * Math.PI;
    const y = -Math.cos(a) * 0.7;
    const r = 0.5 * Math.sin(a) * (1 - 0.13 * (y / 0.7));
    return [r, y];
  };
  for (let i = 0; i <= rows; i++) {
    const [r, y] = prof(i / rows);
    const [r0, y0] = prof(Math.max(0, i - 0.5) / rows);
    const [r1, y1] = prof(Math.min(rows, i + 0.5) / rows);
    let nr = y1 - y0;
    let ny = -(r1 - r0);
    const l = Math.hypot(nr, ny) || 1;
    nr /= l;
    ny /= l;
    if (i === 0) [nr, ny] = [0, -1];
    if (i === rows) [nr, ny] = [0, 1];
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * TAU;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      nor.push(Math.cos(a) * nr, ny, Math.sin(a) * nr);
    }
  }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < segs; j++) {
      const p = i * (segs + 1) + j;
      const q = p + segs + 1;
      idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}

export interface Eggs {
  mesh: Mesh;
  update(eye: Vector3, forward: Vector3): void;
  dispose(): void;
}

export function buildEggs(shared: Shared, layout: Layout, count = 360): Eggs {
  const rand = rng(909);
  const g = eggGeometry();
  const col = new Float32Array(count * 4);
  const egg = new Float32Array(count * 4);
  const hen = layout.hen;
  let i = 0;
  let guard = 0;
  while (i < count && guard++ < 20000) {
    let x: number;
    let z: number;
    const pick = rand();
    if (pick < 0.16) {
      // the column of light
      const a = rand() * TAU;
      const r = Math.sqrt(rand()) * COLUMN.r * 0.95;
      x = COLUMN.x + Math.cos(a) * r;
      z = COLUMN.z + Math.sin(a) * r;
    } else if (pick < 0.36) {
      // round the lamp, docking under the ceiling by its rim
      const a = rand() * TAU;
      const r = LIP_R + 3.4 + rand() * 9;
      x = hen.x + Math.cos(a) * r;
      z = hen.z + Math.sin(a) * r;
    } else if (pick < 0.62) {
      // along the ride
      const s = layout.track[Math.floor(rand() * layout.track.length)]!;
      x = s.p.x + (rand() - 0.5) * 22;
      z = s.p.z + (rand() - 0.5) * 22;
    } else {
      const a = rand() * TAU;
      const r = 6 + 70 * rand() ** 1.3;
      x = CENTRE.x + Math.cos(a) * r;
      z = CENTRE.z + Math.sin(a) * r;
    }
    if (Math.hypot(x - hen.x, z - hen.z) < LIP_R + 3.2) continue;
    const size = 0.18 + 1.0 * rand() ** 1.8;
    const through = inHole(x, z, -size) ? 1 : 0;
    if (!through && inHole(x, z, size + 0.3)) continue;
    // under the ceiling the egg's top touches it
    const top = UNDER_Y - size * 0.72;
    col.set([x, z, 14 + rand() * 16, rand()], i * 4);
    egg.set([size, rand(), top, through], i * 4);
    i++;
  }
  g.setAttribute("aCol", new InstancedBufferAttribute(col, 4));
  g.setAttribute("aEgg", new InstancedBufferAttribute(egg, 4));
  g.instanceCount = i;

  const material = new ShaderMaterial({
    uniforms: { ...shared, uEye: { value: new Vector3() }, uFwd: { value: new Vector3(0, 0, -1) } },
    vertexShader: /* glsl */ `
      #define FLOOR_Y ${FLOOR_Y.toFixed(3)}
      uniform float uT;
      uniform vec3 uHen;
      uniform vec3 uEye;
      uniform vec3 uFwd;
      attribute vec4 aCol;  // x, z, period, phase
      attribute vec4 aEgg;  // size, seed, docking height, rises straight through the hole
      varying vec3 vObj;
      varying vec3 vW;
      varying vec3 vN;
      varying float vSeed;
      void main() {
        float size = aEgg.x;
        float seed = aEgg.y;
        float u = fract(uT / aCol.z + aCol.w);
        float y;
        float grow = 1.0;
        float rock = 0.0;
        float drift = 0.5;
        float rest = FLOOR_Y + size * 0.7;
        if (aEgg.w > 0.5) {
          y = mix(-24.0, FLOOR_Y + 24.0, u);
          grow = smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.7, 1.0, u));
        } else if (u < 0.55) {
          float k = u / 0.55;
          y = mix(-24.0, aEgg.z, 1.0 - pow(1.0 - k, 2.4));
          grow = smoothstep(0.0, 0.12, k);
        } else if (u < 0.7) {
          // docked under the ceiling, nudging it
          y = aEgg.z - 0.03 * (0.5 + 0.5 * sin(uT * 2.1 + seed * 30.0));
          drift = 0.25;
        } else if (u < 0.76) {
          // through the slab
          y = mix(aEgg.z, rest, smoothstep(0.7, 0.76, u));
          drift = 0.25;
        } else if (u < 0.84) {
          // a roly-poly on the glaze
          y = rest;
          float k = (u - 0.76) / 0.08;
          rock = sin(k * 18.0) * 0.32 * (1.0 - k);
          drift = 0.25;
        } else {
          float k = (u - 0.84) / 0.16;
          y = rest + 26.0 * k * k;
          grow = 1.0 - smoothstep(0.4, 1.0, k);
        }
        vec3 c = vec3(aCol.x, y, aCol.y);
        c.x += drift * sin(uT * 0.31 + seed * 17.0) + 0.3 * sin(uT * 0.13 + seed * 5.0);
        c.z += drift * cos(uT * 0.27 + seed * 11.0);

        // above the floor, eggs keep off the hen: out of an ellipsoid round her
        if (c.y > FLOOR_Y - 1.0) {
          vec3 rad = vec3(22.0, 21.0, 15.0) + size;
          vec3 q = (c - (uHen + vec3(-2.0, 0.0, 0.0))) / rad;
          float k = length(q);
          if (k < 1.0) c = uHen + vec3(-2.0, 0.0, 0.0) + q / max(k, 1e-3) * rad;
        }

        // keep the line of flight clear: out of a cone ahead of the eye
        vec3 rel = c - uEye;
        float along = dot(rel, uFwd);
        vec3 perp = rel - uFwd * along;
        float d = max(length(perp), 1e-3);
        float need = (1.6 + 0.16 * max(along, 0.0)) * smoothstep(-4.0, 1.0, along) * (1.0 - smoothstep(30.0, 45.0, along));
        c += perp / d * max(0.0, need + size - d);

        // the swoon: a slow tilt, and the rocking
        float tilt = 0.3 * sin(uT * 0.37 + seed * 23.0) + rock;
        float ta = seed * 40.0;
        vec3 ax = vec3(cos(ta), 0.0, sin(ta));
        vec3 p = position * size * grow;
        // rocking pivots on the egg's foot
        p.y += rock != 0.0 ? 0.7 * size : 0.0;
        float ct = cos(tilt), st = sin(tilt);
        p = p * ct + cross(ax, p) * st + ax * dot(ax, p) * (1.0 - ct);
        vec3 n = normal * ct + cross(ax, normal) * st + ax * dot(ax, normal) * (1.0 - ct);
        p.y -= rock != 0.0 ? 0.7 * size : 0.0;
        vec3 w = c + p;
        vObj = position;
        vW = w;
        vN = n;
        vSeed = seed;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader:
      COMMON +
      /* glsl */ `
      varying vec3 vObj;
      varying vec3 vW;
      varying vec3 vN;
      varying float vSeed;
      void main() {
        vec3 V = cameraPosition - vW;
        float dist = length(V);
        V /= dist;
        vec3 n = normalize(vN);
        // painted from the seed: bands, dots, zigzags, a few gilt, a few with a persimmon spot
        float y = vObj.y;
        float a = atan(vObj.z, vObj.x);
        float aa = fwidth(y) + 0.003;
        float kind = floor(vSeed * 6.0);
        float ink = 0.0;
        float gild = 0.0;
        float spot = 0.0;
        if (kind < 1.0) {
          ink = max(1.0 - smoothstep(0.035, 0.035 + aa, abs(y - 0.12)), 1.0 - smoothstep(0.02, 0.02 + aa, abs(y + 0.08)));
        } else if (kind < 2.0) {
          float zig = 0.05 + 0.09 * abs(fract(a * 1.9099) * 2.0 - 1.0);
          ink = 1.0 - smoothstep(0.025, 0.025 + aa, abs(y - zig));
          ink = max(ink, 1.0 - smoothstep(0.02, 0.02 + aa, abs(y + 0.2)));
        } else if (kind < 3.0) {
          float dots = length(vec2((fract(a * 1.432) - 0.5) * 0.85, (fract(y * 4.5) - 0.5) * 0.22));
          ink = 1.0 - smoothstep(0.07, 0.07 + aa * 2.0, dots);
        } else if (kind < 4.0) {
          gild = 1.0 - smoothstep(0.04, 0.04 + aa, abs(y - 0.05));
          ink = 1.0 - smoothstep(0.015, 0.015 + aa, abs(abs(y - 0.05) - 0.09));
        } else if (kind < 5.0) {
          ink = step(0.0, sin(y * 28.0)) * (1.0 - smoothstep(0.24, 0.25, abs(y + 0.05))) * 0.85;
        } else {
          spot = 1.0 - smoothstep(0.1, 0.1 + aa * 2.0, length(vec2(a - 1.0, (y - 0.1) * 3.0)) * 0.3);
        }
        vec3 base = mix(BONE, COBALT, ink);
        base = mix(base, PERSIMMON, spot);
        vec3 col = capWhite(base * lightAt(vW, n));
        col = mix(col, GOLD * 1.5, gild);
        col += glaze(vW, n, V, 0.6);
        // in the column of light an egg is rimmed gold
        float rim = pow(1.0 - max(dot(n, V), 0.0), 2.0);
        col += GOLD * rim * inColumn(vW) * 1.2;
        col = mix(col, haze(cameraPosition, -V), fogAmount(dist));
        gl_FragColor = vec4(col, 1.0);
        ${TONE}
      }`,
  });

  const mesh = new Mesh(g, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    update(eye, forward) {
      material.uniforms.uEye!.value.copy(eye);
      material.uniforms.uFwd!.value.copy(forward);
    },
    dispose() {
      g.dispose();
      material.dispose();
    },
  };
}

