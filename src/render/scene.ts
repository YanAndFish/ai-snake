import * as THREE from "three";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../config";
import type { Cell, Direction, GameState } from "../sim/types";
import {
  APPLE_SIZE,
  BOARD_TOP,
  BODY_LENGTH,
  BODY_WIDTH,
  HEAD_SIZE,
  SHADOW_LIFT,
  SHADOW_OFFSET_X,
  SHADOW_OFFSET_Z,
  VIEW_ELEVATION_DEGREES,
  renderSceneHot,
  type SceneHot,
} from "./scene.hot";
import {
  appleTexture,
  boardTexture,
  borderTexture,
  bushTexture,
  daisyTexture,
  grassTuftTexture,
  groundShadowTexture,
  groundTexture,
  headTexture,
  particleTexture,
  shadowTexture,
  snakeBodyTexture,
  soilTexture,
  stoneTexture,
} from "./textures";

export { BOARD_TOP, SPRITE_SIZE } from "./scene.hot";
export type { SceneHot } from "./scene.hot";

const BORDER_WIDTH = 0.58;
const BORDER_HEIGHT = 0.16;
const GROUND_Y = -0.16;
const PLINTH_HEIGHT = BOARD_TOP - GROUND_Y;
const MAX_PARTICLES = 48;
const MAX_SEGMENTS = BOARD_WIDTH * BOARD_HEIGHT;
const CAMERA_FOV = 34;
const CAMERA_ELEVATION = THREE.MathUtils.degToRad(VIEW_ELEVATION_DEGREES);
const CAMERA_SIN = Math.sin(CAMERA_ELEVATION);
const CAMERA_COS = Math.cos(CAMERA_ELEVATION);
const FIT_FRACTION = 0.93;

function makeSpriteMaterial(texture: THREE.Texture): THREE.SpriteMaterial {
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    alphaTest: 0.04,
    toneMapped: false,
  });
  return material;
}

export class Scene implements SceneHot {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraHome = new THREE.Vector3();
  cameraTarget = new THREE.Vector3();
  segmentMeshes: THREE.Sprite[] = [];
  segmentShadows: THREE.Mesh[] = [];
  headMesh: THREE.Sprite | null = null;
  headShadow: THREE.Mesh | null = null;
  headMaterials: Record<Direction, THREE.SpriteMaterial>;
  appleGroup = new THREE.Group();
  appleSprite: THREE.Sprite | null = null;
  appleShadow: THREE.Mesh | null = null;
  particles: THREE.Sprite[] = [];
  particleLife: number[] = [];
  prevSnake: Cell[] | null = null;
  currentSnake: Cell[] | null = null;
  lastTick = -1;
  shakeTime = 0;
  shakeActive = false;

  private readonly shadowGeometry: THREE.PlaneGeometry;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly decorations = new THREE.Group();

