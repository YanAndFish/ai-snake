import {
  DX,
  DY,
  type Cell,
  type Direction,
  type GameState,
} from "./types";

export type CrashReason = "wall" | "self" | null;

export interface MoveAnalysis {
  direction: Direction;
  target: Cell;
  safe: boolean;
  crash: CrashReason;
  eats: boolean;
  space: number;
  room: "ample" | "tight";
  foodDistance: number | null;
}

const NEIGHBOR_X = [0, 0, -1, 1];
const NEIGHBOR_Y = [-1, 1, 0, 0];

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

function inBounds(cell: Cell, width: number, height: number): boolean {
  return cell.x >= 0 && cell.x < width && cell.y >= 0 && cell.y < height;
}

function analyzeReachable(
  state: GameState,
  snake: Cell[],
  start: Cell,
): { space: number; foodDistance: number | null } {
  const width = state.width;
  const height = state.height;
  const blocked = new Uint8Array(width * height);
  for (const cell of snake) blocked[cell.y * width + cell.x] = 1;

  const distances = new Int16Array(width * height).fill(-1);
  const startIndex = start.y * width + start.x;
  distances[startIndex] = 0;
  const queue: number[] = [startIndex];
  let cursor = 0;
  let space = 0;
  let foodDistance: number | null = null;
  const foodIndex =
    state.food === null ? -1 : state.food.y * width + state.food.x;

  while (cursor < queue.length) {
    const index = queue[cursor];
    cursor += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let i = 0; i < 4; i += 1) {
      const nx = x + NEIGHBOR_X[i];
      const ny = y + NEIGHBOR_Y[i];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const next = ny * width + nx;
      if (distances[next] !== -1 || blocked[next] === 1) continue;
      distances[next] = distances[index] + 1;
      space += 1;
      if (next === foodIndex) foodDistance = distances[next];
      queue.push(next);
    }
  }

  return { space, foodDistance };
}

export function analyzeMove(state: GameState, direction: Direction): MoveAnalysis {
  const head = state.snake[0];
  const target: Cell = { x: head.x + DX[direction], y: head.y + DY[direction] };
  const eats = state.food !== null && sameCell(target, state.food);

  if (!inBounds(target, state.width, state.height)) {
    return {
      direction,
      target,
      safe: false,
      crash: "wall",
      eats: false,
      space: 0,
      room: "tight",
      foodDistance: null,
    };
  }

  // The tail vacates its cell unless the head eats this turn.
  const bodyAfterMove = eats ? state.snake : state.snake.slice(0, -1);
  if (bodyAfterMove.some((cell) => sameCell(cell, target))) {
    return {
      direction,
      target,
      safe: false,
      crash: "self",
      eats: false,
      space: 0,
      room: "tight",
      foodDistance: null,
    };
  }

  const nextSnake = [target, ...bodyAfterMove];
  const reachable = analyzeReachable(state, nextSnake, target);
  return {
    direction,
    target,
    safe: true,
    crash: null,
    eats,
    space: reachable.space,
    room: reachable.space >= state.snake.length + 2 ? "ample" : "tight",
    foodDistance: eats ? 0 : reachable.foodDistance,
  };
}

export function analyzeMoves(
  state: GameState,
  directions: readonly Direction[],
): MoveAnalysis[] {
  return directions.map((direction) => analyzeMove(state, direction));
}
