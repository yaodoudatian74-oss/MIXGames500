// Atmosphere: physically based sky (Preetham), sun/moon lighting, stars,
// animated cloud layer, fog and image-based lighting from the sky.

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math';
import { U } from './shaderlib';

/** Sky colour keyframes by sun elevation (sunDir.y). Linear HDR colours. */
interface SkyKey {
  e: number;
  zen: [number, number, number];
  hor: [number, number, number];
  horSun: [number, number, number];
  sun: [number, number, number];
  glow: number;
}
const SKY_KEYS: SkyKey[] = [
  { e: -0.3, zen: [0.002, 0.004, 0.012], hor: [0.008, 0.012, 0.026], horSun: [0.01, 0.014, 0.03], sun: [0, 0, 0], glow: 0 },
  { e: -0.08, zen: [0.018, 0.032, 0.085], hor: [0.07, 0.065, 0.11], horSun: [0.36, 0.17, 0.11], sun: [0.4, 0.15, 0.06], glow: 0.35 },
  { e: 0.0, zen: [0.08, 0.15, 0.36], hor: [0.44, 0.33, 0.37], horSun: [1.35, 0.56, 0.22], sun: [1.7, 0.62, 0.24], glow: 1.0 },
  { e: 0.1, zen: [0.13, 0.27, 0.62], hor: [0.62, 0.6, 0.64], horSun: [1.3, 0.86, 0.5], sun: [1.7, 1.05, 0.6], glow: 0.8 },
  { e: 0.3, zen: [0.12, 0.31, 0.8], hor: [0.6, 0.73, 0.92], horSun: [0.9, 0.88, 0.86], sun: [1.7, 1.58, 1.4], glow: 0.5 },
  { e: 1.0, zen: [0.09, 0.27, 0.78], hor: [0.55, 0.7, 0.93], horSun: [0.78, 0.84, 0.93], sun: [1.7, 1.62, 1.5], glow: 0.4 },
];

function sampleKeys(e: number, out: SkyKey): void {
  let a = SKY_KEYS[0] as SkyKey;
  let b = a;
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const k0 = SKY_KEYS[i] as SkyKey;
    const k1 = SKY_KEYS[i + 1] as SkyKey;
    a = k0;
    b = k1;
    if (e <= k1.e) break;
  }
  const t = clamp((e - a.e) / Math.max(1e-4, b.e - a.e), 0, 1);
  const mix3 = (p: number[], q: number[], o: number[]): void => {
    for (let i = 0; i < 3; i++) o[i] = lerp(p[i] as number, q[i] as number, t);
  };
  mix3(a.zen, b.zen, out.zen);
  mix3(a.hor, b.hor, out.hor);
  mix3(a.horSun, b.horSun, out.horSun);
  mix3(a.sun, b.sun, out.sun);
  out.glow = lerp(a.glow, b.glow, t);
}

