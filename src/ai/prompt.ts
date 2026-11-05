import { analyzeMove, type MoveAnalysis } from "../sim/analysis";
import type { Direction, GameState } from "../sim/types";

export function directionToken(dir: Direction): string {
  return { up: "U", down: "D", left: "L", right: "R" }[dir];
}

function formatMove(option: MoveAnalysis, hasFood: boolean): string {
  const token = directionToken(option.direction);
  const target = `(${option.target.x}, ${option.target.y})`;
  if (!option.safe) return `${token} ${target}: CRASH`;
  const food =
    !hasFood
      ? "no food"
      : option.eats
        ? "EATS FOOD"
        : option.foodDistance === null
          ? "food unreachable"
          : `food ${option.foodDistance}`;
  const room =
    option.room === "tight"
      ? `room tight; space ${option.space}`
      : "room ample";
  return `${token} ${target}: SAFE; ${room}; ${food}`;
}

export function buildPrompt(state: GameState, legalMoves: Direction[]): string {
  const head = state.snake[0];
  const neck = state.snake[1] ?? head;
  const tail = state.snake[state.snake.length - 1] ?? head;
  const food = state.food === null ? "none" : `(${state.food.x}, ${state.food.y})`;
  const analysis = legalMoves.map((direction) =>
    formatMove(analyzeMove(state, direction), state.food !== null),
  );
  const lines = [
    "SNAKE/1",
    "Choose exactly one allowed turn for the current board.",
    "",
    "STATE",
    `board ${state.width}x${state.height}; x grows right, y grows down, coordinates are 0-based`,
    `head (${head.x}, ${head.y}); neck (${neck.x}, ${neck.y}); tail (${tail.x}, ${tail.y}); food ${food}`,
    `current direction ${directionToken(state.direction)}; length ${state.snake.length}`,
    "",
    "MOVE ANALYSIS",
    "room: ample or tight; tight means little escape space relative to snake length.",
    "space: reachable empty cells after the move; shown for tight turns.",
    "food: shortest path to the food after the move. CRASH ends the run; EATS FOOD grows the snake.",
    ...analysis,
    "",
    "TASK",
    "1. Never choose CRASH when any SAFE turn exists.",
    "2. If any ample-room turn exists, ignore tight turns. Among them, prefer EATS FOOD, otherwise the smallest food distance.",
    "3. If only tight turns exist, choose the largest space.",
    `4. If all turns crash, or the best turns tie, prefer the current direction ${directionToken(state.direction)}.`,
    "",
    "The simulation keeps moving during the request; answer quickly for this snapshot.",
  ];
  return lines.join("\n");
}
