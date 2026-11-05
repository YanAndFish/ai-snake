import type * as THREE from "three";
import type { Cell, Direction, GameState } from "../sim/types";

export const BOARD_TOP = 0.01;
export const SPRITE_SIZE = 0.88;
export const HEAD_SIZE = 1;
export const BODY_LENGTH = 1.24;
export const BODY_WIDTH = 0.62;
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
  segmentMeshes: THREE.Sprite[];
  segmentShadows: THREE.Mesh[];
  headMesh: THREE.Sprite | null;
  headShadow: THREE.Mesh | null;
  tailMesh: THREE.Sprite | null;
  tailShadow: THREE.Mesh | null;
  headMaterials: Record<Direction, THREE.SpriteMaterial>;
  appleGroup: THREE.Group;
  appleSprite: THREE.Sprite | null;
  appleShadow: THREE.Mesh | null;
  particles: THREE.Sprite[];
  particleLife: number[];
  prevSnake: Cell[] | null;
  currentSnake: Cell[] | null;
  lastTick: number;
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

function setBodyVisibility(scene: SceneHot, count: number): void {
  for (let i = 0; i < scene.segmentMeshes.length; i += 1) {
    const visible = i < count;
    scene.segmentMeshes[i].visible = visible;
    scene.segmentShadows[i].visible = visible;
  }
}

function renderSnake(scene: SceneHot, state: GameState, alpha: number): void {
  if (state.snake.length === 0) {
    setBodyVisibility(scene, 0);
    if (scene.headMesh !== null) scene.headMesh.visible = false;
    if (scene.headShadow !== null) scene.headShadow.visible = false;
    if (scene.tailMesh !== null) scene.tailMesh.visible = false;
    if (scene.tailShadow !== null) scene.tailShadow.visible = false;
    return;
  }
  const head = state.snake[0];
  const moved =
    scene.currentSnake === null ||
    scene.currentSnake.length !== state.snake.length ||
    scene.currentSnake[0].x !== head.x ||
    scene.currentSnake[0].y !== head.y;

  if (moved) {
    scene.prevSnake = scene.currentSnake;
    scene.currentSnake = state.snake;
  }

  let from = scene.prevSnake !== null ? scene.prevSnake : state.snake;
  let to = scene.currentSnake !== null ? scene.currentSnake : state.snake;
  const fromHead = from.length > 0 ? from[0] : to[0];
  const toHead = to[0];
  if (Math.abs(fromHead.x - toHead.x) + Math.abs(fromHead.y - toHead.y) > 1) {
    scene.prevSnake = state.snake;
    scene.currentSnake = state.snake;
    from = state.snake;
    to = state.snake;
  }
  const divisor = state.moveEveryTicks > 0 ? state.moveEveryTicks : 1;
  const progress =
    state.phase === "over" ? 1 : clamp01((state.moveAccumulator + alpha) / divisor);

  const bodyCount = to.length - 1;
  setBodyVisibility(scene, bodyCount);

  for (let i = 1; i < to.length; i += 1) {
    const mesh = scene.segmentMeshes[i - 1];
    if (mesh === undefined) break;
    const previousA = i < from.length ? from[i] : from[from.length - 1];
    const previousB = i - 1 < from.length ? from[i - 1] : from[from.length - 1];
    const targetA = to[i];
    const targetB = to[i - 1];
    const ax = previousA.x + (targetA.x - previousA.x) * progress;
    const az = previousA.y + (targetA.y - previousA.y) * progress;
    const bx = previousB.x + (targetB.x - previousB.x) * progress;
    const bz = previousB.y + (targetB.y - previousB.y) * progress;
    const midX = (ax + bx) * 0.5 + 0.5;
    const midZ = (az + bz) * 0.5 + 0.5;
    const horizontal = Math.abs(ax - bx) >= Math.abs(az - bz);

    mesh.position.x = midX;
    mesh.position.z = midZ;
    mesh.position.y = BOARD_TOP + (horizontal ? BODY_WIDTH * 0.5 : BODY_LENGTH * VIEW_SIN * 0.5);
    mesh.scale.set(horizontal ? BODY_LENGTH : BODY_LENGTH * VIEW_SIN, BODY_WIDTH, 1);
    mesh.material.rotation = horizontal ? 0 : Math.PI / 2;
    mesh.renderOrder = 1 + (to.length - i);

    const shadow = scene.segmentShadows[i - 1];
    shadow.position.x = midX + SHADOW_OFFSET_X;
    shadow.position.z = midZ + SHADOW_OFFSET_Z;
    shadow.scale.set(
      horizontal ? BODY_LENGTH * 1.06 : BODY_WIDTH * 1.12,
      1,
      horizontal ? BODY_WIDTH * 1.12 : BODY_LENGTH * 1.06,
    );
  }

  if (scene.tailMesh !== null && to.length > 1) {
    const tailIndex = to.length - 1;
    const previousTail = tailIndex < from.length ? from[tailIndex] : from[from.length - 1];
    const targetTail = to[tailIndex];
    const tailX = previousTail.x + (targetTail.x - previousTail.x) * progress + 0.5;
    const tailZ = previousTail.y + (targetTail.y - previousTail.y) * progress + 0.5;
    scene.tailMesh.position.set(tailX, BOARD_TOP + BODY_WIDTH * 0.5, tailZ);
    scene.tailMesh.visible = true;
    if (scene.tailShadow !== null) {
      scene.tailShadow.position.set(
        tailX + SHADOW_OFFSET_X * 0.75,
        BOARD_TOP + SHADOW_LIFT,
        tailZ + SHADOW_OFFSET_Z * 0.75,
      );
      scene.tailShadow.visible = true;
    }
  }

  if (scene.headMesh !== null) {
    const previousHead = from.length > 0 ? from[0] : to[0];
    const targetHead = to[0];
    scene.headMesh.position.x =
      previousHead.x + (targetHead.x - previousHead.x) * progress + 0.5;
    scene.headMesh.position.y = BOARD_TOP + HEAD_SIZE * 0.5;
    scene.headMesh.position.z =
      previousHead.y + (targetHead.y - previousHead.y) * progress + 0.5;
    scene.headMesh.material = scene.headMaterials[state.direction];
    scene.headMesh.visible = true;
    if (scene.headShadow !== null) {
      scene.headShadow.position.x = scene.headMesh.position.x + SHADOW_OFFSET_X * 1.1;
      scene.headShadow.position.z = scene.headMesh.position.z + SHADOW_OFFSET_Z * 1.1;
      scene.headShadow.visible = true;
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