const SKY_VERT = `varying vec3 vDir; void main(){ vDir = position; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w * 0.99999; }`;
const SKY_FRAG = `
uniform vec3 uSunDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uHorizonSun; uniform vec3 uSunCol; uniform vec3 uGround;
uniform float uGlow; uniform float uCloud; uniform float uDisc;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float sd = dot(d, uSunDir);
  float sunSide = pow(clamp(sd * 0.5 + 0.5, 0.0, 1.0), 3.0);
  vec3 hor = mix(uHorizon, uHorizonSun, sunSide);
  float t = pow(1.0 - clamp(y, 0.0, 1.0), 5.0);
  vec3 col = mix(uZenith, hor, t);
  // thin bright band right at the horizon
  col += hor * 0.25 * pow(1.0 - clamp(abs(y) * 8.0, 0.0, 1.0), 2.0);
  if (y < 0.0) col = mix(hor, uGround, clamp(-y * 5.0, 0.0, 1.0));
  float s = clamp(sd, 0.0, 1.0);
  col += uSunCol * (pow(s, 600.0) * 1.2 + pow(s, 40.0) * 0.32 + pow(s, 6.0) * 0.12) * uGlow * (1.0 - uCloud * 0.7);
  // sun disc
  col += uSunCol * smoothstep(0.99955, 0.9997, sd) * 18.0 * uDisc * (1.0 - uCloud) * step(-0.02, y);
  // overcast: flatten toward grey
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(l) * vec3(0.92, 0.95, 1.0) * mix(1.0, 0.85, uCloud), uCloud * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeSkyMaterial(uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
}

export interface AtmosphereState {
  sunDir: THREE.Vector3;
  night: number;
  cloud: number;
  rain: number;
  fog: number;
  flash: number;
}

export class Atmosphere {
  readonly sky: THREE.Mesh;
  readonly skyU: Record<string, THREE.IUniform> = {
    uSunDir: U.uSunDir,
    uZenith: { value: new THREE.Color(0.1, 0.3, 0.8) },
    uHorizon: { value: new THREE.Color(0.6, 0.7, 0.9) },
    uHorizonSun: { value: new THREE.Color(0.8, 0.8, 0.85) },
    uSunCol: { value: new THREE.Color(1.6, 1.5, 1.4) },
    uGround: { value: new THREE.Color(0.12, 0.12, 0.12) },
    uGlow: { value: 0.5 },
    uCloud: { value: 0 },
    uDisc: { value: 1 },
  };
  private key: SkyKey = { e: 0, zen: [0, 0, 0], hor: [0, 0, 0], horSun: [0, 0, 0], sun: [0, 0, 0], glow: 0 };
  private tmpC = new THREE.Color();
  private c2 = new THREE.Color();
  private sunColTmp = new THREE.Color();
  private skyTintTmp = new THREE.Color();
  private moonDir = new THREE.Vector3();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly fog: THREE.FogExp2;
  private stars: THREE.Points;
  private moon: THREE.Mesh;
  private clouds: THREE.Mesh;
  private cloudMat: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private envScene: THREE.Scene;
  private envSky: THREE.Mesh;
  private envGround: THREE.Mesh;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private envTimer = 0;
  private lastEnvSun = new THREE.Vector3();
  private lastEnvCloud = -1;
  readonly group = new THREE.Group();
  envIntensity = 1;
  shadowTarget = new THREE.Object3D();

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    cloudNoise: THREE.Texture,
    shadowMapSize: number,
  ) {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), makeSkyMaterial(this.skyU));
    this.sky.scale.setScalar(5500);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -3;
    this.group.add(this.sky);

    // sun
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = shadowMapSize > 0;
    if (shadowMapSize > 0) {
      this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      const cam = this.sun.shadow.camera;
      cam.near = 1;
      cam.far = 900;
      this.setShadowExtent(130);
      this.sun.shadow.bias = -0.00035;
      this.sun.shadow.normalBias = 0.6;
      this.sun.shadow.radius = 2;
    }
    this.sun.target = this.shadowTarget;
    scene.add(this.sun);
    scene.add(this.shadowTarget);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a5040, 0.6);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x223044, 0.0);
    scene.add(this.ambient);

    // stars
    const starGeo = new THREE.BufferGeometry();
    const N = 2600;
    const pos = new Float32Array(N * 3);
    const size = new Float32Array(N);
    let s = 7;
    const rnd = (): number => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * r * 5000;
      pos[i * 3 + 1] = Math.abs(u) * 5000;
      pos[i * 3 + 2] = Math.sin(a) * r * 5000;
      size[i] = 1 + Math.pow(rnd(), 6) * 3;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const starMat = new THREE.ShaderMaterial({
      uniforms: { uNight: U.uNight, uCloud: { value: 0 }, uTime: U.uTime },
      vertexShader: `attribute float aSize; varying float vTw; uniform float uTime;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w * 0.99998;
        vTw = 0.7 + 0.3 * sin(uTime * 2.0 + position.x * 0.13);
        gl_PointSize = aSize * 1.6; }`,
      fragmentShader: `uniform float uNight; uniform float uCloud; varying float vTw;
        void main(){ vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d));
        gl_FragColor = vec4(vec3(1.0), a * uNight * (1.0 - uCloud) * vTw); }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -2;
    this.group.add(this.stars);

    // moon
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xf2f0e6, fog: false, transparent: true });
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(30, 32), moonMat);
    this.group.add(this.moon);

    // clouds: a big dome with noise-based coverage, lit by the sun
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: cloudNoise },
        uTime: U.uTime,
        uCover: { value: 0.3 },
        uSunDir: U.uSunDir,
        uSunCol: { value: new THREE.Color(1, 1, 1) },
        uSkyCol: { value: new THREE.Color(0.6, 0.7, 0.85) },
        uNight: U.uNight,
        uFlash: U.uFlash,
        uWind: U.uWind,
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w * 0.99997; }`,
      fragmentShader: `
        uniform sampler2D uNoise; uniform float uTime; uniform float uCover; uniform vec3 uSunDir;
        uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform float uNight; uniform float uFlash; uniform float uWind;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          if (d.y < 0.005) discard;
          vec2 uv = d.xz / (d.y + 0.08) * 0.22;
          vec2 drift = vec2(uTime * (0.004 + uWind * 0.01), uTime * 0.0015);
          float n1 = texture2D(uNoise, uv + drift).r;
          float n2 = texture2D(uNoise, uv * 2.7 - drift * 1.6).g;
          float n3 = texture2D(uNoise, uv * 7.1 + drift * 2.3).b;
          float n = n1 * 0.62 + n2 * 0.28 + n3 * 0.1;
          float cov = mix(0.72, 0.28, uCover);
          float dens = smoothstep(cov, cov + 0.22, n);
          // thickness shading: thicker = darker underside
          float thick = smoothstep(cov, cov + 0.5, n);
          float sunAmt = clamp(dot(normalize(vec3(d.x, d.y + 0.2, d.z)), uSunDir) * 0.5 + 0.5, 0.0, 1.0);
          float silver = pow(clamp(dot(d, uSunDir), 0.0, 1.0), 8.0) * (1.0 - thick) * 1.6;
          vec3 lit = uSunCol * (0.75 + 0.5 * sunAmt) + silver * uSunCol;
          vec3 shade = mix(uSkyCol * 0.85, vec3(0.32, 0.34, 0.38), uCover);
          vec3 col = mix(lit, shade * (0.55 + 0.45 * sunAmt), thick * (0.35 + 0.55 * uCover));
          col = mix(col, vec3(0.03, 0.035, 0.05), uNight * 0.92);
          col += vec3(0.8, 0.85, 1.0) * uFlash * thick * 2.0;
          float horizonFade = smoothstep(0.0, 0.12, d.y);
          gl_FragColor = vec4(col, dens * horizonFade * mix(0.92, 1.0, uCover));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5), this.cloudMat);
    this.clouds.renderOrder = -1;
    this.clouds.frustumCulled = false;
    this.group.add(this.clouds);
    scene.add(this.group);

    this.fog = new THREE.FogExp2(0xbfd0e0, 0.00022);
    scene.fog = this.fog;

    // environment (IBL) scene: same sky + dark ground
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), makeSkyMaterial(this.skyU));
    this.envScene.add(this.envSky);
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(800, 32), new THREE.MeshBasicMaterial({ color: 0x3a3a38 }));
    this.envGround.rotation.x = -Math.PI / 2;
    this.envGround.position.y = -40;
    this.envScene.add(this.envGround);
    const envClouds = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), this.cloudMat);
    this.envScene.add(envClouds);
  }

  setShadowExtent(half: number): void {
    const cam = this.sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.updateProjectionMatrix();
  }

  /** Per-frame update. focus = point the shadow box follows (player). */
  update(dt: number, st: AtmosphereState, camera: THREE.Camera, focus: THREE.Vector3): void {
    const sunDir = st.sunDir;
    U.uSunDir.value.copy(sunDir);
    const elev = sunDir.y;
    const day = smoothstep(-0.12, 0.12, elev);
    const golden = 1 - smoothstep(0.05, 0.35, elev);
    // sky colours from elevation keyframes
    const k = this.key;
    sampleKeys(elev, k);
    const su = this.skyU;
    (su['uZenith']!.value as THREE.Color).setRGB(k.zen[0], k.zen[1], k.zen[2]);
    (su['uHorizon']!.value as THREE.Color).setRGB(k.hor[0], k.hor[1], k.hor[2]);
    (su['uHorizonSun']!.value as THREE.Color).setRGB(k.horSun[0], k.horSun[1], k.horSun[2]);
    (su['uSunCol']!.value as THREE.Color).setRGB(k.sun[0], k.sun[1], k.sun[2]);
    su['uGlow']!.value = k.glow;
    su['uCloud']!.value = clamp(st.cloud * 0.95 + st.fog * 0.5, 0, 1);
    const gl = 0.06 + day * 0.08;
    (su['uGround']!.value as THREE.Color).setRGB(gl * 0.9, gl * 0.95, gl);
    // follow camera
    this.sky.position.copy(camera.position);
    this.sky.updateMatrixWorld();
    this.clouds.position.set(camera.position.x, 0, camera.position.z);
    this.stars.position.copy(camera.position);
    // moon opposite the sun
    const moonDir = this.moonDir.set(-sunDir.x, Math.abs(-sunDir.y) * 0.8 + 0.15, -sunDir.z).normalize();
    this.moon.position.copy(camera.position).addScaledVector(moonDir, 2000);
    this.moon.lookAt(camera.position);
    (this.moon.material as THREE.MeshBasicMaterial).opacity = st.night * (1 - st.cloud * 0.9);
    ((this.stars.material as THREE.ShaderMaterial).uniforms['uCloud'] as THREE.IUniform<number>).value = clamp(st.cloud * 1.1, 0, 1);

    // sun light colour: white at noon, orange at golden hour, moon blue at night
    const sunCol = this.sunColTmp.setRGB(1.0, lerp(0.95, 0.55, golden), lerp(0.9, 0.32, golden));
    const overcast = st.cloud;
    const sunI = day * lerp(3.7, 0.55, overcast * overcast) * (1 - golden * 0.2);
    if (elev > -0.05) {
      this.sun.position.copy(focus).addScaledVector(sunDir, 400);
      this.sun.color.copy(sunCol);
      this.sun.intensity = sunI;
    } else {
      this.sun.position.copy(focus).addScaledVector(moonDir, 400);
      this.sun.color.setRGB(0.55, 0.65, 0.95);
      this.sun.intensity = 0.28 * (1 - overcast * 0.7);
    }
    U.uSunColor.value.copy(this.sun.color).multiplyScalar(Math.min(1, this.sun.intensity / 2.5));
    // stable shadows: snap the shadow camera to texel grid
    const half = (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / 2;
    const texel = (half * 2) / Math.max(1, this.sun.shadow.mapSize.x);
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.shadowTarget.position.set(fx, focus.y, fz);
    this.sun.position.x += fx - focus.x;
    this.sun.position.z += fz - focus.z;
    this.shadowTarget.updateMatrixWorld();

    // hemisphere fill
    const skyTint = this.skyTintTmp.setRGB(lerp(0.55, 0.9, golden * 0.6), lerp(0.7, 0.72, golden), lerp(0.95, 0.65, golden));
    this.hemi.color.copy(skyTint).lerp(this.c2.setRGB(0.6, 0.63, 0.68), overcast);
    this.hemi.groundColor.setRGB(0.36, 0.32, 0.27);
    // sky fill stays well below the sun so shadows read; overcast days lean on the fill
    this.hemi.intensity = lerp(0.05, 0.42, day) * lerp(1, lerp(1.2, 2.0, day), overcast);
    this.ambient.intensity = st.night * 0.2 + st.flash * 3;
    this.ambient.color.setRGB(0.25, 0.32, 0.48);

    // fog: colour roughly matches the horizon
    const horizon = this.tmpC.setRGB(lerp(k.hor[0], k.horSun[0], 0.3), lerp(k.hor[1], k.horSun[1], 0.3), lerp(k.hor[2], k.horSun[2], 0.3));
    const hl = horizon.r * 0.2126 + horizon.g * 0.7152 + horizon.b * 0.0722;
    horizon.lerp(this.c2.setRGB(hl * 0.92, hl * 0.95, hl), overcast * 0.85);
    horizon.lerp(this.c2.setRGB(0.75, 0.8, 0.9), st.flash * 0.6);
    this.fog.color.copy(horizon);
    this.fog.density = 0.00016 + st.fog * 0.0028 + st.rain * 0.0009;

    // clouds
    const cu = this.cloudMat.uniforms;
    (cu['uCover'] as THREE.IUniform<number>).value = st.cloud;
    (cu['uSunCol'] as THREE.IUniform<THREE.Color>).value.copy(sunCol).multiplyScalar(lerp(0.35, 1.25, day));
    (cu['uSkyCol'] as THREE.IUniform<THREE.Color>).value.copy(skyTint);

    // environment map refresh (throttled)
    this.envTimer -= dt;
    const moved = this.lastEnvSun.distanceTo(sunDir) > 0.03 || Math.abs(this.lastEnvCloud - st.cloud) > 0.06;
    if (this.envTimer <= 0 && moved) {
      this.envTimer = 3;
      this.refreshEnv(st);
    }
    this.envIntensity = lerp(0.1, lerp(0.6, 0.95, overcast), day) * (1 - st.night * 0.6);
  }

  refreshEnv(st: AtmosphereState): void {
    this.lastEnvSun.copy(st.sunDir);
    this.lastEnvCloud = st.cloud;
    const day = smoothstep(-0.12, 0.12, st.sunDir.y);
    // env 'ground' = hazy horizon tone so downward reflections (water, glass) are never black
    const k = this.key;
    (this.envGround.material as THREE.MeshBasicMaterial).color.setRGB(k.hor[0] * 0.55 + 0.01 * day, k.hor[1] * 0.55 + 0.01 * day, k.hor[2] * 0.55 + 0.01 * day);
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
    this.scene.environment = this.envTarget.texture;
    if (old) old.dispose();
  }

  dispose(): void {
    this.pmrem.dispose();
    this.envTarget?.dispose();
  }
}
