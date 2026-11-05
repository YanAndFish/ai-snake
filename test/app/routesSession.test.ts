import { describe, expect, it, vi } from "vitest";
import type { DecisionRequest, DecisionTransport } from "../../src/ai/client";
import { AiController } from "../../src/ai/controller";
import { buildRouteChoices, projectPrefix } from "../../src/ai/routes";
import { KeyStore } from "../../src/app/keyStore";
import { GameSession } from "../../src/app/session";
import { advanceMove, createGame, enqueueDirection } from "../../src/sim/game";

/** 可由测试决定成功、失败和到达时间的一次请求。 */
interface Call {
  /** 真实控制器传给网络层的请求参数。 */
  request: DecisionRequest;
  /** 返回请求中首条合法路线。 */
  answer(): void;
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
        answer: () => resolve(JSON.stringify({ moves: [request.legalMoves[0]], reason: "选首条路线" })),
        fail: () => reject(new Error("连接失败")),
      });
    }),
  };
  const controller = new AiController(transport);
  const game = new GameSession({ controller, keyStore: new KeyStore() });
  game.setCredentials("sk-test-secret");
  return { game, calls, controller };
}

describe("路线会话调度", () => {
  it("提前响应等待完整前缀，随后在预测起点执行所选路线", async () => {
    const { game, calls, controller } = harness();
    game.start({ seed: 2, ai: true });
    const prefix = [...controller.plan];
    const expected = projectPrefix(game.state, prefix);
    expect(expected).not.toBeNull();
    if (expected === null) return;
    const chosen = buildRouteChoices(expected, 16).find((choice) => choice.direction === calls[0].request.legalMoves[0]);
    expect(chosen).toBeDefined();
    calls[0].answer();
    await game.waitForIdle();
    game.stepMoves(prefix.length - 1);
    expect(game.getAiExecutionStats().apiMoves).toBe(0);
    expect(calls).toHaveLength(1);
    game.stepMoves(1);
    expect(game.getState().snake).toEqual(expected.snake);
    expect(calls).toHaveLength(2);
    game.stepMoves(1);
    const next = advanceMove(enqueueDirection(expected, calls[0].request.legalMoves[0])).state;
    expect(game.getState().snake).toEqual(next.snake);
    expect(game.getAiExecutionStats().apiMoves).toBe(1);
    game.stopAi();
  });

  it("迟到响应被丢弃，下一个移动边界重新请求", async () => {
    const { game, calls } = harness();
    game.start({ seed: 2, ai: true });
    game.stepMoves(17);
    expect(game.getState().phase).toBe("playing");
    expect(calls).toHaveLength(1);
    calls[0].answer();
    await game.waitForIdle();
    expect(game.getAiExecutionStats().expiredResponses).toBe(1);
    expect(game.getAiExecutionStats().apiMoves).toBe(0);
    expect(calls).toHaveLength(1);
    game.stepMoves(1);
    expect(calls).toHaveLength(2);
    expect(game.getInvariantReport().ok).toBe(true);
    game.stopAi();
  });

  it("请求失败后至少等待 60 tick，再在移动边界重试", async () => {
    const { game, calls } = harness();
    game.start({ seed: 4, ai: true });
    calls[0].fail();
    await game.waitForIdle();
    expect(calls).toHaveLength(1);
    expect(game.getAiExecutionStats().failedResponses).toBe(1);
    game.stepTicks(1);
    expect(calls).toHaveLength(1);
    game.stepMoves(1);
    expect(calls).toHaveLength(1);
    game.stepTicks(50);
    expect(calls).toHaveLength(2);
    calls[1].answer();
    await game.waitForIdle();
    game.stepMoves(16 - game.getState().moveCount);
    game.stepMoves(1);
    expect(game.getAiExecutionStats().apiMoves).toBe(1);
    expect(game.getAiExecutionStats().maxInFlight).toBe(1);
    game.stopAi();
  });

  it("暂停会取消未来结果，恢复后的请求不受旧回调影响", async () => {
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
    expect(controller.plan[0]).toBe("right");
    calls[0].answer();
    await Promise.resolve();
    await Promise.resolve();
    game.stepMoves(2);
    expect(game.getState().snake[0]).toEqual({ x: 11, y: 9 });
    expect(calls).toHaveLength(2);
    expect(game.getAiExecutionStats().apiMoves).toBe(0);
    game.stopAi();
  });

  it.each(["snake", "food", "speed", "difficulty", "direction"] as const)("编辑 %s 后旧路线失效", async (edit) => {
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

  it("接近满盘时可以在下一步获胜", () => {
    const { game, calls } = harness();
    game.state = createGame({ width: 3, height: 3 });
    game.start({ seed: 10, ai: true });
    game.setSnake([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }], "left");
    game.setFood({ x: 0, y: 0 });
    expect(game.stepMoves(1).overReason).toBe("win");
    expect(game.getState().snake).toHaveLength(9);
    expect(game.getInvariantReport().ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("延迟抖动和间歇失败时，游戏时钟独立推进且移动来源可核对", async () => {
    const { game, calls } = harness();
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now * 1000 / 60);
    try {
      game.start({ seed: 11, ai: true });
      let handled = 0;
      let due = 5;
      for (now = 1; now <= 1200; now += 1) {
        game.stepTick();
        if (handled < calls.length && now >= due) {
          if (handled % 5 === 4) calls[handled].fail();
          else calls[handled].answer();
          handled += 1;
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
          due = now + (handled % 3 === 0 ? 120 : 5);
        }
        expect(game.getInvariantReport().ok).toBe(true);
      }
      const state = game.getState();
      const stats = game.getAiExecutionStats();
      expect(state.tick).toBe(1200);
      expect(state.phase).toBe("playing");
      expect(stats.apiMoves).toBeGreaterThan(0);
      expect(stats.failedResponses).toBeGreaterThan(0);
      expect(stats.apiMoves + stats.bridgeMoves + stats.forcedMoves + stats.scriptMoves).toBe(state.moveCount);
      expect(stats.maxInFlight).toBe(1);
      expect(JSON.stringify({ state, stats, log: game.getAiLog() })).not.toContain("sk-test-secret");
    } finally {
      game.stopAi();
      clock.mockRestore();
    }
  });
});
