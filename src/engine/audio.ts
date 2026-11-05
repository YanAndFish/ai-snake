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

export interface AudioParamLike {
  value: number;
  setValueAtTime?: (value: number, time: number) => void;
  exponentialRampToValueAtTime?: (value: number, time: number) => void;
}

export interface OscillatorLike {
  type: string;
  frequency: AudioParamLike;
  connect(node: unknown): void;
  start(time?: number): void;
  stop(time?: number): void;
}

export interface GainLike {
  gain: AudioParamLike;
  connect(node: unknown): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  resume?(): Promise<void>;
  close(): Promise<void>;
}

const WAVES: Record<
  SfxName,
  { type: OscillatorType; from: number; to: number; dur: number; volume: number }
> = {
  eat: { type: "square", from: 440, to: 880, dur: 0.08, volume: 0.04 },
  turn: { type: "triangle", from: 320, to: 480, dur: 0.05, volume: 0.01 },
  crash: { type: "square", from: 220, to: 60, dur: 0.3, volume: 0.04 },
  start: { type: "triangle", from: 330, to: 660, dur: 0.12, volume: 0.04 },
  win: { type: "square", from: 523, to: 1046, dur: 0.25, volume: 0.04 },
  ui: { type: "triangle", from: 440, to: 440, dur: 0.04, volume: 0.04 },
};

const MUSIC_STEP_SECONDS = 0.27;
const MUSIC_LEVEL = 0.62;
const MELODY = [72, 76, 79, 76, 74, 72, 69, 67, 72, 74, 76, 79, 81, 79, 76, 74];
const BASS = [48, 45, 43, 41];
const LEAD_LEVEL = 0.026;
const BASS_LEVEL = 0.04;

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function ramp(param: AudioParamLike, value: number, time: number): void {
  if (param.exponentialRampToValueAtTime) {
    param.exponentialRampToValueAtTime(Math.max(0.0001, value), time);
  } else {
    param.value = value;
  }
}

export class AudioEngine {
  private ctx: AudioContextLike | null = null;
  private muted = false;
  private factory: () => AudioContextLike;
  private musicGain: GainLike | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicStep = 0;

  constructor(factory?: () => AudioContextLike) {
    this.factory = factory ?? (() => new AudioContext() as unknown as AudioContextLike);
  }

  ensure(): void {
    if (this.ctx !== null) return;
    try {
      this.ctx = this.factory();
      void this.ctx.resume?.();
    } catch {
      this.ctx = null;
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isMusicRunning(): boolean {
    return this.musicTimer !== null;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.musicGain !== null) {
      this.musicGain.gain.value = this.muted ? 0 : MUSIC_LEVEL;
    }
    return this.muted;
  }

  startMusic(): void {
    this.ensure();
    if (this.ctx === null || this.musicTimer !== null) return;
    const musicGain = this.ctx.createGain();
    musicGain.gain.value = this.muted ? 0 : MUSIC_LEVEL;
    musicGain.connect(this.ctx.destination);
    this.musicGain = musicGain;
    this.musicStep = 0;
    this.scheduleMusicStep();
    this.musicTimer = setInterval(() => this.scheduleMusicStep(), MUSIC_STEP_SECONDS * 1000);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicGain = null;
  }

  play(name: SfxName): void {
    if (this.muted || this.ctx === null) return;
    const wave = WAVES[name];
    this.note(
      wave.from,
      wave.to,
      wave.dur,
      wave.type,
      wave.volume,
      this.ctx.destination,
      this.ctx.currentTime,
    );
  }

  private scheduleMusicStep(): void {
    if (this.ctx === null || this.musicGain === null) return;
    const when = this.ctx.currentTime + 0.06;
    const step = this.musicStep % MELODY.length;
    const lead = MELODY[step];
    if (lead > 0) {
      this.note(
        midiToHz(lead),
        midiToHz(lead),
        MUSIC_STEP_SECONDS * 0.82,
        "triangle",
        LEAD_LEVEL,
        this.musicGain,
        when,
      );
    }
    if (step % 4 === 0) {
      const bass = BASS[Math.floor(step / 4) % BASS.length];
      this.note(
        midiToHz(bass),
        midiToHz(bass),
        MUSIC_STEP_SECONDS * 3.4,
        "sine",
        BASS_LEVEL,
        this.musicGain,
        when,
      );
    }
    this.musicStep += 1;
  }

  private note(
    from: number,
    to: number,
    duration: number,
    type: string,
    volume: number,
    destination: unknown,
    when: number,
  ): void {
    if (this.ctx === null) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    const frequency = osc.frequency;
    if (frequency.setValueAtTime) frequency.setValueAtTime(from, when);
    else frequency.value = from;
    if (to !== from) {
      const sweepEnd = when + Math.min(duration, 0.18);
      if (frequency.exponentialRampToValueAtTime) {
        frequency.exponentialRampToValueAtTime(Math.max(0.0001, to), sweepEnd);
      }
    }
    if (gain.gain.setValueAtTime) gain.gain.setValueAtTime(0.0001, when);
    if (gain.gain.exponentialRampToValueAtTime) {
      gain.gain.exponentialRampToValueAtTime(volume, when + 0.02);
      ramp(gain.gain, 0.0001, when + duration);
    } else {
      gain.gain.value = volume;
    }
    osc.connect(gain);
    gain.connect(destination);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }
}
