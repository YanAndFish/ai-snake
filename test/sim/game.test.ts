import { describe, expect, it } from "vitest";
import { moveEveryTicksFor } from "../../src/sim/game";
import {
  advanceTick,
  createGame,
  enqueueDirection,
  pauseGame,
  resumeGame,
  setFood,
  setSnake,
  setDifficulty,
  setSpeed,
  startGame,
  viewState,
} from "../../src/sim/game";
import { checkInvariants } from "../../src/sim/invariants";
import type { Cell, Direction, GameState } from "../../src/sim/types";

function playing(seed = 123): GameState {
  return startGame(createGame({ seed }), seed);
}

function configured(snake: Cell[], direction: Direction, food?: Cell): GameState {
  let state = playing(321);
  state = setSnake(state, snake, direction);
  if (food) state = setFood(state, food);
  return state;
}

function moves(state: GameState, count: number): GameState {
  let current = state;
  let done = 0;
  let guard = 0;
  while (done < count && current.phase === "playing" && guard < 1000) {
    const before = current.moveCount;
    current = advanceTick(current).state;
    if (current.moveCount > before) done += 1;
    guard += 1;
  }
  return current;
}

function movesWithEvents(state: GameState, count: number) {
  let current = state;
  let done = 0;
  let guard = 0;
  const events: ReturnType<typeof advanceTick>["events"] = [];
  while (done < count && current.phase === "playing" && guard < 1000) {
    const before = current.moveCount;
    const result = advanceTick(current);
    current = result.state;
    events.push(...result.events);
    if (current.moveCount > before) done += 1;
    guard += 1;
  }
  return { state: current, events };
}

