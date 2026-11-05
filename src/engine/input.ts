import type { Direction } from "../sim/types";

export type KeyAction = "pause" | "restart" | "mute";

const JOYSTICK_DEAD_ZONE = 14;
const JOYSTICK_SHOW_DISTANCE = 6;
const JOYSTICK_TRAVEL = 36;

/** 摇杆中心在屏幕中的位置和手柄相对中心的偏移。 */
export interface JoystickDrag {
  /** 摇杆中心的水平坐标，单位为 CSS 像素。 */
  x: number;
  /** 摇杆中心的垂直坐标，单位为 CSS 像素。 */
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

/** 将手柄偏移转换为方向；中心区域忽略，换轴时保留 1.25 倍迟滞。 */
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

/** 浮动摇杆状态机：中心在手指超出半径后跟随，方向由中心到手指的角度决定。 */
export class TouchSteering {
  /** 摇杆中心的水平坐标。 */
  private baseX: number;
  /** 摇杆中心的垂直坐标。 */
  private baseY: number;
  /** 手柄相对中心的水平偏移。 */
  private offsetX = 0;
  /** 手柄相对中心的垂直偏移。 */
  private offsetY = 0;
  /** 最近一次生效的方向。 */
  private heading: Direction | null = null;

  constructor(x: number, y: number) {
    this.baseX = x;
    this.baseY = y;
  }

  /** 摇杆中心的水平坐标。 */
  get x(): number {
    return this.baseX;
  }

  /** 摇杆中心的垂直坐标。 */
  get y(): number {
    return this.baseY;
  }

  /** 手柄相对中心的水平偏移，已限制在摇杆半径内。 */
  get dx(): number {
    return this.offsetX;
  }

  /** 手柄相对中心的垂直偏移，已限制在摇杆半径内。 */
  get dy(): number {
    return this.offsetY;
  }

  /** 返回本次移动产生的新方向；未转向或方向未变时返回 null。 */
  move(x: number, y: number): Direction | null {
    let dx = x - this.baseX;
    let dy = y - this.baseY;
    const distance = Math.hypot(dx, dy);
    if (distance > JOYSTICK_TRAVEL) {
      const scale = JOYSTICK_TRAVEL / distance;
      dx *= scale;
      dy *= scale;
      this.baseX = x - dx;
      this.baseY = y - dy;
    }
    this.offsetX = dx;
    this.offsetY = dy;
    const direction = joystickDirection(dx, dy, this.heading);
    if (direction === null) {
      this.heading = null;
      return null;
    }
    if (direction === this.heading) return null;
    this.heading = direction;
    return direction;
  }
}

/** 按住拖动时立即转向，松手后移除摇杆效果。一次只跟踪一个触点。 */
function bindJoystick(
  options: TouchInputOptions,
  onDirection: (direction: Direction) => void,
): JoystickBinding {
  const target = options.target;
  let pointerId: number | null = null;
  let dragging = false;
  let steering: TouchSteering | null = null;

  /** 清除手势，并释放浏览器对触点的捕获。 */
  const cancel = (): void => {
    const captured = pointerId;
    pointerId = null;
    dragging = false;
    steering = null;
    if (captured !== null && target.hasPointerCapture(captured)) target.releasePointerCapture(captured);
    options.onEnd();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (pointerId !== null || !event.isPrimary || event.pointerType === "mouse" || !options.canControl()) return;
    pointerId = event.pointerId;
    steering = new TouchSteering(event.clientX, event.clientY);
    target.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId || steering === null) return;
    if (!options.canControl()) {
      cancel();
      return;
    }
    const direction = steering.move(event.clientX, event.clientY);
    if (!dragging && Math.hypot(steering.dx, steering.dy) < JOYSTICK_SHOW_DISTANCE) return;
    dragging = true;
    options.onDrag({ x: steering.x, y: steering.y, dx: steering.dx, dy: steering.dy });
    if (direction !== null) onDirection(direction);
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
