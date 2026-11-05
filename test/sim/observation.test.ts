import { describe, expect, it } from "vitest";
import { createGame, setFood, setSnake, startGame } from "../../src/sim/game";
import { buildMap, buildObservation, legalMovesFor } from "../../src/sim/observation";

function game() {
  return startGame(createGame({ seed: 55 }), 55);
}

describe("observation", () => {
  it("encodes a bordered map with one head, one food, and the body", () => {
    const state = game();
    const map = buildMap(state);
    const lines = map.split("\n");
    expect(lines).toHaveLength(state.height + 2);
    expect(new Set(lines.map((line) => line.length))).toEqual(new Set([state.width + 2]));
    expect(lines[0]).toBe(`#${"#".repeat(state.width)}#`);
    expect(lines.at(-1)).toBe(`#${"#".repeat(state.width)}#`);
    expect(map.match(/H/g)).toHaveLength(1);
    expect(map.match(/\*/g)).toHaveLength(1);
    expect(map.match(/s/g)).toHaveLength(state.snake.length - 1);
  });

  it("lists legal moves without the reverse", () => {
    const state = game();
    expect(legalMovesFor(state)).toEqual(["up", "down", "right"]);
  });

  it("puts the move analysis and decision task in the prompt", () => {
    const observation = buildObservation(game());
    expect(observation.prompt).toContain("TASK");
    expect(observation.prompt).toContain("MOVE ANALYSIS");
    expect(observation.prompt).toContain("room ample");
    expect(observation.prompt).toContain("SAFE");
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
    expect(prompt).toContain("U (0, -1): CRASH");
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
    expect(prompt).toContain("R (1, 1): SAFE; room tight; space 0");
  });

  it("returns independent cell objects in the view", () => {
    const state = game();
    const observation = buildObservation(state);
    observation.view.snake[0].x = 0;
    expect(state.snake[0].x).not.toBe(0);
  });
});
