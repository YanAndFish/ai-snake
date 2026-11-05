import { describe, expect, it } from "vitest";
import { joystickDirection } from "../../src/engine/input";

describe("摇杆转向", () => {
  it("首次拖动按距离较大的轴选择方向", () => {
    expect(joystickDirection(80, 10)).toBe("right");
    expect(joystickDirection(-80, 10)).toBe("left");
    expect(joystickDirection(10, -80)).toBe("up");
    expect(joystickDirection(10, 80)).toBe("down");
  });

  it("手指在中心区域轻微移动时不转向", () => {
    expect(joystickDirection(0, 0)).toBeNull();
    expect(joystickDirection(8, -8)).toBeNull();
    expect(joystickDirection(13, 4)).toBeNull();
    expect(joystickDirection(0, 0, "right")).toBeNull();
  });

  it("对角线附近的小幅移动沿用上次的轴", () => {
    expect(joystickDirection(30, 33, "right")).toBe("right");
    expect(joystickDirection(-30, 33, "left")).toBe("left");
    expect(joystickDirection(33, -30, "up")).toBe("up");
    expect(joystickDirection(33, 30, "down")).toBe("down");
  });

  it("拖动明显转向另一条轴时切换方向", () => {
    expect(joystickDirection(30, 50, "right")).toBe("down");
    expect(joystickDirection(-30, -50, "left")).toBe("up");
    expect(joystickDirection(50, -30, "up")).toBe("right");
    expect(joystickDirection(-50, 30, "down")).toBe("left");
  });
});
