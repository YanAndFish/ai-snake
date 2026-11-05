import { DEFAULT_DIFFICULTY, DEFAULT_MODEL, type Difficulty } from "../config";
import {
  type AiLogEntry,
  type AiStatusView,
  AiController,
} from "../ai/controller";
import { DecisionTelemetry, type DecisionContext } from "../ai/context";
import { normalizePlan } from "../ai/response";
import { buildBridge, buildRouteChoices, buildRoutePrompt, matchesRouteStart, projectPrefix, rescueDirection, routeLength, type RouteChoice } from "../ai/routes";
import {
  advanceMove,
  createGame,
  enqueueDirection,
  pauseGame,
  resumeGame,
  setFood as setFoodGame,
  setSnake as setSnakeGame,
  setDifficulty as setDifficultyGame,
  setSpeed as setSpeedGame,
  startGame,
  viewState,
} from "../sim/game";
import { checkInvariants, InvariantError } from "../sim/invariants";
import { checkInvariantsMask } from "../sim/invariants.hot";
import { advanceClockHot } from "../sim/tick.hot";
import { buildObservation, type Observation } from "../sim/observation";
import {
  type Cell,
  type Direction,
  type GameEvent,
  type GameState,
  type StateView,
} from "../sim/types";
import { KeyStore } from "./keyStore";

export interface ScoreStore {
  load(): number;
  save(value: number): void;
}

export interface StartOptions {
  seed?: number;
  ai?: boolean;
  difficulty?: Difficulty;
}

export interface SessionOptions {
  controller: AiController;
  keyStore: KeyStore;
  bestScore?: ScoreStore;
  model?: string;
  onEvents?: (events: GameEvent[]) => void;
  onFatal?: (message: string) => void;
}

/** 一局中实际完成的 AI 移动和请求统计。 */
export interface AiExecutionStats {
  /** 已发出的请求数。 */
  requests: number;
  /** 已成功解析的响应数，包含晚到的响应。 */
  completed: number;
  /** 请求或解析失败的次数，取消请求不计入。 */
  failedResponses: number;
  /** 错过执行起点的响应数。 */
  expiredResponses: number;
  /** 移动数相同但棋盘与预测起点不同的次数。 */
  startMismatches: number;
  /** 按 API 选择的路线完成的移动数。 */
  apiMoves: number;
  /** 等待响应时按本地避险前缀完成的移动数。 */
  bridgeMoves: number;
  /** 只有一个安全候选时完成的移动数。 */
  forcedMoves: number;
  /** 按控制台方向计划或入队方向完成的移动数。 */
  scriptMoves: number;
  /** 在 API 路线中吃到的食物数。 */
  apiEats: number;
  /** 在本地避险前缀中吃到的食物数。 */
  bridgeEats: number;
  /** 在唯一安全路线中吃到的食物数。 */
  forcedEats: number;
  /** 同时进行的请求数最大值。 */
  maxInFlight: number;
}

/** 请求绑定的完整未来棋盘和模型选择。 */
interface PendingRoute {
  /** 棋盘修改后递增，用于丢弃旧结果。 */
  version: number;
  /** 当前请求的序号。 */
  requestId: number;
  /** 所有候选路线共享的执行起点。 */
  expected: GameState;
  /** 按不同首步区分的安全路线。 */
  choices: RouteChoice[];
  /** 模型选中的首方向；null 表示尚未收到响应。 */
  selected: Direction | null;
}

type PlanSource = "api" | "bridge" | "forced" | "script";

/** 创建单局执行统计。 */
function emptyExecutionStats(): AiExecutionStats {
  return { requests: 0, completed: 0, failedResponses: 0, expiredResponses: 0, startMismatches: 0, apiMoves: 0, bridgeMoves: 0, forcedMoves: 0, scriptMoves: 0, apiEats: 0, bridgeEats: 0, forcedEats: 0, maxInFlight: 0 };
}

const MAX_EVENTS = 100;
const STEP_MOVES_BUDGET = 10000;

function freshSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
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

