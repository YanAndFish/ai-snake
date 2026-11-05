import { describe, expect, it } from "vitest";
import { createGame, setFood, setSnake, startGame } from "../../src/sim/game";
import { analyzeMove } from "../../src/sim/analysis";

function game() {
  return startGame(createGame({ seed: 55 }), 55);
}

describe("move analysis", () => {
  it("marks a wall and the neck as crashes", () => {
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

    const wall = analyzeMove(state, "up");
    expect(wall.safe).toBe(false);
    expect(wall.crash).toBe("wall");
    expect(wall.target).toEqual({ x: 0, y: -1 });
    expect(wall.runway).toBe(0);

    const neck = analyzeMove(state, "down");
    expect(neck.safe).toBe(false);
    expect(neck.crash).toBe("self");
    expect(neck.target).toEqual({ x: 0, y: 1 });

    const open = analyzeMove(state, "right");
    expect(open.safe).toBe(true);
    expect(open.crash).toBeNull();
    expect(open.space).toBeGreaterThan(0);
    expect(open.room).toBe("ample");
  });

  it("treats the tail cell as free when the snake is not eating", () => {
    let state = game();
    state = setSnake(
      state,
      [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 2, y: 1 },
      ],
      "up",
    );
    state = setFood(state, { x: 5, y: 5 });

    const intoTail = analyzeMove(state, "right");
    expect(intoTail.target).toEqual({ x: 2, y: 1 });
    expect(intoTail.safe).toBe(true);
    expect(intoTail.runway).toBe(17);
  });

  it("reports eating and Manhattan food distance", () => {
    let state = game();
    state = setSnake(
      state,
      [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ],
      "right",
    );
    state = setFood(state, { x: 6, y: 5 });

    const eat = analyzeMove(state, "right");
    expect(eat.eats).toBe(true);
    expect(eat.foodDistance).toBe(0);
    expect(eat.safe).toBe(true);

    const detour = analyzeMove(state, "up");
    expect(detour.eats).toBe(false);
    expect(detour.foodDistance).toBe(2);
  });

  it("转向后靠近墙壁时，报告直行还能移动的步数", () => {
    let state = game();
    state = setSnake(state, [{ x: 17, y: 9 }, { x: 16, y: 9 }, { x: 15, y: 9 }], "right");
    state = setFood(state, { x: 0, y: 0 });
    const before = JSON.stringify(state);
    expect(analyzeMove(state, "right").runway).toBe(1);
    expect(analyzeMove(state, "up").runway).toBe(9);
    expect(analyzeMove(state, "up").tailReachable).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("转进封闭空格时，报告无法通往尾部", () => {
    let state = startGame(createGame({ width: 5, height: 5, seed: 7 }), 7);
    state = setSnake(state, [
      { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 },
      { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 },
    ], "down");
    state = setFood(state, { x: 4, y: 4 });
    const move = analyzeMove(state, "right");
    expect(move.safe).toBe(true);
    expect(move.tailReachable).toBe(false);
    expect(move.space).toBe(0);
    expect(move.runway).toBe(1);
  });
});
