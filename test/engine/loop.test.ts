import { describe, expect, it, vi } from "vitest";
import { Loop } from "../../src/engine/loop";
import { STEP } from "../../src/engine/loop.hot";

describe("Loop", () => {
  it("runs fixed steps from accumulated time", () => {
    let steps = 0;
    const loop = new Loop({
      step: () => {
        steps += 1;
      },
      render: () => {},
      halted: () => false,
    });
    loop.advance(STEP * 3);
    expect(steps).toBe(3);
  });

  it("clears the accumulator while halted", () => {
    let halted = true;
    let steps = 0;
    const loop = new Loop({
      step: () => {
        steps += 1;
      },
      render: () => {},
      halted: () => halted,
    });
    expect(loop.advance(STEP * 10)).toBe(0);
    halted = false;
    expect(loop.advance(STEP / 2)).toBe(0);
    expect(loop.advance(STEP / 2)).toBe(1);
    expect(steps).toBe(1);
  });

  it("stops when a step halts the loop", () => {
    let halted = false;
    let steps = 0;
    const loop = new Loop({
      step: () => {
        steps += 1;
        halted = true;
      },
      render: () => {},
      halted: () => halted,
    });
    loop.advance(STEP * 10);
    expect(steps).toBe(1);
  });
});

describe("Loop frame pump", () => {
  it("starts, renders, schedules, and stops with injected timing", () => {
    const holder: { callback: ((time: number) => void) | null } = { callback: null };
    let now = 0;
    let steps = 0;
    const rendered: number[] = [];
    const cancel = vi.fn();
    const loop = new Loop({
      step: () => {
        steps += 1;
      },
      render: (frame) => {
        rendered.push(frame.alpha);
      },
      halted: () => false,
      now: () => now,
      schedule: (cb) => {
        holder.callback = cb;
        return 7;
      },
      cancel,
    });
    loop.start();
    loop.start();
    now = 1000 / 60;
    const callback = holder.callback;
    if (callback) callback(now);
    expect(steps).toBe(1);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toBeGreaterThanOrEqual(0);
    expect(rendered[0]).toBeLessThanOrEqual(1);
    loop.stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });
});
