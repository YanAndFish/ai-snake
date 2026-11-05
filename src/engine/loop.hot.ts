export const STEP = 1 / 60;

export interface HotLoopState {
  accumulator: number;
}

export function advanceLoopHot(
  loop: HotLoopState,
  deltaSeconds: number,
  halted: () => boolean,
  maxSteps: number,
  step: () => void,
): number {
  if (halted()) {
    loop.accumulator = 0;
    return 0;
  }

  loop.accumulator += deltaSeconds;
  let steps = 0;
  while (loop.accumulator >= STEP && steps < maxSteps) {
    loop.accumulator -= STEP;
    step();
    steps += 1;
    if (halted()) {
      loop.accumulator = 0;
      break;
    }
  }
  loop.accumulator = Math.min(loop.accumulator, STEP);
  return steps;
}
