import type { Direction } from "../sim/types";
import type { DecisionRequest, DecisionTransport } from "./client";
import { parseAiResponse } from "./response";

export type AiStatusState = "off" | "needKey" | "thinking" | "ready" | "error";

export interface AiStatusView {
  /** 当前请求或计划的状态。 */
  state: AiStatusState;
  /** 请求失败的原因；null 表示没有错误。 */
  error: string | null;
  /** 等待执行的方向数量。 */
  planLength: number;
  /** 当前使用的模型；null 表示尚未发出请求。 */
  model: string | null;
  /** 最近一次完成或失败的请求耗时，单位毫秒；null 表示还没有记录。 */
  latencyMs: number | null;
}

export interface AiLogEntry {
  /** 请求完成的时间戳，单位毫秒。 */
  time: number;
  /** 本次请求使用的模型。 */
  model: string;
  /** 模型返回的方向列表。失败时为空。 */
  moves: string[];
  /** 返回结果的简短说明。失败时为空。 */
  reason: string;
  /** 会话分配的请求序号。 */
  requestId: number;
  /** 请求失败的原因；null 表示成功。 */
  error: string | null;
  /** 从发出请求到完成解析的耗时，单位毫秒。 */
  latencyMs: number;
}

export interface AiRequestArgs {
  /** 当前棋盘和移动分析的提示词。 */
  prompt: string;
  /** 本次请求使用的模型名。 */
  model: string;
  /** 当前请求使用的 API Key。 */
  apiKey: string;
  /** 取消请求的信号。 */
  signal: AbortSignal;
  /** 请求发出时蛇头的方向，用于拒绝反向移动。 */
  currentDirection: Direction;
  /** 允许模型选择的方向。 */
  legalMoves: readonly Direction[];
  /** 各方向的局面分析；省略时使用传输层的方向说明。 */
  choiceDescriptions?: DecisionRequest["choiceDescriptions"];
  /** 会话分配的请求序号，用于关联决策记录。 */
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
  private status: Omit<AiStatusView, "latencyMs"> = { state: "off", error: null, planLength: 0, model: null };
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
    return { ...this.status, planLength: this.plan.length, latencyMs: this.log.at(-1)?.latencyMs ?? null };
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
    this.plan = [...moves];
    this.status = { state: "ready", error: null, planLength: moves.length, model: this.model };
    this.version += 1;
  }

  /** 取出下次移动的方向，并通知面板更新剩余步数。 */
  consumeDirection(): Direction | undefined {
    const direction = this.plan.shift();
    if (direction !== undefined) this.version += 1;
    return direction;
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

  /** 返回 AI 选择的一个方向，由会话在下一次移动时执行。 */
  request(args: AiRequestArgs): Promise<Direction[]> {
    const seq = ++this.requestSeq;
    const startedAt = performance.now();
    this.model = args.model;
    this.status = { state: "thinking", error: null, planLength: this.plan.length, model: args.model };
    this.version += 1;
    const transport = this.makeTransport();

    const run = (async (): Promise<Direction[]> => {
      const text = await transport.decide({
        prompt: args.prompt,
        model: args.model,
        apiKey: args.apiKey,
        signal: args.signal,
        legalMoves: args.legalMoves,
        choiceDescriptions: args.choiceDescriptions,
      });
      if (args.signal.aborted || seq !== this.requestSeq) throw abortError();
      const parsed = parseAiResponse(text, args.currentDirection);
      if (parsed.moves.length === 0 || !args.legalMoves.includes(parsed.moves[0])) {
        throw new Error("AI 返回了未提供的方向，请重试");
      }
      this.status = { state: "ready", error: null, planLength: this.plan.length, model: args.model };
      this.version += 1;
      this.log.push({
        time: Date.now(),
        model: args.model,
        moves: [...parsed.moves],
        reason: parsed.reason,
        requestId: args.requestId,
        error: null,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
      if (this.log.length > 20) this.log.splice(0, this.log.length - 20);
      return parsed.moves;
    })().catch((err) => {
      if (args.signal.aborted || seq !== this.requestSeq) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      const message = args.apiKey ? detail.split(args.apiKey).join("[已隐藏 Key]") : detail;
      this.status = { state: "error", error: message, planLength: 0, model: args.model };
      this.version += 1;
      this.log.push({
        time: Date.now(),
        model: args.model,
        moves: [],
        reason: "",
        requestId: args.requestId,
        error: message,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
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
