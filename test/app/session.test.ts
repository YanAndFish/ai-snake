import { describe, expect, it } from "vitest";
import { AiController } from "../../src/ai/controller";
import type { DecisionTransport } from "../../src/ai/client";
import { KeyStore } from "../../src/app/keyStore";
import { GameSession, type ScoreStore } from "../../src/app/session";

interface Deferred {
  promise: Promise<string>;
  resolve: (value: string) => void;
}

function deferredTransport(): { transport: DecisionTransport; calls: Deferred[] } {
  const calls: Deferred[] = [];
  const transport: DecisionTransport = {
    decide: () => {
      let resolve!: (value: string) => void;
      const promise = new Promise<string>((res) => {
        resolve = res;
      });
      calls.push({ promise, resolve });
      return promise;
    },
  };
  return { transport, calls };
}

function session(options: {
  transport?: DecisionTransport;
  mock?: { moves?: string[]; reason?: string };
  seed?: number;
  best?: ScoreStore;
} = {}): GameSession {
  const controller = new AiController(options.transport ?? { decide: async () => "" });
  if (options.mock) controller.useMock(options.mock);
  return new GameSession({
    controller,
    keyStore: new KeyStore(),
    bestScore: options.best,
    model: "gpt-6-luna",
  });
}

describe("GameSession", () => {
  it("starts a manual run without a key", () => {
    const game = session({ seed: 1 });
    const view = game.start({ seed: 1 });
    expect(view.phase).toBe("playing");
    expect(view.control).toBe("human");
    expect(game.getInvariantReport().ok).toBe(true);
  });

  it("requires a key or mock for AI", () => {
    const game = session();
    expect(() => game.start({ ai: true })).toThrow(/API key/);
    expect(game.getAiStatus().state).toBe("needKey");
  });

  it("runs AI without pausing the simulation", async () => {
    const game = session({ mock: { moves: ["up"], reason: "up" }, seed: 2 });
    const view = game.start({ seed: 2, ai: true });
    expect(view.phase).toBe("playing");
    expect(game.getAiStatus().state).toBe("thinking");
    game.stepMoves(3);
    expect(game.getState().snake[0].x).toBe(12);
    await game.waitForIdle(1000);
    expect(game.getAiStatus().state).toBe("ready");
    game.stepMoves(1);
    expect(game.getState().snake[0].y).toBe(8);
  });

  it("keeps moving while a decision is pending and can die from the wait", () => {
    const gate = deferredTransport();
    const game = session({ transport: gate.transport, seed: 3 });
    game.setCredentials("sk-test");
    game.start({ seed: 3, ai: true });
    expect(game.getState().phase).toBe("playing");
    expect(gate.calls).toHaveLength(1);
    game.stepMoves(20);
    expect(game.getState().phase).toBe("over");
    expect(game.getAiStatus().state).toBe("off");
  });

  it("allows only one request in flight", async () => {
    const gate = deferredTransport();
    const game = session({ transport: gate.transport, seed: 4 });
    game.setCredentials("sk-test");
    game.start({ seed: 4, ai: true });
    expect(gate.calls).toHaveLength(1);
    game.stepMoves(3);
    expect(gate.calls).toHaveLength(1);
    gate.calls[0].resolve('{"moves":["up"],"reason":"one"}');
    await game.waitForIdle(1000);
    expect(game.getAiStatus().state).toBe("ready");
    game.stepMoves(1);
    expect(gate.calls).toHaveLength(2);
    gate.calls[1].resolve('{"moves":["left"],"reason":"two"}');
    await game.waitForIdle(1000);
    expect(game.getAiStatus().state).toBe("ready");
  });

  it("records request latency and movement in the decision context", async () => {
    const game = session({ mock: { moves: ["right"], reason: "context" }, seed: 21 });
    game.start({ seed: 21, ai: true });
    await game.waitForIdle(1000);
    const prompt = game.getPrompt();
    expect(prompt).toContain("DELAY");
    expect(prompt).toMatch(/DELAY\nn=1/);
    expect(prompt).toContain("HIST");
    expect(prompt).toContain("recent:");
    game.stepMoves(1);
    expect(game.getPrompt()).toContain("recent:");
  });

  it("pauses and resumes without advancing the tick", () => {
    const game = session({ seed: 5 });
    game.start({ seed: 5 });
    game.stepTicks(5);
    const paused = game.pause();
    expect(paused.phase).toBe("paused");
    game.stepTicks(100);
    expect(game.getState().tick).toBe(paused.tick);
    game.resume();
    expect(game.getState().phase).toBe("playing");
  });

  it("stops AI without changing the phase", () => {
    const game = session({ mock: { moves: ["up"] }, seed: 6 });
    game.start({ seed: 6, ai: true });
    const view = game.stopAi();
    expect(view.phase).toBe("playing");
    expect(view.control).toBe("human");
    expect(game.getAiStatus().state).toBe("off");
  });

  it("sets a console plan and aborts the in-flight request", async () => {
    const gate = deferredTransport();
    const game = session({ transport: gate.transport, seed: 7 });
    game.setCredentials("sk-test");
    game.start({ seed: 7, ai: true });
    const view = game.setPlan("up right");
    expect(view.phase).toBe("playing");
    expect(game.getAiStatus().planLength).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(game.getState().phase).toBe("playing");
  });

  it("rejects setPlan in manual mode", () => {
    const game = session({ seed: 8 });
    game.start({ seed: 8 });
    expect(() => game.setPlan(["up"])).toThrow(/AI-controlled/);
  });

  it("retries after an AI error while the run continues", async () => {
    const game = session({ seed: 9 });
    game.setMock(() => {
      throw new Error("offline");
    });
    game.start({ seed: 9, ai: true });
    await game.waitForIdle(1000);
    expect(game.getAiStatus().state).toBe("error");
    game.stepMoves(2);
    expect(game.getState().phase).toBe("playing");
    game.setMock({ moves: ["up"], reason: "recovered" });
    game.retryAi();
    await game.waitForIdle(1000);
    expect(game.getAiStatus().state).toBe("ready");
  });

  it("times out waitForIdle without pausing the game", async () => {
    const gate = deferredTransport();
    const game = session({ transport: gate.transport, seed: 10 });
    game.setCredentials("sk-test");
    game.start({ seed: 10, ai: true });
    await expect(game.waitForIdle(50)).rejects.toThrow(/timed out/);
    expect(game.getState().phase).toBe("playing");
    game.stopAi();
  });

  it("updates the injected best score and drains events", () => {
    let best = 0;
    const store: ScoreStore = {
      load: () => best,
      save: (value) => {
        best = value;
      },
    };
    const game = session({ seed: 11, best: store });
    game.start({ seed: 11 });
    game.setSnake(
      [
        { x: 0, y: 5 },
        { x: 1, y: 5 },
        { x: 2, y: 5 },
        { x: 3, y: 5 },
      ],
      "left",
    );
    game.stepMoves(1);
    expect(game.getState().phase).toBe("over");
    expect(game.getBestScore()).toBe(10);
    expect(best).toBe(10);
    expect(game.getEvents().length).toBeGreaterThan(0);
    expect(game.getEvents()).toEqual([]);
  });

  it("does not leak the key into its state or log", () => {
    const game = session({ seed: 12 });
    game.setCredentials("sk-secret-value");
    game.start({ seed: 12 });
    const text = JSON.stringify({
      state: game.getState(),
      status: game.getAiStatus(),
      log: game.getAiLog(),
      observation: game.getObservation(),
    });
    expect(text).not.toContain("sk-secret-value");
  });

  it("changes difficulty and keeps the chosen speed", () => {
    const game = session({ seed: 13 });
    game.start({ seed: 13 });
    expect(game.setDifficulty("fast").moveEveryTicks).toBe(8);
    expect(game.getDifficulty()).toBe("fast");
    game.stepMoves(1);
    expect(game.getState().phase).toBe("playing");
    const started = game.start({ seed: 13, difficulty: "chill" });
    expect(started.difficulty).toBe("chill");
    expect(started.moveEveryTicks).toBe(13);
  });

  it("validates test mutations", () => {
    const game = session({ seed: 13 });
    game.start({ seed: 13 });
    expect(() => game.setSnake([{ x: 1, y: 1 }], "right")).toThrow(/at least 3/);
    expect(() => game.setFood({ x: -1, y: 0 })).toThrow(/out of bounds/);
    expect(game.setSpeed(3).moveEveryTicks).toBe(3);
  });

  it("emits events and reports a fatal invariant failure", () => {
    const events: string[] = [];
    const fatal: string[] = [];
    const controller = new AiController({ decide: async () => "" });
    const game = new GameSession({
      controller,
      keyStore: new KeyStore(),
      onEvents: (batch) => {
        for (const event of batch) events.push(event.type);
      },
      onFatal: (message) => fatal.push(message),
    });
    game.start({ seed: 15 });
    expect(events).toContain("start");
    game.state.snake = [];
    expect(() => game.pause()).toThrow(/Invariant/);
    expect(fatal).toHaveLength(1);
    expect(game.getFatal()).not.toBeNull();
    expect(game.halted()).toBe(true);
  });

  it("exposes the remaining read-only view", () => {
    const game = session({ seed: 16 });
    game.start({ seed: 16 });
    expect(game.getState().phase).toBe("playing");
    expect(game.getPrompt()).toContain("MOVE ANALYSIS");
    expect(game.getObservation().prompt).toContain("board 19x19");
    expect(game.getAiVersion()).toBeGreaterThanOrEqual(0);
    expect(game.getFatal()).toBeNull();
    expect(game.halted()).toBe(false);
    game.setModel("gpt-6-luna");
    game.clearKey();
    expect(game.hasKey()).toBe(false);
    expect(game.restart(17).seed).toBe(17);
    expect(() => game.setFood(null)).toThrow(/after the run/);
    expect(game.stopAi().phase).toBe("playing");
  });

  it("attaches and detaches the real-time clock", () => {
    const game = session({ seed: 14 });
    game.start({ seed: 14 });
    expect(game.isDetached()).toBe(false);
    game.detach();
    expect(game.isDetached()).toBe(true);
    game.attach();
    expect(game.isDetached()).toBe(false);
  });
});
