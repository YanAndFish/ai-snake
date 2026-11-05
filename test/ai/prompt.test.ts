import { describe, expect, it } from "vitest";
import { DecisionTelemetry } from "../../src/ai/context";
import { buildObservation } from "../../src/sim/observation";
import { cloneState, createGame, setFood, setSnake, startGame } from "../../src/sim/game";

/** 创建头部朝右、食物在正前方的局面。 */
function alignedGame() {
  return setFood(startGame(createGame({ seed: 55 }), 55), { x: 13, y: 9 });
}

describe("AI 方向信息", () => {
  it("KEEP 与当前朝向使用相同分析并保留方向选项", () => {
    const observation = buildObservation(alignedGame());
    expect(observation.legalMoves).toEqual(["up", "down", "right"]);
    expect(Object.keys(observation.choiceDescriptions)).toEqual(["up", "down", "right", "keep"]);
    expect(observation.choiceDescriptions.keep?.split(": ").slice(1).join(": "))
      .toBe(observation.choiceDescriptions.right?.split(": ").slice(1).join(": "));
    expect(observation.prompt).toContain("allowed=U,D,R,KEEP");
    expect(observation.prompt).toContain("keeps moving at the same speed");
  });

  it("食物在直线上时给出到达步数", () => {
    const observation = buildObservation(alignedGame());
    expect(observation.choiceDescriptions.right).toContain("food_on_straight=4");
    expect(observation.choiceDescriptions.up).toContain("food_on_straight=none");
    expect(observation.choiceDescriptions.down).toContain("food_on_straight=none");
  });

  it("下一步吃到食物时到达步数为 1", () => {
    const observation = buildObservation(setFood(alignedGame(), { x: 10, y: 9 }));
    expect(observation.choiceDescriptions.right).toContain("food_on_straight=1");
  });

  it("危险方向保留在固定顺序的选项中", () => {
    const state = setSnake(alignedGame(), [{ x: 18, y: 0 }, { x: 17, y: 0 }, { x: 16, y: 0 }], "right");
    const observation = buildObservation(state);
    expect(observation.legalMoves).toEqual(["up", "down", "right"]);
    expect(observation.choiceDescriptions.up).toContain("COLLISION wall");
    expect(observation.choiceDescriptions.right).toContain("COLLISION wall");
    expect(observation.choiceDescriptions.down).toContain("safe_for=3000ms");
  });

  it("同一可见局面的信息不随隐藏 RNG 改变", () => {
    const state = setFood(alignedGame(), { x: 10, y: 9 });
    const other = { ...cloneState(state), seed: 1234567, rng: 7654321 };
    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    const first = buildObservation(state, telemetry.context(state, { queue: [], plan: [] }));
    const second = buildObservation(other, telemetry.context(other, { queue: [], plan: [] }));
    expect(first.prompt).toBe(second.prompt);
    expect(first.choiceDescriptions).toEqual(second.choiceDescriptions);
    expect(first.prompt).not.toContain("1234567");
    expect(first.prompt).not.toContain("7654321");
  });

  it("时间余量反映下一次响应的等待时间", () => {
    const state = setSnake(alignedGame(), [{ x: 3, y: 9 }, { x: 3, y: 10 }, { x: 3, y: 11 }], "up");
    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    telemetry.recordLatency(600);
    const observation = buildObservation(state, telemetry.context(state, { queue: [], plan: [] }));
    expect(observation.choiceDescriptions.left).toContain("safe_for=500ms margin=-100ms");
    expect(observation.legalMoves).toContain("left");
  });

  it("生成方向信息后游戏状态保持不变", () => {
    const state = alignedGame();
    const before = cloneState(state);
    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    buildObservation(state, telemetry.context(state, { queue: [], plan: [] }));
    expect(state).toEqual(before);
  });
});
