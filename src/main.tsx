import { createRoot, extend } from "@react-three/fiber";
import {
  AmbientLight,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  PlaneGeometry,
  Points,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
} from "three";
import { Director } from "./director/Director";

// r3f's <Canvas> registers the whole of three.js for JSX, which keeps every class in the bundle.
// Registering only what the scenes write as JSX lets the bundler drop the rest. A scene that
// uses a new lower-case element (<boxGeometry>, <pointLight>, ...) has to add its class here.
extend({
  AmbientLight,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  PlaneGeometry,
  Points,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
});

const canvas = document.createElement("canvas");
document.getElementById("root")!.append(canvas);
const root = createRoot(canvas);

function render() {
  // configure() keeps its own queue, so a resize during start-up cannot overtake the first call
  void root
    .configure({
      dpr: [1, 2],
      gl: { antialias: true, powerPreference: "high-performance" },
      size: { width: window.innerWidth, height: window.innerHeight, top: 0, left: 0 },
    })
    .then(() => root.render(<Director />));
}
window.addEventListener("resize", render);
// Not before the page's first frame: a GL context created earlier than that can be dropped when
// the page is first presented (seen in headless Chrome on ANGLE/Vulkan), and the show would open
// on a lost context.
requestAnimationFrame(render);