export class GameSession {
  state: GameState;
  private controller: AiController;
  private keyStore: KeyStore;
  private bestScoreStore: ScoreStore | null;
  private bestScore: number;
  private model: string;
  private difficulty: Difficulty;
  private events: GameEvent[] = [];
  private onEvents: ((events: GameEvent[]) => void) | null;
  private onFatal: ((message: string) => void) | null;
  private aiEnabled = false;
  private runId = 0;
  private requestSeq = 0;
  private requestPromise: Promise<void> | null = null;
  private requestInFlight = false;
  private abortController: AbortController | null = null;
  private detached = false;
  private frozen = false;
  private fatal: string | null = null;
  private telemetry = new DecisionTelemetry();
  private boardVersion = 0;
  private pendingRoute: PendingRoute | null = null;
  private planSource: PlanSource = "bridge";
  private routeLatenciesMs: number[] = [];
  private executionStats = emptyExecutionStats();
  private retryAtTick = 0;

  constructor(options: SessionOptions) {
    this.controller = options.controller;
    this.keyStore = options.keyStore;
    this.bestScoreStore = options.bestScore ?? null;
    this.bestScore = this.bestScoreStore?.load() ?? 0;
    this.model = options.model ?? DEFAULT_MODEL;
    this.difficulty = DEFAULT_DIFFICULTY;
    this.onEvents = options.onEvents ?? null;
    this.onFatal = options.onFatal ?? null;
    this.state = createGame({ difficulty: this.difficulty });
    this.telemetry.reset(this.state);
  }

  getBestScore(): number {
    return this.bestScore;
  }

  getFatal(): string | null {
    return this.fatal;
  }

  isDetached(): boolean {
    return this.detached;
  }

  halted(): boolean {
    return this.frozen || this.detached || this.state.phase !== "playing";
  }

  private assertInvariants(): void {
    if (checkInvariantsMask(this.state) === 0) return;
    this.failInvariants();
  }

  private assertInvariantsHot(): void {
    if (checkInvariantsMask(this.state) === 0) return;
    this.failInvariants();
  }

  private failInvariants(): never {
    const violations = checkInvariants(this.state);
    const err = new InvariantError(violations);
    this.fatal = err.message;
    this.frozen = true;
    if (this.onFatal) this.onFatal(err.message);
    throw err;
  }

  private emit(events: GameEvent[]): void {
    if (events.length === 0) return;
    for (const event of events) {
      this.events.push(event);
      if (this.events.length > MAX_EVENTS) {
        this.events.splice(0, this.events.length - MAX_EVENTS);
      }
    }
    if (this.onEvents) this.onEvents(events);
  }

  private updateBestScore(): void {
    if (this.state.phase === "over" && this.state.score > this.bestScore) {
      this.bestScore = this.state.score;
      this.bestScoreStore?.save(this.bestScore);
    }
  }

  start(options?: StartOptions): StateView {
    this.runId += 1;
    this.invalidateRoutes();
    this.routeLatenciesMs.length = 0;
    this.executionStats = emptyExecutionStats();
    this.frozen = false;
    this.fatal = null;
    const ai = options?.ai === true;
    if (options?.difficulty) this.difficulty = options.difficulty;
    this.aiEnabled = ai;

    if (ai && !this.controller.hasMock() && !this.keyStore.has()) {
      this.aiEnabled = false;
      this.controller.setNeedKey();
      throw new Error("AI run needs an API key or a mock transport");
    }

    this.state = {
      ...startGame(this.state, options?.seed ?? freshSeed()),
      control: ai ? "ai" : "human",
    };
    this.state = setDifficultyGame(this.state, this.difficulty);
    this.telemetry.reset(this.state);
    this.events.length = 0;
    this.emit([{ type: "start", tick: 0 }]);

    if (ai) {
      this.prepareAi();
    }

    this.assertInvariants();
    return viewState(this.state);
  }

  restart(seed?: number): StateView {
    return this.start({ seed, ai: this.aiEnabled });
  }

