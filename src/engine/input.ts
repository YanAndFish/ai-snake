import type { Direction } from "../sim/types";

export type KeyAction = "pause" | "restart" | "mute";

const JOYSTICK_DEAD_ZONE = 14;
const JOYSTICK_SHOW_DISTANCE = 6;
const JOYSTICK_TRAVEL = 36;

/** 摇杆中心和圆形手柄在屏幕中的位置。 */
export interface JoystickDrag {
  /** 按下位置的水平坐标，单位为 CSS 像素。 */
  x: number;
  /** 按下位置的垂直坐标，单位为 CSS 像素。 */
  y: number;
  /** 手柄相对中心的水平偏移，已限制在摇杆半径内。 */
  dx: number;
  /** 手柄相对中心的垂直偏移，已限制在摇杆半径内。 */
  dy: number;
}

/** 触屏手势的接收区域、可用条件和显示回调。 */
export interface TouchInputOptions {
  /** 接收按下事件的游戏画布。 */
  target: HTMLElement;
  /** 只有返回 true 时才接收触屏转向。 */
  canControl: () => boolean;
  /** 实际拖动后更新摇杆的位置和手柄偏移。 */
  onDrag: (drag: JoystickDrag) => void;
  /** 松手、取消或停止接收输入时收起摇杆。 */
  onEnd: () => void;
}

/** 触屏手势的取消和清理方法。 */
interface JoystickBinding {
  /** 结束当前手势并收起摇杆。 */
  cancel: () => void;
  /** 移除监听，并结束当前手势。 */
  dispose: () => void;
}

/** 将拖动距离转换为方向；中心区域返回 null，对角线附近沿用上次的轴。 */
export function joystickDirection(dx: number, dy: number, previous: Direction | null = null): Direction | null {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (Math.hypot(dx, dy) < JOYSTICK_DEAD_ZONE) return null;
  if ((previous === "left" || previous === "right") && absY < absX * 1.25) {
    return dx > 0 ? "right" : "left";
  }
  if ((previous === "up" || previous === "down") && absX < absY * 1.25) {
    return dy > 0 ? "down" : "up";
  }
  if (absX >= absY) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}

/** 按住拖动时立即转向，松手后移除摇杆效果。一次只跟踪一个触点。 */
function bindJoystick(
  options: TouchInputOptions,
  onDirection: (direction: Direction) => void,
): JoystickBinding {
  const target = options.target;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let previous: Direction | null = null;

  /** 清除手势，并释放浏览器对触点的捕获。 */
  const cancel = (): void => {
    const captured = pointerId;
    pointerId = null;
    dragging = false;
    previous = null;
    if (captured !== null && target.hasPointerCapture(captured)) target.releasePointerCapture(captured);
    options.onEnd();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (pointerId !== null || !event.isPrimary || event.pointerType === "mouse" || !options.canControl()) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    target.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    if (!options.canControl()) {
      cancel();
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const distance = Math.hypot(dx, dy);
    if (!dragging && distance < JOYSTICK_SHOW_DISTANCE) return;
    dragging = true;
    const scale = distance > JOYSTICK_TRAVEL ? JOYSTICK_TRAVEL / distance : 1;
    options.onDrag({ x: startX, y: startY, dx: dx * scale, dy: dy * scale });
    const direction = joystickDirection(dx, dy, previous);
    if (direction !== null && direction !== previous) onDirection(direction);
    previous = direction;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) return;
    cancel();
  };

  const onVisibilityChange = (): void => {
    if (document.hidden) cancel();
  };

  target.addEventListener("pointerdown", onPointerDown);
  target.addEventListener("lostpointercapture", onPointerUp);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("blur", cancel);
  window.addEventListener("resize", cancel);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    cancel,
    dispose() {
      cancel();
      target.removeEventListener("pointerdown", onPointerDown);
      target.removeEventListener("lostpointercapture", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
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
  /** 请求向指定方向移动，由会话检查当前阶段和转向是否合法。 */
  onDirection: (dir: Direction) => void;
  /** 切换暂停状态。 */
  onPause: () => void;
  /** 重新开始游戏。 */
  onRestart: () => void;
  /** 切换静音状态。 */
  onMute: () => void;
}

/** 接收键盘和触屏转向，并在销毁时移除事件监听。 */
export class Input {
  /** 接收键盘事件的对象。 */
  private target: EventTarget;
  /** 键盘和触屏共用的游戏操作。 */
  private handlers: InputHandlers;
  /** 用于移除键盘监听的回调。 */
  private handler: (event: Event) => void;
  /** 触屏绑定；null 表示只接收键盘输入。 */
  private joystick: JoystickBinding | null = null;

  constructor(target: EventTarget, handlers: InputHandlers, touch?: TouchInputOptions) {
    this.target = target;
    this.handlers = handlers;
    this.handler = (event) => this.handle(event);
    this.target.addEventListener("keydown", this.handler);
    if (touch) this.joystick = bindJoystick(touch, handlers.onDirection);
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

  /** 结束当前拖动，并收起摇杆。 */
  cancelGesture(): void {
    this.joystick?.cancel();
  }

  /** 移除键盘和触屏监听，并收起摇杆。 */
  dispose(): void {
    this.target.removeEventListener("keydown", this.handler);
    this.joystick?.dispose();
    this.joystick = null;
  }
}
