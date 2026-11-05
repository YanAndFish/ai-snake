import type {
  DecisionContext,
  FoodRelation,
  PredictedOutcome,
  PredictionScenario,
} from "./context";
import { analyzeMove, type MoveAnalysis } from "../sim/analysis";
import type { Direction, GameState } from "../sim/types";

export function directionToken(dir: Direction): string {
  return { up: "U", down: "D", left: "L", right: "R" }[dir];
}

function formatDistance(distance: number | null): string {
  return distance === null ? "-" : String(distance);
}

function formatTrend(trend: number | null): string {
  if (trend === null) return "-";
  return trend > 0 ? `+${trend}` : String(trend);
}

function formatFood(option: MoveAnalysis, hasFood: boolean): string {
  if (!hasFood) return "no food";
  if (option.eats) return "E";
  return option.foodDistance === null ? "f-" : `f${option.foodDistance}`;
}

function formatRoom(option: MoveAnalysis): string {
  return option.room === "tight" ? `T${option.space}` : "A";
}

function formatStatic(option: MoveAnalysis, hasFood: boolean): string {
  const token = directionToken(option.direction);
  if (!option.safe) return `${token}: X`;
  return `${token}: OK (${option.target.x}, ${option.target.y}) ${formatRoom(option)} ${formatFood(option, hasFood)} ${formatEscape(option)}`;
}

/** 格式化可达空间、通往尾部的路径和下次决策前可直行的步数。 */
function formatEscape(option: MoveAnalysis): string {
  return `space=${option.space} tail=${option.tailReachable ? "yes" : "no"} run=${option.runway}`;
}

function formatOutcome(outcome: PredictedOutcome): string {
  if (outcome.ended) return "P";
  if (!outcome.applicable || outcome.analysis === null) return "NA";
  const option = outcome.analysis;
  if (!option.safe) return "X";
  return `OK (${option.target.x}, ${option.target.y}) ${formatRoom(option)} ${formatFood(option, true)} ${formatEscape(option)}`;
}

function foodRelationToken(relation: FoodRelation): string {
  return relation;
}

function formatScenario(scenario: PredictionScenario): string {
  const at = scenario.ended || scenario.head === null
    ? "dead"
    : `(${scenario.head.x},${scenario.head.y})`;
  const food =
    scenario.food === null ? "-" : `(${scenario.food.x},${scenario.food.y})`;
  return `${scenario.label}${scenario.likely ? "[likely]" : ""}=${scenario.ticks}t/${scenario.moves}m @${at} food=${food} ${foodRelationToken(scenario.foodRelation)}`;
}

function formatRecent(context: DecisionContext): string {
  const entries = context.recent.map((record) => {
    const eat = record.ate ? "+" : "-";
    return `t${record.tick}(${record.head.x},${record.head.y})${directionToken(record.direction)}${eat}`;
  });
  return entries.length === 0 ? "-" : entries.join(" ");
}

function delayLine(context: DecisionContext, state: GameState): string {
  const latency = context.latency;
  if (latency.samples === 0) return "n=0 (unknown); exec timing uncertain";
  const interval = Math.max(1, state.moveEveryTicks);
  const p50Moves = Math.floor(latency.p50Ticks / interval);
  const p90Moves = Math.floor(latency.p90Ticks / interval);
  return `n=${latency.samples}; p50=${latency.p50Ticks}t/${p50Moves}m; p90=${latency.p90Ticks}t/${p90Moves}m; range=${latency.minTicks}..${latency.maxTicks}t`;
}

function historyLine(context: DecisionContext): string {
  const history = context.history;
  return [
    `moves=${history.moves}`,
    `food_age=${history.foodAgeTicks}t`,
    `same_food=${history.sameFoodMoves}m`,
    `dist=${formatDistance(history.distanceNow)}`,
    `min12m=${formatDistance(history.minDistance)}`,
    `trend=${formatTrend(history.trend)}`,
    `stall=${history.noProgressTicks}t/${history.noProgressMoves}m`,
    `repeat=${history.repeats}`,
    `cellrep=${history.cellRepeats}`,
    `loop=${history.loop ? "yes" : "no"}`,
  ].join("; ");
}

