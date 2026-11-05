import { describe, expect, it } from "vitest";
import { createGame, setFood, setSnake, startGame } from "../../src/sim/game";
import { buildObservation, legalMovesFor } from "../../src/sim/observation";

function game() {
  return startGame(createGame({ seed: 55 }), 55);
}

describe("observation", () => {
  it("exposes board size and coordinates without a text map", () => {
    const state = game();
    const observation = buildObservation(state);
    expect(observation.prompt).toContain(`board ${state.width}x${state.height}`);
    expect(observation.prompt).toContain(
      `head (${state.snake[0].x}, ${state.snake[0].y})`,
    );
    expect(observation.prompt).toContain(
      `food (${state.food?.x}, ${state.food?.y})`,
    );
    expect(observation.prompt).toContain(
      `body (${state.snake[0].x},${state.snake[0].y})`,
    );
    expect(observation.prompt).not.toContain("MAP");
    expect(observation).not.toHaveProperty("map");
    expect(observation.view.snake).toHaveLength(3);
  });

  it("lists legal moves without the reverse", () => {
    const state = game();
    expect(legalMovesFor(state)).toEqual(["up", "down", "right"]);
  });

  it("puts the move analysis and decision task in the prompt", () => {
    const observation = buildObservation(game());
    expect(observation.prompt).toContain("TASK");
    expect(observation.prompt).toContain("MOVE ANALYSIS");
    expect(observation.prompt).toContain(" A f");
    expect(observation.prompt).toContain("OK (");
    expect(observation.prompt).toContain(`board ${observation.view.width}x${observation.view.height}`);
    expect(observation.prompt).toContain(`head (${observation.view.snake[0].x}, ${observation.view.snake[0].y})`);
    expect(observation.prompt).not.toContain("MAP");
    expect(observation.legalMoves).toEqual(["up", "down", "right"]);
    expect(observation.view.snake).toHaveLength(3);
  });

  it("labels a turn that would hit a wall as CRASH", () => {
    let state = game();
    state = setSnake(
      state,
      [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 2 },
      ],
      "up",
    );
    state = setFood(state, { x: 5, y: 5 });
    const prompt = buildObservation(state).prompt;
    expect(prompt).toContain("U: X");
  });

  it("shows space only for tight turns", () => {
    let state = startGame(createGame({ width: 5, height: 5, seed: 7 }), 7);
    state = setSnake(
      state,
      [
        { x: 0, y: 1 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 },
        { x: 0, y: 2 },
      ],
      "down",
    );
    state = setFood(state, { x: 3, y: 3 });
    const prompt = buildObservation(state).prompt;
    expect(prompt).toContain("R: OK (1, 1) T0 f-");
  });

  it("returns independent cell objects in the view", () => {
    const state = game();
    const observation = buildObservation(state);
    observation.view.snake[0].x = 0;
    expect(state.snake[0].x).not.toBe(0);
  });
});
