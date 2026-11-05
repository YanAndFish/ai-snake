import { describe, expect, it, vi } from "vitest";
import { DecisionsTransport } from "../../src/ai/client";

const signal = () => new AbortController().signal;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const choices = { legalMoves: ["up", "down", "right"] as const };

describe("Decisions transport", () => {
  it("KEEP 选项通过真实响应校验并保留在结果中", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ answers: [{ type: "choice", choice: "KEEP" }] }));
    const transport = new DecisionsTransport(fetchImpl);
    const content = await transport.decide({ prompt: "p", model: "m", apiKey: "k", signal: signal(), legalMoves: ["up"] });
    expect(JSON.parse(content).moves).toEqual(["KEEP"]);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.questions[0].choices.map((choice: Record<"value", string>) => choice.value)).toEqual(["U", "KEEP"]);
    expect(body.questions[0].choices[1].description).toContain("does not pause");
  });

  it("posts a typed choice question and maps the answer to one move", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        model: "gpt-6-luna",
        answers: [
          { type: "choice", name: "next_move", choice: "U", confidence: 0.87 },
        ],
      }),
    );
    const transport = new DecisionsTransport(
      fetchImpl as unknown as typeof fetch,
      "https://example.test/decisions",
    );
    const content = await transport.decide({
      prompt: "SNAKE/2\nSTATE",
      model: "gpt-6-luna",
      apiKey: "sk-test-secret",
      signal: signal(),
      legalMoves: [...choices.legalMoves],
    });
    expect(JSON.parse(content)).toMatchObject({
      moves: ["U"],
      reason: expect.stringContaining("Decisions API"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/decisions");
    const body = JSON.parse(String(init.body)) as {
      model: string;
      input: string;
      questions: Array<{
        type: string;
        name: string;
        choices: Array<{ value: string }>;
      }>;
    };
    expect(body.model).toBe("gpt-6-luna");
    expect(body.input).toContain("SNAKE/2");
    expect(body.questions[0].type).toBe("choice");
    expect(body.questions[0].name).toBe("next_move");
    expect(body.questions[0].choices.map((choice) => choice.value)).toEqual(["U", "D", "R", "KEEP"]);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-secret");
    expect(init.body).not.toContain("response_format");
  });

  it("候选方向包含局面分析时，将分析发送到对应选项", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ answers: [{ type: "choice", choice: "U" }] }));
    const transport = new DecisionsTransport(fetchImpl);
    await transport.decide({
      prompt: "SNAKE/2", model: "gpt-6-luna", apiKey: "sk-test", signal: signal(),
      legalMoves: ["up", "right"],
      choiceDescriptions: { up: "U: S0 OK run=9 tail=yes", right: "R: S0 X", keep: "KEEP: S0 X" },
    });
    const init = fetchImpl.mock.calls[0][1];
    const body = JSON.parse(String(init?.body));
    expect(body.questions[0].choices).toEqual([
      { value: "U", description: "U: S0 OK run=9 tail=yes" },
      { value: "R", description: "R: S0 X" },
      { value: "KEEP", description: "KEEP: S0 X" },
    ]);
  });

  it("uses the default model when the request leaves it empty", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ answers: [{ type: "choice", choice: "D" }] }),
    );
    const transport = new DecisionsTransport(fetchImpl as unknown as typeof fetch);
    await transport.decide({
      prompt: "p",
      model: "",
      apiKey: "k",
      signal: signal(),
      legalMoves: ["up", "down", "right"],
    });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.model).toBe("gpt-6-luna");
  });

  it("rejects a refusal, an invalid choice, and too few choices", async () => {
    const refusal = vi.fn(async () =>
      jsonResponse({ answers: [{ type: "refusal", name: "next_move" }] }),
    );
    const transport = new DecisionsTransport(refusal as unknown as typeof fetch);
    await expect(
      transport.decide({
        prompt: "p",
        model: "m",
        apiKey: "k",
        signal: signal(),
        legalMoves: ["up", "down"],
      }),
    ).rejects.toThrow(/refused/);

    const invalid = vi.fn(async () =>
      jsonResponse({ answers: [{ type: "choice", choice: "L" }] }),
    );
    const invalidTransport = new DecisionsTransport(invalid as unknown as typeof fetch);
    await expect(
      invalidTransport.decide({
        prompt: "p",
        model: "m",
        apiKey: "k",
        signal: signal(),
        legalMoves: ["up", "down"],
      }),
    ).rejects.toThrow(/illegal/);

    const noFetch = vi.fn();
    const shortTransport = new DecisionsTransport(noFetch as unknown as typeof fetch);
    await expect(
      shortTransport.decide({
        prompt: "p",
        model: "m",
        apiKey: "k",
        signal: signal(),
        legalMoves: [],
      }),
    ).rejects.toThrow(/two legal choices/);
    expect(noFetch).not.toHaveBeenCalled();
  });

  it("reports an HTTP error without the key", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "invalid api key" } }, 401),
    );
    const transport = new DecisionsTransport(fetchImpl as unknown as typeof fetch);
    try {
      await transport.decide({
        prompt: "p",
        model: "m",
        apiKey: "sk-do-not-leak",
        signal: signal(),
        legalMoves: ["up", "down"],
      });
      throw new Error("expected failure");
    } catch (error) {
      const text = String(error);
      expect(text).toContain("401");
      expect(text).not.toContain("sk-do-not-leak");
    }
  });

  it("rejects a missing or malformed answer and an aborted response", async () => {
    const noAnswer = vi.fn(async () => jsonResponse({ answers: [] }));
    const noAnswerTransport = new DecisionsTransport(noAnswer as unknown as typeof fetch);
    await expect(
      noAnswerTransport.decide({
        prompt: "p",
        model: "m",
        apiKey: "k",
        signal: signal(),
        legalMoves: ["up", "down"],
      }),
    ).rejects.toThrow(/no answer/);

    const wrongType = vi.fn(async () =>
      jsonResponse({ answers: [{ type: "score", score: 0.5 }] }),
    );
    const wrongTransport = new DecisionsTransport(wrongType as unknown as typeof fetch);
    await expect(
      wrongTransport.decide({
        prompt: "p",
        model: "m",
        apiKey: "k",
        signal: signal(),
        legalMoves: ["up", "down"],
      }),
    ).rejects.toThrow(/instead of choice/);

    const nonString = vi.fn(async () =>
      jsonResponse({ answers: [{ type: "choice", choice: 1 }] }),
    );
    const nonStringTransport = new DecisionsTransport(nonString as unknown as typeof fetch);
    await expect(
      nonStringTransport.decide({
        prompt: "p",
        model: "m",
        apiKey: "k",
        signal: signal(),
        legalMoves: ["up", "down"],
      }),
    ).rejects.toThrow(/no choice/);

    const aborted = new AbortController();
    aborted.abort();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ answers: [{ type: "choice", choice: "U" }] }),
    );
    const transport = new DecisionsTransport(fetchImpl as unknown as typeof fetch);
    await expect(
      transport.decide({
        prompt: "p",
        model: "m",
        apiKey: "k",
        signal: aborted.signal,
        legalMoves: ["up", "down"],
      }),
    ).rejects.toThrow(/aborted/);
  });

  it("keeps the global fetch receiver when no transport is injected", async () => {
    const original = globalThis.fetch;
    const stub = vi.fn(async () =>
      jsonResponse({ answers: [{ type: "choice", choice: "U" }] }),
    );
    vi.stubGlobal("fetch", stub);
    try {
      const transport = new DecisionsTransport();
      await expect(
        transport.decide({
          prompt: "p",
          model: "m",
          apiKey: "k",
          signal: signal(),
          legalMoves: ["up", "down"],
        }),
      ).resolves.toContain("moves");
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubGlobal("fetch", original);
    }
  });
});
