export interface ClockState {
  phase: string;
  tick: number;
  moveAccumulator: number;
  moveEveryTicks: number;
}

export function advanceClockHot(state: ClockState): boolean {
  if (state.phase !== "playing") return false;
  state.tick += 1;
  state.moveAccumulator += 1;
  if (state.moveAccumulator < state.moveEveryTicks) return false;
  state.moveAccumulator = 0;
  return true;
}
