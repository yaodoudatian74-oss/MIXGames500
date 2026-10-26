// Post-processing chain: HDR render -> (AO) -> bloom -> ACES tone mapping ->
// cinematic grade (contrast, vignette, grain, chromatic aberration, speed blur,
// rain on lens, damage) -> (DOF) -> FXAA.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { QualitySettings } from './quality';

const CinematicShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 0.16 },
    uGrain: { value: 0.018 },
    uCA: { value: 0.0012 },
    uSpeed: { value: 0 },
    uFlash: { value: 0 },
    uRain: { value: 0 },
    uDamage: { value: 0 },
    uDesat: { value: 0 },
    uContrast: { value: 1.06 },
    uSaturation: { value: 1.14 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uFade: { value: 0 },
    uUnder: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uGrain;
    uniform float uCA; uniform float uSpeed; uniform float uFlash; uniform float uRain; uniform float uDamage;
    uniform float uDesat; uniform float uContrast; uniform float uSaturation; uniform vec3 uTint; uniform float uFade;
    uniform float uUnder; uniform float uAspect;
    varying vec2 vUv;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec2 rainOffset(vec2 uv){
      // a few drops running down the lens
      vec2 off = vec2(0.0);
      if (uRain <= 0.01) return off;
      vec2 g = uv * vec2(uAspect * 9.0, 6.0);
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float r = h21(id);
      float t = fract(uTime * (0.08 + r * 0.12) + r);
      vec2 c = vec2((r - 0.5) * 0.6, 0.5 - t * 1.2);
      float d = length((f - c) * vec2(1.0, 0.7));
      float drop = smoothstep(0.12, 0.0, d) * step(0.55, h21(id + 7.3)) * uRain;
      off += (f - c) * drop * 0.06;
      return off;
    }
    void main(){
      vec2 uv = vUv;
      uv += rainOffset(uv);
      vec2 center = uv - 0.5;
      float dist = length(center);
      vec3 col;
      // speed blur: radial samples
      if (uSpeed > 0.01) {
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 8; i++) {
          float k = float(i) / 7.0;
          float w = 1.0 - k * 0.6;
          acc += texture2D(tDiffuse, uv - center * k * uSpeed * 0.045 * smoothstep(0.1, 0.6, dist)).rgb * w;
          wsum += w;
        }
        col = acc / wsum;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      // chromatic aberration toward the edges
      float ca = uCA * (1.0 + uDamage * 4.0) * dist * 2.0;
      col.r = mix(col.r, texture2D(tDiffuse, uv + center * ca).r, 0.85);
      col.b = mix(col.b, texture2D(tDiffuse, uv - center * ca).b, 0.85);
      // grade
      // contrast around a low pivot keeps shadow detail (no crushed blacks)
      col = max(vec3(0.0), (col - 0.36) * uContrast + 0.36);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation * (1.0 - uDesat));
      col *= uTint;
      col += vec3(0.85, 0.9, 1.0) * uFlash * 0.35;
      if (uUnder > 0.0) col = mix(col, col * vec3(0.25, 0.62, 0.7) + vec3(0.0, 0.05, 0.07), uUnder);
      // vignette (+ red when hurt)
      float vig = smoothstep(0.95, 0.3, dist * (1.0 + uVignette));
      col *= mix(1.0, vig, 0.6);
      col = mix(col, vec3(0.55, 0.0, 0.0), uDamage * smoothstep(0.35, 0.85, dist) * 0.6);
      // film grain
      float gr = h21(uv * vec2(1931.0, 1373.0) + fract(uTime * 7.13)) - 0.5;
      col += gr * uGrain;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

/** Clamps HDR values and removes NaN/Inf (e.g. GGX highlights of lamps on wet asphalt
 * overflowing half-float) so bloom never smears a white-out across the frame. */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uMax: { value: 24 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0);
      // soft-clamp keeps hue of very bright highlights
      float m = max(c.r, max(c.g, c.b));
      if (m > uMax) c.rgb *= uMax / m;
      gl_FragColor = vec4(max(c.rgb, vec3(0.0)), 1.0);
    }`,
};

export class PostFX {
  readonly composer: EffectComposer;
  readonly cinematic: ShaderPass;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass | null = null;
  private ao: GTAOPass | null = null;
  private dof: BokehPass | null = null;
  private fxaa: ShaderPass | null = null;
  private output: OutputPass;
  private w = 1;
  private h = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    q: QualitySettings,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.w = size.x;
    this.h = size.y;
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new ShaderPass(SanitizeShader));
    if (q.ao) {
      this.ao = new GTAOPass(scene, camera, size.x, size.y);
      this.ao.blendIntensity = 0.75;
      this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
      this.composer.addPass(this.ao);
    }
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.4, 1.0);
      this.composer.addPass(this.bloom);
    }
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.cinematic = new ShaderPass(CinematicShader);
    this.composer.addPass(this.cinematic);
    if (q.dof) {
      this.dof = new BokehPass(scene, camera, { focus: 12, aperture: 0.00012, maxblur: 0.006 });
      this.composer.addPass(this.dof);
    }
    if (q.fxaa) {
      this.fxaa = new ShaderPass(FXAAShader);
      this.setFxaaRes();
      this.composer.addPass(this.fxaa);
    }
  }

  private setFxaaRes(): void {
    if (!this.fxaa) return;
    const r = this.fxaa.material.uniforms['resolution'] as THREE.IUniform<THREE.Vector2>;
    r.value.set(1 / this.w, 1 / this.h);
  }

  setCamera(cam: THREE.PerspectiveCamera): void {
    this.renderPass.camera = cam;
    if (this.ao) this.ao.camera = cam;
  }

  resize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.w = size.x;
    this.h = size.y;
    this.composer.setSize(size.x / this.renderer.getPixelRatio(), size.y / this.renderer.getPixelRatio());
    this.setFxaaRes();
    (this.cinematic.uniforms['uAspect'] as THREE.IUniform<number>).value = size.x / Math.max(1, size.y);
  }

  setBloom(strength: number, threshold: number): void {
    if (!this.bloom) return;
    this.bloom.strength = strength;
    this.bloom.threshold = threshold;
  }

  setFocus(dist: number): void {
    if (!this.dof) return;
    const u = this.dof.uniforms as unknown as Record<string, THREE.IUniform<number>>;
    const f = u['focus'];
    if (f) f.value = dist;
  }

  uniform(name: keyof typeof CinematicShader.uniforms): THREE.IUniform {
    return this.cinematic.uniforms[name] as THREE.IUniform;
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
    this.ao?.dispose();
    this.bloom?.dispose();
  }
}
