import { Container, Graphics } from "pixi.js";

interface Particle {
  sprite: Graphics;
  vx: number;
  vy: number;
  spin: number;
  gravity: number;
  life: number;
  age: number;
}

export interface BurstOptions {
  count: number;
  colors: readonly number[];
  /** Initial speed range in pixels per second. */
  speed: [number, number];
  /** Lifetime range in milliseconds. */
  life: [number, number];
  size: [number, number];
  /** Downward acceleration in pixels per second squared. */
  gravity?: number;
  /** Launch direction in radians and spread around it. Defaults to every direction. */
  angle?: number;
  spread?: number;
  shape?: "dot" | "confetti";
}

/** Color for a burst given no colors; callers always pass some, so this never shows. */
const FALLBACK_COLOR = 0xffffff;

const random = (min: number, max: number) => min + Math.random() * (max - min);

/** Short-lived particles for explosions and celebrations. */
export class Particles {
  private particles: Particle[] = [];

  constructor(private readonly layer: Container) {}

  burst(x: number, y: number, o: BurstOptions): void {
    for (let i = 0; i < o.count; i++) {
      const angle =
        o.angle === undefined
          ? random(0, Math.PI * 2)
          : o.angle + random(-1, 1) * (o.spread ?? Math.PI);
      const speed = random(...o.speed);
      const size = random(...o.size);
      const color = o.colors[i % o.colors.length] ?? FALLBACK_COLOR;
      const sprite = new Graphics();
      if (o.shape === "confetti") {
        sprite.rect(-size / 2, -size / 4, size, size / 2).fill({ color });
      } else {
        sprite.circle(0, 0, size / 2).fill({ color });
      }
      sprite.position.set(x, y);
      sprite.rotation = random(0, Math.PI);
      this.layer.addChild(sprite);
      this.particles.push({
        sprite,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: o.shape === "confetti" ? random(-8, 8) : 0,
        gravity: o.gravity ?? 0,
        life: random(...o.life),
        age: 0,
      });
    }
  }

  get active(): boolean {
    return this.particles.length > 0;
  }

  tick(deltaMs: number): void {
    const dt = deltaMs / 1000;
    this.particles = this.particles.filter((p) => {
      p.age += deltaMs;
      if (p.age >= p.life) {
        p.sprite.destroy();
        return false;
      }
      p.vy += p.gravity * dt;
      p.vx *= 0.985;
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      p.sprite.rotation += p.spin * dt;
      p.sprite.alpha = 1 - (p.age / p.life) ** 2;
      return true;
    });
  }

  clear(): void {
    for (const p of this.particles) p.sprite.destroy();
    this.particles = [];
  }
}
