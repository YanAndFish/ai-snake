import type { Direction } from "../sim/types";
import type { DecisionRequest, DecisionTransport } from "./client";
import { parseAiResponse } from "./response";

export type AiStatusState = "off" | "needKey" | "thinking" | "ready" | "error";

export interface AiStatusView {
  state: AiStatusState;
  error: string | null;
  planLength: number;
  model: string | null;
}

export interface AiLogEntry {
  time: number;
  model: string;
  moves: string[];
  reason: string;
  observation: string;
  requestId: number;
  error: string | null;
}

export interface AiRequestArgs {
  prompt: string;
  model: string;
  apiKey: string;
  signal: AbortSignal;
  observation: string;
  currentDirection: Direction;
  legalMoves: readonly Direction[];
  requestId: number;
}

export type MockAnswer =
  | { moves?: unknown; action?: unknown; reason?: unknown }
  | ((prompt: string) => unknown);

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("waitForIdle timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class AiController {
  private transport: DecisionTransport;
  private mock: MockAnswer | null = null;
  private status: AiStatusView = { state: "off", error: null, planLength: 0, model: null };
  private log: AiLogEntry[] = [];
  private inFlight: Promise<unknown> | null = null;
  private requestSeq = 0;
  private version = 0;

  plan: Direction[] = [];
  model: string | null = null;

  constructor(transport: DecisionTransport) {
    this.transport = transport;
  }

  hasMock(): boolean {
    return this.mock !== null;
  }

  useMock(answer: MockAnswer): void {
    this.mock = answer;
  }

  clearMock(): void {
    this.mock = null;
    this.plan = [];
    this.status = { state: "off", error: null, planLength: 0, model: null };
    this.version += 1;
  }

  getStatus(): AiStatusView {
    return { ...this.status };
  }

  getVersion(): number {
    return this.version;
  }

  getLog(): AiLogEntry[] {
    return this.log.map((e) => ({ ...e, moves: [...e.moves] }));
  }

  setNeedKey(): void {
    this.status = { state: "needKey", error: null, planLength: 0, model: null };
    this.version += 1;
  }

  setPlan(moves: Direction[]): void {
    this.plan = moves;
    this.status = { state: "ready", error: null, planLength: moves.length, model: this.model };
    this.version += 1;
  }

  setOff(): void {
    this.plan = [];
    this.status = { state: "off", error: null, planLength: 0, model: null };
    this.version += 1;
  }

  private makeTransport(): DecisionTransport {
    if (this.mock === null) return this.transport;
    const mock = this.mock;
    return {
      async decide(request: DecisionRequest): Promise<string> {
        if (request.signal.aborted) throw abortError();
        const result = typeof mock === "function" ? await mock(request.prompt) : mock;
        if (request.signal.aborted) throw abortError();
        if (typeof result === "string") return result;
        return JSON.stringify(result);
      },
    };
  }

  request(args: AiRequestArgs): Promise<Direction[]> {
    const seq = ++this.requestSeq;
    this.model = args.model;
    this.status = { state: "thinking", error: null, planLength: 0, model: args.model };
    this.version += 1;
    const transport = this.makeTransport();

    const run = (async (): Promise<Direction[]> => {
      const text = await transport.decide({
        prompt: args.prompt,
        model: args.model,
        apiKey: args.apiKey,
        signal: args.signal,
        legalMoves: args.legalMoves,
      });
      if (args.signal.aborted || seq !== this.requestSeq) throw abortError();
      const parsed = parseAiResponse(text, args.currentDirection);
      this.plan = parsed.moves;
      this.status = { state: "ready", error: null, planLength: parsed.moves.length, model: args.model };
      this.version += 1;
      this.log.push({
        time: Date.now(),
        model: args.model,
        moves: parsed.moves,
        reason: parsed.reason,
        observation: args.observation,
        requestId: args.requestId,
        error: null,
      });
      if (this.log.length > 20) this.log.splice(0, this.log.length - 20);
      return parsed.moves;
    })().catch((err) => {
      if (args.signal.aborted || seq !== this.requestSeq) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.status = { state: "error", error: message, planLength: 0, model: args.model };
      this.version += 1;
      this.log.push({
        time: Date.now(),
        model: args.model,
        moves: [],
        reason: "",
        observation: args.observation,
        requestId: args.requestId,
        error: message,
      });
      if (this.log.length > 20) this.log.splice(0, this.log.length - 20);
      throw err;
    });

    this.inFlight = run;
    return run;
  }

  waitForIdle(timeout = 30000): Promise<void> {
    const settled = Promise.resolve(this.inFlight ?? undefined).then(
      () => undefined,
      () => undefined,
    );
    return withTimeout(settled, timeout);
  }
}
