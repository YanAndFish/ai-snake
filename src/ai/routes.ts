import { analyzeMove } from "../sim/analysis";
import { advanceMove, cloneState, enqueueDirection } from "../sim/game";
import { DIRECTIONS, isOpposite, type Cell, type Direction, type GameState } from "../sim/types";

/** API 可以选择的连续路线，方向值标记这条路线的首步。 */
export interface RouteChoice {
  /** 同一次请求中唯一的首步方向。 */
  direction: Direction;
  /** 每次移动执行一个方向。 */
  moves: Direction[];
  /** 提供给模型的路线结果。 */
  description: string;
  /** 第几步吃到当前已知食物；null 表示路线内没有吃到。 */
  eatAt: number | null;
  /** 到当前已知食物的曼哈顿距离缩短量。 */
  progress: number;
}

/** 返回一次真实移动的结果，拒绝反向移动。 */
function move(state: GameState, direction: Direction): GameState | null {
  if (isOpposite(direction, state.direction)) return null;
  return advanceMove(enqueueDirection({ ...state, queue: [] }, direction)).state;
}

/** 返回能完成下一次移动的方向及其结果。 */
function safeMoves(state: GameState): { direction: Direction; state: GameState }[] {
  const result: { direction: Direction; state: GameState }[] = [];
  for (const direction of DIRECTIONS) {
    const next = move(state, direction);
    if (next !== null && (next.phase === "playing" || next.overReason === "win")) {
      result.push({ direction, state: next });
    }
  }
  return result;
}

/** 返回到指定食物的曼哈顿距离，没有目标时返回 0。 */
function distance(state: GameState, food: Cell | null): number {
  return food === null ? 0 : Math.abs(state.snake[0].x - food.x) + Math.abs(state.snake[0].y - food.y);
}

/** 直行安全时保持方向，否则选择能直行最远的安全方向。 */
export function rescueDirection(state: GameState): Direction {
  const straight = move(state, state.direction);
  if (straight?.phase === "playing" || straight?.overReason === "win") return state.direction;
  const choices = safeMoves(state);
  const winning = choices.find((choice) => choice.state.overReason === "win");
  if (winning !== undefined) return winning.direction;
  choices.sort((a, b) => analyzeMove(state, b.direction).runway - analyzeMove(state, a.direction).runway || DIRECTIONS.indexOf(a.direction) - DIRECTIONS.indexOf(b.direction));
  return choices[0]?.direction ?? state.direction;
}

/** 按真实移动规则预测前缀终点，包含吃食物后的 RNG 和速度变化。 */
export function projectPrefix(state: GameState, moves: readonly Direction[]): GameState | null {
  let current = cloneState(state);
  for (let index = 0; index < moves.length; index += 1) {
    const direction = moves[index];
    current.tick += current.moveEveryTicks - current.moveAccumulator;
    current.moveAccumulator = 0;
    const next = move(current, direction);
    if (next === null || (next.phase !== "playing" && !(next.overReason === "win" && index === moves.length - 1))) return null;
    current = next;
  }
  return current;
}

/** 创建等待期间的避险前缀，只在直行将碰撞时转向。 */
export function buildBridge(state: GameState, length: number): Direction[] {
  const moves: Direction[] = [];
  let current = state;
  while (moves.length < length) {
    const direction = rescueDirection(current);
    const next = move(current, direction);
    if (next === null || (next.phase !== "playing" && next.overReason !== "win")) break;
    moves.push(direction);
    current = next;
    if (next.overReason === "win") break;
  }
  return moves;
}

/** 根据最近 8 个成功响应的 P90 选择动作步数，没有样本时用 16 步。 */
export function routeLength(state: GameState, latenciesMs: readonly number[]): number {
  if (latenciesMs.length === 0) return 16;
  const recent = latenciesMs.slice(-8).sort((a, b) => a - b);
  const p90Ticks = recent[Math.ceil(recent.length * 0.9) - 1] * 60 / 1000;
  if (p90Ticks <= state.moveEveryTicks) return 1;
  return Math.max(8, Math.min(32, Math.ceil(p90Ticks / state.moveEveryTicks) + 2));
}

