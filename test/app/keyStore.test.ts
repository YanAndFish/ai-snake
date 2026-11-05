import { describe, expect, it } from "vitest";
import { KeyStore } from "../../src/app/keyStore";

describe("KeyStore", () => {
  it("holds, trims, and clears a key", () => {
    const store = new KeyStore();
    expect(store.has()).toBe(false);
    store.set("  sk-memory  ");
    expect(store.has()).toBe(true);
    expect(store.get()).toBe("sk-memory");
    store.clear();
    expect(store.has()).toBe(false);
    expect(store.get()).toBe("");
  });

  it("does not serialize the key", () => {
    const store = new KeyStore();
    store.set("sk-private");
    expect(JSON.stringify(store)).toBe("{}");
  });
});