  private decisionContext(): DecisionContext {
    return this.telemetry.context(this.state, {
      queue: [...this.state.queue],
      plan: [...this.controller.plan],
    });
  }

  /** 取消不适用于当前棋盘的请求，并清空活动路线。 */
  private invalidateRoutes(): void {
    this.boardVersion += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.requestInFlight = false;
    this.requestPromise = null;
    this.pendingRoute = null;
    this.retryAtTick = 0;
    this.controller.setOff();
    this.planSource = "bridge";
  }

  /** 安装已确定的路线。只有会话可以改变实际执行的方向列表。 */
  private installPlan(moves: Direction[], source: PlanSource): void {
    this.planSource = source;
    this.controller.setPlan(moves);
  }

  /** 在移动边界处理未来结果，并从活动路线终点准备下一次选择。 */
  private prepareAi(): void {
    if (!this.aiEnabled || this.state.phase !== "playing" || this.state.queue.length > 0) return;
    if (this.planSource === "script" && this.controller.plan.length > 0) return;
    const pending = this.pendingRoute;
    if (this.controller.plan.length === 0 && pending !== null && pending.selected !== null) {
      if (matchesRouteStart(this.state, pending.expected) && pending.version === this.boardVersion) {
        const selected = pending.choices.find((choice) => choice.direction === pending.selected);
        this.pendingRoute = null;
        if (selected !== undefined) this.installPlan(selected.moves, pending.choices.length === 1 ? "forced" : "api");
      } else {
        this.executionStats.expiredResponses += 1;
        if (this.state.moveCount === pending.expected.moveCount) this.executionStats.startMismatches += 1;
        this.pendingRoute = null;
      }
    }
    if (this.pendingRoute !== null || this.requestInFlight) return;
    if (!this.controller.hasMock() && !this.keyStore.has()) {
      this.controller.setNeedKey();
      return;
    }
    if (this.controller.plan.length === 0) {
      this.installPlan(buildBridge(this.state, routeLength(this.state, this.routeLatenciesMs)), "bridge");
    }
    if (this.controller.plan.length === 0) return;
    if (this.state.tick < this.retryAtTick) return;
    const expected = projectPrefix(this.state, this.controller.plan);
    if (expected === null) return;
    // 前缀吃到食物后，路线只做避险，不追逐尚未在真实棋盘出现的食物。
    const visibleFood = expected.eaten === this.state.eaten ? this.state.food : null;
    const choices = buildRouteChoices(expected, routeLength(expected, this.routeLatenciesMs), visibleFood);
    if (choices.length === 0) return;
    const next: PendingRoute = { version: this.boardVersion, requestId: ++this.requestSeq, expected, choices, selected: null };
    this.pendingRoute = next;
    if (choices.length === 1) {
      next.selected = choices[0].direction;
      // 唯一候选在前缀终点执行，不占用网络请求。
      return;
    }
    this.requestDecision(next, buildRoutePrompt(expected, choices, visibleFood));
  }

  /** 请求只保存所选路线，实际安装留到执行起点。 */
  private requestDecision(pending: PendingRoute, prompt: string): void {
    const runId = this.runId;
    const controller = new AbortController();
    this.abortController = controller;
    this.requestInFlight = true;
    const requestStartedAt = performance.now();
    this.executionStats.requests += 1;
    this.executionStats.maxInFlight = Math.max(1, this.executionStats.maxInFlight);
    this.emit([{ type: "think", tick: this.state.tick }]);

    this.requestPromise = (async () => {
      try {
        const moves = await this.controller.request({
          prompt,
          model: this.model,
          apiKey: this.keyStore.get(),
          signal: controller.signal,
          currentDirection: pending.expected.direction,
          legalMoves: pending.choices.map((choice) => choice.direction),
          choiceDescriptions: Object.fromEntries(pending.choices.map((choice) => [choice.direction, choice.description])),
          requestId: pending.requestId,
        });
        if (controller.signal.aborted || runId !== this.runId || pending.version !== this.boardVersion || this.pendingRoute !== pending) return;
        const latency = performance.now() - requestStartedAt;
        this.telemetry.recordLatency(latency);
        this.routeLatenciesMs.push(latency);
        if (this.routeLatenciesMs.length > 8) this.routeLatenciesMs.shift();
        this.executionStats.completed += 1;
        if (this.state.moveCount > pending.expected.moveCount) {
          this.executionStats.expiredResponses += 1;
          this.pendingRoute = null;
          return;
        }
        pending.selected = moves[0];
        this.emit([{ type: "ready", tick: this.state.tick }]);
      } catch {
        if (!controller.signal.aborted && this.pendingRoute === pending) {
          this.executionStats.failedResponses += 1;
          this.pendingRoute = null;
          this.retryAtTick = this.state.tick + 60;
        }
      } finally {
        if (this.abortController === controller) {
          this.abortController = null;
          this.requestInFlight = false;
        }
      }
    })();
  }

