export type Easing = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  /** Overshoots slightly before settling, for a springy pop. */
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
} satisfies Record<string, Easing>;

export interface TweenOptions {
  delay?: number;
  duration: number;
  easing?: Easing;
  /** Receives eased progress from 0 to 1. */
  update: (progress: number) => void;
  done?: () => void;
}

interface Scheduled {
  at: number;
  run: () => void;
}

interface Tween {
  start: number;
  options: TweenOptions;
}

/** Time-based scheduler for delayed actions and tweens, advanced by `tick`. */
export class Animator {
  private now = 0;
  private scheduled: Scheduled[] = [];
  private tweens: Tween[] = [];

  /** Runs `run` after `delay` milliseconds of animation time. */
  after(delay: number, run: () => void): void {
    if (delay <= 0) {
      run();
      return;
    }
    this.scheduled.push({ at: this.now + delay, run });
  }

  tween(options: TweenOptions): void {
    this.tweens.push({ start: this.now + (options.delay ?? 0), options });
  }

  /** Drops everything pending, for example when a new game starts. */
  clear(): void {
    this.scheduled = [];
    this.tweens = [];
  }

  get busy(): boolean {
    return this.scheduled.length > 0 || this.tweens.length > 0;
  }

  tick(deltaMs: number): void {
    this.now += deltaMs;
    if (this.scheduled.length > 0) {
      const due = this.scheduled.filter((s) => s.at <= this.now);
      this.scheduled = this.scheduled.filter((s) => s.at > this.now);
      for (const s of due) s.run();
    }
    const finished: Tween[] = [];
    for (const tween of this.tweens) {
      const { duration, easing = ease.outCubic, update } = tween.options;
      if (this.now < tween.start) continue;
      const raw = duration <= 0 ? 1 : Math.min(1, (this.now - tween.start) / duration);
      update(easing(raw));
      if (raw >= 1) finished.push(tween);
    }
    if (finished.length > 0) {
      this.tweens = this.tweens.filter((t) => !finished.includes(t));
      for (const t of finished) t.options.done?.();
    }
  }
}
