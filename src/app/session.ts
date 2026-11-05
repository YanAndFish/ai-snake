import { DEFAULT_MODEL } from "../config";
import {
  type AiLogEntry,
  type AiStatusView,
  AiController,
} from "../ai/controller";
import { normalizePlan } from "../ai/response";
import {
  advanceMove,
  createGame,
  enqueueDirection,
  pauseGame,
  resumeGame,
  setFood as setFoodGame,
  setSnake as setSnakeGame,
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
}

export interface SessionOptions {
  controller: AiController;
  keyStore: KeyStore;
  bestScore?: ScoreStore;
  model?: string;
  onEvents?: (events: GameEvent[]) => void;
  onFatal?: (message: string) => void;
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

  constructor(options: SessionOptions) {
    this.controller = options.controller;
    this.keyStore = options.keyStore;
    this.bestScoreStore = options.bestScore ?? null;
    this.bestScore = this.bestScoreStore?.load() ?? 0;
    this.model = options.model ?? DEFAULT_MODEL;
    this.onEvents = options.onEvents ?? null;
    this.onFatal = options.onFatal ?? null;
    this.state = createGame();
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
    this.abortController?.abort();
    this.frozen = false;
    this.fatal = null;
    const ai = options?.ai === true;
    this.aiEnabled = ai;

    if (ai && !this.controller.hasMock() && !this.keyStore.has()) {
      this.controller.setNeedKey();
      throw new Error("AI run needs an API key or a mock transport");
    }

    this.state = startGame(this.state, options?.seed ?? freshSeed());
    this.events.length = 0;
    this.emit([{ type: "start", tick: 0 }]);

    if (ai) {
      this.state = { ...this.state, control: "ai" };
      this.requestDecision();
    } else {
      this.state = { ...this.state, control: "human" };
    }

    this.assertInvariants();
    return viewState(this.state);
  }

  restart(seed?: number): StateView {
    return this.start({ seed, ai: this.aiEnabled });
  }

  private requestDecision(): void {
    if (!this.aiEnabled || this.requestInFlight || this.state.phase !== "playing") return;
    const runId = this.runId;
    const requestId = this.requestSeq + 1;
    this.requestSeq = requestId;
    const controller = new AbortController();
    this.abortController = controller;
    this.requestInFlight = true;
    const observation = buildObservation(this.state);
    this.emit([{ type: "think", tick: this.state.tick }]);

    this.requestPromise = (async () => {
      try {
        await this.controller.request({
          prompt: observation.prompt,
          model: this.model,
          apiKey: this.keyStore.get(),
          signal: controller.signal,
          observation: observation.map,
          currentDirection: this.state.direction,
          legalMoves: observation.legalMoves,
          requestId,
        });
        if (runId !== this.runId || !this.aiEnabled || this.state.phase !== "playing") return;
        if (this.controller.plan.length > 0) {
          this.emit([{ type: "ready", tick: this.state.tick }]);
        }
      } catch {
        // The game keeps moving; a slow or failed request can cost the run.
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

    let consumed = false;
    if (this.aiEnabled && this.controller.plan.length > 0) {
      const dir = this.controller.plan.shift() as Direction;
      this.state = enqueueDirection(this.state, dir);
      consumed = true;
    }

    const result = advanceMove(this.state);
    this.state = result.state;
    this.emit(result.events);
    this.updateBestScore();
    this.assertInvariantsHot();

    if (this.state.phase === "over") {
      this.aiEnabled = false;
      this.abortController?.abort();
      this.abortController = null;
      this.requestInFlight = false;
      this.controller.setOff();
      return;
    }

    if (this.aiEnabled && consumed && this.controller.plan.length === 0) {
      this.requestDecision();
    }
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
    if (this.state.phase === "paused") this.emit([{ type: "pause", tick: this.state.tick }]);
    this.assertInvariants();
    return viewState(this.state);
  }

  resume(): StateView {
    this.state = resumeGame(this.state);
    if (this.state.phase === "playing") this.emit([{ type: "resume", tick: this.state.tick }]);
    this.assertInvariants();
    return viewState(this.state);
  }

  setDirection(dir: Direction): StateView {
    this.state = enqueueDirection(this.state, dir);
    this.assertInvariants();
    return viewState(this.state);
  }

  setSnake(cells: Cell[], dir: Direction): StateView {
    this.state = setSnakeGame(this.state, cells, dir);
    this.assertInvariants();
    return viewState(this.state);
  }

  setFood(cell: Cell | null): StateView {
    this.state = setFoodGame(this.state, cell);
    this.assertInvariants();
    return viewState(this.state);
  }

  setSpeed(moveEveryTicks: number): StateView {
    this.state = setSpeedGame(this.state, moveEveryTicks);
    this.assertInvariants();
    return viewState(this.state);
  }

  setPlan(moves: Direction[] | string): StateView {
    if (this.state.control !== "ai") {
      throw new Error("setPlan requires an AI-controlled run");
    }
    const parsed = normalizePlan(moves, this.state.direction);
    this.abortController?.abort();
    this.abortController = null;
    this.requestInFlight = false;
    this.controller.setPlan(parsed.moves);
    this.assertInvariants();
    return viewState(this.state);
  }

  stopAi(): StateView {
    if (!this.aiEnabled) return viewState(this.state);
    this.runId += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.requestInFlight = false;
    this.aiEnabled = false;
    this.controller.setOff();
    this.state = { ...this.state, control: "human" };
    this.assertInvariants();
    return viewState(this.state);
  }

  retryAi(): StateView {
    if (!this.aiEnabled) return viewState(this.state);
    if (this.requestInFlight) return viewState(this.state);
    this.requestDecision();
    return viewState(this.state);
  }

  setCredentials(value: string): void {
    this.keyStore.set(value);
  }

  setModel(value: string): void {
    this.model = value.trim() || DEFAULT_MODEL;
  }

  clearKey(): void {
    this.keyStore.clear();
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
    return buildObservation(this.state);
  }

  getPrompt(): string {
    return buildObservation(this.state).prompt;
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