  constructor(canvas: HTMLCanvasElement, seed = 1) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#cfe3b0");

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 300);
    this.cameraTarget.set(BOARD_WIDTH / 2, BOARD_TOP, BOARD_HEIGHT / 2);
    this.cameraHome.set(BOARD_WIDTH / 2, BOARD_TOP + 30, BOARD_HEIGHT / 2 + 20);
    this.camera.position.copy(this.cameraHome);
    this.camera.lookAt(this.cameraTarget);

    this.shadowGeometry = new THREE.PlaneGeometry(1, 1);
    this.shadowGeometry.rotateX(-Math.PI / 2);
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
      toneMapped: false,
    });

    this.headMaterials = {
      up: makeSpriteMaterial(headTexture("up")),
      down: makeSpriteMaterial(headTexture("down")),
      left: makeSpriteMaterial(headTexture("left")),
      right: makeSpriteMaterial(headTexture("right")),
    };

    this.buildBoard();
    this.buildDecorations();
    this.buildApple();
    this.buildSnake();
    this.buildParticles();

    this.scene.add(this.decorations);
    this.scene.add(this.appleGroup);

    this.resize(canvas.clientWidth || 960, canvas.clientHeight || 640);
  }

  private buildBoard(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshBasicMaterial({ map: groundTexture(), toneMapped: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(BOARD_WIDTH / 2, GROUND_Y, BOARD_HEIGHT / 2);
    this.scene.add(ground);

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_WIDTH + BORDER_WIDTH * 2, PLINTH_HEIGHT, BOARD_HEIGHT + BORDER_WIDTH * 2),
      new THREE.MeshBasicMaterial({ map: soilTexture(), toneMapped: false }),
    );
    plinth.position.set(BOARD_WIDTH / 2, (BOARD_TOP + GROUND_Y) / 2, BOARD_HEIGHT / 2);
    this.scene.add(plinth);

    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_WIDTH, BOARD_HEIGHT),
      new THREE.MeshBasicMaterial({
        map: boardTexture(BOARD_WIDTH, BOARD_HEIGHT),
        toneMapped: false,
      }),
    );
    field.rotation.x = -Math.PI / 2;
    field.position.set(BOARD_WIDTH / 2, BOARD_TOP + 0.002, BOARD_HEIGHT / 2);
    this.scene.add(field);

    const borderMaterial = new THREE.MeshBasicMaterial({
      map: borderTexture(),
      toneMapped: false,
    });
    const borderY = BOARD_TOP + BORDER_HEIGHT / 2;
    const horizontalBorder = new THREE.BoxGeometry(
      BOARD_WIDTH + BORDER_WIDTH * 2,
      BORDER_HEIGHT,
      BORDER_WIDTH,
    );
    const verticalBorder = new THREE.BoxGeometry(
      BORDER_WIDTH,
      BORDER_HEIGHT,
      BOARD_HEIGHT,
    );
    const topBorder = new THREE.Mesh(horizontalBorder, borderMaterial);
    topBorder.position.set(BOARD_WIDTH / 2, borderY, -BORDER_WIDTH / 2);
    this.scene.add(topBorder);
    const bottomBorder = new THREE.Mesh(horizontalBorder, borderMaterial);
    bottomBorder.position.set(BOARD_WIDTH / 2, borderY, BOARD_HEIGHT + BORDER_WIDTH / 2);
    this.scene.add(bottomBorder);
    const leftBorder = new THREE.Mesh(verticalBorder, borderMaterial);
    leftBorder.position.set(-BORDER_WIDTH / 2, borderY, BOARD_HEIGHT / 2);
    this.scene.add(leftBorder);
    const rightBorder = new THREE.Mesh(verticalBorder, borderMaterial);
    rightBorder.position.set(BOARD_WIDTH + BORDER_WIDTH / 2, borderY, BOARD_HEIGHT / 2);
    this.scene.add(rightBorder);

    const boardShadowMap = groundShadowTexture();
    const ambientShadow = new THREE.Mesh(
      this.shadowGeometry,
      new THREE.MeshBasicMaterial({
        map: boardShadowMap,
        transparent: true,
        depthWrite: false,
        opacity: 0.32,
        toneMapped: false,
      }),
    );
    ambientShadow.position.set(BOARD_WIDTH / 2, GROUND_Y + 0.002, BOARD_HEIGHT / 2);
    ambientShadow.scale.set(
      BOARD_WIDTH + BORDER_WIDTH * 2 + 5.2,
      1,
      BOARD_HEIGHT + BORDER_WIDTH * 2 + 5.2,
    );
    this.scene.add(ambientShadow);

    const contactShadow = new THREE.Mesh(
      this.shadowGeometry,
      new THREE.MeshBasicMaterial({
        map: boardShadowMap,
        transparent: true,
        depthWrite: false,
        opacity: 0.58,
        toneMapped: false,
      }),
    );
    contactShadow.position.set(BOARD_WIDTH / 2, GROUND_Y + 0.003, BOARD_HEIGHT / 2);
    contactShadow.scale.set(
      BOARD_WIDTH + BORDER_WIDTH * 2 + 1.4,
      1,
      BOARD_HEIGHT + BORDER_WIDTH * 2 + 1.4,
    );
    this.scene.add(contactShadow);
  }

  private addDecoration(texture: THREE.Texture, size: number, x: number, z: number): void {
    const sprite = new THREE.Sprite(makeSpriteMaterial(texture));
    sprite.scale.set(size, size, 1);
    sprite.center.set(0.5, 0);
    sprite.position.set(x, GROUND_Y + 0.004, z);
    sprite.renderOrder = 1;
    this.decorations.add(sprite);

    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.position.set(
      x + SHADOW_OFFSET_X * size * 1.3,
      GROUND_Y + 0.006,
      z + SHADOW_OFFSET_Z * size * 1.3,
    );
    shadow.scale.set(size * 0.9, 1, size * 0.62);
    this.decorations.add(shadow);
  }

  private buildDecorations(): void {
    this.addDecoration(grassTuftTexture(), 0.62, 1.4, -1.7);
    this.addDecoration(grassTuftTexture(), 0.56, -1.8, 4.4);
    this.addDecoration(grassTuftTexture(), 0.6, 17.8, -1.6);
    this.addDecoration(grassTuftTexture(), 0.62, -1.7, 12.8);
    this.addDecoration(grassTuftTexture(), 0.58, 20.9, 8.5);
    this.addDecoration(grassTuftTexture(), 0.6, 12.2, 20.6);
    this.addDecoration(grassTuftTexture(), 0.52, 5.2, 20.8);

    this.addDecoration(daisyTexture(), 0.62, 20.8, 3.0);
    this.addDecoration(daisyTexture(), 0.58, 2.8, 20.8);
    this.addDecoration(daisyTexture(), 0.56, -1.6, 18.4);
    this.addDecoration(daisyTexture(), 0.6, 20.7, 16.2);
    this.addDecoration(daisyTexture(), 0.54, -1.5, 9.0);

    this.addDecoration(bushTexture(), 0.84, 9.4, -2.0);
    this.addDecoration(bushTexture(), 0.76, 21.0, 12.0);
    this.addDecoration(bushTexture(), 0.74, -2.0, 7.2);
    this.addDecoration(bushTexture(), 0.72, 20.9, 18.5);
    this.addDecoration(bushTexture(), 0.7, 17.2, 20.8);

    this.addDecoration(stoneTexture(), 0.5, 21.0, 5.2);
    this.addDecoration(stoneTexture(), 0.46, -1.7, 1.6);
    this.addDecoration(stoneTexture(), 0.52, 7.0, 20.8);
    this.addDecoration(stoneTexture(), 0.44, 18.2, 20.7);
  }

  private buildApple(): void {
    const sprite = new THREE.Sprite(makeSpriteMaterial(appleTexture()));
    sprite.scale.set(APPLE_SIZE, APPLE_SIZE, 1);
    sprite.center.set(0.5, 0.5);
    sprite.position.y = BOARD_TOP + APPLE_SIZE * 0.5;
    sprite.renderOrder = 1;
    this.appleSprite = sprite;
    this.appleGroup.add(sprite);

    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.position.set(0.06, BOARD_TOP + SHADOW_LIFT, 0.1);
    shadow.scale.set(0.86, 1, 0.68);
    this.appleShadow = shadow;
    this.appleGroup.add(shadow);
  }

  private addBodyShadow(): THREE.Mesh {
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.position.y = BOARD_TOP + SHADOW_LIFT;
    shadow.scale.set(BODY_LENGTH * 1.06, 1, BODY_WIDTH * 1.12);
    shadow.visible = false;
    this.scene.add(shadow);
    return shadow;
  }

  private buildSnake(): void {
    const bodyA = snakeBodyTexture(0);
    const bodyB = snakeBodyTexture(1);
    for (let i = 0; i < MAX_SEGMENTS; i += 1) {
      const sprite = new THREE.Sprite(
        makeSpriteMaterial(i % 2 === 0 ? bodyA : bodyB),
      );
      sprite.scale.set(BODY_LENGTH, BODY_WIDTH, 1);
      sprite.center.set(0.5, 0.5);
      sprite.renderOrder = 1;
      sprite.visible = false;
      this.segmentMeshes.push(sprite);
      this.scene.add(sprite);
      this.segmentShadows.push(this.addBodyShadow());
    }

    const head = new THREE.Sprite(this.headMaterials.right);
    head.scale.set(HEAD_SIZE, HEAD_SIZE, 1);
    head.center.set(0.5, 0.5);
    head.renderOrder = 1000;
    head.visible = false;
    this.headMesh = head;
    this.scene.add(head);

    const headShadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    headShadow.position.y = BOARD_TOP + SHADOW_LIFT;
    headShadow.scale.set(0.82, 1, 0.68);
    headShadow.visible = false;
    this.headShadow = headShadow;
    this.scene.add(headShadow);
  }

  private buildParticles(): void {
    const texture = particleTexture();
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      const sprite = new THREE.Sprite(makeSpriteMaterial(texture));
      sprite.scale.set(0.2, 0.2, 1);
      sprite.renderOrder = 1001;
      sprite.visible = false;
      this.particles.push(sprite);
      this.particleLife.push(0);
      this.scene.add(sprite);
    }
  }

  render(state: GameState, alpha: number, clock: number, dt: number): void {
    renderSceneHot(this, state, alpha, clock, dt);
  }

  burstAt(cell: Cell): void {
    let spawned = 0;
    for (let i = 0; i < this.particles.length && spawned < 16; i += 1) {
      if (this.particleLife[i] > 0) continue;
      const particle = this.particles[i];
      particle.position.set(
        cell.x + 0.5 + (Math.random() - 0.5) * 0.3,
        BOARD_TOP + 0.18 + Math.random() * 0.22,
        cell.y + 0.5 + (Math.random() - 0.5) * 0.3,
      );
      particle.visible = true;
      particle.material.opacity = 1;
      this.particleLife[i] = 0.55 + Math.random() * 0.25;
      spawned += 1;
    }
  }

  shake(): void {
    this.shakeTime = 0.35;
  }

  resize(cssWidth: number, cssHeight: number): void {
    const width = Math.max(240, Math.floor(cssWidth / 2));
    const height = Math.max(180, Math.floor(cssHeight / 2));
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = CAMERA_FOV;
    this.camera.near = 0.1;
    this.camera.far = 300;

    const tanHalf = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
    const halfDepth = BOARD_HEIGHT / 2 + BORDER_WIDTH + 0.55;
    const halfWidth = BOARD_WIDTH / 2 + BORDER_WIDTH + 0.55;
    const nearDepth = halfDepth * CAMERA_COS;
    const distanceY = nearDepth + (halfDepth * CAMERA_SIN) / (FIT_FRACTION * tanHalf);
    const distanceX = nearDepth + halfWidth / (FIT_FRACTION * tanHalf * aspect);
    const distance = Math.max(distanceY, distanceX);

    this.cameraHome.set(
      BOARD_WIDTH / 2,
      BOARD_TOP + distance * CAMERA_SIN,
      BOARD_HEIGHT / 2 + distance * CAMERA_COS,
    );
    this.camera.position.copy(this.cameraHome);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateProjectionMatrix();
    this.shakeActive = false;
    this.shakeTime = 0;
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((object) => {
      const renderable = object as THREE.Mesh;
      if (renderable.geometry !== undefined) geometries.add(renderable.geometry);
      const material = renderable.material;
      if (material === undefined) return;
      if (Array.isArray(material)) {
        for (const entry of material) materials.add(entry);
      } else {
        materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      const mapped = material as THREE.Material & { map?: THREE.Texture | null };
      if (mapped.map) textures.add(mapped.map);
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    this.renderer.dispose();
  }
}
