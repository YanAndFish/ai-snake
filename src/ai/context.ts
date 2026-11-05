import { STEP } from "../engine/loop.hot";
import {
  analyzeMove,
  shortestFoodDistance,
  type MoveAnalysis,
} from "../sim/analysis";
import { advanceMove, enqueueDirection } from "../sim/game";
import { advanceClockHot } from "../sim/tick.hot";
import {
  DIRECTIONS,
  DX,
  DY,
  isOpposite,
  type Cell,
  type Direction,
  type GameState,
} from "../sim/types";

const MS_PER_TICK = STEP * 1000;
const HISTORY_LIMIT = 24;
const PROMPT_HISTORY = 12;
const LATENCY_LIMIT = 12;

export interface PendingTurn {
  queue: Direction[];
  plan: Direction[];
}

export interface LatencyStats {
  samples: number;
  p50Ticks: number;
  p90Ticks: number;
  minTicks: number;
  maxTicks: number;
}

export interface MotionRecord {
  tick: number;
  head: Cell;
  direction: Direction;
  ate: boolean;
  foodKey: string;
  eaten: number;
  distance: number | null;
}

export interface HistoryStats {
  moves: number;
  foodAgeTicks: number;
  sameFoodMoves: number;
  distanceNow: number | null;
  minDistance: number | null;
  trend: number | null;
  noProgressTicks: number;
  noProgressMoves: number;
  repeats: number;
  cellRepeats: number;
  loop: boolean;
}

export interface DelayScenario {
  /** 提示词中引用这个场景的编号。 */
  label: string;
  /** 请求发出后经过的游戏 tick 数。 */
  ticks: number;
  /** 等待期间已经完成的移动次数。 */
  moves: number;
  /** 是否对应最近延迟的中位数。没有样本时为 false。 */
  likely: boolean;
}

export type FoodRelation = "ahead" | "now" | "past" | "none" | "dead";

export interface PredictionScenario extends DelayScenario {
  head: Cell | null;
  food: Cell | null;
  ended: boolean;
  foodRelation: FoodRelation;
}

export interface PredictedOutcome {
  scenario: string;
  ended: boolean;
  applicable: boolean;
  analysis: MoveAnalysis | null;
}

export interface PredictedMove {
  direction: Direction;
  outcomes: PredictedOutcome[];
}

export interface DecisionContext {
  tick: number;
  latency: LatencyStats;
  scenarios: PredictionScenario[];
  history: HistoryStats;
  recent: MotionRecord[];
  predictions: PredictedMove[];
  pending: PendingTurn;
}

function foodKeyOf(state: GameState): string {
  return state.food === null ? "none" : `${state.food.x},${state.food.y}`;
}

function foodRelation(state: GameState): FoodRelation {
  if (state.food === null) return "none";
  const head = state.snake[0];
  const dot =
    (state.food.x - head.x) * DX[state.direction] +
    (state.food.y - head.y) * DY[state.direction];
  if (dot > 0) return "ahead";
  if (dot < 0) return "past";
  return "now";
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * p) - 1),
  );
  return values[index];
}

/** 用真实时钟和移动规则预测等待结束时的棋盘，保留入队转向和吃食物后的变速。 */
function simulateWait(
  state: GameState,
  ticks: number,
  pending: PendingTurn,
): { state: GameState; ended: boolean } {
  let current = { ...state, queue: [...pending.queue] };
  let planIndex = 0;
  for (let i = 0; i < ticks && current.phase === "playing"; i += 1) {
    if (!advanceClockHot(current)) continue;
    if (planIndex < pending.plan.length) {
      current = enqueueDirection(current, pending.plan[planIndex]);
      planIndex += 1;
    }
    const previousEaten = current.eaten;
    current = advanceMove(current).state;
    // 预测只能使用请求时可见的食物，生成的新位置要等下一次观察。
    if (current.eaten > previousEaten) current = { ...current, food: null };
  }
  return { state: current, ended: current.phase !== "playing" };
}

