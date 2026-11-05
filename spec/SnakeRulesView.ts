type Vars = {
  phase: string;
  body: number[];
  food: number;
  score: number;
  eaten: number;
  ticks: number;
  aiPending: boolean;
};

const names: Record<string, string> = {
  menu: "Menu",
  playing: "Playing",
  paused: "Paused",
  over: "Game over",
};

export const state = (v: Vars) =>
  v.phase === "playing" ? `Playing, ${v.body.length} segments` : (names[v.phase] ?? v.phase);

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

export const title = "Snake rules model, 3x3 board";

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
    case "AIRespondChoice":
      return "the AI answer arrives";
    case "TurnChoice":
      return "you steer";
    case "Advance":
      if (to.phase === "over" && to.body.length === from.body.length) return "the snake crashes";
      if (to.phase === "over" && to.body.length > from.body.length) return "the board fills";
      if (to.body.length > from.body.length) return "the snake eats";
      return "the snake moves";
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
