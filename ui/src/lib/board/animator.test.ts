import { describe, expect, it } from "vitest";
import { Animator, ease } from "./animator";

describe("Animator", () => {
  it("runs delayed actions once their time comes", () => {
    const animator = new Animator();
    const log: string[] = [];
    animator.after(100, () => log.push("late"));
    animator.after(0, () => log.push("now"));
    animator.tick(50);
    expect(log).toEqual(["now"]);
    animator.tick(60);
    expect(log).toEqual(["now", "late"]);
    expect(animator.busy).toBe(false);
  });

  it("drives tweens from 0 to 1 and calls done", () => {
    const animator = new Animator();
    const seen: number[] = [];
    let done = false;
    animator.tween({
      delay: 10,
      duration: 100,
      easing: ease.linear,
      update: (p) => seen.push(p),
      done: () => (done = true),
    });
    animator.tick(5);
    expect(seen).toEqual([]);
    animator.tick(55);
    animator.tick(100);
    expect(seen).toEqual([0.5, 1]);
    expect(done).toBe(true);
  });

  it("outBack overshoots and lands on 1", () => {
    expect(ease.outBack(1)).toBeCloseTo(1);
    expect(Math.max(...[0.6, 0.7, 0.8].map(ease.outBack))).toBeGreaterThan(1);
  });
});