function predictionLines(
  state: GameState,
  legalMoves: Direction[],
  context: DecisionContext,
): string[] {
  const byDirection = new Map(
    context.predictions.map((prediction) => [prediction.direction, prediction]),
  );
  return legalMoves.map((direction) => {
    const prediction = byDirection.get(direction);
    if (prediction === undefined) {
      return formatStatic(analyzeMove(state, direction), state.food !== null);
    }
    const outcomes = prediction.outcomes
      .map((outcome) => `${outcome.scenario} ${formatOutcome(outcome)}`)
      .join(" | ");
    return `${directionToken(direction)}: ${outcomes}`;
  });
}

function taskLines(): string[] {
  return [
    "TASK",
    "Choose one direction to control the snake now. The goal is to survive and eat food; you decide every turn.",
    "Your input is applied at the next movement after the response arrives. Delay scenarios describe uncertainty, not scheduled future actions.",
    "All non-reversing directions are available, including X (crash). The game will execute your choice without a local safety override.",
    "The table contains measurements only. Food distance and reachable space do not guarantee a safe future path. Newly spawned food is unknown until observed.",
    "Return one of U/D/L/R only.",
  ];
}

/** 把每个候选方向的分析放进对应选项，供 Decisions API 直接比较。 */
export function buildChoiceDescriptions(
  state: GameState,
  legalMoves: Direction[],
  context?: DecisionContext,
): Partial<Record<Direction, string>> {
  const lines = context === undefined
    ? legalMoves.map((direction) => formatStatic(analyzeMove(state, direction), state.food !== null))
    : predictionLines(state, legalMoves, context);
  const descriptions: Partial<Record<Direction, string>> = {};
  for (let i = 0; i < legalMoves.length; i += 1) descriptions[legalMoves[i]] = lines[i];
  return descriptions;
}

export function buildPrompt(
  state: GameState,
  legalMoves: Direction[],
  context?: DecisionContext,
): string {
  const head = state.snake[0];
  const neck = state.snake[1] ?? head;
  const tail = state.snake[state.snake.length - 1] ?? head;
  const food = state.food === null ? "none" : `(${state.food.x}, ${state.food.y})`;
  const lines = [
    "SNAKE/2",
    "Snapshot only. The snake keeps moving until the answer is applied; do not assume this board at execution time.",
    "",
    "STATE",
    `tick ${state.tick}; board ${state.width}x${state.height}; x right, y down, 0-based`,
    `head (${head.x}, ${head.y}); neck (${neck.x}, ${neck.y}); tail (${tail.x}, ${tail.y}); food ${food}; dir ${directionToken(state.direction)}; len ${state.snake.length}; interval ${state.moveEveryTicks}t (1m); next_move_in ${state.moveEveryTicks - state.moveAccumulator}t; t=tick, m=move`,
    `body ${state.snake.map((cell) => `(${cell.x},${cell.y})`).join(" ")}`,
  ];

  if (context === undefined) {
    lines.push("", "DELAY", "n=0 (unknown); exec timing uncertain");
    lines.push(
      "",
      "MOVE ANALYSIS",
      "codes: OK safe; X crash; P dead before exec; NA illegal; A ample; T<space> tight; f<path> food distance; E eats; f- unreachable; tail=path to tail; run=safe straight moves including this move.",
      ...legalMoves.map((direction) =>
        formatStatic(analyzeMove(state, direction), state.food !== null),
      ),
    );
  } else {
    const pending = context.pending;
    const pendingText =
      pending.queue.length === 0 && pending.plan.length === 0
        ? "no pending turn"
        : `pending q=${pending.queue.map(directionToken).join("") || "-"} p=${pending.plan.map(directionToken).join("") || "-"}; future dir uncertain`;
    lines.push(
      "",
      "DELAY",
      delayLine(context, state),
      "",
      "SCEN",
      context.scenarios.map(formatScenario).join("; "),
      `EXEC follows queued turns, then continues straight until arrival; ${pendingText}; timing probabilistic.`,
      "",
      "HIST",
      historyLine(context),
      `recent: ${formatRecent(context)}`,
      "trend>0 means farther from the current food; trend<0 means closer.",
      "loop=yes means same food + repeated (head,dir) + stall; a single revisit is normal.",
      "",
      "MOVE ANALYSIS",
      "codes: OK safe; X crash; P dead before exec; NA illegal; A ample; T<space> tight; f<path> food distance; E eats; f- unreachable; tail=path to tail; run=safe straight moves including this move.",
      ...predictionLines(state, legalMoves, context),
    );
  }

  lines.push("", ...taskLines());
  return lines.join("\n");
}
