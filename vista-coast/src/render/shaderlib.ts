// Shared shader uniforms and material patches (wet roads, wind sway, translucency,
// procedural building facades with lit windows at night).

import * as THREE from 'three';

export const U = {
  uTime: { value: 0 },
  uWet: { value: 0 },
  uNight: { value: 0 },
  uWind: { value: 0.25 },
  uRain: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.3) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uPuddle: { value: null as THREE.Texture | null },
  uFlash: { value: 0 },
};

const WPOS_VERT_DECL = 'varying vec3 vWPos;\n';
const WPOS_VERT = `
  {
    vec4 wpw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wpw = instanceMatrix * wpw;
    #endif
    vWPos = (modelMatrix * wpw).xyz;
  }
`;

type Shader = THREE.WebGLProgramParametersWithUniforms;

function addWorldPos(shader: Shader): void {
  shader.vertexShader = WPOS_VERT_DECL + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + WPOS_VERT);
  shader.fragmentShader = 'varying vec3 vWPos;\n' + shader.fragmentShader;
}

let patchId = 0;

/**
 * Wet-surface patch: darker albedo, glossy puddles when raining.
 * strength: how much the surface collects water (roads 1, sidewalks 0.6).
 */
export function patchWet(mat: THREE.MeshStandardMaterial, strength = 1): void {
  const id = patchId++;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms['uWet'] = U.uWet;
    shader.uniforms['uPuddle'] = U.uPuddle;
    shader.uniforms['uRain'] = U.uRain;
    shader.uniforms['uTime'] = U.uTime;
    addWorldPos(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uWet; uniform float uRain; uniform float uTime; uniform sampler2D uPuddle;
float wetMaskF(vec3 p) {
  float n = texture2D(uPuddle, p.xz / 23.0).r * 0.65 + texture2D(uPuddle, p.xz / 7.0 + 0.3).g * 0.35;
  return smoothstep(0.52, 0.62, n);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float wetAmt = uWet * ${strength.toFixed(2)};
  float puddle = wetMaskF(vWPos) * wetAmt;
  diffuseColor.rgb *= mix(1.0, 0.58, wetAmt) * mix(1.0, 0.75, puddle);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.32, wetAmt * 0.85);
  roughnessFactor = mix(roughnessFactor, 0.09, puddle);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  // raindrop ripples flatten into puddles: blend normal toward geometric up
  normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), puddle * 0.85));`,
      );
  };
  mat.customProgramCacheKey = () => 'wet' + strength.toFixed(2) + (mat.normalMap ? 'n' : '') + id % 1;
}

/**
 * Wind sway for instanced vegetation. Vertices sway proportionally to height^2.
 * `stiff` scales amplitude; `height` normalises (model-space tree height).
 */
export function patchWind(mat: THREE.Material, height: number, amp: number, translucent: boolean): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms['uTime'] = U.uTime;
    shader.uniforms['uWind'] = U.uWind;
    shader.uniforms['uSunDir'] = U.uSunDir;
    shader.uniforms['uSunColor'] = U.uSunColor;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime; uniform float uWind;
varying float vSway;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  {
    float hN = clamp(position.y / ${height.toFixed(2)}, 0.0, 1.5);
    vec3 basePos = vec3(0.0);
    #ifdef USE_INSTANCING
      basePos = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
    #endif
    float ph = basePos.x * 0.07 + basePos.z * 0.05;
    float w = (0.35 + uWind) * ${amp.toFixed(3)};
    float s1 = sin(uTime * (1.1 + uWind) + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25;
    float flutter = sin(uTime * 7.0 + position.x * 3.0 + position.z * 2.0 + ph) * 0.06 * hN;
    float k = hN * hN * w;
    transformed.x += (s1 + 0.6 * uWind) * k + flutter * w;
    transformed.z += (sin(uTime * 0.9 + ph * 1.3) * 0.4) * k + flutter * w * 0.6;
    vSway = hN;
  }`,
      );
    if (translucent) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 uSunDir; uniform vec3 uSunColor;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `
  {
    // light passing through leaves when looking toward the sun
    vec3 vdir = normalize(-vViewPosition);
    vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    float back = pow(clamp(dot(-vdir, sunV), 0.0, 1.0), 3.0);
    outgoingLight += diffuseColor.rgb * uSunColor * back * 0.55 * clamp(uSunDir.y * 3.0, 0.0, 1.0);
  }
#include <opaque_fragment>`,
        );
    }
  };
  mat.customProgramCacheKey = () => 'wind' + height.toFixed(1) + amp.toFixed(2) + (translucent ? 't' : '');
}

