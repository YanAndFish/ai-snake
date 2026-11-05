import { describe, expect, it } from "vitest";
import type { DecisionRequest, DecisionTransport } from "../../src/ai/client";
import { AiController } from "../../src/ai/controller";
import { KeyStore } from "../../src/app/keyStore";
import { GameSession } from "../../src/app/session";
import type { Direction } from "../../src/sim/types";

/** 可由测试决定成功、失败和到达时间的一次请求。 */
interface Call {
  /** 真实控制器传给网络层的请求参数。 */
  request: DecisionRequest;
  /** 返回指定方向，省略时返回上。 */
  answer(direction?: Direction): void;
  /** 让当前请求失败。 */
  fail(): void;
}

/** 创建经过真实 parser 的可控网络层。 */
function harness() {
  const calls: Call[] = [];
  const transport: DecisionTransport = {
    decide: (request) => new Promise<string>((resolve, reject) => {
      calls.push({
        request,
        answer: (direction = "up") => resolve(JSON.stringify({ moves: [direction], reason: "当前转向" })),
        fail: () => reject(new Error("连接失败")),
      });
    }),
  };
  const controller = new AiController(transport);
  const game = new GameSession({ controller, keyStore: new KeyStore() });
  game.setCredentials("sk-test-secret");
  return { game, calls, controller };
}

