import * as THREE from 'three';

/**
 * @module vfx/ShellCasings
 * @description Spent brass out of the ejection port.
 *
 * One instanced mesh for the whole fight: a short capped cylinder, brass, that is
 * thrown out to the right and up, tumbles, falls under gravity, bounces once or
 * twice on the floor and lies there a moment before the slot is reused. Twenty-four
 * instances cover a long automatic burst; past that the oldest casing is recycled,
 * which nobody sees because it is on the floor behind the player by then.
 *
 * Presentation only. Nothing here touches the sim, the shot, or the ammunition.
 */

const CAP = 24;
const LIFE = 2.6;
const GRAVITY = -9.8;
const FLOOR = 0.012;

export class ShellCasings {
  readonly mesh: THREE.InstancedMesh;
  private readonly px = new Float32Array(CAP); private readonly py = new Float32Array(CAP); private readonly pz = new Float32Array(CAP);
  private readonly vx = new Float32Array(CAP); private readonly vy = new Float32Array(CAP); private readonly vz = new Float32Array(CAP);
  private readonly age = new Float32Array(CAP).fill(Infinity);
  private readonly rot: THREE.Quaternion[] = Array.from({ length: CAP }, () => new THREE.Quaternion());
  private readonly spin: THREE.Vector3[] = Array.from({ length: CAP }, () => new THREE.Vector3());
  private head = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly p = new THREE.Vector3();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  /** Floor height under a casing (decks and stairs); defaults to the ground. */
  floorAt: (x: number, z: number) => number = () => 0;

  constructor() {
    // 5.56-ish: 45 mm long, 9.5 mm across, along +Y. Low segment counts: it is a glint.
    this.geometry = new THREE.CylinderGeometry(0.0045, 0.0048, 0.045, 8, 1);
    this.material = new THREE.MeshStandardMaterial({ color: '#c9a04a', metalness: 0.95, roughness: 0.28, envMapIntensity: 1.6 });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CAP);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = CAP;
    this.hideAll();
  }

  private hideAll() {
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < CAP; i++) this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Throw one casing. `right`, `up` and `fwd` are the weapon's axes in world space;
   * `power` scales the throw (a battle rifle flings harder than a pistol).
   */
  eject(at: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3, power = 1) {
    const i = this.head; this.head = (this.head + 1) % CAP;
    this.px[i] = at.x; this.py[i] = at.y; this.pz[i] = at.z;
    const r = (1.9 + Math.random() * 1.1) * power, u = (1.6 + Math.random() * 1.0) * power, f = (Math.random() - 0.3) * 0.6;
    this.vx[i] = right.x * r + up.x * u + fwd.x * f;
    this.vy[i] = right.y * r + up.y * u + fwd.y * f;
    this.vz[i] = right.z * r + up.z * u + fwd.z * f;
    this.age[i] = 0;
    // Start aligned with the barrel and tumble end over end.
    this.rot[i].setFromUnitVectors(new THREE.Vector3(0, 1, 0), fwd);
    this.spin[i].set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 30);
  }

  update(dt: number) {
    const d = Math.min(dt, 0.05);
    let any = false;
    for (let i = 0; i < CAP; i++) {
      if (this.age[i] >= LIFE) continue;
      any = true;
      this.age[i] += d;
      if (this.age[i] >= LIFE) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this.m); continue; }
      this.vy[i] += GRAVITY * d;
      this.px[i] += this.vx[i] * d; this.py[i] += this.vy[i] * d; this.pz[i] += this.vz[i] * d;
      const floor = this.floorAt(this.px[i], this.pz[i]) + FLOOR;
      if (this.py[i] < floor) {
        this.py[i] = floor;
        if (this.vy[i] < -0.4) { this.vy[i] *= -0.32; this.vx[i] *= 0.55; this.vz[i] *= 0.55; this.spin[i].multiplyScalar(0.4); }
        else { this.vy[i] = 0; this.vx[i] *= 0.8; this.vz[i] *= 0.8; this.spin[i].multiplyScalar(0.6); }
      }
      const sp = this.spin[i];
      if (sp.lengthSq() > 1e-4) {
        this.q.setFromEuler(new THREE.Euler(sp.x * d, sp.y * d, sp.z * d));
        this.rot[i].multiply(this.q);
      }
      // Fade by shrinking in the last quarter second so a casing never pops out.
      const k = Math.min(1, (LIFE - this.age[i]) / 0.25);
      this.s.setScalar(k);
      this.p.set(this.px[i], this.py[i], this.pz[i]);
      this.m.compose(this.p, this.rot[i], this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
