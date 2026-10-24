import { describe, expect, it } from "vitest";
import { neighborToward } from "./navigation";

/** A square grid with eight-way neighbors, centers one unit apart. */
function grid(cols: number, rows: number) {
  const centers = [];
  const neighbors: number[][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      centers.push({ x: c, y: r });
      const around: number[] = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const [nc, nr] = [c + dc, r + dr];
          if ((dc || dr) && nc >= 0 && nr >= 0 && nc < cols && nr < rows)
            around.push(nr * cols + nc);
        }
      }
      neighbors.push(around);
    }
  }
  return { centers, neighbors };
}

describe("neighborToward", () => {
  const { centers, neighbors } = grid(3, 3);

  it("moves straight on a square grid, never diagonally", () => {
    expect(neighborToward(4, "right", centers, neighbors)).toBe(5);
    expect(neighborToward(4, "left", centers, neighbors)).toBe(3);
    expect(neighborToward(4, "up", centers, neighbors)).toBe(1);
    expect(neighborToward(4, "down", centers, neighbors)).toBe(7);
  });

  it("stays put at the edge of the board", () => {
    expect(neighborToward(0, "up", centers, neighbors)).toBeNull();
    expect(neighborToward(0, "left", centers, neighbors)).toBeNull();
  });

  it("picks one of two equally good hexagon neighbors, consistently", () => {
    // Up from a pointy-top hexagon: upper-left and upper-right tie.
    const hex = {
      centers: [
        { x: 0, y: 0 },
        { x: -0.5, y: -0.866 },
        { x: 0.5, y: -0.866 },
      ],
      neighbors: [[1, 2], [0], [0]],
    };
    expect(neighborToward(0, "up", hex.centers, hex.neighbors)).toBe(1);
  });
});
