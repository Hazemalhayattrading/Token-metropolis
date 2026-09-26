/**
 * Camera director: eased, interruptible flights between poses. Any user input
 * on the controls cancels a flight and hands control back immediately.
 * With reduced motion, flights become instant cuts.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface Pose {
  position: Vector3;
  target: Vector3;
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export class CameraDirector {
  private from: Pose | null = null;
  private to: Pose | null = null;
  private elapsed = 0;
  private duration = 1;
  private resolve: (() => void) | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly controls: OrbitControls,
    private readonly reducedMotion: boolean,
  ) {
    controls.addEventListener('start', () => this.cancel());
  }

  get flying(): boolean {
    return this.to !== null;
  }

  flyTo(to: Pose, duration = 1.8): Promise<void> {
    this.finish(false);
    if (this.reducedMotion || duration <= 0) {
      this.apply(to);
      return Promise.resolve();
    }
    this.from = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    this.to = { position: to.position.clone(), target: to.target.clone() };
    this.elapsed = 0;
    this.duration = duration;
    return new Promise((r) => (this.resolve = r));
  }

  cancel(): void {
    this.finish(false);
  }

  update(dt: number): void {
    if (!this.from || !this.to) return;
    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / this.duration);
    const e = ease(t);
    const pos = this.from.position.clone().lerp(this.to.position, e);
    // Lift the path a little mid-flight for a cinematic arc.
    pos.y += Math.sin(Math.PI * e) * this.from.position.distanceTo(this.to.position) * 0.12;
    this.camera.position.copy(pos);
    this.controls.target.copy(this.from.target.clone().lerp(this.to.target, e));
    if (t >= 1) this.finish(true);
  }

  private apply(p: Pose): void {
    this.camera.position.copy(p.position);
    this.controls.target.copy(p.target);
  }

  private finish(reached: boolean): void {
    if (reached && this.to) this.apply(this.to);
    this.from = null;
    this.to = null;
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }
}