describe("AI 当前方向控制", () => {
  it("每次请求使用当前棋盘，响应在下一次移动执行", async () => {
    const { game, calls, controller } = harness();
    const started = game.start({ seed: 2, ai: true });
    expect(controller.plan).toEqual([]);
    expect(calls[0].request.prompt).toBe(game.getPrompt());
    expect(calls[0].request.prompt).toContain("head (9, 9)");
    expect(calls[0].request.prompt).not.toContain("ROUTES");
    expect(calls[0].request.legalMoves).toEqual(["up", "down", "right"]);
    calls[0].answer();
    await game.waitForIdle();
    expect(game.getState()).toEqual(started);
    expect(controller.plan).toEqual(["up"]);
    expect(calls).toHaveLength(1);
    game.stepMoves(1);
    expect(game.getState().snake[0]).toEqual({ x: 9, y: 8 });
    expect(calls).toHaveLength(2);
    expect(calls[1].request.prompt).toContain("head (9, 8)");
    expect(calls[1].request.legalMoves).toEqual(["up", "left", "right"]);
    expect(game.getAiExecutionStats().apiMoves).toBe(1);
    game.stopAi();
  });

  it("等待期间已经移动时，响应从实际位置控制下一步", async () => {
    const { game, calls } = harness();
    game.start({ seed: 2, ai: true });
    game.stepMoves(3);
    expect(game.getState().snake[0]).toEqual({ x: 12, y: 9 });
    expect(calls).toHaveLength(1);
    calls[0].answer("down");
    await game.waitForIdle();
    game.stepMoves(1);
    expect(game.getState().snake[0]).toEqual({ x: 12, y: 10 });
    expect(game.getAiExecutionStats()).toMatchObject({ apiMoves: 1, coastMoves: 3, maxInFlight: 1 });
    game.stopAi();
  });

  it("只有一个安全方向时也请求 AI，并保留危险选项", async () => {
    const { game, calls, controller } = harness();
    game.start({ seed: 2, ai: true });
    game.setSnake([{ x: 18, y: 0 }, { x: 17, y: 0 }, { x: 16, y: 0 }], "right");
    game.retryAi();
    expect(calls).toHaveLength(2);
    expect(calls[1].request.legalMoves).toEqual(["up", "down", "right"]);
    expect(calls[1].request.choiceDescriptions?.right).toContain("S0 X");
    expect(calls[1].request.choiceDescriptions?.up).toContain("S0 X");
    expect(controller.plan).toEqual([]);
    calls[1].answer("down");
    await game.waitForIdle();
    expect(game.stepMoves(1).snake[0]).toEqual({ x: 18, y: 1 });
    expect(game.getAiExecutionStats().apiMoves).toBe(1);
    game.stopAi();
  });

  it("AI 选择撞墙方向时按规则结束，不替换方向", async () => {
    const { game, calls } = harness();
    game.start({ seed: 2, ai: true });
    game.setSnake([{ x: 18, y: 0 }, { x: 17, y: 0 }, { x: 16, y: 0 }], "right");
    game.retryAi();
    calls[1].answer("up");
    await game.waitForIdle();
    const state = game.stepMoves(1);
    expect(state.direction).toBe("up");
    expect(state.overReason).toBe("wall");
  });

  it("响应未到达时撞墙，后到响应不能重启游戏", async () => {
    const { game, calls, controller } = harness();
    game.start({ seed: 2, ai: true });
    const settled = game.waitForIdle();
    game.stepMoves(10);
    const ended = game.getState();
    expect(ended.overReason).toBe("wall");
    expect(calls[0].request.signal.aborted).toBe(true);
    calls[0].answer();
    await settled;
    expect(game.getState()).toEqual(ended);
    expect(controller.plan).toEqual([]);
    expect(game.getAiExecutionStats().completed).toBe(0);
  });

  it("请求失败后至少等待 60 tick，再请求当前棋盘", async () => {
    const { game, calls } = harness();
    game.start({ seed: 4, ai: true });
    calls[0].fail();
    await game.waitForIdle();
    game.stepTicks(59);
    expect(calls).toHaveLength(1);
    expect(game.getState().snake[0]).toEqual({ x: 14, y: 9 });
    game.stepTicks(1);
    expect(calls).toHaveLength(2);
    expect(game.getAiExecutionStats().failedResponses).toBe(1);
    calls[1].answer();
    await game.waitForIdle();
    expect(game.stepMoves(1).direction).toBe("up");
    expect(game.getAiExecutionStats().apiMoves).toBe(1);
    game.stopAi();
  });

  it("暂停会取消请求，恢复后的请求不受旧回调影响", async () => {
    const { game, calls } = harness();
    game.start({ seed: 5, ai: true });
    game.stepMoves(1);
    const tick = game.pause().tick;
    expect(calls[0].request.signal.aborted).toBe(true);
    game.stepTicks(100);
    expect(game.getState().tick).toBe(tick);
    game.resume();
    expect(calls).toHaveLength(2);
    calls[0].answer();
    await Promise.resolve();
    await Promise.resolve();
    game.stepMoves(3);
    expect(calls).toHaveLength(2);
    expect(game.getAiExecutionStats().completed).toBe(0);
    expect(game.getState().phase).toBe("playing");
    game.stopAi();
  });

  it("重开先清空脚本计划，旧局回调不能修改新局", async () => {
    const { game, calls, controller } = harness();
    game.start({ seed: 6, ai: true });
    game.setPlan("up left");
    game.start({ seed: 7, ai: true });
    expect(controller.plan).toEqual([]);
    calls[0].answer();
    await Promise.resolve();
    await Promise.resolve();
    game.stepMoves(2);
    expect(game.getState().snake[0]).toEqual({ x: 11, y: 9 });
    expect(calls).toHaveLength(2);
    expect(game.getAiExecutionStats().apiMoves).toBe(0);
    game.stopAi();
  });

  it.each(["snake", "food", "speed", "difficulty", "direction"] as const)("编辑 %s 后取消请求", async (edit) => {
    const { game, calls } = harness();
    game.start({ seed: 8, ai: true });
    if (edit === "snake") game.setSnake([{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], "right");
    if (edit === "food") game.setFood({ x: 0, y: 0 });
    if (edit === "speed") game.setSpeed(3);
    if (edit === "difficulty") game.setDifficulty("fast");
    if (edit === "direction") game.setDirection("up");
    expect(calls[0].request.signal.aborted).toBe(true);
    calls[0].answer();
    await Promise.resolve();
    await Promise.resolve();
    game.stepMoves(1);
    expect(game.getAiExecutionStats().apiMoves).toBe(0);
    expect(calls).toHaveLength(2);
    if (edit === "direction") expect(game.getState().direction).toBe("up");
    expect(game.getInvariantReport().ok).toBe(true);
    game.stopAi();
  });

  it("控制台计划逐步执行，网络响应不能覆盖它", async () => {
    const { game, calls } = harness();
    game.start({ seed: 9, ai: true });
    game.setPlan("up right");
    calls[0].answer();
    await Promise.resolve();
    await Promise.resolve();
    expect(game.stepMoves(1).snake[0]).toEqual({ x: 9, y: 8 });
    expect(calls).toHaveLength(1);
    expect(game.stepMoves(1).snake[0]).toEqual({ x: 10, y: 8 });
    expect(game.getAiExecutionStats().scriptMoves).toBe(2);
    expect(game.getAiExecutionStats().apiMoves).toBe(0);
    expect(calls).toHaveLength(2);
    game.stopAi();
  });

  it("移动统计区分 AI 输入、保持方向和控制台脚本", async () => {
    const { game, calls } = harness();
    game.start({ seed: 11, ai: true });
    game.stepMoves(2);
    calls[0].answer();
    await game.waitForIdle();
    game.stepMoves(1);
    game.setPlan("left down");
    game.stepMoves(2);
    const stats = game.getAiExecutionStats();
    expect(stats).toMatchObject({ apiMoves: 1, coastMoves: 2, scriptMoves: 2, maxInFlight: 1 });
    expect(stats.apiMoves + stats.coastMoves + stats.scriptMoves).toBe(game.getState().moveCount);
    expect(JSON.stringify({ stats, log: game.getAiLog() })).not.toContain("sk-test-secret");
    game.stopAi();
  });
});