/**
 * Procedural facade: windows grid, frames, floor lines, lit windows at night.
 * Geometry carries attribute `aFacade` = (style, seed, floorH, winW) and uses world-space UVs.
 * style: 0 glass curtain, 1 office punched, 2 stucco, 3 brick, 4 industrial, 5 house, 6 villa, 7 shopfront/poi
 */
export function makeFacadeMaterial(grime: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uNight'] = U.uNight;
    shader.uniforms['uGrime'] = { value: grime };
    shader.uniforms['uWet'] = U.uWet;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aFacade;
attribute vec3 aLocal; // (u along wall in m, v height in m, wall normal kind: 0 wall 1 roof)
varying vec4 vFacade;
varying vec3 vLocal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  vFacade = aFacade;
  vLocal = aLocal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uNight; uniform sampler2D uGrime; uniform float uWet;
varying vec4 vFacade;
varying vec3 vLocal;
float fhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float facadeWin; float facadeLit; float facadeFrame; float facadeGlass; float facadeBlind; float facadeMetal;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  {
    float style = floor(vFacade.x + 0.5);
    float seed = vFacade.y;
    float floorH = vFacade.z;
    float winW = vFacade.w;
    float u = vLocal.x;
    float v = vLocal.y;
    float isRoof = step(0.5, vLocal.z);
    float g = texture2D(uGrime, vec2(u, v) / 9.0).r;
    float gFine = texture2D(uGrime, vec2(u, v) / 2.3).r;
    // ground floor is grimier (water staining, dirt)
    float groundGrime = (1.0 - smoothstep(0.0, 3.0, v)) * 0.4;
    g = clamp(g - gFine * 0.15 - groundGrime, 0.0, 1.0);
    diffuseColor.rgb *= mix(1.0, g, 0.7);
    facadeWin = 0.0; facadeLit = 0.0; facadeFrame = 0.0; facadeGlass = 0.0; facadeBlind = 0.0; facadeMetal = 0.0;
    if (isRoof < 0.5) {
      float fl = floor(v / floorH);
      float fv = fract(v / floorH);
      float col = floor(u / winW);
      float fu = fract(u / winW);
      float groundFloor = step(fl, 0.5);
      if (style < 0.5) {
        // curtain wall: glass with thin mullions and spandrel bands
        float mull = step(fu, 0.04) + step(0.96, fu);
        float band = step(fv, 0.12);
        facadeFrame = clamp(mull + band, 0.0, 1.0);
        facadeGlass = 1.0 - facadeFrame;
        facadeWin = facadeGlass;
      } else if (style < 5.5 || style > 6.5) {
        float wx = (style < 1.5) ? 0.62 : (style < 2.5 ? 0.42 : (style < 3.5 ? 0.38 : 0.25));
        float wy = (style < 1.5) ? 0.55 : (style < 2.5 ? 0.45 : (style < 3.5 ? 0.5 : 0.25));
        float inX = step(abs(fu - 0.5), wx * 0.5);
        float inY = step(abs(fv - 0.55), wy * 0.5);
        float win = inX * inY;
        // interior blinds in some windows (height varies per window)
        float wr0 = fhash(vec2(col * 1.31, fl * 0.77) + seed * 5.1);
        float winV = (fv - (0.55 - wy * 0.5)) / max(wy, 0.01);
        facadeBlind = step(0.68, wr0) * step(1.0 - (0.25 + 0.6 * fract(wr0 * 7.0)), winV);
        if (style > 3.5 && style < 4.5) win *= step(0.6, fhash(vec2(col, fl) + seed)) * step(0.7, fv);
        if (style > 4.5 && style < 5.5) win *= step(0.35, fhash(vec2(col * 1.7, fl) + seed));
        // storefront on the ground floor
        if (style > 6.5 || (groundFloor > 0.5 && (style < 2.5 || style > 6.5))) {
          float sf = step(0.18, fv) * step(fv, 0.86) * step(0.05, fu) * step(fu, 0.95);
          win = groundFloor > 0.5 ? sf : win;
        }
        float frameX = step(abs(fu - 0.5), wx * 0.5 + 0.03) * step(abs(fv - 0.55), wy * 0.5 + 0.035);
        facadeFrame = frameX - win;
        facadeWin = win;
        facadeBlind *= win;
        facadeGlass = win * (1.0 - facadeBlind);
        // sill shadow under each window
        diffuseColor.rgb *= 1.0 - 0.25 * inX * step(abs(fv - (0.55 - wy * 0.5) + 0.05), 0.04);
      } else {
        // villa: big glass bands
        float win = step(0.25, fv) * step(fv, 0.9) * step(0.08, fu) * step(fu, 0.92);
        facadeWin = win;
        facadeGlass = win;
      }
      float r = fhash(vec2(col, fl) + seed * 3.17);
      float on = step(0.45, r) * uNight + step(0.93, r) * 0.3;
      if (groundFloor > 0.5) on = max(on, uNight * step(0.35, r) * 0.8);
      facadeLit = facadeWin * on;
      float wr = fhash(vec2(col * 0.91, fl * 1.37) + seed * 2.3);
      vec3 glassCol = (style < 0.5) ? diffuseColor.rgb * vec3(0.55, 0.65, 0.72) : mix(vec3(0.06, 0.08, 0.1), vec3(0.2, 0.24, 0.28), wr);
      facadeMetal = (style < 0.5) ? 0.85 : 0.55;
      vec3 frameCol = (style < 0.5) ? vec3(0.15, 0.16, 0.17) : diffuseColor.rgb * 0.75;
      diffuseColor.rgb = mix(diffuseColor.rgb, frameCol, clamp(facadeFrame, 0.0, 1.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, facadeGlass);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.76, 0.7), facadeBlind);
      // horizontal floor lines for concrete styles
      if (style > 0.5 && style < 4.5) diffuseColor.rgb *= 1.0 - 0.18 * step(fv, 0.05);
    } else {
      diffuseColor.rgb *= 0.82;
    }
    diffuseColor.rgb *= mix(1.0, 0.72, uWet * (1.0 - facadeGlass));
  }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, 0.05, facadeGlass);
  roughnessFactor = mix(roughnessFactor, 0.7, facadeBlind);
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.6, uWet);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
  metalnessFactor = mix(metalnessFactor, facadeMetal, facadeGlass);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    float tint = fhash(vec2(floor(vLocal.x / vFacade.w), floor(vLocal.y / vFacade.z)) + vFacade.y);
    vec3 warm = mix(vec3(1.0, 0.78, 0.48), vec3(0.85, 0.92, 1.0), step(0.7, tint));
    float gf = step(floor(vLocal.y / vFacade.z), 0.5);
    // interior light falls off toward the top of each window; storefronts slightly dimmer and warmer
    float fvv = fract(vLocal.y / vFacade.z);
    float grad = mix(1.0, 0.55, smoothstep(0.3, 0.9, fvv));
    totalEmissiveRadiance += mix(warm * (0.9 + tint * 0.8), vec3(1.0, 0.78, 0.52) * 0.6, gf) * facadeLit * grad;
  }`,
      );
  };
  mat.customProgramCacheKey = () => 'facade-v4';
  return mat;
}
