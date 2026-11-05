import { MAX_PLAN_MOVES } from "../config";
import { isOpposite, type Direction } from "../sim/types";
import type { AiAction } from "./types";

export interface ParsedPlan {
  /** 已解析的方向输入，AI 响应只有一个方向。 */
  moves: Direction[];
  /** 响应附带的简短说明。 */
  reason: string;
}

/** 已解析的单次 AI 操作及其对应的移动方向。 */
export interface ParsedDecision extends ParsedPlan {
  /** 模型实际选择的操作，keep 与明确选择当前方向分别记录。 */
  action: AiAction;
}

function toDirection(token: unknown): Direction | null {
  if (typeof token !== "string") return null;
  switch (token.trim().toLowerCase()) {
    case "u":
    case "up":
      return "up";
    case "d":
    case "down":
      return "down";
    case "l":
    case "left":
      return "left";
    case "r":
    case "right":
      return "right";
    default:
      return null;
  }
}

export function validateMoves(
  tokens: unknown[],
  currentDirection: Direction,
): Direction[] {
  const moves: Direction[] = [];
  let last = currentDirection;
  for (const token of tokens) {
    const dir = toDirection(token);
    if (dir === null) continue;
    if (isOpposite(dir, last)) break;
    moves.push(dir);
    last = dir;
    if (moves.length >= MAX_PLAN_MOVES) break;
  }
  return moves;
}

function sanitizeReason(reason: unknown): string {
  if (typeof reason !== "string") return "";
  const stripped = reason.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  return stripped.slice(0, 300);
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      // fall through
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // fall through
    }
  }

  throw new Error("no JSON object found in AI response");
}

function extractMoves(parsed: unknown): unknown[] {
  if (typeof parsed !== "object" || parsed === null) return [];
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.moves)) return obj.moves;
  if (typeof obj.action === "string") return [obj.action];
  if (Array.isArray(obj.action)) return obj.action;
  return [];
}

function extractReason(parsed: unknown): string {
  if (typeof parsed === "object" && parsed !== null) {
    const object = parsed as Record<string, unknown>;
    return sanitizeReason(object.reason ?? object.note);
  }
  return "";
}

/** 解析一次操作。KEEP 对应当前方向，并单独保留在 action 中。 */
export function parseAiResponse(
  text: string,
  currentDirection: Direction,
): ParsedDecision {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("empty AI response");
  }
  const parsed = extractJson(text);
  const tokens = extractMoves(parsed);
  if (tokens.length !== 1) throw new Error("AI 必须只返回一个方向或 KEEP 操作");
  const keep = typeof tokens[0] === "string" && tokens[0].trim().toUpperCase() === "KEEP";
  const direction = keep ? currentDirection : toDirection(tokens[0]);
  if (direction === null || isOpposite(direction, currentDirection)) {
    throw new Error("AI 返回的方向无效或与当前方向相反");
  }
  return { moves: [direction], action: keep ? "keep" : direction, reason: extractReason(parsed) };
}

function tokenizePlanString(s: string): string[] {
  const trimmed = s.trim();
  if (trimmed === "") return [];
  const parts = trimmed.split(/[\s,]+/).filter(Boolean);
  const tokens: string[] = [];
  for (const part of parts) {
    if (part.length > 1 && /^[UDLRudlr]+$/.test(part)) {
      for (const ch of part) tokens.push(ch);
    } else {
      tokens.push(part);
    }
  }
  return tokens;
}

export function normalizePlan(
  input: Direction[] | string,
  currentDirection: Direction,
): ParsedPlan {
  const tokens = Array.isArray(input) ? input.map(String) : tokenizePlanString(input);
  const moves = validateMoves(tokens, currentDirection);
  if (moves.length === 0) {
    throw new Error("no valid move in plan");
  }
  return { moves, reason: "" };
}
