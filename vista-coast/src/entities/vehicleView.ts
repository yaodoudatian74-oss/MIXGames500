// Visual representation of a vehicle: body/glass meshes, steering wheel, wipers,
// headlight beams, interpolated transforms, lights logic and crumple damage.
// Wheels for all vehicles are drawn by one shared instanced pool.

import * as THREE from 'three';
import { clamp } from '../core/math';
import type { VehicleSpec } from '../data/vehicles';
import type { VehicleState } from '../sim/vehiclePhysics';
import { bodyMaterialFor, vehicleGeometry, wheelGeometries, type BodyUniforms, type VehicleGeometry } from './vehicleModel';

export class WheelPool {
  readonly tire: THREE.InstancedMesh;
  readonly rim: THREE.InstancedMesh;
  private n = 0;
  constructor(capacity: number) {
    const g = wheelGeometries();
    this.tire = new THREE.InstancedMesh(g.tire, new THREE.MeshStandardMaterial({ color: 0x151516, roughness: 0.92, metalness: 0 }), capacity);
    this.rim = new THREE.InstancedMesh(g.rim, new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.22, metalness: 1 }), capacity);
    for (const m of [this.tire, this.rim]) {
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
    }
  }
  begin(): void {
    this.n = 0;
  }
  add(m: THREE.Matrix4): void {
    if (this.n >= this.tire.instanceMatrix.count) return;
    this.tire.setMatrixAt(this.n, m);
    this.rim.setMatrixAt(this.n, m);
    this.n++;
  }
  end(): void {
    this.tire.count = this.n;
    this.rim.count = this.n;
    this.tire.instanceMatrix.needsUpdate = true;
    this.rim.instanceMatrix.needsUpdate = true;
  }
}

export interface ViewParams {
  alpha: number;
  night: number;
  braking: boolean;
  reversing: boolean;
  blinker: number;
  hazard: boolean;
  siren: boolean;
  lightsOn: boolean;
  time: number;
  wipers: boolean;
  steer: number;
  detail: boolean; // within 150 m: wheels + glass
  near: boolean; // within ~45 m (or the player's car): steering wheel, wipers, decals
  shadow: boolean; // casts shadows
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);

export class VehicleView {
  readonly group = new THREE.Group();
  readonly body: THREE.Group = new THREE.Group();
  readonly bodyMesh: THREE.Mesh;
  readonly glassMesh: THREE.Mesh;
  readonly geo: VehicleGeometry;
  readonly u: BodyUniforms;
  private steeringWheel: THREE.Mesh;
  private wipers: THREE.Mesh[] = [];
  private decals: THREE.Mesh[] = [];
  private lodNear = true;
  private beams: THREE.Mesh | null = null;
  private ownGeometry = false;
  private deformBase: Float32Array | null = null;
  driverSlot = new THREE.Object3D();
  private wheelSpinVis = 0;

