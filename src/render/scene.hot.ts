import type * as THREE from "three";
import type { Cell, Direction, GameState } from "../sim/types";

export const SNAKE_SIZE = 0.82;

export interface SceneHot {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  segmentMeshes: THREE.Mesh[];
  headMesh: THREE.Mesh | null;
  headEyes: THREE.Mesh[];
  headTongue: THREE.Mesh | null;
  appleGroup: THREE.Group;
  particles: THREE.Mesh[];
  particleLife: number[];
  prevSnake: Cell[] | null;
  currentSnake: Cell[] | null;
  lastTick: number;
  shakeTime: number;
  shakeActive: boolean;
}

function yawFor(direction: Direction): number {
  switch (direction) {
    case "up":
      return Math.PI;
    case "down":
      return 0;
    case "left":
      return -Math.PI / 2;
    default:
      return Math.PI / 2;
  }
}

function setSnakeVisibility(scene: SceneHot, bodyLength: number): void {
  for (let i = 0; i < scene.segmentMeshes.length; i += 1) {
    scene.segmentMeshes[i].visible = i < bodyLength;
  }
}

function renderApple(scene: SceneHot, state: GameState, clock: number): void {
  scene.appleGroup.visible = state.food !== null && state.phase !== "over";
  if (state.food === null) return;
  scene.appleGroup.position.x = state.food.x + 0.5;
  scene.appleGroup.position.z = state.food.y + 0.5;
  scene.appleGroup.position.y = 0.42 + Math.sin(clock * 3) * 0.08;
  scene.appleGroup.rotation.y = clock * 1.2;
}

function renderParticles(scene: SceneHot, dt: number): void {
  for (let i = 0; i < scene.particles.length; i += 1) {
    if (scene.particleLife[i] <= 0) {
      scene.particles[i].visible = false;
      continue;
    }
    scene.particleLife[i] -= dt;
    const particle = scene.particles[i];
    particle.position.y += dt * 2;
    particle.position.x += dt * 0.6;
    const scale = Math.max(0.05, scene.particleLife[i]);
    particle.scale.x = scale;
    particle.scale.y = scale;
    particle.scale.z = scale;
    if (scene.particleLife[i] <= 0) particle.visible = false;
  }
}

function renderSnake(scene: SceneHot, state: GameState, alpha: number, clock: number): void {
  if (state.snake.length === 0) return;
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

  const from = scene.prevSnake !== null ? scene.prevSnake : state.snake;
  const to = scene.currentSnake !== null ? scene.currentSnake : state.snake;
  const progress =
    state.phase === "playing"
      ? Math.min(1, Math.max(0, (state.moveAccumulator + alpha) / state.moveEveryTicks))
      : 1;

  setSnakeVisibility(scene, to.length - 1);

  for (let i = 1; i < to.length; i += 1) {
    const previous = i < from.length ? from[i] : from[from.length - 1];
    const mesh = scene.segmentMeshes[i - 1];
    mesh.position.x = previous.x + (to[i].x - previous.x) * progress + 0.5;
    mesh.position.y = SNAKE_SIZE / 2;
    mesh.position.z = previous.y + (to[i].y - previous.y) * progress + 0.5;
  }

  if (scene.headMesh !== null) {
    const previousHead = from.length > 0 ? from[0] : to[0];
    scene.headMesh.position.x = previousHead.x + (to[0].x - previousHead.x) * progress + 0.5;
    scene.headMesh.position.y = SNAKE_SIZE / 2;
    scene.headMesh.position.z = previousHead.y + (to[0].y - previousHead.y) * progress + 0.5;
    scene.headMesh.rotation.y = yawFor(state.direction);
  }

  if (scene.headTongue !== null) {
    scene.headTongue.position.z = SNAKE_SIZE / 2 + 0.12 + Math.sin(clock * 8) * 0.05;
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

  renderSnake(scene, state, alpha, clock);
  renderApple(scene, state, clock);
  renderParticles(scene, frameDt);

  if (scene.shakeTime > 0) {
    scene.shakeTime -= frameDt;
    const amount = scene.shakeTime * 0.8;
    scene.camera.position.x = 7.5 + (Math.random() - 0.5) * amount;
    scene.camera.position.z = 18 + (Math.random() - 0.5) * amount;
    scene.camera.lookAt(7.5, 0, 7.5);
    scene.shakeActive = true;
  } else if (scene.shakeActive) {
    scene.shakeActive = false;
    scene.camera.position.set(7.5, 20, 18);
    scene.camera.lookAt(7.5, 0, 7.5);
  }

  scene.renderer.render(scene.scene, scene.camera);
}
