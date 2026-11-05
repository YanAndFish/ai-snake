import { describe, expect, it } from "vitest";
import { AiController } from "../../src/ai/controller";
import { KeyStore } from "../../src/app/keyStore";
import { GameSession } from "../../src/app/session";
import { createTestApi } from "../../src/app/testApi";

function harness() {
  const controller = new AiController({ decide: async () => "" });
  const session = new GameSession({ controller, keyStore: new KeyStore() });
  const api = createTestApi(session, controller);
  return { controller, session, api };
}

describe("console test API", () => {
  it("starts detached so console steps never race the real clock", () => {
    const { session, api } = harness();
    api.start({ seed: 1 });
    expect(session.isDetached()).toBe(true);
    api.attach();
    expect(session.isDetached()).toBe(false);
    api.detach();
    expect(session.isDetached()).toBe(true);
  });

  it("returns copies and drains events", () => {
    const { api } = harness();
    const view = api.start({ seed: 2 });
    view.snake[0].x = 0;
    expect(api.getState().snake[0].x).not.toBe(0);
    expect(api.getEvents().some((event) => event.type === "start")).toBe(true);
    expect(api.getEvents()).toEqual([]);
    expect(api.getInvariantReport().ok).toBe(true);
  });

  it("steps ticks and moves through the facade", () => {
    const { api } = harness();
    api.start({ seed: 3 });
    const before = api.getState().tick;
    api.stepTicks(3);
    expect(api.getState().tick).toBe(before + 3);
    expect(api.stepMoves(1).moveCount).toBe(1);
  });

  it("validates snake and food mutations", () => {
    const { api } = harness();
    api.start({ seed: 4 });
    expect(() => api.setSnake([{ x: 1, y: 1 }], "right")).toThrow(/at least 3/);
    expect(() => api.setFood({ x: -1, y: 0 })).toThrow(/out of bounds/);
    const next = api.setSnake(
      [
        { x: 4, y: 4 },
        { x: 3, y: 4 },
        { x: 2, y: 4 },
      ],
      "right",
    );
    expect(next.snake[0]).toEqual({ x: 4, y: 4 });
  });

  it("exposes observations and prompts", () => {
    const { api } = harness();
    api.start({ seed: 5 });
    expect(api.getObservation().prompt).toContain("board 19x19");
    expect(api.getObservation().prompt).toContain("head (");
    expect(api.getPrompt()).toContain("MOVE ANALYSIS");
  });

  it("控制台收到 AI 响应后下一步执行所选方向", async () => {
    const { api } = harness();
    api.ai.useMock({ moves: ["up"], reason: "api mock" });
    api.start({ seed: 6, ai: true });
    api.stepMoves(2);
    await api.ai.waitForIdle(1000);
    expect(api.ai.getStatus().state).toBe("ready");
    expect(api.ai.getStatus().planLength).toBe(1);
    api.stepMoves(1);
    expect(api.getState().snake[0]).toEqual({ x: 11, y: 8 });
    expect(api.ai.getExecutionStats().apiMoves).toBe(1);
    expect(api.getAiLog().at(-1)?.reason).toBe("api mock");
    api.ai.clearMock();
  });

  it("sets a console plan only in AI mode", async () => {
    const { session, api } = harness();
    api.ai.useMock({ moves: ["up"], reason: "first" });
    session.setCredentials("sk-test");
    api.start({ seed: 7, ai: true });
    api.ai.setPlan("up right");
    expect(api.ai.getStatus().planLength).toBe(2);
    api.ai.clearMock();
  });

  it("pauses, resumes, restarts, and sets speed", () => {
    const { api } = harness();
    api.start({ seed: 8 });
    expect(api.pause().phase).toBe("paused");
    expect(api.resume().phase).toBe("playing");
    expect(api.setSpeed(4).moveEveryTicks).toBe(4);
    expect(api.setDifficulty("fast").moveEveryTicks).toBe(8);
    const restarted = api.restart(9);
    expect(restarted.phase).toBe("playing");
    expect(restarted.seed).toBe(9);
  });

  it("returns a help string and version", () => {
    const { api } = harness();
    expect(api.help()).toContain("stepTicks");
    expect(api.version).toBe("1.0.0");
  });
});
