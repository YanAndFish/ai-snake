import type { DecisionContext } from "../ai/context";
import { buildChoiceDescriptions, buildPrompt } from "../ai/prompt";
import { DIRECTIONS, isOpposite, type Direction, type GameState, type StateView } from "./types";
import { viewState } from "./game";

export interface Observation {
  /** 本次决策的棋盘、延迟和移动分析文本。 */
  prompt: string;
  /** 可提交给模型的方向，不包括当前方向的反向。 */
  legalMoves: Direction[];
  /** 每个候选方向在执行时点的分析。 */
  choiceDescriptions: Partial<Record<Direction, string>>;
  /** 游戏状态副本，调用者修改它不会改变游戏。 */
  view: StateView;
}

export type ObservationView = Observation;

export function legalMovesFor(state: GameState): Direction[] {
  return DIRECTIONS.filter((d) => !isOpposite(d, state.direction));
}

export function buildObservation(
  state: GameState,
  context?: DecisionContext,
): Observation {
  const legalMoves = legalMovesFor(state);
  const prompt = buildPrompt(state, legalMoves, context);
  const view = viewState(state);
  return { prompt, legalMoves, choiceDescriptions: buildChoiceDescriptions(state, legalMoves, context), view };
}
