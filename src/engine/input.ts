import type { Direction } from "../sim/types";

export type KeyAction = "pause" | "restart" | "mute";

export function keyToDirection(code: string): Direction | null {
  switch (code) {
    case "ArrowUp":
    case "KeyW":
      return "up";
    case "ArrowDown":
    case "KeyS":
      return "down";
    case "ArrowLeft":
    case "KeyA":
      return "left";
    case "ArrowRight":
    case "KeyD":
      return "right";
    default:
      return null;
  }
}

export function keyToAction(code: string): KeyAction | null {
  switch (code) {
    case "Space":
      return "pause";
    case "KeyR":
      return "restart";
    case "KeyM":
      return "mute";
    default:
      return null;
  }
}

export interface InputHandlers {
  onDirection: (dir: Direction) => void;
  onPause: () => void;
  onRestart: () => void;
  onMute: () => void;
}

export class Input {
  private target: EventTarget;
  private handlers: InputHandlers;
  private handler: (event: Event) => void;

  constructor(target: EventTarget, handlers: InputHandlers) {
    this.target = target;
    this.handlers = handlers;
    this.handler = (event) => this.handle(event);
    this.target.addEventListener("keydown", this.handler);
  }

  handle(event: Event): void {
    const keyboard = event as KeyboardEvent;
    if (!keyboard || typeof keyboard.code !== "string") return;
    const dir = keyToDirection(keyboard.code);
    if (dir !== null) {
      this.handlers.onDirection(dir);
      return;
    }
    const action = keyToAction(keyboard.code);
    if (action === "pause") this.handlers.onPause();
    else if (action === "restart") this.handlers.onRestart();
    else if (action === "mute") this.handlers.onMute();
  }

  dispose(): void {
    this.target.removeEventListener("keydown", this.handler);
  }
}
