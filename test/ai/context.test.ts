import { describe, expect, it } from "vitest";
import { DecisionTelemetry } from "../../src/ai/context";
import { buildPrompt } from "../../src/ai/prompt";
import { STEP } from "../../src/engine/loop.hot";
import { shortestFoodDistance } from "../../src/sim/analysis";
import { createGame, enqueueDirection, setFood, setSnake, setSpeed, startGame } from "../../src/sim/game";
import type { Cell, Direction, GameState } from "../../src/sim/types";

const MS_PER_TICK = STEP * 1000;

function game(): GameState {
  return startGame(createGame({ seed: 55 }), 55);
}

function moved(
  state: GameState,
  tick: number,
  head: Cell,
  direction: Direction,
): GameState {
  return {
    ...state,
    tick,
    direction,
    snake: [{ ...head }, ...state.snake.slice(1)],
  };
}

describe("decision context", () => {
  it("derives latency percentiles in game ticks and delay scenarios", () => {
    const state = game();
    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    for (const ticks of [9, 12, 18, 34, 41]) {
      telemetry.recordLatency(ticks * MS_PER_TICK + 0.4);
    }

    const context = telemetry.context(state, { queue: [], plan: [] });
    expect(context.latency.samples).toBe(5);
    expect(context.latency.p50Ticks).toBe(19);
    expect(context.latency.p90Ticks).toBe(42);
    expect(context.latency.minTicks).toBe(10);
    expect(context.latency.maxTicks).toBe(42);
    expect(context.scenarios.map((scenario) => scenario.moves)).toEqual([0, 1, 4]);
  });

  it("tracks food age, distance trend, stalls, and repeated state orbits", () => {
    let state = game();
    state = setSnake(
      state,
      [
        { x: 2, y: 2 },
        { x: 1, y: 2 },
        { x: 0, y: 2 },
      ],
      "right",
    );
    state = setFood(state, { x: 10, y: 10 });

    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    const path: Array<[number, Cell, Direction]> = [
      [10, { x: 5, y: 10 }, "right"],
      [20, { x: 10, y: 5 }, "down"],
      [30, { x: 5, y: 10 }, "right"],
      [40, { x: 10, y: 5 }, "down"],
    ];
    for (const [tick, head, direction] of path) {
      state = moved(state, tick, head, direction);
      telemetry.recordMove(state, [{ type: "move", tick }]);
    }

    const context = telemetry.context(state, { queue: [], plan: [] });
    expect(context.history.foodAgeTicks).toBe(40);
    expect(context.history.sameFoodMoves).toBe(5);
    expect(context.history.repeats).toBe(2);
    expect(context.history.cellRepeats).toBe(2);
    expect(context.history.noProgressTicks).toBe(30);
    expect(context.history.noProgressMoves).toBe(3);
    expect(context.history.loop).toBe(true);
    expect(context.history.minDistance).toBe(5);
    expect(context.history.trend).toBe(-11);
  });

  it("predicts that a candidate turn happens after the food line is passed", () => {
    let state = game();
    state = setSnake(
      state,
      [
        { x: 9, y: 9 },
        { x: 8, y: 9 },
        { x: 7, y: 9 },
      ],
      "right",
    );
    state = setFood(state, { x: 9, y: 11 });

    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    telemetry.recordLatency(20 * MS_PER_TICK);
    telemetry.recordLatency(20 * MS_PER_TICK);

    const context = telemetry.context(state, { queue: [], plan: [] });
    expect(context.scenarios.map((scenario) => scenario.moves)).toEqual([0, 2]);
    expect(context.scenarios[0].foodRelation).toBe("now");
    expect(context.scenarios[1].head).toEqual({ x: 11, y: 9 });
    expect(context.scenarios[1].foodRelation).toBe("past");

    const down = context.predictions.find((prediction) => prediction.direction === "down");
    expect(down).toBeDefined();
    const now = down?.outcomes[0]?.analysis;
    const delayed = down?.outcomes[1]?.analysis;
    expect(now?.target).toEqual({ x: 9, y: 10 });
    expect(now?.foodDistance).toBe(1);
    expect(delayed?.target).toEqual({ x: 11, y: 10 });
    expect(delayed?.foodDistance).toBe(3);

    const prompt = buildPrompt(state, ["up", "down", "right"], context);
    expect(prompt).toContain("SNAKE/2");
    expect(prompt).toContain("DELAY");
    expect(prompt).toContain("SCEN");
    expect(prompt).toContain("HIST");
    expect(prompt).toContain("recent:");
    expect(prompt).toContain("MOVE ANALYSIS");
    expect(prompt).toContain("D: S0 OK (9, 10) A f1 space=358 tail=yes run=9");
    expect(prompt).toContain("S1 OK (11, 10) A f3");
    expect(prompt).toContain("S1[likely]");
    expect(prompt).toContain("loop=no");
    expect(prompt).toContain("Return one of U/D/L/R only.");
    expect(prompt).not.toContain("MAP");
    expect(prompt.length).toBeLessThan(4000);
  });

  it("keeps tight, unreachable food visible in the prediction table", () => {
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

    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    const context = telemetry.context(state, { queue: [], plan: [] });
    expect(shortestFoodDistance(state)).toBeNull();
    const right = context.predictions.find((prediction) => prediction.direction === "right");
    expect(right?.outcomes[0]?.analysis?.room).toBe("tight");
    expect(right?.outcomes[0]?.analysis?.space).toBe(0);
    expect(right?.outcomes[0]?.analysis?.foodDistance).toBeNull();

    const prompt = buildPrompt(state, ["down", "left", "right"], context);
    expect(prompt).toContain("R: S0 OK (1, 1) T0 f-");
  });

  it("computes current shortest food distance without mutating state", () => {
    let state = game();
    state = setSnake(
      state,
      [
        { x: 9, y: 9 },
        { x: 8, y: 9 },
        { x: 7, y: 9 },
      ],
      "right",
    );
    state = setFood(state, { x: 9, y: 11 });
    const before = JSON.stringify(state);
    expect(shortestFoodDistance(state)).toBe(2);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("请求接近移动边界时，预测包含等待期间完成的那一步", () => {
    const state = { ...game(), moveAccumulator: 9 };
    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    telemetry.recordLatency(MS_PER_TICK * 2);
    const before = JSON.stringify(state);
    const context = telemetry.context(state, { queue: [], plan: [] });
    const likely = context.scenarios.find((scenario) => scenario.likely);
    expect(likely?.moves).toBe(1);
    expect(likely?.head).toEqual({ x: 10, y: 9 });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("等待期间有入队转向时，按转向后的路径预测", () => {
    const state = enqueueDirection(game(), "up");
    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    telemetry.recordLatency(MS_PER_TICK * 20);
    const context = telemetry.context(state, { queue: state.queue, plan: [] });
    expect(context.scenarios.find((scenario) => scenario.likely)?.head).toEqual({ x: 9, y: 7 });
    const down = context.predictions.find((prediction) => prediction.direction === "down");
    expect(down?.outcomes.at(-1)?.applicable).toBe(false);
  });

  it("手动模式等待期间吃到食物时，预测按难度重算速度", () => {
    let state = setSpeed(game(), 2);
    state = setFood(state, { x: 10, y: 9 });
    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    telemetry.recordLatency(MS_PER_TICK * 6);
    const context = telemetry.context(state, { queue: [], plan: [] });
    const likely = context.scenarios.find((scenario) => scenario.likely);
    expect(likely?.moves).toBe(1);
    expect(likely?.head).toEqual({ x: 10, y: 9 });
    expect(state.moveEveryTicks).toBe(2);
    expect(state.eaten).toBe(0);
  });

  it("AI 等待期间吃到食物时，预测保持自定义速度", () => {
    let state = setSpeed({ ...game(), control: "ai" }, 2);
    state = setFood(state, { x: 10, y: 9 });
    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    telemetry.recordLatency(MS_PER_TICK * 6);
    const context = telemetry.context(state, { queue: [], plan: [] });
    const likely = context.scenarios.find((scenario) => scenario.likely);
    expect(likely?.moves).toBe(3);
    expect(likely?.head).toEqual({ x: 12, y: 9 });
    expect(state.moveEveryTicks).toBe(2);
    expect(state.eaten).toBe(0);
  });

  it("等待期间吃到食物时，分析隐藏尚未出现的新食物", () => {
    const state = setFood(game(), { x: 10, y: 9 });
    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    const context = telemetry.context(state, { queue: [], plan: [] });
    expect(context.scenarios[0].food).toEqual({ x: 10, y: 9 });
    expect(context.scenarios[1].food).toBeNull();
    expect(context.scenarios[2].food).toBeNull();
    expect(state.food).toEqual({ x: 10, y: 9 });
  });

  it("没有延迟样本时，展示等待一到两步的风险", () => {
    const state = game();
    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    const context = telemetry.context(state, { queue: [], plan: [] });
    expect(context.scenarios.map((scenario) => scenario.moves)).toEqual([0, 1, 2]);
    expect(context.scenarios.every((scenario) => !scenario.likely)).toBe(true);
  });

  it("手动模式吃第 6 个食物提速后，保留不同移动次数的延迟场景", () => {
    let state = setSnake(game(), [
      { x: 9, y: 9 }, { x: 8, y: 9 }, { x: 7, y: 9 }, { x: 6, y: 9 }, { x: 5, y: 9 },
      { x: 4, y: 9 }, { x: 3, y: 9 }, { x: 2, y: 9 },
    ], "right");
    state = setFood(state, { x: 10, y: 9 });
    const telemetry = new DecisionTelemetry();
    telemetry.reset(state);
    for (const ticks of [18, 18, 18, 19]) telemetry.recordLatency(ticks * MS_PER_TICK);
    const context = telemetry.context(state, { queue: [], plan: [] });
    expect(context.scenarios.map((scenario) => scenario.moves)).toEqual([0, 1, 2]);
    expect(context.scenarios[1].head).toEqual({ x: 10, y: 9 });
    expect(context.scenarios[2].head).toEqual({ x: 11, y: 9 });
  });
});