export class DecisionTelemetry {
  private latenciesMs: number[] = [];
  private records: MotionRecord[] = [];
  private foodSinceTick = 0;
  private foodKey = "none";
  private eaten = -1;
  private bestDistance: number | null = null;
  private lastProgressTick = 0;
  private lastDistance: number | null = null;

  reset(state: GameState): void {
    this.records.length = 0;
    this.foodKey = foodKeyOf(state);
    this.eaten = state.eaten;
    this.foodSinceTick = state.tick;
    this.lastProgressTick = state.tick;
    this.lastDistance = shortestFoodDistance(state);
    this.bestDistance = this.lastDistance;
    this.record(state, false);
  }

  recordLatency(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.latenciesMs.push(ms);
    if (this.latenciesMs.length > LATENCY_LIMIT) {
      this.latenciesMs.splice(0, this.latenciesMs.length - LATENCY_LIMIT);
    }
  }

  recordMove(state: GameState, events: readonly { type: string; tick?: number }[]): void {
    const ate = events.some((event) => event.type === "eat");
    const key = foodKeyOf(state);
    const changed = ate || key !== this.foodKey || state.eaten !== this.eaten;
    const distance = shortestFoodDistance(state);

    if (changed) {
      this.foodKey = key;
      this.eaten = state.eaten;
      this.foodSinceTick = state.tick;
      this.lastProgressTick = state.tick;
      this.bestDistance = distance;
    } else if (
      distance !== null &&
      (this.bestDistance === null || distance < this.bestDistance)
    ) {
      this.bestDistance = distance;
      this.lastProgressTick = state.tick;
    }

    this.lastDistance = distance;
    this.record(state, ate);
  }

  context(state: GameState, pending: PendingTurn): DecisionContext {
    const latency = this.latencyStats();
    const scenarios = this.scenarios(state, latency);
    const history = this.historyStats(state);
    const scenarioStates = scenarios.map((scenario) => {
      const simulated = simulateWait(state, scenario.ticks, pending);
      const head = simulated.ended ? null : simulated.state.snake[0];
      return {
        ...scenario,
        moves: simulated.state.moveCount - state.moveCount,
        state: simulated.state,
        ended: simulated.ended,
        head: head === null ? null : { ...head },
        food:
          simulated.state.food === null ? null : { ...simulated.state.food },
        foodRelation: simulated.ended
          ? ("dead" as const)
          : foodRelation(simulated.state),
      };
    });

    const predictions: PredictedMove[] = DIRECTIONS.map((direction) => ({
      direction,
      outcomes: scenarioStates.map((scenario) => {
        if (scenario.ended) {
          return {
            scenario: scenario.label,
            ended: true,
            applicable: false,
            analysis: null,
          };
        }
        if (isOpposite(direction, scenario.state.direction)) {
          return {
            scenario: scenario.label,
            ended: false,
            applicable: false,
            analysis: null,
          };
        }
        return {
          scenario: scenario.label,
          ended: false,
          applicable: true,
          analysis: analyzeMove(scenario.state, direction),
        };
      }),
    }));

    return {
      tick: state.tick,
      latency,
      scenarios: scenarioStates.map((scenario) => ({
        label: scenario.label,
        ticks: scenario.ticks,
        moves: scenario.moves,
        likely: scenario.likely,
        head: scenario.head,
        food: scenario.food,
        ended: scenario.ended,
        foodRelation: scenario.foodRelation,
      })),
      history,
      recent: this.records.slice(-PROMPT_HISTORY),
      predictions,
      pending: {
        queue: [...pending.queue],
        plan: [...pending.plan],
      },
    };
  }

  private record(state: GameState, ate: boolean): void {
    const head = state.snake[0];
    this.records.push({
      tick: state.tick,
      head: { x: head.x, y: head.y },
      direction: state.direction,
      ate,
      foodKey: this.foodKey,
      eaten: this.eaten,
      distance: this.lastDistance,
    });
    if (this.records.length > HISTORY_LIMIT) {
      this.records.splice(0, this.records.length - HISTORY_LIMIT);
    }
  }

