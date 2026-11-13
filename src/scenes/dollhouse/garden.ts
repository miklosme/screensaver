import {
  BufferAttribute,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix3,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Material,
} from "three";

/**
 * The small life of the dune garden: drifts of flowers along the way, pinwheels turning on tall
 * stalks, and two flocks of paper birds circling high overhead.
 *
 * All three are single instanced draws animated in the vertex shader from the scene clock.
 * Flowers stay below knee height, pinwheels are planted clear of the camera's track, and the
 * birds never come below the tree tops, so none of them can cross the line of flight.
 */

const TAU = Math.PI * 2;
type RGB = [number, number, number];

// three's ACES filmic curve, which the director's final pass applies to every scene (post.ts)
const ACES_IN = new Matrix3().set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777).invert();
const ACES_OUT = new Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602).invert();
/** the curve's fit `(v (v + a) - b) / (v (c v + d) + e)`, solved for v */
const unfit = (y: number) => {
  y = Math.min(Math.max(y, 0), 0.99);
  const A = y * 0.983729 - 1;
  const B = y * 0.432951 - 0.0245786;
  const C = y * 0.238081 + 0.000090537;
  return (-B - Math.sqrt(B * B - 4 * A * C)) / (2 * A);
};
const _v = new Vector3();
/**
 * The linear light that reaches the screen as `hex`.
 *
 * The final tone curve squeezes bright colours together and greys them, so a pastel has to go in
 * far more saturated than it comes out (a candy pink is about 7 : 1 : 1.5, and above 1 in red).
 * The scene's palette is therefore written as the colours a viewer should see, and solved back
 * through the curve here. Colours near white ask for a lot of light; keep channels below ~0xf4.
 */
export function onScreen(hex: string): RGB {
  const c = new Color(hex);
  _v.set(c.r, c.g, c.b).applyMatrix3(ACES_OUT);
  _v.set(unfit(_v.x), unfit(_v.y), unfit(_v.z)).applyMatrix3(ACES_IN);
  return [Math.max(0, _v.x * 0.6), Math.max(0, _v.y * 0.6), Math.max(0, _v.z * 0.6)];
}
/** `onScreen` as a GLSL vec3 */
export const glScreen = (hex: string) => `vec3(${onScreen(hex).map((v) => v.toFixed(4)).join(",")})`;

export interface GardenOptions {
  ground: (x: number, z: number) => number;
  /** true where nothing else stands within r of (x, z) and the camera does not pass */
  clear: (x: number, z: number, r: number) => boolean;
  /** points along the camera's track; flowers gather around it */
  path: { x: number; z: number }[];
  rnd: () => number;
  /** GLSL defining `vec3 applyFog(vec3 colour, float distance)` */
  fogGlsl: string;
  /** the scene's sun, pointing towards it */
  sun: { x: number; y: number; z: number };
  /** GLSL defining `float groundAt(vec2 xz)`, the same dunes as `ground` */
  groundGlsl: string;
  /** a cast-shadow material around the given vertex shader, which sets vW and vA (see dollhouse.tsx) */
  shadowMaterial: (vertexShader: string) => ShaderMaterial;
}

export interface Garden {
  root: Group;
  /** each flower drift: centre, radius and petal colour (linear light), for the shadow and the fallen petals under it */
  drifts: { x: number; z: number; r: number; hue: RGB }[];
  /** foot of each pinwheel stalk, and the height of its hub (the stalk's shadow is baked with the scene's) */
  pinwheels: { x: number; z: number; size: number; top: number }[];
  update(t: number): void;
  dispose(): void;
}

