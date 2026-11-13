import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  Path,
  Shape,
  ShapeGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  type Material,
  type Vector3,
} from "three";
import { COMMON, TONE, type Shared } from "./glsl";
import { BOWL_DEPTH, CENTRE, COLUMN, CURTAIN_R, FLOOR_R, FLOOR_Y, HOLE, LIP_R, TAU, UNDER_Y, WALL_R } from "./layout";

/**
 * The place itself: the curtain all round, the slab with its two faces and its broken hole, the
 * lamp that is the underside of the nest, the column of light, the nest's lip and the portal.
 */

const VERT = /* glsl */ `
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vUv;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

function mat(shared: Shared, frag: string, extra: Partial<ConstructorParameters<typeof ShaderMaterial>[0]> = {}, uniforms = {}) {
  return new ShaderMaterial({
    uniforms: { ...shared, ...uniforms },
    vertexShader: VERT,
    fragmentShader: COMMON + frag,
    ...extra,
  });
}

/** the backdrop: a sphere far out, painted with the curtain */
function backdrop(shared: Shared) {
  const geo = new SphereGeometry(CURTAIN_R + 30, 64, 32);
  const m = mat(
    shared,
    /* glsl */ `
    varying vec3 vW;
    void main() {
      vec3 dir = normalize(vW - cameraPosition);
      vec2 c = curtainHit(cameraPosition, dir);
      gl_FragColor = vec4(curtain(c.x, c.y), 1.0);
      ${TONE}
    }`,
    { side: BackSide, depthWrite: false },
  );
  const mesh = new Mesh(geo, m);
  mesh.position.set(CENTRE.x, FLOOR_Y, CENTRE.z);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/** the slab's outline with its hole, in shape coordinates (x, -z) */
function floorGeometry() {
  const shape = new Shape();
  shape.absarc(CENTRE.x, -CENTRE.z, FLOOR_R, 0, TAU, false);
  const hole = new Path();
  HOLE.forEach(([x, z], i) => (i ? hole.lineTo(x, -z) : hole.moveTo(x, -z)));
  hole.closePath();
  shape.holes.push(hole);
  const geo = new ShapeGeometry(shape, 96);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** the glazed top face */
function floorTop(shared: Shared, geo: BufferGeometry) {
  const m = mat(
    shared,
    /* glsl */ `
    varying vec3 vW;
    void main() {
      vec3 V = cameraPosition - vW;
      float dist = length(V);
      V /= dist;
      vec2 q = vW.xz - uHen.xz;
      float r = length(q);
      float a = atan(q.y, q.x);
      vec3 base = BONE;
      // cobalt border rings round the nest, the outer one scalloped
      float aa = fwidth(r) + 0.004;
      float line = 1.0 - smoothstep(0.07, 0.07 + aa, abs(r - 14.2));
      line = max(line, 1.0 - smoothstep(0.05, 0.05 + aa, abs(r - 14.9)));
      float sc = 17.2 + 0.9 * abs(sin(a * 18.0));
      line = max(line, 1.0 - smoothstep(0.06, 0.06 + aa, abs(r - sc)));
      line = max(line, (1.0 - smoothstep(0.18, 0.18 + aa, length(vec2(r - 16.0, (fract(a * 36.0 / 6.2831853) - 0.5) * r * 0.1745)))));
      // and far out, broad bands of willow-pattern blue
      line = max(line, 1.0 - smoothstep(0.09, 0.09 + aa, abs(r - 24.0)));
      line = max(line, 1.0 - smoothstep(0.04, 0.04 + aa, abs(r - 24.6)));
      float wave = 30.0 + 1.2 * sin(a * 14.0);
      line = max(line, 1.0 - smoothstep(0.08, 0.08 + aa, abs(r - wave)));
      line = max(line, (1.0 - smoothstep(0.05, 0.05 + aa, abs(r - wave - 1.4))) * step(0.5, fract(a * 28.0 / 6.2831853)));
      base = mix(base, COBALT * 1.4, line * 0.9);
      // the glaze is not quite even: it pools a little celadon in slow ripples
      float pool2 = 0.5 + 0.5 * sin(vW.x * 0.37 + sin(vW.z * 0.29) * 2.0) * sin(vW.z * 0.31 + sin(vW.x * 0.23) * 2.0);
      base = mix(base, CELADON, 0.12 * pool2);
      // glaze pooled celadon round the foot of the nest, and her shade
      float pool = 1.0 - smoothstep(11.3, 13.8, r);
      base = mix(base, CELADON * 0.75, pool * 0.6);
      vec3 col = base * (0.62 + 0.12 * smoothstep(40.0, 140.0, length(vW.xz - CENTRE)));
      col = capWhite(col);
      col = mix(col, GOLD * 1.8, crackLine(vW.xz, 0.06));
      col += glaze(vW, vec3(0.0, 1.0, 0.0), V, 0.85);
      col = mix(col, haze(cameraPosition, -V), fogAmount(dist));
      gl_FragColor = vec4(col, 1.0);
      ${TONE}
    }`,
  );
  const mesh = new Mesh(geo, m);
  mesh.position.y = FLOOR_Y;
  mesh.frustumCulled = false;
  return mesh;
}

/** the matt underside: the white ceiling of the place below, lit by the lamp and the column */
function floorUnder(shared: Shared, geo: BufferGeometry) {
  const m = mat(
    shared,
    /* glsl */ `
    varying vec3 vW;
    void main() {
      vec3 V = cameraPosition - vW;
      float dist = length(V);
      V /= dist;
      float r = length(vW.xz - uHen.xz);
      vec3 col = BONE * 0.66;
      // the lamp's warm pool round the bowl
      float d = max(r - 10.5, 0.0);
      col += vec3(1.0, 0.55, 0.2) * 0.8 * lampGlow() / (1.0 + d * d / 70.0);
      // the light that falls through the hole spills on the ceiling round it
      float c = length(vW.xz - COLUMN.xy);
      col += GOLD * 0.18 / (1.0 + c * c / 120.0);
      // a biscuit grain, and the mended cracks in gold
      float g = fract(sin(dot(floor(vW.xz * 6.0), vec2(12.9898, 78.233))) * 43758.5453);
      col *= 0.97 + 0.03 * g;
      col = mix(col, GOLD * 1.6, crackLine(vW.xz, 0.06));
      col = mix(col, haze(cameraPosition, -V), fogAmount(dist));
      gl_FragColor = vec4(col, 1.0);
      ${TONE}
    }`,
    { side: BackSide },
  );
  const mesh = new Mesh(geo, m);
  mesh.position.y = UNDER_Y;
  mesh.frustumCulled = false;
  return mesh;
}

/** gilt: the hole's broken edge, its ribbons on both faces, the nest's lip */
function gilt(shared: Shared, gain = 1) {
  return mat(
    shared,
    /* glsl */ `
    varying vec3 vW;
    varying vec3 vN;
    void main() {
      vec3 V = cameraPosition - vW;
      float dist = length(V);
      V /= dist;
      vec3 n = normalize(vN);
      float ndv = abs(dot(n, V));
      vec3 col = GOLD * (${gain.toFixed(2)} * (1.2 + 1.3 * ndv * ndv));
      col = mix(col, haze(cameraPosition, -V), fogAmount(dist) * 0.8);
      gl_FragColor = vec4(col, 1.0);
      ${TONE}
    }`,
    { side: DoubleSide },
  );
}

/** the hole's broken edge, the thickness of the slab, and a gilt ribbon along it on both faces */
function holeEdge() {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const n = HOLE.length;
  // signed area tells which way round the outline goes, so the walls face into the hole
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = HOLE[i]!;
    const [bx, bz] = HOLE[(i + 1) % n]!;
    area += ax * bz - bx * az;
  }
  const s = Math.sign(area);
  const W = 0.16;
  const quad = (a: number[], b: number[], c: number[], d: number[], nn: number[]) => {
    const o = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) nor.push(...nn);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  for (let i = 0; i < n; i++) {
    const [ax, az] = HOLE[i]!;
    const [bx, bz] = HOLE[(i + 1) % n]!;
    const len = Math.hypot(bx - ax, bz - az);
    // inward normal (towards the hole's middle)
    const nx = (-(bz - az) / len) * -s;
    const nz = ((bx - ax) / len) * -s;
    quad([ax, UNDER_Y - 0.01, az], [bx, UNDER_Y - 0.01, bz], [bx, FLOOR_Y + 0.01, bz], [ax, FLOOR_Y + 0.01, az], [nx, 0, nz]);
    // ribbons, reaching W back into the slab from the edge, a hair off each face
    for (const [y, ny] of [
      [FLOOR_Y + 0.012, 1],
      [UNDER_Y - 0.012, -1],
    ] as const)
      quad([ax, y, az], [bx, y, bz], [bx - nx * W, y, bz - nz * W], [ax - nx * W, y, az - nz * W], [0, ny, 0]);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  return g;
}

/**
 * The lamp: the nest's bowl seen from below, a dome hanging from the ceiling, lit from inside and
 * woven like a basket. Thin porcelain lets more light through between the strands than over them.
 * It breathes with the hen.
 */
function bowl(shared: Shared, hen: Vector3) {
  const cols = 128;
  const rows = 40;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const th = (v * Math.PI) / 2;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const a = u * TAU;
      const r = LIP_R * Math.cos(th);
      pos.push(Math.cos(a) * r, 0.1 - (BOWL_DEPTH + 0.1) * Math.sin(th), Math.sin(a) * r);
      const nx = Math.cos(th) / LIP_R;
      const ny = -Math.sin(th) / BOWL_DEPTH;
      const l = Math.hypot(nx, ny);
      nor.push((Math.cos(a) * nx) / l, ny / l, (Math.sin(a) * nx) / l);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const p = j * (cols + 1) + i;
      const q = p + cols + 1;
      idx.push(p, p + 1, q, p + 1, q + 1, q);
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  const m = mat(
    shared,
    /* glsl */ `
    varying vec3 vW;
    varying vec3 vN;
    varying vec2 vUv;
    void main() {
      vec3 V = cameraPosition - vW;
      float dist = length(V);
      V /= dist;
      vec3 n = normalize(vN);
      // the weave: ribs running down the bowl, rows round it, over and under
      vec2 w = vec2(vUv.x * 64.0, pow(vUv.y, 0.8) * 16.0);
      vec2 cell = floor(w);
      vec2 f = fract(w) - 0.5;
      float over = mod(cell.x + cell.y, 2.0);
      float rib = smoothstep(0.5, 0.3, abs(f.x));
      float row = smoothstep(0.5, 0.32, abs(f.y));
      float thick = max(rib * (0.55 + 0.45 * over), row * (1.0 - 0.45 * over));
      // far off the weave melts into its average
      float fine = clamp(1.4 - 3.0 * max(fwidth(w.x), fwidth(w.y)), 0.0, 1.0);
      thick = mix(0.6, thick, fine);
      // porcelain lit from inside: thinnest and hottest at the bottom, amber up the sides,
      // brighter between the strands than over them
      float ndv = max(dot(n, V), 0.0);
      // a sunset the wrong way up: deep amber at the rim, hot pale gold at the bottom
      float heat = smoothstep(0.05, 1.0, vUv.y);
      vec3 rim = vec3(1.0, 0.42, 0.1) * 1.5;
      vec3 hot = vec3(1.0, 0.78, 0.42) * 3.4;
      vec3 col = mix(rim, hot, heat * heat * (0.7 + 0.3 * ndv)) * (1.0 - 0.4 * thick);
      col *= lampGlow();
      // a band of plain biscuit where it meets the ceiling, and a gilt line under it
      col = mix(col, BONE * 0.8, smoothstep(0.045, 0.02, vUv.y));
      col = mix(col, GOLD * 2.0, 1.0 - smoothstep(0.006, 0.006 + fwidth(vUv.y), abs(vUv.y - 0.06)));
      col = mix(col, haze(cameraPosition, -V), fogAmount(dist));
      gl_FragColor = vec4(col, 1.0);
      ${TONE}
    }`,
  );
  const mesh = new Mesh(g, m);
  mesh.position.set(hen.x, UNDER_Y, hen.z);
  return mesh;
}

/**
 * The column of light through the hole: a soft upright shaft of glowing air, brightest at the hole,
 * fading down into the dark and up into the sky. Integrated along each ray in six steps, drawn from
 * inside (back faces) so it shows the same whether the eye is in it or not, and faded next to the
 * eye so it never fogs the lens.
 */
function column(shared: Shared) {
  const h = COLUMN.top - COLUMN.bottom;
  const geo = new CylinderGeometry(COLUMN.r * 1.02, COLUMN.r * 1.02, h, 48, 1, false);
  geo.translate(0, COLUMN.bottom + h / 2, 0);
  const m = mat(
    shared,
    /* glsl */ `
    varying vec3 vW;
    void main() {
      vec3 ro = cameraPosition;
      vec3 rd = vW - ro;
      float far = length(rd);
      rd /= far;
      vec2 o = ro.xz - COLUMN.xy;
      float a = dot(rd.xz, rd.xz);
      float b = dot(o, rd.xz);
      float R = COLUMN.z;
      float t0 = 0.0;
      float t1 = far;
      if (a > 1e-6) {
        float disc = b * b - a * (dot(o, o) - R * R);
        if (disc <= 0.0) discard;
        float sq = sqrt(disc);
        t0 = max((-b - sq) / a, 0.0);
        t1 = min((-b + sq) / a, far);
      }
      if (t1 <= t0) discard;
      float sum = 0.0;
      float dt = (t1 - t0) / 6.0;
      for (int i = 0; i < 6; i++) {
        float s = t0 + (float(i) + 0.5) * dt;
        vec3 p = ro + rd * s;
        vec2 q = p.xz - COLUMN.xy;
        // shafts: the light comes through a broken edge
        float az = atan(q.y, q.x);
        float shafts = 0.6 + 0.4 * sin(az * 5.0 + 1.3 + 0.08 * p.y) * sin(az * 3.0 - 0.7 + 0.15 * uT);
        sum += columnDensity(p) * shafts * smoothstep(1.0, 14.0, s) * (1.0 - fogAmount(s) * 0.6);
      }
      vec3 col = GOLD * sum * dt * 0.1;
      gl_FragColor = vec4(col, 1.0);
      ${TONE}
    }`,
    { side: BackSide, transparent: true, blending: AdditiveBlending, depthWrite: false },
  );
  const mesh = new Mesh(geo, m);
  mesh.position.set(COLUMN.x, 0, COLUMN.z);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

export interface World {
  meshes: Mesh[];
  lip: Mesh;
  portal: Mesh;
  dispose(): void;
}

export function buildWorld(shared: Shared, hen: Vector3, portalMaterial: Material): World {
  const floorGeo = floorGeometry();
  const giltMat = gilt(shared);
  const meshes = [backdrop(shared), floorTop(shared, floorGeo), floorUnder(shared, floorGeo), new Mesh(holeEdge(), giltMat), bowl(shared, hen), column(shared)];
  meshes[3]!.frustumCulled = false;

  // the nest's lip: a gilt rim round the bowl, nearly flush with the floor
  const lipGeo = new TorusGeometry(LIP_R, 0.17, 12, 192);
  lipGeo.rotateX(Math.PI / 2);
  const lip = new Mesh(lipGeo, gilt(shared, 1.1));
  lip.position.set(hen.x, FLOOR_Y + 0.08, hen.z);

  // the portal: an upright wall just inside the lip, hidden by her skirt until she lifts
  const wallGeo = new CylinderGeometry(WALL_R, WALL_R, 1, 160, 1, true);
  wallGeo.translate(0, 0.5, 0);
  const portal = new Mesh(wallGeo, portalMaterial);
  portal.position.set(hen.x, FLOOR_Y + 0.1, hen.z);
  portal.visible = false;

  return {
    meshes,
    lip,
    portal,
    dispose() {
      for (const m of [...meshes, lip]) {
        m.geometry.dispose();
        (m.material as Material).dispose();
      }
      wallGeo.dispose();
    },
  };
}