  private latencyStats(): LatencyStats {
    if (this.latenciesMs.length === 0) {
      return {
        samples: 0,
        p50Ticks: 0,
        p90Ticks: 0,
        minTicks: 0,
        maxTicks: 0,
      };
    }
    const ticks = this.latenciesMs
      .map((ms) => Math.max(0, Math.ceil(ms / MS_PER_TICK)))
      .sort((a, b) => a - b);
    return {
      samples: ticks.length,
      p50Ticks: percentile(ticks, 0.5),
      p90Ticks: percentile(ticks, 0.9),
      minTicks: ticks[0],
      maxTicks: ticks[ticks.length - 1],
    };
  }

  private scenarios(state: GameState, latency: LatencyStats): DelayScenario[] {
    const interval = Math.max(1, state.moveEveryTicks);
    const tickOffsets = [0];
    if (latency.samples > 0) {
      if (latency.p50Ticks > 0) tickOffsets.push(latency.p50Ticks);
      if (latency.p90Ticks > latency.p50Ticks) tickOffsets.push(latency.p90Ticks);
    } else {
      // 首次请求也展示等待一到两步的结果，让模型看到直行带来的风险。
      tickOffsets.push(interval, interval * 2);
    }
    const scenarios: DelayScenario[] = [];
    for (const ticks of tickOffsets) {
      const moves = Math.floor((state.moveAccumulator + ticks) / interval);
      const likely = latency.samples > 0 && ticks === latency.p50Ticks;
      scenarios.push({ label: `S${scenarios.length}`, ticks, moves, likely });
    }
    return scenarios;
  }

  private historyStats(state: GameState): HistoryStats {
    const currentKey = foodKeyOf(state);
    const usable = this.records
      .slice(-PROMPT_HISTORY)
      .filter(
        (record) => record.foodKey === currentKey && record.eaten === state.eaten,
      );
    const distances = usable
      .map((record) => record.distance)
      .filter((distance): distance is number => distance !== null);

    let sameFoodMoves = 0;
    for (let i = this.records.length - 1; i >= 0; i -= 1) {
      const record = this.records[i];
      if (record.foodKey !== currentKey || record.eaten !== state.eaten) break;
      sameFoodMoves += 1;
    }

    const stateCounts = new Map<string, number>();
    const cellCounts = new Map<string, number>();
    for (const record of usable) {
      const stateKey = `${record.head.x},${record.head.y},${record.direction}`;
      stateCounts.set(stateKey, (stateCounts.get(stateKey) ?? 0) + 1);
      const cellKey = `${record.head.x},${record.head.y}`;
      cellCounts.set(cellKey, (cellCounts.get(cellKey) ?? 0) + 1);
    }
    const repeats = Math.max(0, ...stateCounts.values());
    const cellRepeats = Math.max(0, ...cellCounts.values());

    const foodAgeTicks = Math.max(0, state.tick - this.foodSinceTick);
    const noProgressTicks = Math.max(0, state.tick - this.lastProgressTick);
    const noProgressMoves = Math.floor(
      noProgressTicks / Math.max(1, state.moveEveryTicks),
    );
    const distanceNow = shortestFoodDistance(state);
    const firstDistance = usable[0]?.distance ?? null;
    const trend =
      distanceNow !== null && firstDistance !== null
        ? distanceNow - firstDistance
        : null;

    return {
      moves: usable.length,
      foodAgeTicks,
      sameFoodMoves,
      distanceNow,
      minDistance: distances.length === 0 ? null : Math.min(...distances),
      trend,
      noProgressTicks,
      noProgressMoves,
      repeats,
      cellRepeats,
      loop:
        state.food !== null &&
        repeats >= 2 &&
        noProgressMoves >= 2 &&
        sameFoodMoves >= 4,
    };
  }
}
