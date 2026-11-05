import { INITIAL_LENGTH, SCORE_PER_FOOD } from "../config";
import { isOpposite, type Direction, type GameState } from "./types";
import { inBounds } from "./game";

export const BIT_TYPE_OK = 1 << 0;
export const BIT_BODY_ON_BOARD = 1 << 1;
export const BIT_NO_OVERLAP = 1 << 2;
export const BIT_FOOD_ON_EMPTY = 1 << 3;
export const BIT_FOOD_EXISTS = 1 << 4;
export const BIT_SCORE = 1 << 5;
export const BIT_LENGTH = 1 << 6;
export const BIT_NO_REVERSE = 1 << 7;
export const BIT_HALT = 1 << 8;
export const BIT_MENU_ZERO = 1 << 10;
export const BIT_HEAD = 1 << 11;
export const BIT_MIN_LENGTH = 1 << 12;

function isDirection(value: unknown): value is Direction {
  return value === "up" || value === "down" || value === "left" || value === "right";
}

function isCell(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const cell = value as { x?: unknown; y?: unknown };
  return Number.isInteger(cell.x) && Number.isInteger(cell.y);
}

function isOverReason(value: unknown): boolean {
  return value === null || value === "wall" || value === "self" || value === "win";
}

function isPauseReason(value: unknown): boolean {
  return value === null || value === "user" || value === "ai" || value === "hidden";
}

function isPhase(value: unknown): boolean {
  return (
    value === "menu" ||
    value === "playing" ||
    value === "paused" ||
    value === "over"
  );
}

function isControl(value: unknown): boolean {
  return value === "human" || value === "ai";
}

function isCounter(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function checkInvariantsMask(state: GameState): number {
  let mask = 0;
  const width = state.width;
  const height = state.height;
  const snake = state.snake;
  const snakeLength = snake.length;

  let typeOk = true;
  if (!isPhase(state.phase)) typeOk = false;
  if (!isControl(state.control)) typeOk = false;
  if (!isDirection(state.direction)) typeOk = false;
  if (!Array.isArray(state.queue) || state.queue.length > 2) typeOk = false;
  else {
    for (let i = 0; i < state.queue.length; i += 1) {
      if (!isDirection(state.queue[i])) typeOk = false;
    }
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    typeOk = false;
  }
  if (!Array.isArray(snake)) typeOk = false;
  else {
    for (let i = 0; i < snakeLength; i += 1) {
      if (!isCell(snake[i])) typeOk = false;
    }
  }
  if (!isCounter(state.tick)) typeOk = false;
  if (!isCounter(state.haltTick)) typeOk = false;
  if (!isCounter(state.moveCount)) typeOk = false;
  if (!isCounter(state.moveEveryTicks)) typeOk = false;
  if (!isCounter(state.moveAccumulator)) typeOk = false;
  if (!isCounter(state.score)) typeOk = false;
  if (!isCounter(state.eaten)) typeOk = false;
  if (!isCounter(state.seed)) typeOk = false;
  if (!isCounter(state.rng)) typeOk = false;
  if (!isOverReason(state.overReason)) typeOk = false;
  if (!isPauseReason(state.pauseReason)) typeOk = false;
  if (state.lastMove !== null) {
    if (!isCell(state.lastMove.from) || !isCell(state.lastMove.to)) typeOk = false;
  }
  if (state.food !== null) {
    if (!isCell(state.food) || !inBounds(state.food, width, height)) typeOk = false;
  }
  if (!typeOk) mask |= BIT_TYPE_OK;

  let bodyOnBoard = true;
  for (let i = 0; i < snakeLength; i += 1) {
    if (!inBounds(snake[i], width, height)) bodyOnBoard = false;
  }
  if (!bodyOnBoard) mask |= BIT_BODY_ON_BOARD;

  let overlap = false;
  for (let i = 0; i < snakeLength && !overlap; i += 1) {
    for (let j = i + 1; j < snakeLength; j += 1) {
      if (snake[i].x === snake[j].x && snake[i].y === snake[j].y) {
        overlap = true;
        break;
      }
    }
  }
  if (overlap) mask |= BIT_NO_OVERLAP;

  if (snakeLength === 0) mask |= BIT_HEAD;
  if (snakeLength < INITIAL_LENGTH) mask |= BIT_MIN_LENGTH;

  if (state.food !== null) {
    let onSnake = false;
    for (let i = 0; i < snakeLength; i += 1) {
      if (snake[i].x === state.food.x && snake[i].y === state.food.y) onSnake = true;
    }
    if (onSnake) mask |= BIT_FOOD_ON_EMPTY;
  }

  if (
    (state.phase === "playing" || state.phase === "paused") &&
    state.food === null
  ) {
    mask |= BIT_FOOD_EXISTS;
  }

  if (state.score !== SCORE_PER_FOOD * state.eaten) mask |= BIT_SCORE;
  if (snakeLength !== INITIAL_LENGTH + state.eaten) mask |= BIT_LENGTH;

  let previous: Direction = state.direction;
  for (let i = 0; i < state.queue.length; i += 1) {
    const direction = state.queue[i];
    if (isOpposite(previous, direction)) {
      mask |= BIT_NO_REVERSE;
      break;
    }
    previous = direction;
  }

  if (
    (state.phase === "paused" || state.phase === "over") &&
    state.tick !== state.haltTick
  ) {
    mask |= BIT_HALT;
  }

  if (state.phase === "menu" && (state.tick !== 0 || state.haltTick !== 0)) {
    mask |= BIT_MENU_ZERO;
  }

  return mask;
}
