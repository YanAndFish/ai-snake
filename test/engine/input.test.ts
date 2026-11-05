import { describe, expect, it } from "vitest";
import { swipeDirection } from "../../src/engine/input";

describe("swipeDirection", () => {
  it("maps the dominant axis to a board direction", () => {
    expect(swipeDirection(80, 10)).toBe("right");
    expect(swipeDirection(-80, 10)).toBe("left");
    expect(swipeDirection(10, -80)).toBe("up");
    expect(swipeDirection(10, 80)).toBe("down");
  });

  it("ignores taps and drags that stay under the threshold", () => {
    expect(swipeDirection(0, 0)).toBeNull();
    expect(swipeDirection(12, -12)).toBeNull();
    expect(swipeDirection(23, 4)).toBeNull();
  });
});
