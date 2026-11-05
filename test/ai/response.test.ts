import { describe, expect, it } from "vitest";
import { normalizePlan, parseAiResponse } from "../../src/ai/response";

describe("AI response parsing", () => {
  it("accepts a plain JSON plan", () => {
    expect(parseAiResponse('{"moves":["U","R"],"reason":"go"}', "right")).toEqual({
      moves: ["up", "right"],
      reason: "go",
    });
  });

  it("accepts a fenced plan", () => {
    expect(parseAiResponse('```json\n{"moves":["D","L"],"note":"turn"}\n```', "right")).toEqual({
      moves: ["down", "left"],
      reason: "turn",
    });
  });

  it("accepts a single action and lowercase tokens", () => {
    expect(parseAiResponse('{"action":"u","reason":"one"}', "right").moves).toEqual(["up"]);
    expect(parseAiResponse('{"moves":["up","right"]}', "right").moves).toEqual(["up", "right"]);
  });

  it("truncates at the first reverse", () => {
    expect(parseAiResponse('{"moves":["U","D","R"]}', "right").moves).toEqual(["up"]);
  });

  it("skips unknown tokens", () => {
    expect(parseAiResponse('{"moves":["U","north","R"]}', "right").moves).toEqual(["up", "right"]);
  });

  it("caps the plan at eight moves", () => {
    const moves = Array.from({ length: 20 }, () => "R");
    expect(parseAiResponse(JSON.stringify({ moves }), "right").moves).toHaveLength(8);
  });

  it("rejects an empty plan and garbage", () => {
    expect(() => parseAiResponse('{"moves":[]}', "right")).toThrow(/no valid move/);
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
