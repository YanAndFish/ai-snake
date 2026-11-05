type Vars = {
  phase: string;
  aiMode: boolean;
  aiPending: boolean;
  ticks: number;
  haltTick: number;
};

export const state = (v: Vars) => {
  if (v.phase === "menu") return "Menu";
  if (v.phase === "playing") return v.aiPending ? "Playing, AI request in flight" : "Playing";
  if (v.phase === "paused") return "Paused";
  return "Game over";
};

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

export const title = "Snake run lifecycle, AI requests never halt";

export const step = (action: string, from: Vars, to: Vars) => {
  switch (action) {
    case "Start":
      return "you start a run";
    case "StartAI":
      return "you hand the run to the AI";
    case "Pause":
      return "you pause";
    case "Resume":
      return "you resume";
    case "AIRequest":
      return "the AI request starts";
    case "AIRespond":
      return "the AI answer arrives";
    case "AIError":
      return "the AI request fails";
    case "Tick":
      return to.phase === "over" ? "the run ends" : "the snake moves";
    case "Restart":
      return "you run it again";
    case "RestartAI":
      return "you let the AI run it again";
    case "Done":
      return "the run is over";
    default:
      return null;
  }
};
