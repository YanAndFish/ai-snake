import { describe, expect, it, vi } from "vitest";
import type { GameSession } from "../../src/app/session";
import type { Scene } from "../../src/render/scene";
import type { GameState } from "../../src/sim/types";
import { renderFrameHot, type FrameHotContext } from "../../src/app/frame.hot";

function state(): GameState {
  return {
    phase: "menu",
    control: "human",
    width: 15,
    height: 15,
    tick: 0,
    haltTick: 0,
    moveCount: 0,
    moveEveryTicks: 10,
    moveAccumulator: 0,
    difficulty: "normal",
    snake: [
      { x: 7, y: 7 },
      { x: 6, y: 7 },
      { x: 5, y: 7 },
    ],
    direction: "right",
    queue: [],
    food: { x: 9, y: 7 },
    score: 0,
    eaten: 0,
    seed: 1,
    rng: 1,
    overReason: null,
    pauseReason: null,
    lastMove: null,
  };
}

function harness() {
  const game = state();
  let best = 0;
  let aiVersion = 0;
  let fatal: string | null = null;
  const session = {
    state: game,
    getBestScore: () => best,
    getAiVersion: () => aiVersion,
    getFatal: () => fatal,
  } as unknown as GameSession;
  const scene = { render: vi.fn() } as unknown as Scene;
  const ctx: FrameHotContext = {
    lastPhase: "",
    lastScore: -1,
    lastBest: -1,
    lastLength: -1,
    lastSpeed: -1,
    lastAiVersion: -1,
    lastFatal: null,
    onPhase: vi.fn(),
    onHud: vi.fn(),
    onAi: vi.fn(),
    onFatal: vi.fn(),
  };
  return {
    game,
    session,
    scene,
    ctx,
    setBest: (value: number) => {
      best = value;
    },
    setAiVersion: (value: number) => {
      aiVersion = value;
    },
    setFatal: (value: string | null) => {
      fatal = value;
    },
  };
}

describe("frame hot orchestration", () => {
  it("calls phase, hud, ai, and scene only when their values change", () => {
    const h = harness();
    renderFrameHot(h.ctx, h.session, h.scene, 0.5, 1 / 60, 1);
    expect(h.ctx.onPhase).toHaveBeenCalledTimes(1);
    expect(h.ctx.onHud).toHaveBeenCalledTimes(1);
    expect(h.ctx.onAi).toHaveBeenCalledTimes(1);
    expect(h.scene.render).toHaveBeenCalledTimes(1);

    renderFrameHot(h.ctx, h.session, h.scene, 0.6, 1 / 60, 2);
    expect(h.ctx.onPhase).toHaveBeenCalledTimes(1);
    expect(h.ctx.onHud).toHaveBeenCalledTimes(1);
    expect(h.ctx.onAi).toHaveBeenCalledTimes(1);
    expect(h.scene.render).toHaveBeenCalledTimes(2);

    h.game.score = 10;
    renderFrameHot(h.ctx, h.session, h.scene, 1, 1 / 60, 3);
    expect(h.ctx.onHud).toHaveBeenCalledTimes(2);

    h.setAiVersion(1);
    renderFrameHot(h.ctx, h.session, h.scene, 1, 1 / 60, 4);
    expect(h.ctx.onAi).toHaveBeenCalledTimes(2);

    h.game.phase = "playing";
    h.game.overReason = null;
    renderFrameHot(h.ctx, h.session, h.scene, 1, 1 / 60, 5);
    expect(h.ctx.onPhase).toHaveBeenCalledTimes(2);
    expect(h.ctx.onPhase).toHaveBeenLastCalledWith("playing", "", 10);
  });

  it("reports a fatal state once", () => {
    const h = harness();
    h.setFatal("broken");
    renderFrameHot(h.ctx, h.session, h.scene, 1, 1 / 60, 1);
    renderFrameHot(h.ctx, h.session, h.scene, 1, 1 / 60, 2);
    expect(h.ctx.onFatal).toHaveBeenCalledTimes(1);
    expect(h.ctx.onFatal).toHaveBeenCalledWith("broken");
  });
});
