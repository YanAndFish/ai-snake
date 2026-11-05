import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  DEFAULT_SEED,
  INITIAL_LENGTH,
  MAX_QUEUE,
  SCORE_PER_FOOD,
  moveEveryTicksFor,
} from "../config";
import { rngNext } from "../engine/rng";
import { advanceClockHot } from "./tick.hot";
import {
  DX,
  DY,
  type Cell,
  type Direction,
  type GameEvent,
  type GameState,
  type PauseReason,
  type StateView,
  isOpposite,
} from "./types";

export { moveEveryTicksFor };

export function inBounds(cell: Cell, width: number, height: number): boolean {
  return (
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    cell.x >= 0 &&
    cell.x < width &&
    cell.y >= 0 &&
    cell.y < height
  );
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

export function cellIndex(cell: Cell, width: number): number {
  return cell.y * width + cell.x;
}

export function freeCells(state: GameState): Cell[] {
  const occupied = new Set(state.snake.map((c) => cellIndex(c, state.width)));
  const cells: Cell[] = [];
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      if (!occupied.has(y * state.width + x)) cells.push({ x, y });
    }
  }
  return cells;
}

export function initialSnake(width: number, height: number): Cell[] {
  const hy = Math.floor(height / 2);
  const hx = Math.max(2, Math.floor(width / 2));
  return [
    { x: hx, y: hy },
    { x: hx - 1, y: hy },
    { x: hx - 2, y: hy },
  ];
}

function spawnFood(state: GameState): GameState {
  const free = freeCells(state);
  if (free.length === 0) return { ...state, food: null };
  const step = rngNext(state.rng);
  const idx = Math.floor(step.value * free.length);
  return { ...state, food: free[idx], rng: step.state };
}

export function createGame(options?: {
  seed?: number;
  width?: number;
  height?: number;
}): GameState {
  const width = options?.width ?? BOARD_WIDTH;
  const height = options?.height ?? BOARD_HEIGHT;
  const seed = (options?.seed ?? DEFAULT_SEED) >>> 0;
  const base: GameState = {
    phase: "menu",
    control: "human",
    width,
    height,
    tick: 0,
    haltTick: 0,
    moveCount: 0,
    moveEveryTicks: moveEveryTicksFor(0),
    moveAccumulator: 0,
    snake: initialSnake(width, height),
    direction: "right",
    queue: [],
    food: null,
    score: 0,
    eaten: 0,
    seed,
    rng: seed,
    overReason: null,
    pauseReason: null,
    lastMove: null,
  };
  return spawnFood(base);
}

export function startGame(state: GameState, seed?: number): GameState {
  const width = state.width;
  const height = state.height;
  const nextSeed = (seed ?? state.seed) >>> 0;
  const base: GameState = {
    phase: "playing",
    control: "human",
    width,
    height,
    tick: 0,
    haltTick: 0,
    moveCount: 0,
    moveEveryTicks: moveEveryTicksFor(0),
    moveAccumulator: 0,
    snake: initialSnake(width, height),
    direction: "right",
    queue: [],
    food: null,
    score: 0,
    eaten: 0,
    seed: nextSeed,
    rng: nextSeed,
    overReason: null,
    pauseReason: null,
    lastMove: null,
  };
  return spawnFood(base);
}

export function pauseGame(state: GameState, reason?: PauseReason): GameState {
  if (state.phase !== "playing") return state;
  return {
    ...state,
    phase: "paused",
    haltTick: state.tick,
    pauseReason: reason ?? "user",
  };
}

export function resumeGame(state: GameState): GameState {
  if (state.phase !== "paused") return state;
  return { ...state, phase: "playing", pauseReason: null };
}

export function beginThinking(state: GameState): GameState {
  if (state.control !== "ai") {
    throw new Error("beginThinking requires an AI-controlled run");
  }
  if (state.phase === "thinking") return state;
  if (state.phase !== "playing") {
    throw new Error("beginThinking requires a playing run");
  }
  return {
    ...state,
    phase: "thinking",
    haltTick: state.tick,
    pauseReason: "ai",
  };
}

export function finishThinking(state: GameState): GameState {
  if (state.phase !== "thinking") return state;
  return { ...state, phase: "playing", pauseReason: null };
}

export function enqueueDirection(state: GameState, dir: Direction): GameState {
  if (state.phase !== "playing") return state;
  if (state.queue.length >= MAX_QUEUE) return state;
  const last = state.queue.length > 0 ? state.queue[state.queue.length - 1] : state.direction;
  if (dir === last || isOpposite(last, dir)) return state;
  return { ...state, queue: [...state.queue, dir] };
}

export function advanceTick(state: GameState): {
  state: GameState;
  events: GameEvent[];
} {
  if (state.phase !== "playing") {
    return { state, events: [] };
  }
  const next = cloneState(state);
  if (!advanceClockHot(next)) {
    return { state: next, events: [] };
  }
  return advanceMove(next);
}

