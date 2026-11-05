import { type GameState } from "./types";
import {
  BIT_BODY_ON_BOARD,
  BIT_FOOD_EXISTS,
  BIT_FOOD_ON_EMPTY,
  BIT_HALT,
  BIT_HEAD,
  BIT_LENGTH,
  BIT_MENU_ZERO,
  BIT_MIN_LENGTH,
  BIT_NO_OVERLAP,
  BIT_NO_REVERSE,
  BIT_SCORE,
  BIT_TYPE_OK,
  checkInvariantsMask,
} from "./invariants.hot";

export const INVARIANT_NAMES = [
  "TypeOK",
  "BodyOnBoard",
  "NoOverlap",
  "FoodOnEmpty",
  "FoodExistsInPlay",
  "ScoreMatchesFood",
  "LengthMatchesFood",
  "NoReverse",
  "HaltFreezesTicks",
  "MenuAtZero",
  "HeadIsFirst",
  "LengthAtLeastThree",
] as const;

export type InvariantName = (typeof INVARIANT_NAMES)[number];

const BITS = [
  BIT_TYPE_OK,
  BIT_BODY_ON_BOARD,
  BIT_NO_OVERLAP,
  BIT_FOOD_ON_EMPTY,
  BIT_FOOD_EXISTS,
  BIT_SCORE,
  BIT_LENGTH,
  BIT_NO_REVERSE,
  BIT_HALT,
  BIT_MENU_ZERO,
  BIT_HEAD,
  BIT_MIN_LENGTH,
];

export class InvariantError extends Error {
  violations: string[];

  constructor(violations: string[]) {
    super(`Invariant violation: ${violations.join(", ")}`);
    this.name = "InvariantError";
    this.violations = violations;
  }
}

export function checkInvariants(state: GameState): string[] {
  const mask = checkInvariantsMask(state);
  if (mask === 0) return [];
  const violations: string[] = [];
  for (let i = 0; i < BITS.length; i += 1) {
    if ((mask & BITS[i]) !== 0) violations.push(INVARIANT_NAMES[i]);
  }
  return violations;
}
