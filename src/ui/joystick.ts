import type { JoystickDrag } from "../engine/input";

/** 手柄在圆盘内相对中心的固定偏移，单位为 CSS 像素。 */
const THUMB_OFFSET = 34;

/** 显示摇杆位置和当前转向；摇杆仅作视觉提示，触点由画布接收。 */
export function showJoystick(root: HTMLElement, drag: JoystickDrag): void {
  let dx = 0;
  let dy = 0;
  if (drag.direction === "left") dx = -THUMB_OFFSET;
  else if (drag.direction === "right") dx = THUMB_OFFSET;
  else if (drag.direction === "up") dy = -THUMB_OFFSET;
  else if (drag.direction === "down") dy = THUMB_OFFSET;
  root.style.setProperty("--joystick-x", `${drag.x}px`);
  root.style.setProperty("--joystick-y", `${drag.y}px`);
  root.style.setProperty("--joystick-dx", `${dx}px`);
  root.style.setProperty("--joystick-dy", `${dy}px`);
  root.hidden = false;
}