export function advanceMove(state: GameState): {
  state: GameState;
  events: GameEvent[];
} {
  let s: GameState = state;
  let direction = s.direction;
  let queue = s.queue;
  if (queue.length > 0) {
    direction = queue[0];
    queue = queue.slice(1);
  }

  const head = s.snake[0];
  const newHead: Cell = { x: head.x + DX[direction], y: head.y + DY[direction] };

  if (!inBounds(newHead, s.width, s.height)) {
    return {
      state: {
        ...s,
        direction,
        queue: [],
        phase: "over",
        overReason: "wall",
        haltTick: s.tick,
        lastMove: null,
      },
      events: [{ type: "crash", tick: s.tick }],
    };
  }

  const willEat = s.food !== null && sameCell(newHead, s.food);
  const bodyToCheck = willEat ? s.snake : s.snake.slice(0, -1);
  if (bodyToCheck.some((c) => sameCell(c, newHead))) {
    return {
      state: {
        ...s,
        direction,
        queue: [],
        phase: "over",
        overReason: "self",
        haltTick: s.tick,
        lastMove: null,
      },
      events: [{ type: "crash", tick: s.tick }],
    };
  }

  const newSnake = [newHead, ...(willEat ? s.snake : s.snake.slice(0, -1))];
  let next: GameState = {
    ...s,
    direction,
    queue,
    snake: newSnake,
    moveCount: s.moveCount + 1,
    lastMove: { from: head, to: newHead },
  };

  const events: GameEvent[] = [{ type: "move", tick: s.tick }];

  if (willEat) {
    const eaten = s.eaten + 1;
    next = {
      ...next,
      eaten,
      score: SCORE_PER_FOOD * eaten,
      moveEveryTicks: moveEveryTicksFor(eaten),
    };
    events.push({ type: "eat", tick: s.tick });

    const free = freeCells(next);
    if (free.length === 0) {
      next = {
        ...next,
        food: null,
        phase: "over",
        overReason: "win",
        haltTick: s.tick,
        queue: [],
      };
      events.push({ type: "win", tick: s.tick });
    } else {
      const step = rngNext(next.rng);
      const idx = Math.floor(step.value * free.length);
      next = { ...next, food: free[idx], rng: step.state };
    }
  }

  return { state: next, events };
}

function assertDirection(dir: Direction): void {
  if (dir !== "up" && dir !== "down" && dir !== "left" && dir !== "right") {
    throw new Error(`invalid direction: ${String(dir)}`);
  }
}

export function setSnake(state: GameState, cells: Cell[], dir: Direction): GameState {
  assertDirection(dir);
  if (!Array.isArray(cells) || cells.length < INITIAL_LENGTH) {
    throw new Error("setSnake requires at least 3 cells");
  }
  for (const cell of cells) {
    if (!inBounds(cell, state.width, state.height)) {
      throw new Error(`setSnake cell out of bounds: ${cell.x},${cell.y}`);
    }
  }
  const seen = new Set<number>();
  for (const cell of cells) {
    const key = cellIndex(cell, state.width);
    if (seen.has(key)) {
      throw new Error(`setSnake cell duplicated: ${cell.x},${cell.y}`);
    }
    seen.add(key);
  }
  for (let i = 1; i < cells.length; i += 1) {
    const a = cells[i - 1];
    const b = cells[i];
    const adjacent = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
    if (!adjacent) {
      throw new Error(`setSnake cells must be 4-neighbor contiguous at index ${i}`);
    }
  }

  const eaten = cells.length - INITIAL_LENGTH;
  let next: GameState = {
    ...state,
    phase: "playing",
    snake: cells.map((c) => ({ ...c })),
    direction: dir,
    queue: [],
    eaten,
    score: SCORE_PER_FOOD * eaten,
    moveEveryTicks: moveEveryTicksFor(eaten),
    moveAccumulator: 0,
    overReason: null,
    pauseReason: null,
    haltTick: state.tick,
    lastMove: null,
  };

  if (
    next.food === null ||
    !inBounds(next.food, next.width, next.height) ||
    next.snake.some((c) => sameCell(c, next.food!))
  ) {
    next = spawnFood(next);
  }
  if (next.food === null) {
    next = { ...next, phase: "over", overReason: "win", haltTick: next.tick, queue: [] };
  }
  return next;
}

export function setFood(state: GameState, cell: Cell | null): GameState {
  if (cell === null) {
    if (state.phase !== "over") {
      throw new Error("setFood(null) is only valid after the run ends");
    }
    return { ...state, food: null };
  }
  if (!inBounds(cell, state.width, state.height)) {
    throw new Error(`setFood cell out of bounds: ${cell.x},${cell.y}`);
  }
  if (state.snake.some((c) => sameCell(c, cell))) {
    throw new Error(`setFood cell is on the snake: ${cell.x},${cell.y}`);
  }
  return { ...state, food: { ...cell } };
}

export function setSpeed(state: GameState, moveEveryTicks: number): GameState {
  if (!Number.isFinite(moveEveryTicks)) {
    throw new Error("setSpeed requires a number");
  }
  const clamped = Math.min(60, Math.max(1, Math.floor(moveEveryTicks)));
  return { ...state, moveEveryTicks: clamped, moveAccumulator: 0 };
}

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    snake: state.snake.map((c) => ({ ...c })),
    queue: [...state.queue],
    food: state.food ? { ...state.food } : null,
    lastMove: state.lastMove
      ? { from: { ...state.lastMove.from }, to: { ...state.lastMove.to } }
      : null,
  };
}

export function viewState(state: GameState): StateView {
  return cloneState(state);
}
