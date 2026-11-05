import * as THREE from "three";
import type { Cell, GameState } from "../sim/types";
import {
  appleTexture,
  grassTexture,
  headTexture,
  leafTexture,
  snakeTexture,
  stemTexture,
  wallTexture,
} from "./textures";
import { SNAKE_SIZE, renderSceneHot, type SceneHot } from "./scene.hot";

const APPLE_SIZE = 0.6;
const MAX_PARTICLES = 64;
const MAX_SEGMENTS = 224;
const TILE_COLOR_A = new THREE.Color("#3a5c3d");
const TILE_COLOR_B = new THREE.Color("#314d35");

export class Scene implements SceneHot {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  segmentMeshes: THREE.Mesh[] = [];
  headMesh: THREE.Mesh | null = null;
  headEyes: THREE.Mesh[] = [];
  headTongue: THREE.Mesh | null = null;
  appleGroup = new THREE.Group();
  particles: THREE.Mesh[] = [];
  particleLife: number[] = [];
  prevSnake: Cell[] | null = null;
  currentSnake: Cell[] | null = null;
  lastTick = -1;
  shakeTime = 0;
  shakeActive = false;

  private readonly snakeGroup = new THREE.Group();
  private readonly bodyMaterial: THREE.MeshLambertMaterial;
  private readonly headMaterial: THREE.MeshLambertMaterial;
  private readonly eyeMaterial: THREE.MeshLambertMaterial;
  private readonly appleMaterial: THREE.MeshLambertMaterial;
  private readonly seed: number;

  constructor(canvas: HTMLCanvasElement, seed = 1) {
    this.seed = seed;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0a120c");

    this.camera = new THREE.OrthographicCamera(-14, 14, 14, -14, 1, 120);

    const hemi = new THREE.HemisphereLight("#a9c8a0", "#1a241a", 0.55);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight("#f1e6c8", 1.15);
    sun.position.set(10, 22, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    this.scene.add(sun);

    this.bodyMaterial = new THREE.MeshLambertMaterial({ map: snakeTexture() });
    this.headMaterial = new THREE.MeshLambertMaterial({ map: headTexture() });
    this.eyeMaterial = new THREE.MeshLambertMaterial({ color: "#0c0c10" });
    this.appleMaterial = new THREE.MeshLambertMaterial({ map: appleTexture() });

    this.buildBoard();
    this.buildApple();
    this.buildParticles();
    this.ensureSnakeMeshes(MAX_SEGMENTS);

    this.scene.add(this.snakeGroup);
    this.scene.add(this.appleGroup);

    this.camera.position.set(7.5, 20, 18);
    this.camera.lookAt(7.5, 0, 7.5);
    this.camera.updateProjectionMatrix();
  }

  private buildBoard(): void {
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(15, 1, 15),
      new THREE.MeshLambertMaterial({ map: grassTexture(this.seed) }),
    );
    floor.position.set(7.5, -0.75, 7.5);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const tileGeo = new THREE.BoxGeometry(0.94, 0.08, 0.94);
    const tiles = new THREE.InstancedMesh(
      tileGeo,
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      15 * 15,
    );
    const matrix = new THREE.Matrix4();
    let i = 0;
    for (let y = 0; y < 15; y += 1) {
      for (let x = 0; x < 15; x += 1) {
        matrix.makeTranslation(x + 0.5, 0.0, y + 0.5);
        tiles.setMatrixAt(i, matrix);
        tiles.setColorAt(i, (x + y) % 2 === 0 ? TILE_COLOR_A : TILE_COLOR_B);
        i += 1;
      }
    }
    tiles.receiveShadow = true;
    this.scene.add(tiles);

    const wallMat = new THREE.MeshLambertMaterial({ map: wallTexture() });
    const wallDefs: Array<[number, number, number, number]> = [
      [17, 1, 1, -0.5],
      [17, 1, 1, 14.5],
      [1, 1, 17, -0.5],
      [1, 1, 17, 14.5],
    ];
    for (const [w, h, d, axis] of wallDefs) {
      const horizontal = w > 1;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      wall.position.set(horizontal ? 7.5 : axis, 0.5, horizontal ? axis : 7.5);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
    }
  }

  private buildApple(): void {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(APPLE_SIZE, APPLE_SIZE, APPLE_SIZE),
      this.appleMaterial,
    );
    body.castShadow = true;
    this.appleGroup.add(body);

    const stem = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.24, 0.12),
      new THREE.MeshLambertMaterial({ map: stemTexture() }),
    );
    stem.position.y = APPLE_SIZE / 2 + 0.12;
    this.appleGroup.add(stem);

    const leaf = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.05, 0.16),
      new THREE.MeshLambertMaterial({ map: leafTexture() }),
    );
    leaf.position.set(0.14, APPLE_SIZE / 2 + 0.1, 0);
    leaf.castShadow = true;
    this.appleGroup.add(leaf);
  }

  private buildParticles(): void {
    const geo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: "#a85a44" }));
      mesh.visible = false;
      this.particles.push(mesh);
      this.particleLife.push(0);
      this.scene.add(mesh);
    }
  }

  private ensureSnakeMeshes(length: number): void {
    const geo = new THREE.BoxGeometry(SNAKE_SIZE, SNAKE_SIZE, SNAKE_SIZE);
    while (this.segmentMeshes.length < length) {
      const mesh = new THREE.Mesh(geo, this.bodyMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      this.segmentMeshes.push(mesh);
      this.snakeGroup.add(mesh);
    }

    if (this.headMesh === null) {
      this.headMesh = new THREE.Mesh(
        new THREE.BoxGeometry(SNAKE_SIZE, SNAKE_SIZE, SNAKE_SIZE),
        this.headMaterial,
      );
      this.headMesh.castShadow = true;
      this.snakeGroup.add(this.headMesh);
      for (let e = 0; e < 2; e += 1) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.1), this.eyeMaterial);
        eye.position.set(e === 0 ? -0.1 : 0.1, 0.12, SNAKE_SIZE / 2);
        this.headEyes.push(eye);
        this.headMesh.add(eye);
      }
      this.headTongue = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.04, 0.04),
        new THREE.MeshLambertMaterial({ color: "#8f3444" }),
      );
      this.headTongue.position.set(0, -0.05, SNAKE_SIZE / 2 + 0.12);
      this.headMesh.add(this.headTongue);
    }
  }

  render(state: GameState, alpha: number, clock: number, dt: number): void {
    renderSceneHot(this, state, alpha, clock, dt);
  }

  burstAt(cell: Cell): void {
    let spawned = 0;
    for (let i = 0; i < this.particles.length && spawned < 16; i += 1) {
      if (this.particleLife[i] > 0) continue;
      const p = this.particles[i];
      p.position.set(cell.x + 0.5, 0.4, cell.y + 0.5);
      p.visible = true;
      this.particleLife[i] = 0.5 + Math.random() * 0.3;
      spawned += 1;
    }
  }

  shake(): void {
    this.shakeTime = 0.4;
  }

  resize(cssWidth: number, cssHeight: number): void {
    const w = Math.max(240, Math.floor(cssWidth / 2));
    const h = Math.max(180, Math.floor(cssHeight / 2));
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const half = 14;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