const VARYINGS = /* glsl */ `
  varying vec3 vCol;
  varying vec3 vW;
`;
const FRAGMENT = (fogGlsl: string, flat: boolean) => /* glsl */ `
  ${VARYINGS}
  ${fogGlsl}
  void main() {
    vec3 col = vCol;
    ${
      flat
        ? /* glsl */ `
    // folded paper: every facet takes its own share of the sun
    vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
    col *= 0.62 + 0.5 * abs(dot(n, normalize(vec3(0.45, 0.6, 0.75))));`
        : ""
    }
    gl_FragColor = vec4(applyFog(col, length(cameraPosition - vW)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function geometry(pos: number[], part: number[]) {
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aPart", new BufferAttribute(new Float32Array(part), 1));
  return g;
}

export function createGarden(o: GardenOptions): Garden {
  const { rnd, ground } = o;
  const root = new Group();
  const drifts: Garden["drifts"] = [];
  const pinwheels: Garden["pinwheels"] = [];
  const materials: ShaderMaterial[] = [];
  const geometries: InstancedBufferGeometry[] = [];
  const add = (g: InstancedBufferGeometry, m: ShaderMaterial) => {
    if (!m.uniforms.uT) m.uniforms.uT = { value: 0 };
    const mesh = new Mesh(g, m as Material);
    mesh.frustumCulled = false;
    root.add(mesh);
    materials.push(m);
    geometries.push(g);
  };
  const shader = (vertexShader: string, flat = false) =>
    new ShaderMaterial({ uniforms: { uT: { value: 0 } }, vertexShader, fragmentShader: FRAGMENT(o.fogGlsl, flat), side: DoubleSide });

  // -------------------------------------------------------------------------------------------
  // flowers: a stem, six petals and a button (aPart 0 / 1 / 2)
  // -------------------------------------------------------------------------------------------
  {
    const pos: number[] = [];
    const part: number[] = [];
    const tri = (a: number[], b: number[], c: number[], p: number) => {
      pos.push(...a, ...b, ...c);
      part.push(p, p, p);
    };
    tri([-0.035, 0, 0], [0.035, 0, 0], [0, 1, 0], 0);
    tri([0, 0, -0.035], [0, 0, 0.035], [0, 1, 0], 0);
    // the head is tipped a little towards +z; every flower gets its own yaw
    const head = (r: number, a: number, lift = 0): number[] => {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      return [x, 1 + lift + z * 0.45, z * 0.9];
    };
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      tri(head(0, 0), head(0.42, a - 0.42), head(0.7, a), 1);
      tri(head(0, 0), head(0.7, a), head(0.42, a + 0.42), 1);
      tri(head(0, 0, 0.03), head(0.22, a, 0.03), head(0.22, a + TAU / 6, 0.03), 2);
    }
    const g = geometry(pos, part);

    const COUNT = 3200;
    const place = new Float32Array(COUNT * 4);
    const look = new Float32Array(COUNT * 4);
    // deeper than the sand they stand on in every case, so that a drift is a patch of colour from afar
    const hues = ["#f285a2", "#f4cc55", "#ea6a98", "#74aef0", "#b094ec", "#f4955a", "#5fcdb0"].map(onScreen);
    let n = 0;
    // drifts: each one a patch of a single colour near the camera's way
    while (n < COUNT) {
      const at = o.path[Math.floor(rnd() * o.path.length)]!;
      const a = rnd() * TAU;
      const d = 3 + rnd() ** 1.5 * 34;
      const cx = at.x + Math.cos(a) * d;
      const cz = at.z + Math.sin(a) * d;
      const hue = hues[Math.floor(rnd() * hues.length)]!;
      const spread = 1.2 + rnd() * 3.5;
      const size = 0.2 + rnd() * 0.3;
      const k = Math.min(COUNT - n, 10 + Math.floor(rnd() * 40));
      if (Math.hypot(cx, cz) > 8.6 + spread) drifts.push({ x: cx, z: cz, r: spread, hue });
      for (let i = 0; i < k; i++) {
        const b = rnd() * TAU;
        const r = spread * Math.sqrt(rnd());
        const x = cx + Math.cos(b) * r;
        const z = cz + Math.sin(b) * r;
        // not on the stele's plinth
        const ok = Math.hypot(x, z) > 8.6;
        place.set([x, ground(x, z) - 0.02, z, ok ? size * (0.6 + 0.6 * rnd()) : 0], n * 4);
        look.set([hue[0], hue[1], hue[2], rnd() * TAU], n * 4);
        n++;
      }
    }
    g.setAttribute("aPlace", new InstancedBufferAttribute(place, 4));
    g.setAttribute("aLook", new InstancedBufferAttribute(look, 4));
    g.instanceCount = COUNT;
    // each flower's dark foot: a little soft pool on the sand, under the head and leaning away from
    // the sun (a fan: aPart 1 at its middle, 0 round its edge, which is what softens it)
    {
      const fp: number[] = [];
      const fa: number[] = [];
      for (let k = 0; k < 8; k++) {
        const a0 = (k / 8) * TAU;
        const a1 = ((k + 1) / 8) * TAU;
        fp.push(0, 0, 0, Math.cos(a1), 0, Math.sin(a1), Math.cos(a0), 0, Math.sin(a0)); // facing up
        fa.push(1, 0, 0);
      }
      const fg = geometry(fp, fa);
      fg.setAttribute("aPlace", g.getAttribute("aPlace"));
      fg.instanceCount = COUNT;
      add(
        fg,
        o.shadowMaterial(/* glsl */ `
          attribute float aPart;
          attribute vec4 aPlace; // foot, height
          varying vec3 vW;
          varying float vA;
          varying vec2 vQ;
          const vec3 SUN = vec3(${o.sun.x.toFixed(4)}, ${o.sun.y.toFixed(4)}, ${o.sun.z.toFixed(4)});
          ${o.groundGlsl}
          void main() {
            vec2 c = aPlace.xz - normalize(SUN.xz) * aPlace.w * 0.22;
            vec2 xz = c + position.xz * aPlace.w * 0.42;
            vW = vec3(xz.x, groundAt(xz) + 0.03, xz.y);
            // only near: further off a drift's own pool does the work, and the foot is not drawn at all
            float far = length(cameraPosition - aPlace.xyz);
            vA = aPart * 0.6 * (1.0 - smoothstep(12.0, 40.0, far));
            vQ = vec2(0.0);
            gl_Position = far > 40.0 || aPlace.w == 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(vW, 1.0);
          }`),
      );
    }
    add(
      g,
      shader(/* glsl */ `
        attribute float aPart;
        attribute vec4 aPlace; // foot, height
        attribute vec4 aLook;  // petal colour, phase
        uniform float uT;
        ${VARYINGS}
        void main() {
          float yaw = aLook.w * 5.0;
          float c = cos(yaw), s = sin(yaw);
          vec3 p = position;
          p.xz = mat2(c, s, -s, c) * p.xz;
          // a breeze crosses the garden in slow waves
          float gust = sin(uT * 1.4 + aPlace.x * 0.22 + aPlace.z * 0.17) + 0.4 * sin(uT * 3.1 + aLook.w);
          p.x += 0.16 * gust * position.y * position.y;
          vW = aPlace.xyz + p * aPlace.w;
          // dark green stems and a dark eye, so every flower has its own little contrast
          vCol = aPart < 0.5 ? ${glScreen("#3f9468")} * (0.45 + 0.6 * position.y) : aPart < 1.5 ? aLook.rgb * (0.74 + 0.4 * length(position.xz)) : ${glScreen("#5c2a50")};
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`),
    );
  }

  // -------------------------------------------------------------------------------------------
  // pinwheels: a stalk, four two-tone sails and a hub (aPart 0 / 1 / 2 / 3)
  // -------------------------------------------------------------------------------------------
  {
    const pos: number[] = [];
    const part: number[] = [];
    const tri = (a: number[], b: number[], c: number[], p: number) => {
      pos.push(...a, ...b, ...c);
      part.push(p, p, p);
    };
    const STALK = 3.2;
    for (let k = 0; k < 4; k++) {
      const a0 = (k / 4) * TAU;
      const a1 = ((k + 1) / 4) * TAU;
      const w = 0.035;
      const at = (a: number, y: number) => [Math.cos(a) * w, y, Math.sin(a) * w - 0.05];
      tri(at(a0, -STALK), at(a1, -STALK), at(a1, 0), 0);
      tri(at(a0, -STALK), at(a1, 0), at(a0, 0), 0);
    }
    const sail = (r: number, a: number, z = 0) => [Math.cos(a) * r, Math.sin(a) * r, z];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU;
      tri(sail(0, 0), sail(1, a), sail(0.68, a + TAU / 8, 0.1), 1);
      tri(sail(0, 0), sail(0.68, a + TAU / 8, 0.1), sail(0.36, a + TAU / 4, 0.16), 2);
    }
    for (let k = 0; k < 6; k++) tri(sail(0, 0, 0.2), sail(0.1, (k / 6) * TAU, 0.18), sail(0.1, ((k + 1) / 6) * TAU, 0.18), 3);
    const g = geometry(pos, part);

    const COUNT = 54;
    const place = new Float32Array(COUNT * 4);
    const spin = new Float32Array(COUNT * 4);
    const hues = ["#ee6f8e", "#f4c540", "#4fc6ac", "#659eee", "#a888f0", "#f48650"].map(onScreen);
    const hue = new Float32Array(COUNT * 3);
    for (let n = 0, tries = 0; n < COUNT && tries < 4000; tries++) {
      const a = rnd() * TAU;
      const r = 14 + rnd() ** 0.8 * 70;
      const x = Math.cos(a) * r;
      const z = 18 + Math.sin(a) * r;
      const size = 0.9 + rnd() ** 1.5 * 1.7;
      if (!o.clear(x, z, 4 + size)) continue;
      place.set([x, ground(x, z) + STALK * size - 0.1, z, size], n * 4);
      pinwheels.push({ x, z, size, top: ground(x, z) + STALK * size - 0.1 });
      spin.set([rnd() * TAU, (rnd() < 0.5 ? -1 : 1) * (1.2 + rnd() * 2.6) / size, rnd() * TAU, 0], n * 4);
      hue.set(hues[Math.floor(rnd() * hues.length)]!, n * 3);
      n++;
    }
    g.setAttribute("aPlace", new InstancedBufferAttribute(place, 4));
    g.setAttribute("aSpin", new InstancedBufferAttribute(spin, 4));
    g.setAttribute("aHue", new InstancedBufferAttribute(hue, 3));
    g.instanceCount = COUNT;
    // the dune under each pinwheel as a plane (normal, offset), for its shadow
    const plane = new Float32Array(COUNT * 4);
    pinwheels.forEach((p, i) => {
      const e = 1.5;
      const nx = ground(p.x - e, p.z) - ground(p.x + e, p.z);
      const nz = ground(p.x, p.z - e) - ground(p.x, p.z + e);
      const l = Math.hypot(nx, 2 * e, nz);
      const [ax, ay, az] = [nx / l, (2 * e) / l, nz / l];
      plane.set([ax, ay, az, ax * p.x + ay * (ground(p.x, p.z) + 0.05) + az * p.z], i * 4);
    });
    const sg = new InstancedBufferGeometry();
    for (const name of ["position", "aPart"]) sg.setAttribute(name, g.getAttribute(name));
    for (const name of ["aPlace", "aSpin"]) sg.setAttribute(name, g.getAttribute(name));
    sg.setAttribute("aPlane", new InstancedBufferAttribute(plane, 4));
    sg.instanceCount = COUNT;
    const shadowOf = (vs: string) => Object.assign(o.shadowMaterial(vs), { side: DoubleSide });
    add(
      sg,
      shadowOf(/* glsl */ `
        attribute float aPart;
        attribute vec4 aPlace;
        attribute vec4 aSpin;
        attribute vec4 aPlane; // ground normal, offset
        uniform float uT;
        varying vec3 vW;
        varying float vA;
        varying vec2 vQ;
        const vec3 SUN = vec3(${o.sun.x.toFixed(4)}, ${o.sun.y.toFixed(4)}, ${o.sun.z.toFixed(4)});
        ${o.groundGlsl}
        void main() {
          // the stalk's shadow is baked into the sand with every other still thing's
          if (aPart < 0.5) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          vec3 p = position;
          if (aPart > 0.5) {
            float a = aSpin.z + uT * aSpin.y;
            float c = cos(a), s = sin(a);
            p.xy = mat2(c, s, -s, c) * p.xy;
          }
          float c = cos(aSpin.x), s = sin(aSpin.x);
          p.xz = mat2(c, s, -s, c) * p.xz;
          vec3 w0 = aPlace.xyz + p * aPlace.w;
          // slid along the sun onto the dune: first onto its tangent plane under the stalk, then
          // onto the dune itself, so the shadow lies on the sand however it curves
          float k = (dot(aPlane.xyz, w0) - aPlane.w) / dot(aPlane.xyz, SUN);
          for (int i = 0; i < 3; i++) k = (w0.y - groundAt(w0.xz - SUN.xz * k) - 0.04) / SUN.y;
          vec3 w = w0 - SUN * k;
          vW = w;
          // the sails' shadow is a little lighter, and paler still far off, where it would only flicker
          vA = 0.85 * (1.0 - 0.6 * smoothstep(25.0, 110.0, length(cameraPosition - w)));
          vQ = vec2(0.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`),
    );
    add(
      g,
      shader(
        /* glsl */ `
        attribute float aPart;
        attribute vec4 aPlace; // hub, size
        attribute vec4 aSpin;  // yaw, speed, phase
        attribute vec3 aHue;
        uniform float uT;
        ${VARYINGS}
        void main() {
          vec3 p = position;
          if (aPart > 0.5) {
            float a = aSpin.z + uT * aSpin.y;
            float c = cos(a), s = sin(a);
            p.xy = mat2(c, s, -s, c) * p.xy;
          }
          float c = cos(aSpin.x), s = sin(aSpin.x);
          p.xz = mat2(c, s, -s, c) * p.xz;
          vW = aPlace.xyz + p * aPlace.w;
          vCol = aPart < 0.5 ? ${glScreen("#8d6a80")} : aPart < 1.5 ? aHue : aPart < 2.5 ? ${glScreen("#f4ecd8")} : ${glScreen("#5a2a4c")};
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`,
        true,
      ),
    );
  }

  // -------------------------------------------------------------------------------------------
  // paper birds: a folded body and two wings that beat (aPart: 0 body, +-1 wing tip)
  // -------------------------------------------------------------------------------------------
  {
    const pos: number[] = [];
    const part: number[] = [];
    const tri = (a: number[], b: number[], c: number[], pa: number, pb: number, pc: number) => {
      pos.push(...a, ...b, ...c);
      part.push(pa, pb, pc);
    };
    // body: a long keel, nose up at +z, tail fanned at -z
    tri([0, 0.06, 0.75], [0.1, 0, 0.1], [-0.1, 0, 0.1], 0, 0, 0);
    tri([0.1, 0, 0.1], [-0.1, 0, 0.1], [0, -0.12, -0.2], 0, 0, 0);
    tri([0.1, 0, 0.1], [0, -0.12, -0.2], [0.16, 0.05, -0.7], 0, 0, 0);
    tri([-0.1, 0, 0.1], [0, -0.12, -0.2], [-0.16, 0.05, -0.7], 0, 0, 0);
    tri([0, 0.06, 0.75], [0, 0.2, 0.95], [0, 0.02, 0.55], 0, 0, 0);
    for (const sgn of [1, -1]) {
      tri([sgn * 0.08, 0.01, 0.28], [sgn * 0.08, 0.01, -0.3], [sgn * 1.25, 0.01, -0.22], 0, 0, sgn);
      tri([sgn * 0.08, 0.01, 0.28], [sgn * 1.25, 0.01, -0.22], [sgn * 0.7, 0.01, 0.2], 0, sgn, sgn * 0.6);
    }
    const g = geometry(pos, part);

    const COUNT = 46;
    const orbit = new Float32Array(COUNT * 4);
    const bird = new Float32Array(COUNT * 4);
    const hues = ["#f3f0ea", "#f4d3c0", "#c4e8d6", "#cbdff6", "#f4e6ac"].map(onScreen);
    const hue = new Float32Array(COUNT * 3);
    for (let n = 0; n < COUNT; n++) {
      const flock = n % 2;
      const lead = flock ? 2.6 : 3.1; // where each flock is when the scene begins
      const r = (flock ? 50 : 82) + (rnd() - 0.5) * 30;
      const speed = (flock ? -1 : 1) * (7.5 + rnd() * 1.5);
      orbit.set([r, lead + (rnd() - 0.5) * 0.75 * (60 / r), (flock ? 17 : 24) + rnd() * 14, speed / r], n * 4);
      bird.set([2.4 + rnd() * 1.8, rnd() * TAU, 4.5 + rnd() * 2, rnd()], n * 4);
      hue.set(hues[Math.floor(rnd() * hues.length)]!, n * 3);
    }
    g.setAttribute("aOrbit", new InstancedBufferAttribute(orbit, 4));
    g.setAttribute("aBird", new InstancedBufferAttribute(bird, 4));
    g.setAttribute("aHue", new InstancedBufferAttribute(hue, 3));
    g.instanceCount = COUNT;
    add(
      g,
      shader(
        /* glsl */ `
        attribute float aPart;
        attribute vec4 aOrbit; // radius, angle, height, angular speed
        attribute vec4 aBird;  // size, phase, wing beat, seed
        attribute vec3 aHue;
        uniform float uT;
        ${VARYINGS}
        void main() {
          float ang = aOrbit.y + uT * aOrbit.w;
          float dir = sign(aOrbit.w);
          vec3 centre = vec3(aOrbit.x * cos(ang), aOrbit.z + 2.5 * sin(uT * 0.5 + aBird.y), 18.0 + aOrbit.x * sin(ang));
          vec3 fwd = vec3(-sin(ang), 0.0, cos(ang)) * dir;
          vec3 right = vec3(fwd.z, 0.0, -fwd.x);
          // a few strong beats, then a glide
          float beat = sin(uT * aBird.z + aBird.y) * (0.35 + 0.65 * smoothstep(-0.2, 0.5, sin(uT * 0.7 + aBird.y * 3.0)));
          vec3 p = position;
          float reach = abs(aPart);
          float lift = beat * 0.95 + 0.2;
          p.y += abs(p.x) * sin(lift) * reach;
          p.x *= mix(1.0, cos(lift), reach);
          p.y -= 0.12 * beat * (1.0 - reach);
          vW = centre + (right * p.x + vec3(0.0, p.y, 0.0) + fwd * p.z) * aBird.x;
          vCol = aHue * (1.0 + 0.15 * reach);
          gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
        }`,
        true,
      ),
    );
  }

  return {
    root,
    drifts,
    pinwheels,
    update(t) {
      for (const m of materials) m.uniforms.uT!.value = t;
    },
    dispose() {
      for (const m of materials) m.dispose();
      for (const g of geometries) g.dispose();
    },
  };
}
