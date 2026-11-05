import type { JoystickDrag } from "../engine/input";

/** 显示摇杆中心和手柄偏移；摇杆仅作视觉提示，触点由画布接收。 */
export function showJoystick(root: HTMLElement, drag: JoystickDrag): void {
  root.style.setProperty("--joystick-x", `${drag.x}px`);
  root.style.setProperty("--joystick-y", `${drag.y}px`);
  root.style.setProperty("--joystick-dx", `${drag.dx}px`);
  root.style.setProperty("--joystick-dy", `${drag.dy}px`);
  root.hidden = false;
}
