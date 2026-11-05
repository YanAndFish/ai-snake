import type { Direction } from "../sim/types";

/** AI 的一次操作。keep 表示不转向，蛇按当前方向移动。 */
export type AiAction = Direction | "keep";
