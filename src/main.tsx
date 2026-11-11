import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { Director } from "./director/Director";

createRoot(document.getElementById("root")!).render(
  <Canvas dpr={[1, 2]} gl={{ antialias: true, powerPreference: "high-performance" }}>
    <Director />
  </Canvas>,
);
