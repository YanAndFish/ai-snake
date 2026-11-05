import { describe, expect, it, vi } from "vitest";
import type { DecisionTransport } from "../../src/ai/client";
import { AiController } from "../../src/ai/controller";

function args(signal = new AbortController().signal) {
  return {
    prompt: "SNAKE/1\nMAP",
    model: "gpt-6-luna",
    apiKey: "sk-test",
    signal,
    observation: "#################\n#.....ssH.......#\n#################",
    currentDirection: "right" as const,
    legalMoves: ["up", "down", "right"] as const,
    requestId: 1,
  };
}

describe("AI controller", () => {
  it("uses the real parser and log path through a mock", async () => {
    const controller = new AiController({ decide: async () => "" });
    controller.useMock({ moves: ["up", "right"], reason: "mock plan" });
    const moves = await controller.request(args());
    expect(moves).toEqual(["up", "right"]);
    expect(controller.plan).toEqual(["up", "right"]);
    expect(controller.getStatus().state).toBe("ready");
    const log = controller.getLog();
    expect(log).toHaveLength(1);
    expect(log[0].reason).toBe("mock plan");
    expect(log[0].observation).toContain("#################");
    expect(controller.getVersion()).toBeGreaterThan(0);
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

  it("keeps only the latest request result when responses race", async () => {
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
    expect(controller.plan).toEqual(["down"]);
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
