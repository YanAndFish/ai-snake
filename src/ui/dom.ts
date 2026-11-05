import type { AiLogEntry, AiStatusView } from "../ai/controller";
import { isDifficulty, type Difficulty } from "../config";
import type { StateView } from "../sim/types";

const STATUS_LABELS: Record<AiStatusView["state"], string> = {
  off: "关闭",
  needKey: "等待 Key",
  thinking: "请求中",
  ready: "计划就绪",
  error: "错误",
};

const PHASE_LABELS: Record<StateView["phase"], string> = {
  menu: "菜单",
  playing: "游戏中",
  paused: "已暂停",
  over: "结束",
};

const OVER_LABELS: Record<string, string> = {
  wall: "撞墙了",
  self: "咬到自己了",
  win: "吃满了！",
};

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function setText(id: string, value: string): void {
  const node = el(id);
  if (node) node.textContent = value;
}

export interface UiHandlers {
  onStartManual: () => void;
  onStartAi: () => void;
  onStopAi: () => void;
  onRetryAi: () => void;
  onDifficulty: (difficulty: Difficulty) => void;
  onPause: () => void;
  onRestart: () => void;
  onMute: () => void;
}

export function apiKeyValue(): string {
  return el<HTMLInputElement>("api-key").value;
}

export function clearApiKeyInput(): void {
  el<HTMLInputElement>("api-key").value = "";
}

export function modelValue(): string {
  return el<HTMLInputElement>("model").value;
}

function markDifficulty(value: Difficulty): void {
  document.querySelectorAll<HTMLButtonElement>("[data-difficulty]").forEach((button) => {
    const selected = button.dataset.difficulty === value;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

export function bindUi(handlers: UiHandlers): void {
  el("start-manual").addEventListener("click", handlers.onStartManual);
  el("start-ai").addEventListener("click", handlers.onStartAi);
  el("stop-ai").addEventListener("click", handlers.onStopAi);
  el("retry-ai").addEventListener("click", handlers.onRetryAi);
  document.querySelectorAll<HTMLButtonElement>("[data-difficulty]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.difficulty;
      if (value === undefined || !isDifficulty(value)) return;
      markDifficulty(value);
      handlers.onDifficulty(value);
    });
  });
  el("pause").addEventListener("click", handlers.onPause);
  el("restart").addEventListener("click", handlers.onRestart);
  el("mute").addEventListener("click", handlers.onMute);
}

export function updateHud(view: StateView, best: number): void {
  setText("score", String(view.score));
  setText("best", String(best));
  setText("length", String(view.snake.length));
  setText("speed", String(view.moveEveryTicks));
  setText("phase", PHASE_LABELS[view.phase]);
  markDifficulty(view.difficulty);
}

export function updateObservation(observation: string): void {
  const node = el("observation");
  if (node) node.textContent = observation;
}

export function updateAiPanel(
  status: AiStatusView,
  log: AiLogEntry[],
  observation: string,
): void {
  const state = status.state;
  const label = STATUS_LABELS[state] ?? state;
  const error = status.error ? ` · ${status.error}` : "";
  setText("ai-status", `${label}${error}`);
  el("ai-status").dataset.state = state;

  const logLines = log.slice(-20).map((entry) => {
    const moves = entry.moves.length > 0 ? entry.moves.join(" ") : "-";
    const reason = entry.reason ? ` | ${entry.reason}` : "";
    const err = entry.error ? ` | 错误 ${entry.error}` : "";
    return `#${entry.requestId} ${entry.model} [${moves}]${reason}${err}`;
  });
  el("ai-log").textContent = logLines.join("\n") || "暂无决策记录";

  updateObservation(observation);
}

function show(id: string, visible: boolean): void {
  el(id).style.display = visible ? "flex" : "none";
}

export function showMenu(): void {
  show("menu-overlay", true);
  show("pause-overlay", false);
  show("over-overlay", false);
  show("fatal-overlay", false);
}

export function showPause(): void {
  show("menu-overlay", false);
  show("pause-overlay", true);
  show("over-overlay", false);
  show("fatal-overlay", false);
}

export function showOver(reason: string, score: number): void {
  setText("over-reason", OVER_LABELS[reason] ?? reason);
  setText("over-score", String(score));
  show("menu-overlay", false);
  show("pause-overlay", false);
  show("over-overlay", true);
  show("fatal-overlay", false);
}

export function showFatal(message: string): void {
  setText("fatal-message", message);
  show("menu-overlay", false);
  show("pause-overlay", false);
  show("over-overlay", false);
  show("fatal-overlay", true);
}

export function hideAllOverlays(): void {
  show("menu-overlay", false);
  show("pause-overlay", false);
  show("over-overlay", false);
  show("fatal-overlay", false);
}

export function flashScreen(): void {
  const node = el("flash");
  if (!node) return;
  node.classList.remove("active");
  void node.offsetWidth;
  node.classList.add("active");
}

export function setMuteLabel(muted: boolean): void {
  el("mute").textContent = muted ? "声音：关" : "声音：开";
}
