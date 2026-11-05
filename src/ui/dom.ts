import type { AiLogEntry, AiStatusView } from "../ai/controller";
import { isDifficulty, type Difficulty } from "../config";
import type { StateView } from "../sim/types";
import dayjs from "dayjs";

const STATUS_LABELS: Record<AiStatusView["state"], string> = {
  off: "未启动",
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

const MOVE_ARROWS: Record<string, string> = {
  up: "↑ UP",
  down: "↓ DOWN",
  left: "← LEFT",
  right: "→ RIGHT",
};

const MAX_ERROR_LENGTH = 24;

function clip(text: string): string {
  if (text.length <= MAX_ERROR_LENGTH) return text;
  return `${text.slice(0, MAX_ERROR_LENGTH - 1)}…`;
}

function formatLogLine(entry: AiLogEntry): string {
  if (entry.error) return `✕  ${entry.latencyMs} ms · ${clip(entry.error)}`;
  if (entry.moves.length === 0) return "—";
  const glyphs = entry.moves.map((move) => MOVE_ARROWS[move] ?? move).join("");
  return `[${dayjs(entry.time).format("HH:mm:ss.SSS")}] ${glyphs}  ${entry.latencyMs} ms`;
}

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

const COMPACT_QUERY = "(max-width: 900px)";

function setAiPanelOpen(open: boolean): void {
  document.body.dataset.aiPanel = open ? "open" : "closed";
  const tab = document.getElementById("ai-tab");
  if (tab) tab.setAttribute("aria-expanded", open ? "true" : "false");
}

export function openAiPanel(): void {
  setAiPanelOpen(true);
}

export function closeAiPanelIfCompact(): void {
  if (window.matchMedia(COMPACT_QUERY).matches) closeAiPanel();
}

function closeAiPanel(): void {
  const panel = document.getElementById("ai-panel");
  const restoreFocus = panel !== null && panel.contains(document.activeElement);
  setAiPanelOpen(false);
  if (restoreFocus) document.getElementById("ai-tab")?.focus();
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

  const compact = window.matchMedia(COMPACT_QUERY);
  setAiPanelOpen(!compact.matches);
  compact.addEventListener("change", (event) => {
    if (event.matches) closeAiPanel();
  });

  el("ai-tab").addEventListener("click", () => {
    openAiPanel();
    el<HTMLElement>("ai-close").focus();
  });
  el("ai-close").addEventListener("click", closeAiPanel);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.body.dataset.aiPanel !== "open") return;
    closeAiPanel();
  });
}

export function updateHud(view: StateView, best: number): void {
  setText("score", String(view.score));
  setText("best", String(best));
  setText("length", String(view.snake.length));
  setText("speed", String(view.moveEveryTicks));
  setText("phase", PHASE_LABELS[view.phase]);
  markDifficulty(view.difficulty);
}

export function updateAiPanel(
  status: AiStatusView,
  log: AiLogEntry[],
): void {
  const state = status.state;
  const label = STATUS_LABELS[state] ?? state;
  const error = status.error ? ` · ${status.error}` : "";
  setText("ai-status", `${label}${error}`);
  el("ai-status").dataset.state = state;

  const last = status.latencyMs;
  setText("ai-latency", last === null ? "--" : String(last));

  const samples = log.map((entry) => entry.latencyMs).sort((a, b) => a - b);
  if (samples.length === 0) {
    setText("ai-latency-stats", "");
  } else {
    const p50 = samples[Math.ceil(samples.length * 0.5) - 1];
    const p90 = samples[Math.ceil(samples.length * 0.9) - 1];
    setText("ai-latency-stats", `P50 ${p50}ms · P90 ${p90}ms`);
  }

  const logNode = el("ai-log");
  logNode.textContent =
    log.slice(-20).reverse().map(formatLogLine).join("\n") || "暂无决策记录";
  logNode.scrollTop = 0;
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
