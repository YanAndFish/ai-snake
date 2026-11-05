import { DEFAULT_MODEL, OPENAI_ENDPOINT } from "../config";
import type { Direction } from "../sim/types";

export interface DecisionRequest {
  /** 棋盘状态和候选移动的分析。 */
  prompt: string;
  /** 使用的模型名，空字符串表示默认模型。 */
  model: string;
  /** 仅用于当前请求的 API Key。 */
  apiKey: string;
  /** 取消当前请求的信号。 */
  signal: AbortSignal;
  /** 游戏规则允许的方向，仅排除反向。 */
  legalMoves: readonly Direction[];
  /** 选项的局面分析；省略时使用方向说明。 */
  choiceDescriptions?: Partial<Record<Direction, string>>;
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
      description: request.choiceDescriptions?.[dir] ?? DESCRIPTION[dir],
    }));
    const body = {
      model: request.model || DEFAULT_MODEL,
      input: request.prompt,
      questions: [
        {
          type: "choice",
          name: "next_move",
          instructions:
            "Choose the direction to control the snake now. Your answer is one direction input applied at the next movement after arrival. Use the current board and delay information to decide. The snake keeps its heading while waiting. Every non-reversing direction is offered, including dangerous ones. No local planner or collision avoidance will change your choice. Return exactly one listed choice.",
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
