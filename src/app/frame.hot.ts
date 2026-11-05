import type { GameSession } from "../app/session";
import type { Scene } from "../render/scene";
import type { GameState } from "../sim/types";

export interface FrameHotContext {
  lastPhase: string;
  lastScore: number;
  lastBest: number;
  lastLength: number;
  lastSpeed: number;
  lastAiVersion: number;
  lastFatal: string | null;
  onPhase: (phase: string, reason: string, score: number) => void;
  onHud: (state: GameState, best: number) => void;
  onAi: () => void;
  onFatal: (message: string) => void;
}

export function renderFrameHot(
  ctx: FrameHotContext,
  session: GameSession,
  scene: Scene | null,
  alpha: number,
  frameDt: number,
  clock: number,
): void {
  const state = session.state;
  const best = session.getBestScore();
  const phaseChanged = state.phase !== ctx.lastPhase;

  if (phaseChanged) {
    ctx.lastPhase = state.phase;
    ctx.onPhase(state.phase, state.overReason === null ? "" : state.overReason, state.score);
  }

  if (
    phaseChanged ||
    state.score !== ctx.lastScore ||
    best !== ctx.lastBest ||
    state.snake.length !== ctx.lastLength ||
    state.moveEveryTicks !== ctx.lastSpeed
  ) {
    ctx.lastScore = state.score;
    ctx.lastBest = best;
    ctx.lastLength = state.snake.length;
    ctx.lastSpeed = state.moveEveryTicks;
    ctx.onHud(state, best);
  }

  const aiVersion = session.getAiVersion();
  if (aiVersion !== ctx.lastAiVersion) {
    ctx.lastAiVersion = aiVersion;
    ctx.onAi();
  }

  const fatal = session.getFatal();
  if (fatal !== ctx.lastFatal) {
    ctx.lastFatal = fatal;
    if (fatal !== null) ctx.onFatal(fatal);
  }

  if (scene !== null) scene.render(state, alpha, clock, frameDt);
}