/** 每个安全首方向提供一条路线，并检查至少 16 步的安全延伸。 */
export function buildRouteChoices(state: GameState, length: number, visibleFood: Cell | null = state.food): RouteChoice[] {
  const choices: RouteChoice[] = [];
  if (state.phase !== "playing") return choices;
  const checkedLength = Math.max(16, length);
  for (const first of safeMoves(state)) {
    let current = first.state;
    const moves: Direction[] = [first.direction];
    let food = visibleFood;
    let eatAt = food !== null && distance(current, food) === 0 ? 1 : null;
    if (eatAt !== null) food = null;
    while (moves.length < checkedLength && current.phase === "playing") {
      let direction: Direction | undefined;
      if (food !== null) {
        const target = food;
        const candidates = safeMoves(current);
        candidates.sort((a, b) => distance(a.state, target) - distance(b.state, target) || Number(b.direction === current.direction) - Number(a.direction === current.direction) || DIRECTIONS.indexOf(a.direction) - DIRECTIONS.indexOf(b.direction));
        direction = candidates[0]?.direction;
      } else {
        direction = rescueDirection(current);
      }
      if (direction === undefined) break;
      const next = move(current, direction);
      if (next === null || (next.phase !== "playing" && next.overReason !== "win")) break;
      current = next;
      moves.push(direction);
      if (food !== null && distance(current, food) === 0) {
        eatAt = moves.length;
        food = null;
      }
    }
    if (moves.length !== checkedLength && current.overReason !== "win") continue;
    const actions = moves.slice(0, length);
    const end = projectPrefix(state, actions);
    if (end === null) continue;
    const actionEatAt = eatAt !== null && eatAt <= length ? eatAt : null;
    const progress = visibleFood === null ? 0 : distance(state, visibleFood) - (actionEatAt !== null ? 0 : distance(end, visibleFood));
    const head = end.snake[0];
    choices.push({
      direction: first.direction,
      moves: actions,
      eatAt: actionEatAt,
      progress,
      description: `Route ${first.direction}: moves=${actions.join(",")} length=${actions.length} safe_extension=${moves.length} eatAt=${actionEatAt ?? "-"} progress=${progress} end=(${head.x},${head.y}). After eating known food, only continue straight or avoid collisions.`,
    });
  }
  return choices;
}

/** 比较路线执行起点，tick 与累加器不参与比较。 */
export function matchesRouteStart(state: GameState, expected: GameState): boolean {
  return state.phase === "playing" && expected.phase === "playing" &&
    state.control === expected.control && state.width === expected.width && state.height === expected.height &&
    state.moveCount === expected.moveCount && state.direction === expected.direction &&
    state.rng === expected.rng && state.seed === expected.seed && state.eaten === expected.eaten && state.score === expected.score &&
    state.moveEveryTicks === expected.moveEveryTicks && state.difficulty === expected.difficulty &&
    state.snake.length === expected.snake.length && state.snake.every((cell, index) => cell.x === expected.snake[index].x && cell.y === expected.snake[index].y) &&
    state.queue.length === expected.queue.length && state.queue.every((direction, index) => direction === expected.queue[index]) &&
    (state.food === null ? expected.food === null : expected.food !== null && state.food.x === expected.food.x && state.food.y === expected.food.y);
}

/** 描述固定前缀终点的棋盘，模型只选择从这个位置开始的路线。 */
export function buildRoutePrompt(state: GameState, choices: readonly RouteChoice[], visibleFood: Cell | null): string {
  return [
    "SNAKE/3 ROUTES",
    "This is the exact future board after the committed prefix. Choose one listed route; its direction token is a route ID, not an immediate turn.",
    `Start move=${state.moveCount}; board=${state.width}x${state.height}; x right, y down; direction=${state.direction}; interval=${state.moveEveryTicks} ticks.`,
    `Body=${state.snake.map((cell) => `(${cell.x},${cell.y})`).join(" ")}`,
    visibleFood === null ? "Known food=none. Food generated during the prefix is hidden from route pursuit." : `Known food=(${visibleFood.x},${visibleFood.y}).`,
    ...choices.map((choice) => choice.description),
    "Prefer survival and reaching the known food sooner. Compare eatAt and progress. Every route has a simulated safety extension; it does not guarantee indefinite survival.",
    "Return exactly one listed direction token. An early answer waits until this start position. A late answer is discarded.",
  ].join("\n");
}
