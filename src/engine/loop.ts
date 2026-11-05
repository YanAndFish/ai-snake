import { STEP, advanceLoopHot } from "./loop.hot";

export { STEP };
const MAX_STEPS = 8;
const MAX_FRAME_DT = 0.25;

export interface LoopFrame {
  alpha: number;
  frameDt: number;
  clock: number;
}

export interface LoopOptions {
  step: () => void;
  render: (frame: LoopFrame) => void;
  halted: () => boolean;
  timeScale?: number;
  now?: () => number;
  schedule?: (cb: (time: number) => void) => number;
  cancel?: (id: number) => void;
}

export class Loop {
  private step: () => void;
  private render: (frame: LoopFrame) => void;
  private halted: () => boolean;
  private timeScale: number;
  private now: () => number;
  private schedule: (cb: (time: number) => void) => number;
  private cancel: (id: number) => void;

  accumulator = 0;
  private lastTime = 0;
  clock = 0;
  alpha = 0;
  private running = false;
  private raf = 0;
  private frameInfo: LoopFrame = { alpha: 0, frameDt: 0, clock: 0 };

  constructor(options: LoopOptions) {
    this.step = options.step;
    this.render = options.render;
    this.halted = options.halted;
    this.timeScale = options.timeScale ?? 1;
    this.now = options.now ?? (() => performance.now());
    this.schedule = options.schedule ?? ((cb) => requestAnimationFrame(cb));
    this.cancel = options.cancel ?? ((id) => cancelAnimationFrame(id));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = this.now();
    this.raf = this.schedule(this.frame);
  }

  stop(): void {
    this.running = false;
    this.cancel(this.raf);
  }

  advance(deltaSeconds: number): number {
    return advanceLoopHot(
      this,
      deltaSeconds,
      this.halted,
      MAX_STEPS * Math.max(1, this.timeScale),
      this.step,
    );
  }

  private frame = (now: number): void => {
    if (!this.running) return;

    const deltaSeconds = Math.min(MAX_FRAME_DT, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.advance(deltaSeconds * this.timeScale);

    this.alpha = this.halted() ? 1 : Math.min(1, this.accumulator / STEP);
    this.clock += deltaSeconds;
    this.frameInfo.alpha = this.alpha;
    this.frameInfo.frameDt = deltaSeconds;
    this.frameInfo.clock = this.clock;

    this.render(this.frameInfo);

    this.raf = this.schedule(this.frame);
  };
}
