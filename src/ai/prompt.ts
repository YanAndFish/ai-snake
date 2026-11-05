import { analyzeMove, type MoveAnalysis } from "../sim/analysis";
import type { Direction, GameState } from "../sim/types";

export function directionToken(dir: Direction): string {
  return { up: "U", down: "D", left: "L", right: "R" }[dir];
}

function formatMove(option: MoveAnalysis, hasFood: boolean): string {
  const token = directionToken(option.direction);
  if (!option.safe) return `${token}: CRASH`;
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
  return `${token}: SAFE; ${room}; ${food}`;
}

export function buildPrompt(state: GameState, legalMoves: Direction[]): string {
  const analysis = legalMoves.map((direction) =>
    formatMove(analyzeMove(state, direction), state.food !== null),
  );
  const lines = [
    "SNAKE/1",
    "Choose exactly one allowed turn for the current board.",
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
