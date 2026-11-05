import { describe, expect, it } from "vitest";
import { normalizePlan, parseAiResponse } from "../../src/ai/response";

describe("AI response parsing", () => {
  it("JSON 响应返回一个方向", () => {
    expect(parseAiResponse('{"moves":["U"],"reason":"go"}', "right")).toEqual({ moves: ["up"], reason: "go" });
  });

  it("代码块中的响应返回一个方向", () => {
    expect(parseAiResponse('```json\n{"moves":["D"],"note":"turn"}\n```', "right")).toEqual({ moves: ["down"], reason: "turn" });
  });

  it("action 字段支持小写方向", () => {
    expect(parseAiResponse('{"action":"u"}', "right").moves).toEqual(["up"]);
  });

  it.each([["U", "R"], ["U", "D", "R"], ["north", "U"], []])("多个或缺失方向被拒绝：%j", (...moves) => {
    expect(() => parseAiResponse(JSON.stringify({ moves }), "right")).toThrow("一个方向");
  });

  it.each(["north", "L"])("无效或反向输入被拒绝：%s", (move) => {
    expect(() => parseAiResponse(JSON.stringify({ moves: [move] }), "right")).toThrow("方向无效");
  });

  it("非 JSON 响应被拒绝", () => {
    expect(() => parseAiResponse("not json", "right")).toThrow(/no JSON/);
  });

  it("cleans and caps the reason", () => {
    const parsed = parseAiResponse(
      JSON.stringify({ moves: ["U"], reason: `a\nb${"x".repeat(400)}` }),
      "right",
    );
    expect(parsed.reason).not.toContain("\n");
    expect(parsed.reason.length).toBeLessThanOrEqual(300);
  });

  it("normalizes console plan strings and arrays", () => {
    expect(normalizePlan("up right down", "right").moves).toEqual(["up", "right", "down"]);
    expect(normalizePlan(["up", "right"], "right").moves).toEqual(["up", "right"]);
    expect(() => normalizePlan("left", "right")).toThrow(/no valid move/);
  });
});
