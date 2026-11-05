import type { DecisionContext, PredictedOutcome, PredictionScenario } from "./context";
import { analyzeMove, type MoveAnalysis } from "../sim/analysis";
import { DX, DY, type Cell, type Direction, type GameState } from "../sim/types";

/** 返回 API 使用的单字符方向。 */
export function directionToken(dir: Direction): string {
  return { up: "U", down: "D", left: "L", right: "R" }[dir];
}

/** 返回沿指定方向直行时吃到已知食物的步数，不能直接到达时返回 null。 */
function foodOnStraight(option: MoveAnalysis, food: Cell | null): number | null {
  if (food === null || !option.safe) return null;
  const dx = food.x - option.target.x + DX[option.direction];
  const dy = food.y - option.target.y + DY[option.direction];
  const steps = dx * DX[option.direction] + dy * DY[option.direction];
  const aligned = dx * DY[option.direction] === dy * DX[option.direction];
  return aligned && steps >= 1 && steps <= option.runway ? steps : null;
}

/** 用明确字段描述一次方向输入，指标只提供给模型比较。 */
function describeMove(option: MoveAnalysis, food: Cell | null, intervalMs: number, nextReplyMs: number): string {
  if (!option.safe) return `COLLISION ${option.crash}`;
  const straightFood = foodOnStraight(option, food);
  const distance = food === null ? "unknown" : option.foodDistance ?? "unreachable";
  const headroomMs = Math.round(option.runway * intervalMs);
  return `safe_for=${headroomMs}ms margin=${Math.round(headroomMs - nextReplyMs)}ms food_on_straight=${straightFood ?? "none"} food_distance=${distance} space=${option.space} tail=${option.tailReachable}`;
}

/** 将响应到达场景中的结果写成方向说明。 */
function describeOutcome(outcome: PredictedOutcome, scenario: PredictionScenario, intervalMs: number, nextReplyMs: number): string {
  if (outcome.ended) return `${scenario.label}: DEAD_BEFORE_RESPONSE`;
  if (!outcome.applicable || outcome.analysis === null) return `${scenario.label}: REVERSE`;
  return `${scenario.label}${scenario.likely ? " LIKELY" : ""}: ${describeMove(outcome.analysis, scenario.food, intervalMs, nextReplyMs)}`;
}

/** 为每个非反向选项提供相同指标，保留会碰撞的选项和固定顺序。 */
export function buildChoiceDescriptions(
  state: GameState,
  legalMoves: Direction[],
  context?: DecisionContext,
): Partial<Record<Direction, string>> {
  const descriptions: Partial<Record<Direction, string>> = {};
  const intervalMs = state.moveEveryTicks * 1000 / 60;
  const nextReplyMs = context !== undefined && context.latency.samples > 0 ? context.latency.p90Ticks * 1000 / 60 : intervalMs * 2;
  for (const direction of legalMoves) {
    const prediction = context?.predictions.find((item) => item.direction === direction);
    const details = prediction === undefined || context === undefined
      ? describeMove(analyzeMove(state, direction), state.food, intervalMs, nextReplyMs)
      : [...prediction.outcomes].sort((a, b) => Number(context.scenarios.find((item) => item.label === b.scenario)?.likely) - Number(context.scenarios.find((item) => item.label === a.scenario)?.likely))
        .map((outcome) => describeOutcome(outcome, context.scenarios.find((item) => item.label === outcome.scenario)!, intervalMs, nextReplyMs)).join(" | ");
    descriptions[direction] = `${directionToken(direction)} (${direction}): ${details}`;
  }
  return descriptions;
}

/** 提供当前棋盘和时间信息，方向后果由 API 选项分别说明。 */
export function buildPrompt(
  state: GameState,
  legalMoves: Direction[],
  context?: DecisionContext,
): string {
  const head = state.snake[0];
  const food = state.food === null ? "unknown" : `(${state.food.x},${state.food.y})`;
  const lines = [
    "SNAKE/4 CURRENT",
    `board ${state.width}x${state.height}; x right, y down; head (${head.x}, ${head.y}); heading ${directionToken(state.direction)}; food ${food}; score ${state.score}`,
    `body head-to-tail: ${state.snake.map((cell) => `(${cell.x},${cell.y})`).join(" ")}`,
    `step=${Math.round(state.moveEveryTicks * 1000 / 60)}ms; next_step_in=${Math.round((state.moveEveryTicks - state.moveAccumulator) * 1000 / 60)}ms; allowed=${legalMoves.map(directionToken).join(",")}`,
  ];
  if (context !== undefined) {
    const latency = context.latency;
    lines.push(latency.samples === 0
      ? "Response delay unknown. S0=now; S1=after 1 move; S2=after 2 moves. Actual delay may be longer."
      : `Response delay median=${Math.round(latency.p50Ticks * 1000 / 60)}ms p90=${Math.round(latency.p90Ticks * 1000 / 60)}ms. S0=now; LIKELY=median arrival; final scenario=late arrival.`);
    lines.push(`food_unchanged=${Math.round(context.history.foodAgeTicks / 60)}s; no_progress=${Math.round(context.history.noProgressTicks / 60)}s`);
  }
  lines.push(
    "You control every turn. While waiting, the snake holds its heading. Your choice executes on the first move after arrival; then holds until the next response.",
    "Option metrics: safe_for=time from first chosen move to straight-line collision; margin=safe_for minus p90 delay (unknown delay assumes 2 moves). food_on_straight=steps to eat the visible apple while holding this direction, none=off line. food_distance=distance after first move. space=reachable cells; tail=connected to tail. Food spawned later is unknown.",
    "Earn 10 points per apple. Seek food when there is enough time for another response. Extra empty space gives no points. Use likely arrival, not snapshot-only food opportunities. All non-reversing choices remain available; collisions end the game.",
  );
  return lines.join("\n");
}