  stepTick(): void {
    if (this.fatal !== null) return;
    if (this.state.phase !== "playing") return;

    const due = advanceClockHot(this.state);
    if (!due) {
      this.assertInvariantsHot();
      return;
    }

    if (this.aiEnabled) this.prepareAi();
    let source: PlanSource = this.state.queue.length > 0 ? "script" : this.planSource;
    if (this.aiEnabled && this.controller.plan.length > 0) {
      const dir = this.controller.consumeDirection();
      if (dir !== undefined) this.state = enqueueDirection(this.state, dir);
    } else if (this.aiEnabled && this.state.queue.length === 0) {
      source = "bridge";
      this.state = enqueueDirection(this.state, rescueDirection(this.state));
    }

    const beforeMove = this.state.moveCount;
    const beforeEaten = this.state.eaten;
    const result = advanceMove(this.state);
    this.state = result.state;
    if (this.aiEnabled && this.state.moveCount > beforeMove) {
      if (source === "api") this.executionStats.apiMoves += 1;
      else if (source === "forced") this.executionStats.forcedMoves += 1;
      else if (source === "script") this.executionStats.scriptMoves += 1;
      else this.executionStats.bridgeMoves += 1;
      if (this.state.eaten > beforeEaten) {
        if (source === "api") this.executionStats.apiEats += 1;
        else if (source === "forced") this.executionStats.forcedEats += 1;
        else if (source === "bridge") this.executionStats.bridgeEats += 1;
      }
    }
    this.telemetry.recordMove(this.state, result.events);
    this.emit(result.events);
    this.updateBestScore();
    this.assertInvariantsHot();

    if (this.state.phase === "over") {
      this.aiEnabled = false;
      this.invalidateRoutes();
      return;
    }

    if (this.aiEnabled) this.prepareAi();
  }

  stepTicks(n: number): StateView {
    const count = Math.max(0, Math.floor(n));
    for (let i = 0; i < count; i += 1) this.stepTick();
    return viewState(this.state);
  }

  stepMoves(n: number): StateView {
    const target = this.state.moveCount + Math.max(0, Math.floor(n));
    let budget = STEP_MOVES_BUDGET;
    while (this.state.phase === "playing" && this.state.moveCount < target && budget > 0) {
      this.stepTick();
      budget -= 1;
    }
    return viewState(this.state);
  }

  pause(): StateView {
    this.state = pauseGame(this.state, "user");
    if (this.state.phase === "paused") {
      this.invalidateRoutes();
      this.emit([{ type: "pause", tick: this.state.tick }]);
    }
    this.assertInvariants();
    return viewState(this.state);
  }

  resume(): StateView {
    this.state = resumeGame(this.state);
    if (this.state.phase === "playing") {
      this.emit([{ type: "resume", tick: this.state.tick }]);
      this.prepareAi();
    }
    this.assertInvariants();
    return viewState(this.state);
  }

  setDirection(dir: Direction): StateView {
    this.state = enqueueDirection(this.state, dir);
    if (this.aiEnabled) this.invalidateRoutes();
    this.assertInvariants();
    return viewState(this.state);
  }

