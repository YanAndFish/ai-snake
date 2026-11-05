import { describe, expect, it, vi } from "vitest";
import type { DecisionTransport } from "../../src/ai/client";
import { AiController } from "../../src/ai/controller";

function args(signal = new AbortController().signal) {
  return {
    prompt: "SNAKE/2\nSTATE",
    model: "gpt-6-luna",
    apiKey: "sk-test",
    signal,
    currentDirection: "right" as const,
    legalMoves: ["up", "down", "right"] as const,
    requestId: 1,
  };
}

describe("AI controller", () => {
  it("Mock 响应经过真实解析器并返回一个方向", async () => {
    const controller = new AiController({ decide: async () => "" });
    controller.useMock({ moves: ["up"], reason: "mock plan" });
    const moves = await controller.request(args());
    expect(moves).toEqual(["up"]);
    expect(controller.plan).toEqual([]);
    expect(controller.getStatus().state).toBe("ready");
    const log = controller.getLog();
    expect(log).toHaveLength(1);
    expect(log[0].reason).toBe("mock plan");
    expect(controller.getVersion()).toBeGreaterThan(0);
    controller.setPlan(["right"]);
    expect(controller.getLog()[0].moves).toEqual(["up"]);
  });

  it("logs a failed request", async () => {
    const controller = new AiController({ decide: async () => "" });
    controller.useMock(() => {
      throw new Error("network down");
    });
    await expect(controller.request(args())).rejects.toThrow(/network down/);
    expect(controller.getStatus().state).toBe("error");
    expect(controller.getStatus().error).toContain("network down");
    expect(controller.getLog()[0].error).toContain("network down");
  });

  it("请求成功时，状态和记录包含实际耗时", async () => {
    const clock = vi.spyOn(performance, "now");
    clock.mockReturnValueOnce(100).mockReturnValueOnce(347);
    try {
      const controller = new AiController({ decide: async () => '{"moves":["up"]}' });
      expect(controller.getStatus().latencyMs).toBeNull();
      await controller.request(args());
      expect(controller.getStatus().latencyMs).toBe(247);
      expect(controller.getLog()[0].latencyMs).toBe(247);
    } finally {
      clock.mockRestore();
    }
  });

  it("请求失败时，记录耗时并隐藏错误里的 Key", async () => {
    const clock = vi.spyOn(performance, "now");
    clock.mockReturnValueOnce(10).mockReturnValueOnce(500);
    try {
      const controller = new AiController({ decide: async () => { throw new Error("invalid sk-test"); } });
      await expect(controller.request(args())).rejects.toThrow();
      expect(controller.getLog()[0].latencyMs).toBe(490);
      expect(JSON.stringify(controller.getLog())).not.toContain("sk-test");
      expect(controller.getStatus().error).not.toContain("sk-test");
    } finally {
      clock.mockRestore();
    }
  });

  it("请求响应乱序时只保留最新请求记录", async () => {
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const transport: DecisionTransport = { decide: vi.fn(() => pending) };
    const controller = new AiController(transport);
    const first = controller.request({ ...args(), requestId: 1 });
    const second = controller.request({ ...args(), requestId: 2 });
    release('{"moves":["D"],"reason":"latest"}');
    const results = await Promise.allSettled([first, second]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
    expect(controller.plan).toEqual([]);
    expect(controller.getLog()).toHaveLength(1);
  });

  it("rejects an aborted request without an error log", async () => {
    const controller = new AiController({ decide: async () => "" });
    controller.useMock({ moves: ["up"] });
    const aborted = new AbortController();
    aborted.abort();
    await expect(controller.request(args(aborted.signal))).rejects.toThrow(/aborted/);
    expect(controller.getLog()).toHaveLength(0);
  });

  it("waits for the current request and times out a pending one", async () => {
    const controller = new AiController({ decide: async () => "" });
    controller.useMock({ moves: ["up"] });
    const request = controller.request(args());
    await controller.waitForIdle(1000);
    await request;
    const pending = new AiController({ decide: () => new Promise<string>(() => {}) });
    void pending.request(args());
    await expect(pending.waitForIdle(10)).rejects.toThrow(/timed out/);
  });

  it("caps its log and supports status setters", async () => {
    const controller = new AiController({ decide: async () => "" });
    controller.useMock({ moves: ["up"], reason: "same" });
    for (let i = 0; i < 25; i += 1) {
      await controller.request({ ...args(), requestId: i + 1 });
    }
    expect(controller.getLog()).toHaveLength(20);
    controller.setNeedKey();
    expect(controller.getStatus().state).toBe("needKey");
    controller.setPlan(["up"]);
    expect(controller.getStatus().state).toBe("ready");
    controller.setOff();
    expect(controller.getStatus().state).toBe("off");
    controller.clearMock();
    expect(controller.hasMock()).toBe(false);
  });
});
