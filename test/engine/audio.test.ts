import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AudioEngine,
  type AudioContextLike,
  type GainLike,
  type OscillatorLike,
  sfxForEvent,
} from "../../src/engine/audio";

interface FakeGain extends GainLike {
  gain: { value: number };
}

interface FakeOscillator extends OscillatorLike {
  type: string;
  frequency: { value: number };
}

function fakeContext(): {
  ctx: AudioContextLike;
  oscillators: FakeOscillator[];
  gains: FakeGain[];
} {
  const oscillators: FakeOscillator[] = [];
  const gains: FakeGain[] = [];
  const ctx: AudioContextLike = {
    currentTime: 0,
    destination: {},
    createOscillator() {
      const oscillator: FakeOscillator = {
        type: "sine",
        frequency: { value: 0 },
        connect() {},
        start() {},
        stop() {},
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain() {
      const gain: FakeGain = {
        gain: { value: 1 },
        connect() {},
      };
      gains.push(gain);
      return gain;
    },
    close: async () => {},
  };
  return { ctx, oscillators, gains };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AudioEngine", () => {
  it("maps game events to sound effects", () => {
    expect(sfxForEvent("eat")).toBe("eat");
    expect(sfxForEvent("move")).toBe("turn");
    expect(sfxForEvent("crash")).toBe("crash");
    expect(sfxForEvent("start")).toBe("start");
    expect(sfxForEvent("win")).toBe("win");
    expect(sfxForEvent("pause")).toBe("ui");
    expect(sfxForEvent("resume")).toBe("ui");
    expect(sfxForEvent("ready")).toBe("ui");
    expect(sfxForEvent("think")).toBeNull();
    expect(sfxForEvent("unknown")).toBeNull();
  });

  it("keeps sound effects silent while muted", () => {
    const { ctx, oscillators } = fakeContext();
    const audio = new AudioEngine(() => ctx);
    audio.ensure();
    audio.toggleMute();
    audio.play("eat");
    expect(oscillators).toHaveLength(0);
    audio.toggleMute();
    audio.play("eat");
    expect(oscillators).toHaveLength(1);
  });

  it("plays the movement sound quieter than other effects", () => {
    const { ctx, gains } = fakeContext();
    const audio = new AudioEngine(() => ctx);
    audio.ensure();
    audio.play("turn");
    audio.play("eat");
    expect(gains[0].gain.value).toBeCloseTo(0.01);
    expect(gains[0].gain.value).toBeLessThan(gains[1].gain.value);
  });

  it("starts a looping background track and mutes it with the master gain", () => {
    vi.useFakeTimers();
    const { ctx, oscillators, gains } = fakeContext();
    const audio = new AudioEngine(() => ctx);
    audio.startMusic();
    expect(audio.isMusicRunning).toBe(true);
    expect(gains[0].gain.value).toBe(0.62);
    expect(oscillators.length).toBeGreaterThan(0);

    const firstCount = oscillators.length;
    vi.advanceTimersByTime(270 * 3);
    expect(oscillators.length).toBeGreaterThan(firstCount);

    audio.toggleMute();
    expect(audio.isMuted).toBe(true);
    expect(gains[0].gain.value).toBe(0);
    audio.toggleMute();
    expect(gains[0].gain.value).toBe(0.62);

    audio.stopMusic();
    expect(audio.isMusicRunning).toBe(false);
  });

  it("does not throw when the browser has no audio context", () => {
    const audio = new AudioEngine(() => {
      throw new Error("no audio");
    });
    expect(() => audio.ensure()).not.toThrow();
    expect(() => audio.play("ui")).not.toThrow();
    expect(() => audio.startMusic()).not.toThrow();
    expect(audio.isMusicRunning).toBe(false);
  });
});
