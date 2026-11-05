import { describe, expect, it } from "vitest";
import { Rng, rngNext } from "../../src/engine/rng";

describe("seeded RNG", () => {
  it("produces a stable sequence", () => {
    const first = rngNext(123);
    const second = rngNext(first.state);
    expect(rngNext(123)).toEqual(first);
    expect(first.value).toBeGreaterThanOrEqual(0);
    expect(first.value).toBeLessThan(1);
    expect(second.value).not.toBe(first.value);
  });

  it("exposes next, int, and pick", () => {
    const rng = new Rng(42);
    const a = rng.next();
    const b = rng.next();
    expect(a).not.toBe(b);
    const value = rng.int(3, 5);
    expect(value).toBeGreaterThanOrEqual(3);
    expect(value).toBeLessThanOrEqual(5);
    const picked = rng.pick(["a", "b", "c"]);
    expect(["a", "b", "c"]).toContain(picked);
  });
});
