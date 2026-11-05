import type { Direction, GameState } from "../sim/types";

export function directionToken(dir: Direction): string {
  return { up: "U", down: "D", left: "L", right: "R" }[dir];
}

export function buildPrompt(
  state: GameState,
  map: string,
  legalMoves: Direction[],
): string {
  const legal = legalMoves.map(directionToken).join(" ");
  const lines = [
    "You are playing a deterministic Snake game on a grid.",
    "",
    "LEGEND",
    "# wall, . empty, H head, s body, * food",
    "",
    "RULES",
    "x grows right, y grows down. Coordinates are 0-based.",
    "The snake moves one cell per move. Each move advances the head in a direction.",
    "Moving into a wall or the body ends the run, except the tail cell is vacated when not eating.",
    "Eating the food scores 10 points and grows the snake by one segment.",
    "You may never reverse 180 degrees into the neck.",
    "",
    "STATE",
    `board ${state.width}x${state.height}`,
    `current direction ${directionToken(state.direction)}`,
    `score ${state.score}`,
    `length ${state.snake.length}`,
    `speed ${state.moveEveryTicks} ticks per move`,
    `legal first moves ${legal}`,
    "",
    "MAP",
    map,
    "",
    "TASK",
    "The decision question chooses the next legal move. Keep escape room and prefer food.",
    "The board is complete and does not change while the decision is made.",
  ];
  return lines.join("\n");
}
