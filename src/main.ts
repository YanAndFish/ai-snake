import "@fontsource/press-start-2p";
import "./styles.css";

import { DecisionsTransport } from "./ai/client";
import { AiController } from "./ai/controller";
import { KeyStore } from "./app/keyStore";
import { GameSession, type ScoreStore } from "./app/session";
import { createTestApi } from "./app/testApi";
import { renderFrameHot, type FrameHotContext } from "./app/frame.hot";
import { AudioEngine, sfxForEvent } from "./engine/audio";
import { Input } from "./engine/input";
import { Loop } from "./engine/loop";
import { Scene } from "./render/scene";
import type { GameEvent } from "./sim/types";
import {
  apiKeyValue,
  bindUi,
  clearApiKeyInput,
  flashScreen,
  hideAllOverlays,
  setMuteLabel,
  showFatal,
  showMenu,
  showOver,
  showPause,
  updateAiPanel,
  updateHud,
} from "./ui/dom";

const BEST_SCORE_KEY = "snake-best";

const localStorageScore: ScoreStore = {
  load() {
    try {
      const value = Number(localStorage.getItem(BEST_SCORE_KEY));
      return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    } catch {
      return 0;
    }
  },
  save(value) {
    try {
      localStorage.setItem(BEST_SCORE_KEY, String(value));
    } catch {
      // storage unavailable
    }
  },
};

const audio = new AudioEngine();
const keyStore = new KeyStore();
const controller = new AiController(new DecisionsTransport());

const canvas = document.getElementById("world") as HTMLCanvasElement;

let scene: Scene | null = null;
try {
  scene = new Scene(canvas, 1);
} catch (err) {
  console.error("WebGL unavailable", err);
  scene = null;
}

const session = new GameSession({
  controller,
  keyStore,
  bestScore: localStorageScore,
  onEvents: handleEvents,
  onFatal: (message) => {
    showFatal(message);
  },
});

function handleEvents(events: GameEvent[]): void {
  for (const event of events) {
    if (event.type === "eat") {
      scene?.burstAt(session.state.snake[0]);
    }
    if (event.type === "crash") {
      scene?.shake();
      flashScreen();
    }
    const sfx = sfxForEvent(event.type);
    if (sfx) audio.play(sfx);
  }
}

function startManual(): void {
  audio.ensure();
  session.start({ ai: false });
}

function startAi(): void {
  audio.ensure();
  const key = apiKeyValue().trim();
  if (key) session.setCredentials(key);
  clearApiKeyInput();
  try {
    session.start({ ai: true });
  } catch {
    // the AI panel already shows 等待 Key
  }
}

function togglePause(): void {
  const phase = session.state.phase;
  if (phase === "playing") session.pause();
  else if (phase === "paused") session.resume();
}

function restart(): void {
  session.restart();
}

bindUi({
  onStartManual: startManual,
  onStartAi: startAi,
  onStopAi: () => session.stopAi(),
  onRetryAi: () => session.retryAi(),
  onClearKey: () => {
    session.clearKey();
    clearApiKeyInput();
  },
  onPause: togglePause,
  onRestart: restart,
  onMute: () => setMuteLabel(audio.toggleMute()),
});

document.getElementById("menu-ai")?.addEventListener("click", startAi);
document.getElementById("resume-btn")?.addEventListener("click", togglePause);
document.getElementById("restart-pause")?.addEventListener("click", restart);
document.getElementById("restart-over")?.addEventListener("click", restart);

const input = new Input(window, {
  onDirection: (dir) => {
    if (session.state.phase === "playing" && session.state.control === "human") {
      session.setDirection(dir);
    }
  },
  onPause: togglePause,
  onRestart: restart,
  onMute: () => setMuteLabel(audio.toggleMute()),
});

const frameCtx: FrameHotContext = {
  lastPhase: "",
  lastScore: -1,
  lastBest: -1,
  lastLength: -1,
  lastSpeed: -1,
  lastAiVersion: -1,
  lastFatal: null,
  onPhase(phase, reason, score) {
    if (phase === "menu") showMenu();
    else if (phase === "paused") showPause();
    else if (phase === "over") showOver(reason, score);
    else hideAllOverlays();
  },
  onHud(state, best) {
    updateHud(state, best);
  },
  onAi() {
    updateAiPanel(session.getAiStatus(), session.getAiLog(), session.getObservation().map);
  },
  onFatal(message) {
    showFatal(message);
  },
};

const loop = new Loop({
  step: () => {
    try {
      session.stepTick();
    } catch (err) {
      console.error(err);
    }
  },
  render: (frame) =>
    renderFrameHot(frameCtx, session, scene, frame.alpha, frame.frameDt, frame.clock),
  halted: () => session.halted(),
});

function resize(): void {
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 480;
  scene?.resize(w, h);
}

window.addEventListener("resize", resize);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && session.state.phase === "playing") session.pause();
});

resize();
loop.start();

const testApi = createTestApi(session, controller);
(globalThis as unknown as { __snake: unknown }).__snake = testApi;
(globalThis as unknown as { __pixelSerpent: unknown }).__pixelSerpent = { session, scene };
