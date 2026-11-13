import { DataTexture, DoubleSide, RGBAFormat, ShaderMaterial, Vector2, type Texture } from "three";

export const blackTexture = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat);
blackTexture.needsUpdate = true;

/**
 * Samples a render target in *screen space*: whatever mesh wears this material becomes a
 * window onto the other scene. Because the lookup ignores the mesh's own UVs, the image seen
 * through the window is pixel-identical to the other scene rendered fullscreen, which is what
 * makes flying through it a seamless cut.
 *
 * It copies linear HDR to linear HDR. Both scenes are drawn into float targets and the director's
 * final pass (post.ts) turns the finished frame into a picture, so the window gets exactly the
 * treatment the scene behind it will get once it owns the screen.
 */
export function createPortalMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      map: { value: blackTexture as Texture },
      resolution: { value: new Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec2 resolution;
      void main() {
        vec2 uv = gl_FragCoord.xy / resolution;
        gl_FragColor = vec4(texture2D(map, uv).rgb, 1.0);
      }
    `,
    fog: false,
    side: DoubleSide,
  });
}
