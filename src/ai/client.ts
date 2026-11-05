import { DEFAULT_MODEL, OPENAI_ENDPOINT } from "../config";
import type { Direction } from "../sim/types";

export interface DecisionRequest {
  prompt: string;
  model: string;
  apiKey: string;
  signal: AbortSignal;
  legalMoves: readonly Direction[];
}

export interface DecisionTransport {
  decide(request: DecisionRequest): Promise<string>;
}

const TOKEN: Record<Direction, string> = {
  up: "U",
  down: "D",
  left: "L",
  right: "R",
};

const DESCRIPTION: Record<Direction, string> = {
  up: "Move the head up one cell.",
  down: "Move the head down one cell.",
  left: "Move the head left one cell.",
  right: "Move the head right one cell.",
};

interface DecisionAnswer {
  type?: string;
  name?: string;
  choice?: unknown;
  confidence?: unknown;
}

interface DecisionPayload {
  answers?: DecisionAnswer[];
  error?: { message?: string };
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

export class DecisionsTransport implements DecisionTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;

  constructor(fetchImpl?: typeof fetch, endpoint = OPENAI_ENDPOINT) {
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.endpoint = endpoint;
  }

  async decide(request: DecisionRequest): Promise<string> {
    if (request.legalMoves.length < 2) {
      throw new Error("The Decisions API needs at least two legal choices");
    }
    const choices = request.legalMoves.map((dir) => ({
      value: TOKEN[dir],
      description: DESCRIPTION[dir],
    }));
    const body = {
      model: request.model || DEFAULT_MODEL,
      input: request.prompt,
      questions: [
        {
          type: "choice",
          name: "next_move",
          instructions:
            "Choose exactly one listed turn. Never choose a turn labeled CRASH when a SAFE turn is available; if every turn crashes, choose the one with the most space. A 180-degree reversal is not offered.",
          choices,
        },
      ],
    };

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      let detail = "";
      try {
        const payload = (await response.json()) as DecisionPayload;
        detail = payload.error?.message?.slice(0, 300) ?? "";
      } catch {
        detail = "";
      }
      throw new Error(
        `OpenAI decision failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }

    if (request.signal.aborted) throw abortError();
    const payload = (await response.json()) as DecisionPayload;
    const answer = payload.answers?.[0];
    if (!answer) throw new Error("OpenAI decision returned no answer");
    if (answer.type === "refusal") throw new Error("OpenAI decision was refused");
    if (answer.type !== "choice") {
      throw new Error(`OpenAI decision returned ${String(answer.type)} instead of choice`);
    }
    if (typeof answer.choice !== "string") {
      throw new Error("OpenAI decision returned no choice");
    }
    const choice = answer.choice.trim().toUpperCase();
    const legal = choices.some((item) => item.value === choice);
    if (!legal) throw new Error("OpenAI decision chose an illegal move");
    const confidence =
      typeof answer.confidence === "number" ? ` (${answer.confidence.toFixed(2)})` : "";
    return JSON.stringify({
      moves: [choice],
      reason: `Decisions API choice ${choice}${confidence}`,
    });
  }
}
