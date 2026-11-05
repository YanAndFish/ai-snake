import {
  DX,
  DY,
  type Cell,
  type Direction,
  type GameState,
} from "./types";
import { advanceMove, enqueueDirection } from "./game";

export type CrashReason = "wall" | "self" | null;

export interface MoveAnalysis {
  /** 这次分析对应的方向。 */
  direction: Direction;
  /** 下一步蛇头所在的格子。 */
  target: Cell;
  /** 下一步是否能完成移动。 */
  safe: boolean;
  /** 撞击原因；null 表示下一步安全。 */
  crash: CrashReason;
  /** 下一步是否吃到食物。 */
  eats: boolean;
  /** 移动后可通往的空格数，不包括蛇头所在格。 */
  space: number;
  /** 空间是否足够容纳当前蛇身。 */
  room: "ample" | "tight";
  /** 移动后到食物的最短路长度；null 表示暂时无法到达。 */
  foodDistance: number | null;
  /** 移动后是否有一条空路通往尾格。 */
  tailReachable: boolean;
  /** 选择这个方向后，保持直行还能安全移动的步数，包含第一步。 */
  runway: number;
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
): { space: number; foodDistance: number | null; tailReachable: boolean } {
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
  let tailReachable = false;
  const tail = snake[snake.length - 1];
  const tailIndex = tail.y * width + tail.x;
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
      // 允许路径在尾格结束，但不能穿过还没有移开的尾巴。
      if (next === tailIndex) tailReachable = true;
      if (distances[next] !== -1 || blocked[next] === 1) continue;
      distances[next] = distances[index] + 1;
      space += 1;
      if (next === foodIndex) foodDistance = distances[next];
      queue.push(next);
    }
  }

  return { space, foodDistance, tailReachable };
}

/** 返回沿指定方向连续移动的安全步数，包含首次转向的那一步。 */
function straightRunway(state: GameState, direction: Direction): number {
  let current = enqueueDirection({ ...state, queue: [] }, direction);
  let moves = 0;
  const limit = Math.max(state.width, state.height);
  while (moves < limit && current.phase === "playing") {
    const result = advanceMove(current);
    if (result.events.some((event) => event.type === "crash")) break;
    moves += 1;
    current = result.state.eaten > current.eaten ? { ...result.state, food: null } : result.state;
  }
  return moves;
}

/** 返回当前蛇头到食物的最短路长度；null 表示食物无法到达。 */
export function shortestFoodDistance(state: GameState): number | null {
  if (state.food === null || state.snake.length === 0) return null;
  return analyzeReachable(state, state.snake, state.snake[0]).foodDistance;
}

/** 分析一次转向的碰撞、食物路径、退路和直行距离。 */
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
      tailReachable: false,
      runway: 0,
    };
  }

  // 吃食物时尾巴留在原地，其余移动会释放尾格。
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
      tailReachable: false,
      runway: 0,
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
    tailReachable: reachable.tailReachable,
    runway: straightRunway(state, direction),
  };
}

export function analyzeMoves(
  state: GameState,
  directions: readonly Direction[],
): MoveAnalysis[] {
  return directions.map((direction) => analyzeMove(state, direction));
}
