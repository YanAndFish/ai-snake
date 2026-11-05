export const BOARD_WIDTH = 15;
export const BOARD_HEIGHT = 15;
export const INITIAL_LENGTH = 3;
export const SCORE_PER_FOOD = 10;
export const MAX_PLAN_MOVES = 8;
export const DEFAULT_MODEL = "gpt-6-luna";
export const OPENAI_ENDPOINT = "https://api.openai.com/v1/decisions";
export const DEFAULT_SEED = 1;
export const MAX_QUEUE = 2;

export function moveEveryTicksFor(eaten: number): number {
  return Math.max(5, 10 - Math.floor(eaten / 3));
}