  constructor(
    readonly spec: VehicleSpec,
    paint: number,
    baseBody: THREE.MeshPhysicalMaterial,
    glassMat: THREE.Material,
    shared: { steering: THREE.BufferGeometry; steeringMat: THREE.Material; wiper: THREE.BufferGeometry; wiperMat: THREE.Material; beamGeo: THREE.BufferGeometry; beamMat: THREE.Material; decalMats: Map<string, THREE.Material> },
  ) {
    this.geo = vehicleGeometry(spec);
    const { mat, u } = bodyMaterialFor(baseBody, paint);
    this.u = u;
    this.bodyMesh = new THREE.Mesh(this.geo.body, mat);
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.glassMesh = new THREE.Mesh(this.geo.glass, glassMat);
    this.glassMesh.renderOrder = 3;
    this.body.add(this.bodyMesh, this.glassMesh);
    this.steeringWheel = new THREE.Mesh(shared.steering, shared.steeringMat);
    this.steeringWheel.position.copy(this.geo.steering);
    this.steeringWheel.rotation.x = -1.1;
    this.body.add(this.steeringWheel);
    for (const wp of this.geo.wipers) {
      const w = new THREE.Mesh(shared.wiper, shared.wiperMat);
      w.position.copy(wp);
      this.body.add(w);
      this.wipers.push(w);
    }
    if (this.geo.decal) {
      let dm = shared.decalMats.get(spec.id);
      if (!dm) {
        dm = new THREE.MeshStandardMaterial({ map: this.geo.decal, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
        shared.decalMats.set(spec.id, dm);
      }
      for (const p of this.geo.decalPanels) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), dm);
        m.position.copy(p.pos);
        m.rotation.y = p.rotY;
        this.body.add(m);
        this.decals.push(m);
      }
    }
    if (spec.shape !== 'bike') {
      this.beams = new THREE.Mesh(shared.beamGeo, shared.beamMat);
      this.beams.position.set(0, 0.06, spec.length / 2 + 7);
      this.beams.visible = false;
      this.group.add(this.beams);
    }
    this.driverSlot.position.copy(this.geo.driverPos);
    this.body.add(this.driverSlot);
    this.group.add(this.body);
  }

  update(st: VehicleState, p: ViewParams, wheels: WheelPool): void {
    const a = p.alpha;
    const x = st.px + (st.x - st.px) * a;
    const y = st.py + (st.y - st.py) * a;
    const z = st.pz + (st.z - st.pz) * a;
    let dyaw = st.yaw - st.pyaw;
    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
    if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const yaw = st.pyaw + dyaw * a;
    this.group.position.set(x, y, z);
    this.group.rotation.set(0, yaw, 0);
    this.body.position.y = st.suspension;
    this.body.rotation.set(st.pitch, 0, st.roll);
    // lights
    const u = this.u;
    const lights = p.lightsOn || p.night > 0.3;
    u.uHead.value = lights ? 6 + p.night * 6 : 0.4;
    u.uTail.value = (lights ? 1.8 : 0.15) + (p.braking ? 7 : 0);
    const blinkOn = Math.floor(p.time * 2.6) % 2 === 0;
    u.uIndL.value = (p.blinker < 0 || p.hazard) && blinkOn ? 9 : 0;
    u.uIndR.value = (p.blinker > 0 || p.hazard) && blinkOn ? 9 : 0;
    u.uReverse.value = p.reversing ? 5 : 0;
    if (p.siren) {
      const ph = Math.floor(p.time * 7) % 4;
      u.uSirenR.value = ph === 0 || ph === 2 ? 30 : 0.5;
      u.uSirenB.value = ph === 1 || ph === 3 ? 30 : 0.5;
    } else {
      u.uSirenR.value = 0.15;
      u.uSirenB.value = 0.15;
    }
    u.uDirt.value = clamp(st.damage * 1.2, 0, 1);
    // LOD: fewer draw calls for distant cars
    if (p.near !== this.lodNear) {
      this.lodNear = p.near;
      this.steeringWheel.visible = p.near;
      for (const w of this.wipers) w.visible = p.near;
      for (const d of this.decals) d.visible = p.near;
    }
    this.glassMesh.visible = p.detail;
    this.bodyMesh.castShadow = p.shadow;
    if (this.beams) this.beams.visible = lights && p.night > 0.2 && p.detail;
    // steering wheel and wipers
    this.steeringWheel.rotation.z = -st.steerAngle * 6;
    if (p.wipers) {
      const w = (Math.sin(p.time * 4.2) * 0.5 + 0.5) * 1.6;
      this.wipers.forEach((m, i) => (m.rotation.z = i === 0 ? w : w));
    }
    // wheels via the shared pool
    if (!p.detail) return;
    this.wheelSpinVis = st.wheelSpin;
    this.group.updateMatrixWorld();
    const bodyM = this.group.matrixWorld;
    for (const wh of this.geo.wheels) {
      const steer = wh.front ? st.steerAngle * -1 : 0;
      const bikeLean = this.spec.shape === 'bike' ? st.roll : 0;
      tmpQ.setFromAxisAngle(AY, steer);
      tmpQ2.setFromAxisAngle(AX, this.wheelSpinVis);
      tmpQ.multiply(tmpQ2);
      if (bikeLean !== 0) tmpQ.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), bikeLean));
      tmpV.set(wh.x, wh.r + Math.max(-0.08, Math.min(0.06, -st.suspension * 0.5)), wh.z);
      tmpS.set(wh.w, wh.r, wh.r);
      tmpM.compose(tmpV, tmpQ, tmpS);
      tmpM.premultiply(bodyM);
      wheels.add(tmpM);
    }
  }

  /** Dent the body near a world-space impact point. */
  deform(worldX: number, worldZ: number, amount: number): void {
    if (amount <= 0.02) return;
    if (!this.ownGeometry) {
      this.bodyMesh.geometry = this.bodyMesh.geometry.clone();
      this.ownGeometry = true;
      const p = this.bodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      this.deformBase = new Float32Array(p.array as Float32Array);
    }
    this.group.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(this.bodyMesh.matrixWorld).invert();
    const local = new THREE.Vector3(worldX, this.group.position.y + 0.7, worldZ).applyMatrix4(inv);
    const pos = this.bodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const R = 0.9 + amount * 0.6;
    const cx = 0;
    const cyB = this.spec.height * 0.5;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      const dx = vx - local.x;
      const dz = vz - local.z;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const f = (1 - d / R) * amount * 0.22;
      // push toward the vehicle centre line
      const ix = cx - vx;
      const iy = cyB - vy;
      const iz = -vz * 0.3;
      const il = Math.hypot(ix, iy, iz) || 1;
      pos.setXYZ(i, vx + (ix / il) * f, vy + (iy / il) * f * 0.4, vz + (iz / il) * f);
    }
    pos.needsUpdate = true;
    this.bodyMesh.geometry.computeVertexNormals();
  }

  repair(): void {
    if (this.ownGeometry && this.deformBase) {
      const pos = this.bodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      (pos.array as Float32Array).set(this.deformBase);
      pos.needsUpdate = true;
      this.bodyMesh.geometry.computeVertexNormals();
    }
  }

  setPaint(c: number): void {
    this.u.uPaint.value.setHex(c);
  }

  dispose(): void {
    if (this.ownGeometry) this.bodyMesh.geometry.dispose();
    for (const d of this.decals) d.geometry.dispose(); // per-view livery planes
    (this.bodyMesh.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}

export function makeSharedVehicleParts(lightPool: THREE.Texture): {
  steering: THREE.BufferGeometry;
  steeringMat: THREE.Material;
  wiper: THREE.BufferGeometry;
  wiperMat: THREE.Material;
  beamGeo: THREE.BufferGeometry;
  beamMat: THREE.Material;
  decalMats: Map<string, THREE.Material>;
} {
  const beamGeo = new THREE.PlaneGeometry(8, 15).rotateX(-Math.PI / 2);
  return {
    steering: new THREE.TorusGeometry(0.18, 0.022, 8, 20),
    steeringMat: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.6 }),
    wiper: new THREE.BoxGeometry(0.02, 0.02, 0.55).translate(0, 0, 0.27).rotateX(-0.9).rotateY(Math.PI / 2),
    wiperMat: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
    beamGeo,
    beamMat: new THREE.MeshBasicMaterial({ map: lightPool, color: new THREE.Color(1.0, 0.92, 0.78).multiplyScalar(0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6 }),
    decalMats: new Map(),
  };
}