describe("game", () => {
  it("starts with a three-cell snake and food on a free cell", () => {
    const state = playing(1);
    expect(state.phase).toBe("playing");
    expect(state.control).toBe("human");
    expect(state.snake).toHaveLength(3);
    expect(state.snake[0]).toEqual({ x: 9, y: 9 });
    expect(checkInvariants(state)).toEqual([]);
  });

  it("only moves on the move boundary", () => {
    let state = setFood(playing(2), { x: 0, y: 0 });
    const start = state.snake[0];
    for (let i = 0; i < 9; i += 1) state = advanceTick(state).state;
    expect(state.moveCount).toBe(0);
    state = advanceTick(state).state;
    expect(state.moveCount).toBe(1);
    expect(state.snake[0]).toEqual({ x: start.x + 1, y: start.y });
  });

  it("eats food, grows, and scores ten", () => {
    const state = configured(
      [
        { x: 7, y: 7 },
        { x: 6, y: 7 },
        { x: 5, y: 7 },
      ],
      "right",
      { x: 8, y: 7 },
    );
    const result = movesWithEvents(state, 1);
    expect(result.state.score).toBe(10);
    expect(result.state.snake).toHaveLength(4);
    expect(result.state.eaten).toBe(1);
    expect(result.state.food).not.toBeNull();
    expect(
      result.state.snake.some(
        (cell) => cell.x === result.state.food?.x && cell.y === result.state.food?.y,
      ),
    ).toBe(false);
    expect(result.events.some((event) => event.type === "eat")).toBe(true);
  });

  it("dies on a wall", () => {
    const state = configured(
      [
        { x: 0, y: 5 },
        { x: 1, y: 5 },
        { x: 2, y: 5 },
      ],
      "left",
      { x: 9, y: 9 },
    );
    const result = movesWithEvents(state, 1);
    expect(result.state.phase).toBe("over");
    expect(result.state.overReason).toBe("wall");
    expect(result.state.tick).toBe(result.state.haltTick);
    expect(result.events[0].type).toBe("crash");
  });

  it("dies when the head hits a non-tail segment", () => {
    const state = configured(
      [
        { x: 5, y: 5 },
        { x: 6, y: 5 },
        { x: 6, y: 6 },
        { x: 5, y: 6 },
      ],
      "right",
      { x: 0, y: 0 },
    );
    const result = movesWithEvents(state, 1);
    expect(result.state.phase).toBe("over");
    expect(result.state.overReason).toBe("self");
  });

  it("allows moving into the tail cell when not growing", () => {
    const state = configured(
      [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 4, y: 6 },
        { x: 5, y: 6 },
      ],
      "down",
      { x: 0, y: 0 },
    );
    const next = moves(state, 1);
    expect(next.phase).toBe("playing");
    expect(next.snake[0]).toEqual({ x: 5, y: 6 });
  });

  it("rejects an immediate reverse", () => {
    let state = playing(4);
    state = enqueueDirection(state, "left");
    expect(state.queue).toEqual([]);
    state = moves(state, 1);
    expect(state.direction).toBe("right");
  });

  it("rejects a second turn that would reverse the first", () => {
    let state = playing(5);
    state = enqueueDirection(state, "up");
    state = enqueueDirection(state, "down");
    expect(state.queue).toEqual(["up"]);
    state = moves(state, 2);
    expect(state.direction).toBe("up");
    expect(state.phase).toBe("playing");
  });

  it("pauses without advancing the tick", () => {
    let state = playing(6);
    for (let i = 0; i < 5; i += 1) state = advanceTick(state).state;
    const paused = pauseGame(state);
    expect(paused.phase).toBe("paused");
    expect(paused.tick).toBe(paused.haltTick);
    expect(advanceTick(paused).state.tick).toBe(paused.tick);
    expect(resumeGame(paused).phase).toBe("playing");
  });

  it("wins when the board is full", () => {
    let state = startGame(createGame({ seed: 9, width: 3, height: 3 }), 9);
    state = setSnake(
      state,
      [
        { x: 1, y: 2 },
        { x: 0, y: 2 },
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 1, y: 1 },
      ],
      "right",
    );
    state = setFood(state, { x: 2, y: 2 });
    const result = movesWithEvents(state, 1);
    expect(result.state.phase).toBe("over");
    expect(result.state.overReason).toBe("win");
    expect(result.state.food).toBeNull();
    expect(result.state.snake).toHaveLength(9);
    expect(result.events.some((event) => event.type === "win")).toBe(true);
  });

  it("applies a difficulty without breaking the run", () => {
    let state = playing(12);
    state = setDifficulty(state, "fast");
    expect(state.difficulty).toBe("fast");
    expect(state.moveEveryTicks).toBe(8);
    state = setDifficulty(state, "chill");
    expect(state.moveEveryTicks).toBe(13);
    expect(checkInvariants(state)).toEqual([]);
    const started = startGame(createGame({ seed: 12, difficulty: "chill" }), 12);
    expect(started.difficulty).toBe("chill");
    expect(started.moveEveryTicks).toBe(13);
  });

  it("keeps the terminal state stable", () => {
    const state = configured(
      [
        { x: 0, y: 5 },
        { x: 1, y: 5 },
        { x: 2, y: 5 },
      ],
      "left",
      { x: 9, y: 9 },
    );
    const over = moves(state, 1);
    expect(advanceTick(over).state).toEqual(over);
    expect(checkInvariants(over)).toEqual([]);
  });

  it("is deterministic for the same seed and actions", () => {
    const run = (seed: number) => {
      let state = startGame(createGame({ seed }), seed);
      state = enqueueDirection(state, "up");
      state = moves(state, 4);
      state = enqueueDirection(state, "left");
      state = moves(state, 4);
      return viewState(state);
    };
    expect(run(77)).toEqual(run(77));
  });

  it("maps food eaten and difficulty to the speed curve", () => {
    expect(moveEveryTicksFor(0)).toBe(10);
    expect(moveEveryTicksFor(2)).toBe(10);
    expect(moveEveryTicksFor(3)).toBe(9);
    expect(moveEveryTicksFor(30)).toBe(5);
    expect(moveEveryTicksFor(0, "chill")).toBe(13);
    expect(moveEveryTicksFor(30, "chill")).toBe(7);
    expect(moveEveryTicksFor(0, "fast")).toBe(8);
    expect(moveEveryTicksFor(30, "fast")).toBe(4);
  });

  it("validates test mutations and clamps speed", () => {
    const state = playing(10);
    expect(() => setSnake(state, [{ x: 1, y: 1 }], "right")).toThrow(/at least 3/);
    expect(() =>
      setSnake(state, [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }], "right"),
    ).toThrow(/duplicated/);
    expect(() => setFood(state, { x: -1, y: 0 })).toThrow(/out of bounds/);
    expect(() => setFood(state, state.snake[0])).toThrow(/snake/);
    expect(() => setFood(state, null)).toThrow(/after the run/);
    expect(setSpeed(state, 0).moveEveryTicks).toBe(1);
    expect(setSpeed(state, 99).moveEveryTicks).toBe(60);
  });

  it("emits a move event and lastMove on a normal step", () => {
    const state = setFood(playing(11), { x: 0, y: 0 });
    const result = movesWithEvents(state, 1);
    expect(result.events[0].type).toBe("move");
    expect(result.state.lastMove?.to).toEqual(result.state.snake[0]);
  });
});
