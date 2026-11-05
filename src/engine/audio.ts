export type SfxName = "eat" | "turn" | "crash" | "start" | "win" | "ui";

export function sfxForEvent(type: string): SfxName | null {
  switch (type) {
    case "eat":
      return "eat";
    case "move":
      return "turn";
    case "crash":
      return "crash";
    case "start":
      return "start";
    case "win":
      return "win";
    case "pause":
    case "resume":
    case "ready":
      return "ui";
    default:
      return null;
  }
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  close(): Promise<void>;
}

export interface OscillatorLike {
  type: string;
  frequency: { value: number };
  connect(node: unknown): void;
  start(time?: number): void;
  stop(time?: number): void;
}

export interface GainLike {
  gain: { value: number };
  connect(node: unknown): void;
}

const WAVES: Record<SfxName, { type: OscillatorType; from: number; to: number; dur: number }> = {
  eat: { type: "square", from: 440, to: 880, dur: 0.08 },
  turn: { type: "triangle", from: 320, to: 480, dur: 0.05 },
  crash: { type: "square", from: 220, to: 60, dur: 0.3 },
  start: { type: "triangle", from: 330, to: 660, dur: 0.12 },
  win: { type: "square", from: 523, to: 1046, dur: 0.25 },
  ui: { type: "triangle", from: 440, to: 440, dur: 0.04 },
};

export class AudioEngine {
  private ctx: AudioContextLike | null = null;
  private muted = false;
  private factory: () => AudioContextLike;

  constructor(factory?: () => AudioContextLike) {
    this.factory =
      factory ??
      (() => new AudioContext() as unknown as AudioContextLike);
  }

  ensure(): void {
    if (this.ctx === null) this.ctx = this.factory();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  play(name: SfxName): void {
    if (this.muted || this.ctx === null) return;
    const wave = WAVES[name];
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = wave.type;
    const freq = osc.frequency as {
      value: number;
      setValueAtTime?: (v: number, t: number) => void;
      exponentialRampToValueAtTime?: (v: number, t: number) => void;
    };
    freq.setValueAtTime?.(wave.from, this.ctx.currentTime);
    freq.value = wave.from;
    freq.exponentialRampToValueAtTime?.(wave.to, this.ctx.currentTime + wave.dur);
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + wave.dur);
  }
}
