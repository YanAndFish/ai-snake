import { describe, expect, it } from "vitest";
import { DIRECTIONS, type GameState } from "../../src/sim/types";
import { advanceTick, createGame, enqueueDirection, pauseGame, resumeGame, startGame } from "../../src/sim/game";
import {
  BIT_NO_OVERLAP,
  BIT_NO_REVERSE,
  BIT_SCORE,
  checkInvariantsMask,
} from "../../src/sim/invariants.hot";
import { checkInvariants, INVARIANT_NAMES } from "../../src/sim/invariants";

const base = (): GameState => startGame(createGame({ seed: 4242 }), 4242);

function broken(state: GameState, name: string): void {
  expect(checkInvariants(state)).toContain(name);
}

const TLA_MODEL_NAMES = [
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

describe("invariants", () => {
  it("accepts a healthy run and returns a zero mask", () => {
    expect(checkInvariants(base())).toEqual([]);
    expect(checkInvariantsMask(base())).toBe(0);
  });

  it("names every invariant that both TLA+ models use", () => {
    for (const name of TLA_MODEL_NAMES) expect(INVARIANT_NAMES).toContain(name);
  });

  it("detects TypeOK violations", () => {
    broken({ ...base(), phase: "nope" as GameState["phase"] }, "TypeOK");
  });

  it("detects a body cell off the board", () => {
    broken({ ...base(), snake: [{ x: -1, y: 0 }, ...base().snake.slice(1)] }, "BodyOnBoard");
  });

  it("detects overlapping cells", () => {
    const state = base();
    const bad = { ...state, snake: [state.snake[0], state.snake[1], state.snake[1]] };
    expect(checkInvariantsMask(bad) & BIT_NO_OVERLAP).not.toBe(0);
    broken(bad, "NoOverlap");
  });

  it("detects food on the snake", () => {
    const state = base();
    broken({ ...state, food: state.snake[0] }, "FoodOnEmpty");
  });

  it("detects missing food during a live run", () => {
    broken({ ...base(), food: null }, "FoodExistsInPlay");
  });

  it("detects a score that does not match food", () => {
    const bad = { ...base(), score: 5 };
    expect(checkInvariantsMask(bad) & BIT_SCORE).not.toBe(0);
    broken(bad, "ScoreMatchesFood");
  });

  it("detects a length that does not match food", () => {
    broken({ ...base(), eaten: 1 }, "LengthMatchesFood");
  });

  it("detects a reverse in the queue", () => {
    const bad = { ...base(), queue: ["left" as const] };
    expect(checkInvariantsMask(bad) & BIT_NO_REVERSE).not.toBe(0);
    broken(bad, "NoReverse");
  });

  it("detects a halted run whose tick moved", () => {
    broken({ ...base(), phase: "paused", tick: 5, haltTick: 0 }, "HaltFreezesTicks");
  });

  it("detects a menu that advanced its tick", () => {
    broken({ ...base(), phase: "menu", tick: 3, haltTick: 3 }, "MenuAtZero");
  });

  it("detects a missing head", () => {
    broken({ ...base(), snake: [] }, "HeadIsFirst");
  });

  it("detects a snake shorter than three cells", () => {
    broken({ ...base(), snake: base().snake.slice(0, 2) }, "LengthAtLeastThree");
  });

  it("holds through a deterministic fuzz run", () => {
    let state = base();
    let seed = 0x12345678;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 600; i += 1) {
      if (state.phase === "over" || state.phase === "menu") {
        const nextSeed = (i * 7919 + 13) >>> 0;
        state = startGame(createGame({ seed: nextSeed }), nextSeed);
      }
      const roll = random();
      if (roll < 0.55) {
        const ticks = 1 + Math.floor(random() * 20);
        for (let n = 0; n < ticks && state.phase === "playing"; n += 1) {
          state = advanceTick(state).state;
        }
      } else if (roll < 0.85) {
        const dir = DIRECTIONS[Math.floor(random() * DIRECTIONS.length)];
        state = enqueueDirection(state, dir);
      } else if (state.phase === "playing") {
        state = pauseGame(state);
      } else if (state.phase === "paused") {
        state = resumeGame(state);
      }
      expect(checkInvariants(state), `iteration ${i}`).toEqual([]);
    }
  });

  it("survives 64 seeds of short automated runs", () => {
    for (let seed = 0; seed < 64; seed += 1) {
      let state = startGame(createGame({ seed }), seed);
      for (let i = 0; i < 80; i += 1) {
        if (state.phase !== "playing") break;
        state = enqueueDirection(state, DIRECTIONS[(seed + i) % DIRECTIONS.length]);
        for (let t = 0; t < 12 && state.phase === "playing"; t += 1) {
          state = advanceTick(state).state;
        }
        expect(checkInvariants(state), `seed ${seed} iteration ${i}`).toEqual([]);
      }
    }
  });
});
