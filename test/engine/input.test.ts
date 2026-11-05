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

  it("已有方向时仍保留 14px 判定距离", () => {
    expect(joystickDirection(0, 13, "right")).toBeNull();
    expect(joystickDirection(0, 14, "right")).toBe("down");
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
    expect(steering.move(14, 0)).toBe("right");
  });

  it("手指超出半径后中心跟随，偏移限制在半径内", () => {
    const steering = new TouchSteering(100, 100);
    expect(steering.move(100, 200)).toBe("down");
    expect(steering.x).toBeCloseTo(100);
    expect(steering.y).toBeCloseTo(164);
    expect(steering.dx).toBeCloseTo(0);
    expect(steering.dy).toBeCloseTo(36);
  });

  it("手指继续拖远时中心继续跟随，方向不重复上报", () => {
    const steering = new TouchSteering(100, 100);
    expect(steering.move(100, 200)).toBe("down");
    expect(steering.move(100, 300)).toBeNull();
    expect(steering.x).toBeCloseTo(100);
    expect(steering.y).toBeCloseTo(264);
    expect(steering.dx).toBeCloseTo(0);
    expect(steering.dy).toBeCloseTo(36);
  });

  it("手指在半径内时中心不动，偏移等于手指位移", () => {
    const steering = new TouchSteering(0, 0);
    expect(steering.move(0, 20)).toBe("down");
    expect(steering.x).toBeCloseTo(0);
    expect(steering.y).toBeCloseTo(0);
    expect(steering.dx).toBeCloseTo(0);
    expect(steering.dy).toBeCloseTo(20);
  });

  it("沿圆弧从下划向左时先保持方向，越过迟滞边界后换轴", () => {
    const steering = new TouchSteering(0, 0);
    expect(steering.move(0, 100)).toBe("down");
    expect(steering.x).toBeCloseTo(0);
    expect(steering.y).toBeCloseTo(64);

    const at135 = (135 * Math.PI) / 180;
    expect(steering.move(36 * Math.cos(at135), 64 + 36 * Math.sin(at135))).toBeNull();
    expect(steering.x).toBeCloseTo(0);
    expect(steering.y).toBeCloseTo(64);

    const at140 = (140 * Math.PI) / 180;
    expect(steering.move(36 * Math.cos(at140), 64 + 36 * Math.sin(at140))).toBeNull();
    expect(steering.x).toBeCloseTo(0);
    expect(steering.y).toBeCloseTo(64);

    const at150 = (150 * Math.PI) / 180;
    expect(steering.move(36 * Math.cos(at150), 64 + 36 * Math.sin(at150))).toBe("left");
    expect(steering.x).toBeCloseTo(0);
    expect(steering.y).toBeCloseTo(64);
  });

  it("同一方向连续移动返回 null", () => {
    const steering = new TouchSteering(0, 0);
    expect(steering.move(0, 20)).toBe("down");
    expect(steering.move(0, 30)).toBeNull();
    expect(steering.dy).toBeCloseTo(30);
  });
});