  setSnake(cells: Cell[], dir: Direction): StateView {
    this.state = setSnakeGame(this.state, cells, dir);
    if (this.aiEnabled) this.invalidateRoutes();
    this.telemetry.reset(this.state);
    this.assertInvariants();
    return viewState(this.state);
  }

  setFood(cell: Cell | null): StateView {
    this.state = setFoodGame(this.state, cell);
    if (this.aiEnabled) this.invalidateRoutes();
    this.telemetry.reset(this.state);
    this.assertInvariants();
    return viewState(this.state);
  }

  setSpeed(moveEveryTicks: number): StateView {
    this.state = setSpeedGame(this.state, moveEveryTicks);
    if (this.aiEnabled) this.invalidateRoutes();
    this.assertInvariants();
    return viewState(this.state);
  }

  setDifficulty(difficulty: Difficulty): StateView {
    this.difficulty = difficulty;
    this.state = setDifficultyGame(this.state, difficulty);
    if (this.aiEnabled) this.invalidateRoutes();
    this.assertInvariants();
    return viewState(this.state);
  }

  getDifficulty(): Difficulty {
    return this.difficulty;
  }

  setPlan(moves: Direction[] | string): StateView {
    if (this.state.control !== "ai") {
      throw new Error("setPlan requires an AI-controlled run");
    }
    const parsed = normalizePlan(moves, this.state.direction);
    this.invalidateRoutes();
    this.state = { ...this.state, queue: [] };
    this.installPlan(parsed.moves, "script");
    this.assertInvariants();
    return viewState(this.state);
  }

  stopAi(): StateView {
    if (!this.aiEnabled) return viewState(this.state);
    this.runId += 1;
    this.invalidateRoutes();
    this.aiEnabled = false;
    this.state = { ...this.state, control: "human" };
    this.assertInvariants();
    return viewState(this.state);
  }

  retryAi(): StateView {
    if (!this.aiEnabled) return viewState(this.state);
    if (this.requestInFlight) return viewState(this.state);
    this.retryAtTick = 0;
    this.prepareAi();
    return viewState(this.state);
  }

  setCredentials(value: string): void {
    this.keyStore.set(value);
  }

  setMock(answer: Parameters<AiController["useMock"]>[0]): void {
    this.controller.useMock(answer);
  }

  clearMock(): void {
    this.invalidateRoutes();
    this.controller.clearMock();
  }

  setModel(value: string): void {
    if (this.aiEnabled) this.invalidateRoutes();
    this.model = value.trim() || DEFAULT_MODEL;
  }

  clearKey(): void {
    if (this.aiEnabled) this.invalidateRoutes();
    this.keyStore.clear();
  }

  hasKey(): boolean {
    return this.keyStore.has();
  }

  attach(): StateView {
    this.detached = false;
    return viewState(this.state);
  }

  detach(): StateView {
    this.detached = true;
    return viewState(this.state);
  }

  getState(): StateView {
    return viewState(this.state);
  }

  getObservation(): Observation {
    return buildObservation(this.state, this.decisionContext());
  }

  getPrompt(): string {
    return this.getObservation().prompt;
  }

  getDecisionContext(): DecisionContext {
    return this.decisionContext();
  }

  getInvariantReport(): { ok: boolean; violations: string[] } {
    const violations = checkInvariants(this.state);
    return { ok: violations.length === 0, violations };
  }

  getEvents(): GameEvent[] {
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  getAiLog(): AiLogEntry[] {
    return this.controller.getLog();
  }

  /** 返回本局路线来源和请求结果的副本。 */
  getAiExecutionStats(): AiExecutionStats {
    return { ...this.executionStats };
  }

  getAiStatus(): AiStatusView {
    return this.controller.getStatus();
  }

  getAiVersion(): number {
    return this.controller.getVersion();
  }

  waitForIdle(timeout = 30000): Promise<void> {
    const settled = Promise.resolve(this.requestPromise ?? undefined).then(
      () => undefined,
      () => undefined,
    );
    return withTimeout(settled, timeout);
  }
}
