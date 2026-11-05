import { buildPrompt } from "../ai/prompt";
import { DIRECTIONS, isOpposite, type Direction, type GameState, type StateView } from "./types";
import { viewState } from "./game";

export interface Observation {
  map: string;
  prompt: string;
  legalMoves: Direction[];
  view: StateView;
}

export type ObservationView = Observation;

function glyphAt(state: GameState, x: number, y: number): string {
  if (state.snake.length > 0 && state.snake[0].x === x && state.snake[0].y === y) {
    return "H";
  }
  if (state.snake.slice(1).some((c) => c.x === x && c.y === y)) {
    return "s";
  }
  if (state.food !== null && state.food.x === x && state.food.y === y) {
    return "*";
  }
  return ".";
}

export function buildMap(state: GameState): string {
  const border = "#".repeat(state.width + 2);
  const rows: string[] = [border];
  for (let y = 0; y < state.height; y += 1) {
    let line = "#";
    for (let x = 0; x < state.width; x += 1) {
      line += glyphAt(state, x, y);
    }
    line += "#";
    rows.push(line);
  }
  rows.push(border);
  return rows.join("\n");
}

export function legalMovesFor(state: GameState): Direction[] {
  return DIRECTIONS.filter((d) => !isOpposite(d, state.direction));
}

export function buildObservation(state: GameState): Observation {
  const map = buildMap(state);
  const legalMoves = legalMovesFor(state);
  const prompt = buildPrompt(state, map, legalMoves);
  const view = viewState(state);
  return { map, prompt, legalMoves, view };
}
