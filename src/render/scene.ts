import * as THREE from "three";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../config";
import type { Cell, Direction, GameState } from "../sim/types";
import {
  APPLE_SIZE,
  BOARD_TOP,
  HEAD_SIZE,
  SHADOW_LIFT,
  SHADOW_OFFSET_X,
  SHADOW_OFFSET_Z,
  VIEW_ELEVATION_DEGREES,
  renderSceneHot,
  type SceneHot,
} from "./scene.hot";
import { appleTexture } from "./snakeTextures";
import { createSnakeBody, createSnakeShadow } from "./snakeBody";
import {
  boardTexture,
  bushTexture,
  daisyTexture,
  grassTuftTexture,
  groundTexture,
  headTexture,
  particleTexture,
  shadowTexture,
  stoneTexture,
} from "./textures";

export { BOARD_TOP, SPRITE_SIZE } from "./scene.hot";
export type { SceneHot } from "./scene.hot";

const GROUND_Y = 0;
const FIELD_Y = 0.01;
const FIELD_MARGIN = 0.95;
const RAIL_WIDTH = 0.14;
const RAIL_HEIGHT = 0.12;
const RAIL_LOW = 0.14;
const RAIL_HIGH = 0.28;
const POST_WIDTH = 0.3;
const POST_HEIGHT = 0.42;
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

/** 创建与蛇身共用俯视角度的像素蛇头材质。 */
function makeHeadMaterial(direction: Direction): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: headTexture(direction),
    transparent: true,
    depthWrite: false,
    alphaTest: 0.04,
    toneMapped: false,
  });
}

export class Scene implements SceneHot {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  cameraHome = new THREE.Vector3();
  cameraTarget = new THREE.Vector3();
  /** 身体使用同一张像素贴图，弯道与直线的边缘连续。 */
  bodyMesh = createSnakeBody(MAX_SEGMENTS);
  /** 每帧插值后的身体中心点，依次保存 x、z。 */
  snakePoints = new Float32Array(MAX_SEGMENTS * 2);
  /** 沿身体轮廓连续绘制的地面阴影。 */
  bodyShadow = createSnakeShadow(this.bodyMesh);
  headMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  headShadow: THREE.Mesh | null = null;
  headMaterials: Record<Direction, THREE.MeshBasicMaterial>;
  appleGroup = new THREE.Group();
  appleSprite: THREE.Sprite | null = null;
  appleShadow: THREE.Mesh | null = null;
  particles: THREE.Sprite[] = [];
  particleLife: number[] = [];
  prevSnake: Cell[] | null = null;
  currentSnake: Cell[] | null = null;
  lastTick = -1;
  lastMoveCount = -1;
  shakeTime = 0;
  shakeActive = false;

