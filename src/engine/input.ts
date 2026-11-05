import type { Direction } from "../sim/types";

export type KeyAction = "pause" | "restart" | "mute";

const SWIPE_THRESHOLD = 24;

export function swipeDirection(dx: number, dy: number): Direction | null {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < SWIPE_THRESHOLD && absY < SWIPE_THRESHOLD) return null;
  if (absX >= absY) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

export function bindSwipe(
  target: HTMLElement,
  onDirection: (direction: Direction) => void,
): () => void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;

  const onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.pointerType === "mouse") return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    pointerId = null;
    const direction = swipeDirection(event.clientX - startX, event.clientY - startY);
    if (direction !== null) onDirection(direction);
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === pointerId) pointerId = null;
  };

  target.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);

  return () => {
    target.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
  };
}

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
  private swipeCleanup: (() => void) | null = null;

  constructor(target: EventTarget, handlers: InputHandlers, gestureTarget?: HTMLElement) {
    this.target = target;
    this.handlers = handlers;
    this.handler = (event) => this.handle(event);
    this.target.addEventListener("keydown", this.handler);
    if (gestureTarget) {
      this.swipeCleanup = bindSwipe(gestureTarget, handlers.onDirection);
    }
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
    this.swipeCleanup?.();
    this.swipeCleanup = null;
  }
}
