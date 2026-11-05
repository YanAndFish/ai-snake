import { describe, expect, it } from "vitest";
import { joystickDirection, TouchSteering } from "../../src/engine/input";

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

  it("已有方向时 8px 即可换轴", () => {
    expect(joystickDirection(0, 8, "right")).toBe("down");
    expect(joystickDirection(0, -8, "left")).toBe("up");
    expect(joystickDirection(8, 0, "up")).toBe("right");
    expect(joystickDirection(-8, 0, "down")).toBe("left");
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

describe("TouchSteering", () => {
  it("首次移动 13px 不转向，14px 转向", () => {
    const steering = new TouchSteering(0, 0);
    expect(steering.move(13, 0)).toBeNull();
    expect(steering.direction).toBeNull();
    expect(steering.move(14, 0)).toBe("right");
    expect(steering.direction).toBe("right");
  });

  it("连续按住时 10px 的四向转折", () => {
    const steering = new TouchSteering(0, 0);
    expect(steering.move(14, 0)).toBe("right");
    expect(steering.move(14, 10)).toBe("down");
    expect(steering.move(24, 10)).toBe("right");
    expect(steering.move(24, 0)).toBe("up");
    expect(steering.direction).toBe("up");
  });

  it("同向连续移动返回 null，但锚点重设后 8px 的垂直移动即可换向", () => {
    const steering = new TouchSteering(0, 0);
    expect(steering.move(14, 0)).toBe("right");
    expect(steering.move(22, 0)).toBeNull();
    expect(steering.move(22, 8)).toBe("down");
    expect(steering.direction).toBe("down");
  });

  it("direction 反映当前方向", () => {
    const steering = new TouchSteering(100, 100);
    expect(steering.direction).toBeNull();
    expect(steering.move(100, 86)).toBe("up");
    expect(steering.direction).toBe("up");
    expect(steering.move(100, 86)).toBeNull();
    expect(steering.direction).toBe("up");
  });
});
