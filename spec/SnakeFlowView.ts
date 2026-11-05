/** 状态图使用的生命周期字段。 */
type Vars = {
  /** 一局游戏当前所处的阶段。 */
  phase: "menu" | "playing" | "paused" | "over";
  /** 是否由 AI 控制。 */
  aiMode: boolean;
  /** 是否正在等待网络响应。 */
  aiPending: boolean;
  /** 是否已收到等待执行的选择。 */
  aiReady: boolean;
  /** 待执行的 AI 方向。aiReady 为 false 时不参与执行。 */
  readyDir: "R" | "L" | "U" | "D";
  /** 已推进的 tick 数。 */
  ticks: number;
  /** 暂停或结束游戏时记录的 tick 数。 */
  haltTick: number;
};

/** 将模型状态归入读者可见的生命周期节点。 */
export const state = (v: Vars) => {
  if (v.phase === "menu") return "菜单";
  if (v.phase === "playing") {
    if (v.aiPending) return "游戏中，等待 AI 响应";
    if (v.aiReady) return "游戏中，等待下一次移动";
    return "游戏中";
  }
  if (v.phase === "paused") return "已暂停";
  return "游戏结束";
};

/** 按运行状态选择节点颜色。 */
export const group = (v: Vars) => {
  if (v.phase === "playing") return "Running";
  if (v.phase === "paused") return "Halted";
  return "Idle";
};

export const colors = {
  Running: "blue",
  Halted: "orange",
  Idle: "tan",
};

export const title = "游戏生命周期与 AI 结果缓存";

/** 返回状态转换的说明。null 表示图中省略该动作。 */
export const step = (action: string, from: Vars, to: Vars) => {
  switch (action) {
    case "Start":
      return "开始游戏";
    case "StartAI":
      return "开始 AI 游戏";
    case "Pause":
      return "暂停并清空 AI 请求和缓存";
    case "Resume":
      return "恢复游戏";
    case "AIRequest":
      return "发起 AI 请求";
    case "AIRespond":
    case "AIRespondAny":
      return "缓存 AI 选择";
    case "AIApply":
      return "下一次移动应用方向";
    case "AIError":
      return "AI 请求失败";
    case "Tick":
      return to.phase === "over" ? "游戏结束并清空 AI 请求和缓存" : "蛇移动";
    case "Restart":
      return "重新开始游戏";
    case "RestartAI":
      return "重新开始 AI 游戏";
    case "Done":
      return "游戏已结束";
    default:
      return null;
  }
};
