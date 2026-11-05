import { describe, expect, it } from "vitest";
import { AiController } from "../../src/ai/controller";
import type { DecisionTransport } from "../../src/ai/client";
import { KeyStore } from "../../src/app/keyStore";
import { GameSession } from "../../src/app/session";
import { DIRECTIONS, type GameState } from "../../src/sim/types";
import {
  advanceTick,
  createGame,
  enqueueDirection,
  pauseGame,
  resumeGame,
  startGame,
} from "../../src/sim/game";
import { checkInvariants, INVARIANT_NAMES } from "../../src/sim/invariants";

const GAME_MODEL_NAMES = [
  "TypeOK",
  "BodyOnBoard",
  "NoOverlap",
  "FoodOnEmpty",
  "FoodExistsInPlay",
  "ScoreMatchesFood",
  "LengthMatchesFood",
  "NoReverse",
  "HaltFreezesTicks",
  "MenuAtZero",
  "HeadIsFirst",
  "LengthAtLeastThree",
];

function deferred(): {
  transport: DecisionTransport;
  resolve: (value: string) => void;
} {
  let resolve!: (value: string) => void;
  const pending = new Promise<string>((res) => {
    resolve = res;
  });
  return { transport: { decide: () => pending }, resolve: (value) => resolve(value) };
}

function aiSession(transport: DecisionTransport): GameSession {
  const session = new GameSession({
    controller: new AiController(transport),
    keyStore: new KeyStore(),
  });
  session.setCredentials("sk-test");
  return session;
}

describe("TLA+ action conformance", () => {
  it("covers every game invariant name in both models", () => {
    for (const name of GAME_MODEL_NAMES) expect(INVARIANT_NAMES).toContain(name);
  });

  it("Start, Pause, Resume, and Restart preserve the model invariants", () => {
    let state = startGame(createGame({ seed: 11 }), 11);
    expect(state.phase).toBe("playing");
    for (let i = 0; i < 4; i += 1) state = advanceTick(state).state;
    const paused = pauseGame(state);
    expect(paused.tick).toBe(paused.haltTick);
    expect(checkInvariants(paused)).toEqual([]);
    expect(resumeGame(paused).phase).toBe("playing");
    const restarted = startGame(paused, 12);
    expect(restarted.phase).toBe("playing");
    expect(checkInvariants(restarted)).toEqual([]);
  });

  it("Turn keeps adjacent directions legal", () => {
    const state = startGame(createGame({ seed: 13 }), 13);
    const turned = enqueueDirection(state, "up");
    expect(turned.queue).toEqual(["up"]);
    const reverse = enqueueDirection(state, "left");
    expect(reverse.queue).toEqual([]);
    expect(checkInvariants(turned)).toEqual([]);
  });

  it("Advance is deterministic and keeps the rules", () => {
    const run = (seed: number): GameState => {
      let state = startGame(createGame({ seed }), seed);
      for (let i = 0; i < 40; i += 1) state = advanceTick(state).state;
      return state;
    };
    expect(run(14)).toEqual(run(14));
    expect(checkInvariants(run(14))).toEqual([]);
  });

  it("AIRequest does not halt the phase or the tick", async () => {
    const gate = deferred();
    const session = aiSession(gate.transport);
    const started = session.start({ seed: 15, ai: true });
    expect(started.phase).toBe("playing");
    expect(session.getAiStatus().state).toBe("thinking");
    session.stepMoves(2);
    expect(session.getState().phase).toBe("playing");
    expect(session.getState().moveCount).toBe(2);
    gate.resolve('{"moves":["up"],"reason":"answer"}');
    await session.waitForIdle(1000);
    expect(session.getAiStatus().state).toBe("ready");
  });

  it("AIError leaves the game running and never enters a thinking phase", async () => {
    const session = new GameSession({
      controller: new AiController({
        decide: async () => {
          throw new Error("offline");
        },
      }),
      keyStore: new KeyStore(),
    });
    session.setCredentials("sk-test");
    session.start({ seed: 16, ai: true });
    await session.waitForIdle(1000);
    expect(session.getState().phase).toBe("playing");
    expect(session.getAiStatus().state).toBe("error");
    session.stepMoves(1);
    expect(session.getState().moveCount).toBe(1);
  });

  it("manual runs never create an AI pending state", () => {
    const session = new GameSession({
      controller: new AiController({ decide: async () => "" }),
      keyStore: new KeyStore(),
    });
    session.start({ seed: 17 });
    expect(session.getAiStatus().state).toBe("off");
    expect(session.getState().phase).toBe("playing");
    expect(DIRECTIONS).toContain(session.getState().direction);
  });
});
