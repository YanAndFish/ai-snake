import { describe, expect, it } from "vitest";
import { buildBridge, buildRouteChoices, matchesRouteStart, projectPrefix, routeLength } from "../../src/ai/routes";
import { advanceMove, createGame, enqueueDirection, setFood, setSnake, startGame } from "../../src/sim/game";
import { checkInvariants } from "../../src/sim/invariants";
import type { GameState } from "../../src/sim/types";

/** 创建固定种子、AI 控制的真实棋盘。 */
function board(seed = 17): GameState {
  return { ...startGame(createGame({ seed })), control: "ai" };
}

describe("预测路线", () => {
  it("最近 8 次成功延迟的 P90 决定 1 步或 8 到 32 步路线", () => {
    const state = board();
    expect(routeLength(state, [])).toBe(16);
    expect(routeLength(state, [100])).toBe(1);
    expect(routeLength(state, [200])).toBe(8);
    expect(routeLength(state, [1200])).toBe(10);
    expect(routeLength(state, [10000])).toBe(32);
    expect(routeLength(state, [10000, ...Array(8).fill(100)])).toBe(1);
  });

  it("每个候选有不同首步且整条路线遵守真实移动规则", () => {
    const state = board();
    const before = structuredClone(state);
    const choices = buildRouteChoices(state, 16);
    expect(choices.length).toBeGreaterThanOrEqual(2);
    expect(new Set(choices.map((choice) => choice.direction)).size).toBe(choices.length);
    for (const choice of choices) {
      expect(choice.moves[0]).toBe(choice.direction);
      expect(choice.description).toMatch(/eatAt=(?:\d+|-) progress=-?\d+/);
      let current = state;
      for (const direction of choice.moves) {
        current = advanceMove(enqueueDirection(current, direction)).state;
        expect(current.phase).toBe("playing");
        expect(checkInvariants(current)).toEqual([]);
      }
    }
    expect(state).toEqual(before);
  });

  it("1 步候选经过 16 步安全延伸检查", () => {
    const state = board();
    const short = buildRouteChoices(state, 1);
    const checked = buildRouteChoices(state, 16);
    expect(short.map((choice) => choice.direction)).toEqual(checked.map((choice) => choice.direction));
    expect(short.every((choice) => choice.moves.length === 1 && choice.description.includes("safe_extension=16"))).toBe(true);
  });

  it("避险前缀遇到侧面的食物时保持直行", () => {
    const state = setFood(board(), { x: 9, y: 8 });
    expect(buildBridge(state, 3)).toEqual(["right", "right", "right"]);
  });

  it("前缀吃到食物后，隐藏目标的候选只做避险", () => {
    const state = setFood(board(), { x: 10, y: 9 });
    const expected = projectPrefix(state, ["right"]);
    expect(expected?.eaten).toBe(state.eaten + 1);
    expect(expected).not.toBeNull();
    if (expected === null) return;
    for (const choice of buildRouteChoices(expected, 8, null)) {
      expect(choice.eatAt).toBeNull();
      expect(choice.progress).toBe(0);
    }
  });

  it("起点检查允许 tick 变化，但拒绝蛇身、队列、食物和 RNG 改动", () => {
    const state = board();
    expect(matchesRouteStart({ ...state, tick: state.tick + 9, moveAccumulator: 9 }, state)).toBe(true);
    expect(matchesRouteStart({ ...state, rng: state.rng + 1 }, state)).toBe(false);
    expect(matchesRouteStart({ ...state, queue: ["up"] }, state)).toBe(false);
    expect(matchesRouteStart(setFood(state, { x: 0, y: 0 }), state)).toBe(false);
    const changed = setSnake(state, [{ x: 9, y: 9 }, { x: 9, y: 10 }, { x: 8, y: 10 }], "up");
    expect(matchesRouteStart(changed, state)).toBe(false);
  });

  it("只差一个格子获胜时，候选和前缀允许提前结束", () => {
    let state: GameState = { ...startGame(createGame({ width: 3, height: 3 })), control: "ai" };
    state = setSnake(state, [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }], "left");
    state = setFood(state, { x: 0, y: 0 });
    expect(buildBridge(state, 16)).toEqual(["left"]);
    const choices = buildRouteChoices(state, 16);
    expect(choices).toHaveLength(1);
    expect(choices[0].moves).toEqual(["left"]);
    expect(projectPrefix(state, choices[0].moves)?.overReason).toBe("win");
  });
});
