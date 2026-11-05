import type * as THREE from "three";
import type { Cell, Direction, GameState } from "../sim/types";
import { BODY_RADIUS, BODY_SAMPLES, BODY_SIDES, BODY_Y } from "./snakeBody";

export const BOARD_TOP = 0.01;
export const SPRITE_SIZE = 0.88;
export const HEAD_SIZE = 1.35;
export const APPLE_SIZE = 0.84;
export const SHADOW_LIFT = 0.006;
export const SHADOW_OFFSET_X = 0.08;
export const SHADOW_OFFSET_Z = 0.13;
export const VIEW_ELEVATION_DEGREES = 52;
export const VIEW_SIN = Math.sin((VIEW_ELEVATION_DEGREES * Math.PI) / 180);

export interface SceneHot {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraHome: THREE.Vector3;
  cameraTarget: THREE.Vector3;
  /** 连续的蛇身网格，顶点数组在创建场景时分配。 */
  bodyMesh: THREE.Mesh;
  /** 插值后的身体中心点，依次保存 x、z。 */
  snakePoints: Float32Array;
  /** 与身体同时更新的连续地面阴影。 */
  bodyShadow: THREE.Mesh;
  /** 蛇头与蛇身使用同一俯视平面。 */
  headMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null;
  headShadow: THREE.Mesh | null;
  headMaterials: Record<Direction, THREE.MeshBasicMaterial>;
  appleGroup: THREE.Group;
  appleSprite: THREE.Sprite | null;
  appleShadow: THREE.Mesh | null;
  particles: THREE.Sprite[];
  particleLife: number[];
  prevSnake: Cell[] | null;
  currentSnake: Cell[] | null;
  lastTick: number;
  /** 上次渲染的移动次数，用于区分移动和控制台替换蛇身。 */
  lastMoveCount: number;
  shakeTime: number;
  shakeActive: boolean;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function renderParticles(scene: SceneHot, frameDt: number): void {
  for (let i = 0; i < scene.particles.length; i += 1) {
    const particle = scene.particles[i];
    const life = scene.particleLife[i];
    if (life <= 0) {
      particle.visible = false;
      continue;
    }
    const nextLife = life - frameDt;
    scene.particleLife[i] = nextLife;
    if (nextLife <= 0) {
      particle.visible = false;
      continue;
    }
    particle.visible = true;
    particle.position.x += ((i % 5) - 2) * frameDt * 0.32;
    particle.position.z += ((i % 3) - 1) * frameDt * 0.24;
    particle.position.y += frameDt * 1.55;
    const age = 0.8 - Math.min(nextLife, 0.8);
    const size = 0.14 + age * 0.42;
    particle.scale.set(size, size, 1);
    particle.material.opacity = clamp01(nextLife * 2.6);
  }
}

function renderApple(scene: SceneHot, state: GameState, clock: number): void {
  const visible = state.food !== null && state.phase !== "over";
  scene.appleGroup.visible = visible;
  if (!visible || state.food === null) return;
  const food = state.food;
  scene.appleGroup.position.x = food.x + 0.5;
  scene.appleGroup.position.z = food.y + 0.5;
  if (scene.appleSprite !== null) {
    scene.appleSprite.position.y =
      BOARD_TOP + APPLE_SIZE * 0.5 + Math.sin(clock * 3.4) * 0.06;
  }
}

/** 沿中心线连接平面的像素贴图，弯道连续，尾部逐渐变细。 */
function renderBody(scene: SceneHot, count: number): void {
  const points = scene.snakePoints;
  const attribute = scene.bodyMesh.geometry.getAttribute("position");
  const shadowAttribute = scene.bodyShadow.geometry.getAttribute("position");
  const rings = (count - 1) * BODY_SAMPLES + 1;
  const stride = BODY_SIDES + 1;
  for (let ring = 0; ring < rings; ring += 1) {
    const distance = ring / BODY_SAMPLES;
    const index = Math.min(count - 2, Math.floor(distance));
    const t = distance - index;
    const p0 = Math.max(0, index - 1) * 2;
    const p1 = index * 2;
    const p2 = (index + 1) * 2;
    const p3 = Math.min(count - 1, index + 2) * 2;
    const x0 = points[p0];
    const z0 = points[p0 + 1];
    const x1 = points[p1];
    const z1 = points[p1 + 1];
    const x2 = points[p2];
    const z2 = points[p2 + 1];
    const x3 = points[p3];
    const z3 = points[p3 + 1];
    const cx = 2 * x0 - 5 * x1 + 4 * x2 - x3;
    const cz = 2 * z0 - 5 * z1 + 4 * z2 - z3;
    const dx = -x0 + 3 * x1 - 3 * x2 + x3;
    const dz = -z0 + 3 * z1 - 3 * z2 + z3;
    const x = 0.5 * (2 * x1 + (x2 - x0) * t + cx * t * t + dx * t * t * t);
    const z = 0.5 * (2 * z1 + (z2 - z0) * t + cz * t * t + dz * t * t * t);
    const tx = 0.5 * (x2 - x0 + 2 * cx * t + 3 * dx * t * t);
    const tz = 0.5 * (z2 - z0 + 2 * cz * t + 3 * dz * t * t);
    const length = Math.sqrt(tx * tx + tz * tz);
    const nx = length > 0.0001 ? -tz / length : 1;
    const nz = length > 0.0001 ? tx / length : 0;
    const taper = Math.min(1, (count - 1 - distance) / 0.9);
    const radius = BODY_RADIUS * (0.08 + 0.92 * taper);
    attribute.setXYZ(ring * stride, x + nx * radius, BOARD_TOP + BODY_Y, z + nz * radius);
    attribute.setXYZ(ring * stride + 1, x - nx * radius, BOARD_TOP + BODY_Y, z - nz * radius);
    const shadowRadius = radius * 1.32;
    shadowAttribute.setXYZ(ring * stride, x + nx * shadowRadius + SHADOW_OFFSET_X, BOARD_TOP + SHADOW_LIFT, z + nz * shadowRadius + SHADOW_OFFSET_Z);
    shadowAttribute.setXYZ(ring * stride + 1, x - nx * shadowRadius + SHADOW_OFFSET_X, BOARD_TOP + SHADOW_LIFT, z - nz * shadowRadius + SHADOW_OFFSET_Z);
  }
  attribute.needsUpdate = true;
  shadowAttribute.needsUpdate = true;
  scene.bodyMesh.geometry.setDrawRange(0, (rings - 1) * BODY_SIDES * 6);
  scene.bodyMesh.visible = true;
  scene.bodyShadow.geometry.setDrawRange(0, (rings - 1) * BODY_SIDES * 6);
  scene.bodyShadow.visible = true;
}

/** 在上一步和当前步之间插值；重开或替换蛇身时直接使用新坐标。 */
function renderSnake(scene: SceneHot, state: GameState, alpha: number): void {
  if (state.snake !== scene.currentSnake) {
    const continuous = scene.currentSnake !== null && state.moveCount === scene.lastMoveCount + 1;
    scene.prevSnake = continuous ? scene.currentSnake : state.snake;
    scene.currentSnake = state.snake;
  }
  scene.lastMoveCount = state.moveCount;
  const from = scene.prevSnake !== null ? scene.prevSnake : state.snake;
  const to = state.snake;
  const divisor = state.moveEveryTicks > 0 ? state.moveEveryTicks : 1;
  const progress = state.phase === "over" ? 1 : clamp01((state.moveAccumulator + alpha) / divisor);
  for (let i = 0; i < to.length; i += 1) {
    const previous = i < from.length ? from[i] : from[from.length - 1];
    const x = previous.x + (to[i].x - previous.x) * progress + 0.5;
    const z = previous.y + (to[i].y - previous.y) * progress + 0.5;
    scene.snakePoints[i * 2] = x;
    scene.snakePoints[i * 2 + 1] = z;
  }
  if (to.length > 1) renderBody(scene, to.length);
  else {
    scene.bodyMesh.visible = false;
    scene.bodyShadow.visible = false;
  }
  if (scene.headMesh !== null) {
    scene.headMesh.position.set(scene.snakePoints[0], BOARD_TOP + BODY_Y + 0.002, scene.snakePoints[1]);
    scene.headMesh.material = scene.headMaterials[state.direction];
    scene.headMesh.visible = to.length > 0;
    if (scene.headShadow !== null) {
      scene.headShadow.position.x = scene.headMesh.position.x + SHADOW_OFFSET_X * 1.1;
      scene.headShadow.position.z = scene.headMesh.position.z + SHADOW_OFFSET_Z * 1.1;
      scene.headShadow.visible = to.length > 0;
    }
  }
}

function renderShake(scene: SceneHot, frameDt: number): void {
  if (scene.shakeTime > 0) {
    scene.shakeTime -= frameDt;
    if (scene.shakeTime < 0) scene.shakeTime = 0;
    const amount = scene.shakeTime * 0.55;
    scene.camera.position.x = scene.cameraHome.x + (Math.random() - 0.5) * amount;
    scene.camera.position.y = scene.cameraHome.y + (Math.random() - 0.5) * amount * 0.5;
    scene.camera.position.z = scene.cameraHome.z + (Math.random() - 0.5) * amount;
    scene.camera.lookAt(scene.cameraTarget);
    scene.shakeActive = true;
  } else if (scene.shakeActive) {
    scene.camera.position.copy(scene.cameraHome);
    scene.camera.lookAt(scene.cameraTarget);
    scene.shakeActive = false;
  }
}

export function renderSceneHot(
  scene: SceneHot,
  state: GameState,
  alpha: number,
  clock: number,
  frameDt: number,
): void {
  if (state.tick < scene.lastTick || state.phase === "menu") {
    scene.prevSnake = null;
    scene.currentSnake = null;
  }
  scene.lastTick = state.tick;

  renderSnake(scene, state, alpha);
  renderApple(scene, state, clock);
  renderParticles(scene, frameDt);
  renderShake(scene, frameDt);

  scene.renderer.render(scene.scene, scene.camera);
}
