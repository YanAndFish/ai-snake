import { describe, expect, it } from "vitest";
import { AiController } from "../../src/ai/controller";
import type { DecisionRequest, DecisionTransport } from "../../src/ai/client";
import { KeyStore } from "../../src/app/keyStore";
import { GameSession } from "../../src/app/session";
import { DIRECTIONS, type GameState } from "../../src/sim/types";
import {
  advanceTick,
  createGame,
  enqueueDirection,
  pauseGame,
  resumeGame,
  startGame,
} from "../../src/sim/game";
import { checkInvariants, INVARIANT_NAMES } from "../../src/sim/invariants";

const GAME_MODEL_NAMES = [
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

/** 记录一个请求，并允许测试决定响应到达的时间。 */
interface DeferredRequest {
  /** 传输层收到的请求，包含取消信号和候选方向。 */
  request: DecisionRequest;
  /** 完成本次请求。 */
  resolve: (value: string) => void;
}

/** 使用手动完成的请求检查会话中的响应时序。 */
interface DeferredTransport {
  /** 交给真实 AI 控制器的传输层。 */
  transport: DecisionTransport;
  /** 按发送顺序记录的请求。 */
  calls: DeferredRequest[];
}

/** 创建不发网络请求、由测试完成响应的传输层。 */
function deferred(): DeferredTransport {
  const calls: DeferredRequest[] = [];
  return {
    calls,
    transport: {
      decide: (request) => new Promise<string>((resolve) => {
        calls.push({ request, resolve });
      }),
    },
  };
}

function aiSession(transport: DecisionTransport): GameSession {
  const session = new GameSession({
    controller: new AiController(transport),
    keyStore: new KeyStore(),
  });
  session.setCredentials("sk-test");
  return session;
}

describe("TLA+ action conformance", () => {
  it("covers every game invariant name in both models", () => {
    for (const name of GAME_MODEL_NAMES) expect(INVARIANT_NAMES).toContain(name);
  });

  it("Start, Pause, Resume, and Restart preserve the model invariants", () => {
    let state = startGame(createGame({ seed: 11 }), 11);
    expect(state.phase).toBe("playing");
    for (let i = 0; i < 4; i += 1) state = advanceTick(state).state;
    const paused = pauseGame(state);
    expect(paused.tick).toBe(paused.haltTick);
    expect(checkInvariants(paused)).toEqual([]);
    expect(resumeGame(paused).phase).toBe("playing");
    const restarted = startGame(paused, 12);
    expect(restarted.phase).toBe("playing");
    expect(checkInvariants(restarted)).toEqual([]);
  });

  it("Turn keeps adjacent directions legal", () => {
    const state = startGame(createGame({ seed: 13 }), 13);
    const turned = enqueueDirection(state, "up");
    expect(turned.queue).toEqual(["up"]);
    const reverse = enqueueDirection(state, "left");
    expect(reverse.queue).toEqual([]);
    expect(checkInvariants(turned)).toEqual([]);
  });

  it("Advance is deterministic and keeps the rules", () => {
    const run = (seed: number): GameState => {
      let state = startGame(createGame({ seed }), seed);
      for (let i = 0; i < 40; i += 1) state = advanceTick(state).state;
      return state;
    };
    expect(run(14)).toEqual(run(14));
    expect(checkInvariants(run(14))).toEqual([]);
  });

  it("AIRequest does not halt the phase or the tick", async () => {
    const gate = deferred();
    const session = aiSession(gate.transport);
    const started = session.start({ seed: 15, ai: true });
    expect(started.phase).toBe("playing");
    expect(session.getAiStatus().state).toBe("thinking");
    session.stepMoves(2);
    expect(session.getState().phase).toBe("playing");
    expect(session.getState().moveCount).toBe(2);
    gate.calls[0].resolve('{"moves":["up"],"reason":"answer"}');
    await session.waitForIdle(1000);
    expect(session.getAiStatus().state).toBe("ready");
    session.stopAi();
  });

  it("AIRespond 保存一个方向，AIApply 在下一次移动执行", async () => {
    const gate = deferred();
    const session = aiSession(gate.transport);
    session.start({ seed: 15, ai: true });
    const before = session.getState();
    expect(session.getDecisionContext().pending.plan).toEqual([]);
    gate.calls[0].resolve('{"moves":["up"]}');
    await session.waitForIdle(1000);
    expect(session.getState()).toEqual(before);
    expect(session.getDecisionContext().pending.plan).toEqual(["up"]);
    expect(session.stepMoves(1).direction).toBe("up");
    expect(session.getAiExecutionStats().apiMoves).toBe(1);
    expect(session.getInvariantReport().ok).toBe(true);
    session.stopAi();
  });

  it("Pause 取消 pending，恢复后丢弃暂停前请求的响应", async () => {
    const gate = deferred();
    const session = aiSession(gate.transport);
    session.start({ seed: 15, ai: true });
    const oldRequest = gate.calls[0];
    const oldSettled = session.waitForIdle(1000);
    expect(oldRequest.request.signal.aborted).toBe(false);

    session.pause();
    expect(oldRequest.request.signal.aborted).toBe(true);
    expect(session.getAiStatus().state).toBe("off");
    expect(session.getAiStatus().planLength).toBe(0);
    session.resume();
    expect(gate.calls).toHaveLength(2);
    const resumed = session.getState();
    const prefix = session.getDecisionContext().pending.plan;
    session.getEvents();

    oldRequest.resolve('{"moves":["up"]}');
    await oldSettled;
    expect(session.getState()).toEqual(resumed);
    expect(session.getDecisionContext().pending.plan).toEqual(prefix);
    expect(session.getAiStatus().state).toBe("thinking");
    expect(session.getEvents().some((event) => event.type === "ready")).toBe(false);
    session.stepMoves(prefix.length + 1);
    expect(session.getAiExecutionStats().apiMoves).toBe(0);
    session.stopAi();
  });

  it("Pause 清除 ready，恢复后不会安装暂停前缓存的选择", async () => {
    const gate = deferred();
    const session = aiSession(gate.transport);
    session.start({ seed: 15, ai: true });
    gate.calls[0].resolve('{"moves":["up"]}');
    await session.waitForIdle(1000);
    expect(session.getAiStatus().state).toBe("ready");

    session.pause();
    expect(session.getAiStatus().planLength).toBe(0);
    session.resume();
    expect(gate.calls).toHaveLength(2);
    const prefixLength = session.getAiStatus().planLength;
    session.stepMoves(prefixLength + 1);
    expect(session.getAiExecutionStats().apiMoves).toBe(0);
    expect(session.getInvariantReport().ok).toBe(true);
    session.stopAi();
  });

  it("反向响应被拒绝，等待期间维持当前方向", async () => {
    const gate = deferred();
    const session = aiSession(gate.transport);
    session.start({ seed: 15, ai: true });
    gate.calls[0].resolve('{"moves":["left"]}');
    await session.waitForIdle(1000);
    expect(session.getAiStatus().state).toBe("error");
    expect(session.getDecisionContext().pending.plan).toEqual([]);
    expect(session.stepMoves(1).direction).toBe("right");
    expect(session.getAiExecutionStats().apiMoves).toBe(0);
    expect(session.getInvariantReport().ok).toBe(true);
    session.stopAi();
  });

  it("AIError leaves the game running and never enters a thinking phase", async () => {
    const session = new GameSession({
      controller: new AiController({
        decide: async () => {
          throw new Error("offline");
        },
      }),
      keyStore: new KeyStore(),
    });
    session.setCredentials("sk-test");
    session.start({ seed: 16, ai: true });
    await session.waitForIdle(1000);
    expect(session.getState().phase).toBe("playing");
    expect(session.getAiStatus().state).toBe("error");
    session.stepMoves(1);
    expect(session.getState().moveCount).toBe(1);
  });

  it("manual runs never create an AI pending state", () => {
    const session = new GameSession({
      controller: new AiController({ decide: async () => "" }),
      keyStore: new KeyStore(),
    });
    session.start({ seed: 17 });
    expect(session.getAiStatus().state).toBe("off");
    expect(session.getState().phase).toBe("playing");
    expect(DIRECTIONS).toContain(session.getState().direction);
  });
});
