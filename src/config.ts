export const BOARD_WIDTH = 19;
export const BOARD_HEIGHT = 19;
export const INITIAL_LENGTH = 3;
export const SCORE_PER_FOOD = 10;
export const MAX_PLAN_MOVES = 8;
export const DEFAULT_MODEL = "gpt-6-luna";
export const OPENAI_ENDPOINT = "https://api.openai.com/v1/decisions";
export const DEFAULT_SEED = 1;
export const MAX_QUEUE = 2;

export type Difficulty = "chill" | "normal" | "fast";

/** 一档难度的名称和移动间隔。 */
export interface SpeedProfile {
  /** 界面显示的难度名称。 */
  label: string;
  /** 新局每次移动间隔的 tick 数。 */
  baseTicks: number;
  /** 手动模式提速后最短的移动间隔。 */
  minTicks: number;
}

export const DIFFICULTIES: Record<Difficulty, SpeedProfile> = {
  chill: { label: "悠闲", baseTicks: 13, minTicks: 7 },
  normal: { label: "标准", baseTicks: 10, minTicks: 5 },
  fast: { label: "疾速", baseTicks: 8, minTicks: 4 },
};

export const DEFAULT_DIFFICULTY: Difficulty = "normal";

export function isDifficulty(value: string): value is Difficulty {
  return value === "chill" || value === "normal" || value === "fast";
}

/** 返回手动模式的移动间隔，每吃 6 个食物减少 1 tick。 */
export function moveEveryTicksFor(eaten: number, difficulty: Difficulty = DEFAULT_DIFFICULTY): number {
  const profile = DIFFICULTIES[difficulty];
  return Math.max(profile.minTicks, profile.baseTicks - Math.floor(eaten / 6));
}