  private readonly shadowGeometry: THREE.PlaneGeometry;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly decorations = new THREE.Group();
  private lastBufferWidth = 0;
  private lastBufferHeight = 0;

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
      up: makeHeadMaterial("up"),
      down: makeHeadMaterial("down"),
      left: makeHeadMaterial("left"),
      right: makeHeadMaterial("right"),
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

    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_WIDTH, BOARD_HEIGHT),
      new THREE.MeshBasicMaterial({
        map: boardTexture(BOARD_WIDTH, BOARD_HEIGHT),
        toneMapped: false,
      }),
    );
    field.rotation.x = -Math.PI / 2;
    field.position.set(BOARD_WIDTH / 2, FIELD_Y, BOARD_HEIGHT / 2);
    this.scene.add(field);

    const topMaterial = new THREE.MeshBasicMaterial({ color: "#b08a55", toneMapped: false });
    const sideMaterial = new THREE.MeshBasicMaterial({ color: "#6b4c2c", toneMapped: false });
    const fenceMaterials = [sideMaterial, sideMaterial, topMaterial, sideMaterial, sideMaterial, sideMaterial];
    const railGeoH = new THREE.BoxGeometry(
      BOARD_WIDTH + POST_WIDTH,
      RAIL_HEIGHT,
      RAIL_WIDTH,
    );
    const railGeoV = new THREE.BoxGeometry(
      RAIL_WIDTH,
      RAIL_HEIGHT,
      BOARD_HEIGHT + POST_WIDTH,
    );
    this.addFenceShadow(BOARD_WIDTH / 2, -RAIL_WIDTH / 2, BOARD_WIDTH + 0.6, 0.48);
    this.addFenceShadow(BOARD_WIDTH / 2, BOARD_HEIGHT + RAIL_WIDTH / 2, BOARD_WIDTH + 0.6, 0.48);
    this.addFenceShadow(-RAIL_WIDTH / 2, BOARD_HEIGHT / 2, 0.48, BOARD_HEIGHT + 0.6);
    this.addFenceShadow(BOARD_WIDTH + RAIL_WIDTH / 2, BOARD_HEIGHT / 2, 0.48, BOARD_HEIGHT + 0.6);
    const railYs = [FIELD_Y + RAIL_LOW, FIELD_Y + RAIL_HIGH];
    for (let i = 0; i < railYs.length; i += 1) {
      const y = railYs[i];
      const northRail = new THREE.Mesh(railGeoH, fenceMaterials);
      northRail.position.set(BOARD_WIDTH / 2, y, -RAIL_WIDTH / 2);
      this.scene.add(northRail);
      const southRail = new THREE.Mesh(railGeoH, fenceMaterials);
      southRail.position.set(BOARD_WIDTH / 2, y, BOARD_HEIGHT + RAIL_WIDTH / 2);
      this.scene.add(southRail);
      const westRail = new THREE.Mesh(railGeoV, fenceMaterials);
      westRail.position.set(-RAIL_WIDTH / 2, y, BOARD_HEIGHT / 2);
      this.scene.add(westRail);
      const eastRail = new THREE.Mesh(railGeoV, fenceMaterials);
      eastRail.position.set(BOARD_WIDTH + RAIL_WIDTH / 2, y, BOARD_HEIGHT / 2);
      this.scene.add(eastRail);
    }

    const postGeo = new THREE.BoxGeometry(POST_WIDTH, POST_HEIGHT, POST_WIDTH);
    const postXs = [0.1, 4.75, 9.5, 14.25, 18.9];
    const postOffset = POST_WIDTH / 2;
    for (let i = 0; i < postXs.length; i += 1) {
      const x = postXs[i];
      const northPost = new THREE.Mesh(postGeo, fenceMaterials);
      northPost.position.set(x, FIELD_Y + POST_HEIGHT / 2, -postOffset);
      this.scene.add(northPost);
      this.addFenceShadow(x, -postOffset, 0.68, 0.62);
      const southPost = new THREE.Mesh(postGeo, fenceMaterials);
      southPost.position.set(x, FIELD_Y + POST_HEIGHT / 2, BOARD_HEIGHT + postOffset);
      this.scene.add(southPost);
      this.addFenceShadow(x, BOARD_HEIGHT + postOffset, 0.68, 0.62);
      if (i > 0 && i < postXs.length - 1) {
        const westPost = new THREE.Mesh(postGeo, fenceMaterials);
        westPost.position.set(-postOffset, FIELD_Y + POST_HEIGHT / 2, x);
        this.scene.add(westPost);
        this.addFenceShadow(-postOffset, x, 0.68, 0.62);
        const eastPost = new THREE.Mesh(postGeo, fenceMaterials);
        eastPost.position.set(BOARD_WIDTH + postOffset, FIELD_Y + POST_HEIGHT / 2, x);
        this.scene.add(eastPost);
        this.addFenceShadow(BOARD_WIDTH + postOffset, x, 0.68, 0.62);
      }
    }
  }

  /** 绘制栅栏在地面上的柔和投影，偏移方向与食物一致。 */
  private addFenceShadow(x: number, z: number, width: number, depth: number): void {
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.position.set(x + SHADOW_OFFSET_X, BOARD_TOP + SHADOW_LIFT, z + SHADOW_OFFSET_Z);
    shadow.scale.set(width, 1, depth);
    this.scene.add(shadow);
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

  private buildSnake(): void {
    this.scene.add(this.bodyMesh);
    this.scene.add(this.bodyShadow);

    const geometry = new THREE.PlaneGeometry(HEAD_SIZE, HEAD_SIZE);
    geometry.rotateX(-Math.PI / 2);
    const head = new THREE.Mesh(geometry, this.headMaterials.right);
    head.renderOrder = 1000;
    head.visible = false;
    this.headMesh = head;
    this.scene.add(head);

    const headShadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    headShadow.position.y = BOARD_TOP + SHADOW_LIFT;
    headShadow.scale.set(1.65, 1, 1.45);
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
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const width = Math.max(1, Math.round(cssWidth / 2));
    const height = Math.max(1, Math.round(cssHeight / 2));
    if (width === this.lastBufferWidth && height === this.lastBufferHeight) return;
    this.lastBufferWidth = width;
    this.lastBufferHeight = height;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = CAMERA_FOV;
    this.camera.near = 0.1;
    this.camera.far = 300;

    const tanHalf = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
    const halfDepth = BOARD_HEIGHT / 2 + FIELD_MARGIN;
    const halfWidth = BOARD_WIDTH / 2 + FIELD_MARGIN;
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
