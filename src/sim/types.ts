import type { Difficulty } from "../config";

export type Direction = "up" | "down" | "left" | "right";
export type Phase = "menu" | "playing" | "paused" | "over";
export type OverReason = "wall" | "self" | "win";
export type PauseReason = "user" | "ai" | "hidden" | null;
export type Control = "human" | "ai";

export interface Cell {
  x: number;
  y: number;
}

export interface GameState {
  phase: Phase;
  control: Control;
  width: number;
  height: number;
  tick: number;
  haltTick: number;
  moveCount: number;
  moveEveryTicks: number;
  moveAccumulator: number;
  difficulty: Difficulty;
  snake: Cell[];
  direction: Direction;
  queue: Direction[];
  food: Cell | null;
  score: number;
  eaten: number;
  seed: number;
  rng: number;
  overReason: OverReason | null;
  pauseReason: PauseReason;
  lastMove: { from: Cell; to: Cell } | null;
}

export type StateView = GameState;

export type GameEventType =
  | "start"
  | "move"
  | "eat"
  | "crash"
  | "win"
  | "pause"
  | "resume"
  | "think"
  | "ready";

export interface GameEvent {
  type: GameEventType;
  tick: number;
}

export const DIRECTIONS: Direction[] = ["up", "down", "left", "right"];

export const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export const DX: Record<Direction, number> = { up: 0, down: 0, left: -1, right: 1 };
export const DY: Record<Direction, number> = { up: -1, down: 1, left: 0, right: 0 };

export function isOpposite(a: Direction, b: Direction): boolean {
  return OPPOSITE[a] === b;
}
