import { describe, expect, it } from "vitest";
import { advanceClockHot, type ClockState } from "../../src/sim/tick.hot";

function clock(): ClockState {
  return { phase: "playing", tick: 0, moveAccumulator: 0, moveEveryTicks: 10 };
}

describe("hot clock", () => {
  it("advances the tick every call", () => {
    const state = clock();
    expect(advanceClockHot(state)).toBe(false);
    expect(state.tick).toBe(1);
    expect(state.moveAccumulator).toBe(1);
  });

  it("returns due only on the move boundary and resets the accumulator", () => {
    const state = clock();
    for (let i = 0; i < 9; i += 1) expect(advanceClockHot(state)).toBe(false);
    expect(advanceClockHot(state)).toBe(true);
    expect(state.tick).toBe(10);
    expect(state.moveAccumulator).toBe(0);
  });

  it("does nothing outside playing", () => {
    const state = { ...clock(), phase: "paused", tick: 5 };
    expect(advanceClockHot(state)).toBe(false);
    expect(state.tick).toBe(5);
  });
});
