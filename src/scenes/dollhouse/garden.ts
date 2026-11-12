import {
  BufferAttribute,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
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
const lin = (hex: string) => new Color(hex).toArray() as [number, number, number];

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
  /** a cast-shadow material around the given vertex shader, which sets vW and vA (see dollhouse.tsx) */
  shadowMaterial: (vertexShader: string) => ShaderMaterial;
}

export interface Garden {
  root: Group;
  /** each flower drift: centre and radius, for the contact shadow under it */
  drifts: { x: number; z: number; r: number }[];
  /** foot of each pinwheel stalk */
  pinwheels: { x: number; z: number; size: number }[];
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
    const hues = ["#ffa9b8", "#ffe08f", "#ffffff", "#b4defc", "#d6bcff", "#ffb893", "#a3e6d1"].map(lin);
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
      if (Math.hypot(cx, cz) > 8.6 + spread) drifts.push({ x: cx, z: cz, r: spread });
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
          vCol = aPart < 0.5 ? vec3(0.3, 0.6, 0.42) * (0.45 + 0.7 * position.y) : aPart < 1.5 ? aLook.rgb * (0.9 + 0.3 * length(position.xz)) * 1.12 : vec3(1.0, 0.62, 0.12);
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
    const hues = ["#ff8fa3", "#ffd166", "#7fd6c2", "#8fb8f2", "#c8a6ff", "#ff9f6e"].map(lin);
    const hue = new Float32Array(COUNT * 3);
    for (let n = 0, tries = 0; n < COUNT && tries < 4000; tries++) {
      const a = rnd() * TAU;
      const r = 14 + rnd() ** 0.8 * 70;
      const x = Math.cos(a) * r;
      const z = 18 + Math.sin(a) * r;
      const size = 0.9 + rnd() ** 1.5 * 1.7;
      if (!o.clear(x, z, 4 + size)) continue;
      place.set([x, ground(x, z) + STALK * size - 0.1, z, size], n * 4);
      pinwheels.push({ x, z, size });
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
        void main() {
          vec3 p = position;
          if (aPart > 0.5) {
            float a = aSpin.z + uT * aSpin.y;
            float c = cos(a), s = sin(a);
            p.xy = mat2(c, s, -s, c) * p.xy;
          }
          float c = cos(aSpin.x), s = sin(aSpin.x);
          p.xz = mat2(c, s, -s, c) * p.xz;
          vec3 w = aPlace.xyz + p * aPlace.w;
          // flattened onto the dune along the sun; the sails' shadow is a little lighter
          w -= SUN * (dot(aPlane.xyz, w) - aPlane.w) / dot(aPlane.xyz, SUN);
          vW = w;
          vA = aPart < 0.5 ? 1.0 : 0.85;
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
          vCol = aPart < 0.5 ? vec3(0.93, 0.78, 0.7) : aPart < 1.5 ? aHue : aPart < 2.5 ? vec3(1.0, 0.96, 0.9) : vec3(1.0, 0.7, 0.25);
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
    const hues = ["#ffffff", "#ffe2d2", "#d6f0e4", "#dbe9fb", "#fff3c4"].map(lin);
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
          vCol = mix(aHue, vec3(1.0), 0.35 * reach);
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
