import { describe, expect, it } from "vitest";
import { STEP } from "../../src/engine/loop.hot";
import { advanceLoopHot } from "../../src/engine/loop.hot";

describe("hot loop", () => {
  it("runs fixed steps from accumulated time", () => {
    const loop = { accumulator: 0 };
    let steps = 0;
    advanceLoopHot(loop, STEP * 3, () => false, 8, () => {
      steps += 1;
    });
    expect(steps).toBe(3);
  });

  it("caps catch-up at the max steps", () => {
    const loop = { accumulator: 0 };
    let steps = 0;
    advanceLoopHot(loop, STEP * 20, () => false, 8, () => {
      steps += 1;
    });
    expect(steps).toBe(8);
  });

  it("clears the accumulator while halted", () => {
    const loop = { accumulator: 0.5 };
    let steps = 0;
    expect(advanceLoopHot(loop, STEP * 10, () => true, 8, () => {
      steps += 1;
    })).toBe(0);
    expect(steps).toBe(0);
    expect(loop.accumulator).toBe(0);
  });

  it("stops when the step callback halts the loop", () => {
    const loop = { accumulator: 0 };
    let halted = false;
    let steps = 0;
    advanceLoopHot(loop, STEP * 10, () => halted, 8, () => {
      steps += 1;
      halted = true;
    });
    expect(steps).toBe(1);
    expect(halted).toBe(true);
  });
});
