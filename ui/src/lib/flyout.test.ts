import { describe, expect, it } from "vitest";
import { placeFlyout } from "./flyout";

const bounds = { top: 0, left: 0, right: 600, bottom: 400 };
const size = { width: 200, height: 80 };

describe("placeFlyout", () => {
  it("opens below the anchor, centered on it, with the arrow at its middle", () => {
    const place = placeFlyout({ top: 50, left: 200, right: 300, bottom: 100 }, size, bounds);
    expect(place).toEqual({ top: 108, left: 150, side: "below", arrow: 100 });
  });

  it("flips above when only that side has room", () => {
    const place = placeFlyout({ top: 300, left: 200, right: 300, bottom: 350 }, size, bounds);
    expect(place.side).toBe("above");
    expect(place.top).toBe(300 - 8 - 80);
  });

  it("takes the roomier side when neither fits", () => {
    const tall = { width: 200, height: 390 };
    expect(placeFlyout({ top: 40, left: 0, right: 100, bottom: 60 }, tall, bounds).side).toBe(
      "below",
    );
    expect(placeFlyout({ top: 340, left: 0, right: 100, bottom: 360 }, tall, bounds).side).toBe(
      "above",
    );
  });

  it("stays inside the bounds at the edges and keeps the arrow on the anchor", () => {
    const left = placeFlyout({ top: 50, left: 0, right: 60, bottom: 100 }, size, bounds);
    expect(left.left).toBe(8);
    expect(left.arrow).toBe(22);
    const right = placeFlyout({ top: 50, left: 560, right: 600, bottom: 100 }, size, bounds);
    expect(right.left).toBe(600 - 8 - 200);
    expect(right.arrow).toBe(200 - 16);
  });

  it("pins to the start edge when the flyout is wider than the bounds", () => {
    const wide = { width: 700, height: 80 };
    expect(placeFlyout({ top: 50, left: 200, right: 300, bottom: 100 }, wide, bounds).left).toBe(8);
  });
});
