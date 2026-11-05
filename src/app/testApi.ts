import type {
  AiController,
  AiLogEntry,
  AiStatusView,
  MockAnswer,
} from "../ai/controller";
import type { Observation } from "../sim/observation";
import type { Cell, Direction, GameEvent, StateView } from "../sim/types";
import type { GameSession, StartOptions } from "./session";

export const VERSION = "1.0.0";

const HELP_TEXT = [
  "start({seed, ai})  reset and run (ai:true uses a mock or the in-memory key)",
  "restart(seed?)     reset with the same mode",
  "attach() / detach()  hand the run back to real time / freeze it for steps",
  "stepTicks(n)       advance n fixed ticks",
  "stepMoves(n)       advance until n moves happen or the run ends",
  "setDirection(dir)  queue a direction (up/down/left/right)",
  "setSnake(cells, dir)  place a contiguous snake",
  "setFood(cell)      place food on an empty cell",
  "setSpeed(t)        set ticks-per-move, 1..60",
  "pause() / resume()",
  "getState() getObservation() getPrompt() getInvariantReport()",
  "getEvents() getAiLog()",
  "ai.setPlan(moves) ai.useMock(a) ai.clearMock() ai.getStatus() ai.waitForIdle()",
].join("\n");

export interface SnakeApi {
  version: string;
  help(): string;
  start(options?: StartOptions): StateView;
  attach(): StateView;
  detach(): StateView;
  restart(seed?: number): StateView;
  stepTicks(n: number): StateView;
  stepMoves(n: number): StateView;
  setDirection(dir: Direction): StateView;
  setSnake(cells: Cell[], dir: Direction): StateView;
  setFood(cell: Cell | null): StateView;
  setSpeed(moveEveryTicks: number): StateView;
  pause(): StateView;
  resume(): StateView;
  getState(): StateView;
  getObservation(): Observation;
  getPrompt(): string;
  getInvariantReport(): { ok: boolean; violations: string[] };
  getEvents(): GameEvent[];
  getAiLog(): AiLogEntry[];
  ai: {
    setPlan(moves: Direction[] | string): StateView;
    useMock(answer: MockAnswer): void;
    clearMock(): void;
    getStatus(): AiStatusView;
    waitForIdle(timeout?: number): Promise<void>;
  };
}

export function createTestApi(
  session: GameSession,
  controller: AiController,
): SnakeApi {
  const view = () => session.getState();
  const detachAnd = <T>(fn: () => T): T => {
    session.detach();
    return fn();
  };

  return {
    version: VERSION,
    help: () => HELP_TEXT,
    start: (options) => detachAnd(() => session.start(options)),
    attach: () => {
      session.attach();
      return view();
    },
    detach: () => {
      session.detach();
      return view();
    },
    restart: (seed) => detachAnd(() => session.restart(seed)),
    stepTicks: (n) => detachAnd(() => session.stepTicks(n)),
    stepMoves: (n) => detachAnd(() => session.stepMoves(n)),
    setDirection: (dir) => detachAnd(() => session.setDirection(dir)),
    setSnake: (cells, dir) => detachAnd(() => session.setSnake(cells, dir)),
    setFood: (cell) => detachAnd(() => session.setFood(cell)),
    setSpeed: (t) => detachAnd(() => session.setSpeed(t)),
    pause: () => detachAnd(() => session.pause()),
    resume: () => detachAnd(() => session.resume()),
    getState: () => session.getState(),
    getObservation: () => session.getObservation(),
    getPrompt: () => session.getPrompt(),
    getInvariantReport: () => session.getInvariantReport(),
    getEvents: () => session.getEvents(),
    getAiLog: () => session.getAiLog(),
    ai: {
      setPlan: (moves) => detachAnd(() => session.setPlan(moves)),
      useMock: (answer) => {
        session.detach();
        controller.useMock(answer);
      },
      clearMock: () => {
        session.detach();
        controller.clearMock();
      },
      getStatus: () => session.getAiStatus(),
      waitForIdle: (timeout) => session.waitForIdle(timeout),
    },
  };
}
