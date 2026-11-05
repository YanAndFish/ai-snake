import * as THREE from "three";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../config";
import { Rng } from "../engine/rng";
import { SHADOW_OFFSET_X, SHADOW_OFFSET_Z, VIEW_ELEVATION_DEGREES, VIEW_SIN } from "./scene.hot";
import {
  logTexture,
  mushroomTexture,
  pathTexture,
  pineTexture,
  pondTexture,
  reedsTexture,
  signTexture,
  treeTexture,
  wildflowerTexture,
} from "./sceneryTextures";
import { bushTexture, grassTuftTexture, shadowTexture, stoneTexture } from "./textures";

/** 一个静态贴片在世界中的位置与尺寸。 */
interface SceneryPatch {
  /** 贴片底部中心的横坐标。地面贴片使用中心横坐标。 */
  x: number;
  /** 贴片底部中心的纵坐标。地面贴片使用中心纵坐标。 */
  z: number;
  /** 世界坐标中的宽度。 */
  width: number;
  /** 竖立贴片的高度，或地面贴片的深度。 */
  height: number;
}

/** 将同一贴图的静态景物合成一个网格，减少绘制次数。 */
function createPatchMesh(
  texture: THREE.Texture,
  patches: SceneryPatch[],
  ground = false,
): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const cos = Math.cos(THREE.MathUtils.degToRad(VIEW_ELEVATION_DEGREES));
  for (const patch of patches) {
    const left = patch.x - patch.width / 2;
    const right = patch.x + patch.width / 2;
    const bottom = ground ? patch.z + patch.height / 2 : patch.z;
    const top = ground ? patch.z - patch.height / 2 : patch.z - patch.height * VIEW_SIN;
    const baseY = ground ? 0.006 : 0.012;
    const topY = ground ? baseY : baseY + patch.height * cos;
    const offset = positions.length / 3;
    positions.push(left, baseY, bottom, right, baseY, bottom, right, topY, top, left, topY, top);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    map: texture,
    alphaTest: ground ? 0.01 : 0.5,
    transparent: ground,
    depthWrite: !ground,
    toneMapped: false,
  }));
}

/** 创建棋盘外的林地、花丛与池塘。所有贴图和网格只在创建场景时生成。 */
export function createScenery(seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "scenery";
  const rng = new Rng(seed ^ 0x5ce9e);
  const batches = new Map<THREE.Texture, SceneryPatch[]>();
  const shadows: SceneryPatch[] = [];
  const oak = treeTexture();
  const birch = treeTexture(true);
  const pine = pineTexture();
  const grass = grassTuftTexture();
  const bush = bushTexture();
  const stone = stoneTexture();
  const mushroom = mushroomTexture();
  const log = logTexture();
  const reeds = reedsTexture();
  const flowers = [wildflowerTexture("#d1b5d6"), wildflowerTexture("#e3af9d"), wildflowerTexture("#f2e5b3")];

  /** 收集竖立景物，并添加贴近底部的地面阴影。 */
  function plant(texture: THREE.Texture, x: number, z: number, height: number, width = height): void {
    let patches = batches.get(texture);
    if (patches === undefined) {
      patches = [];
      batches.set(texture, patches);
    }
    patches.push({ x, z, width, height });
    const isTree = texture === oak || texture === birch || texture === pine;
    // 树冠决定投影大小，偏移量保持较小，让投影与树根相连。
    const shadowOffset = isTree ? 1 : height;
    shadows.push({
      x: x + SHADOW_OFFSET_X * shadowOffset,
      z: z + SHADOW_OFFSET_Z * shadowOffset,
      width: width * 0.85,
      height: width * 0.5,
    });
    if (isTree) {
      // 树干与地面接触处更暗，细树干也能看清落点。
      shadows.push({ x, z, width: width * 0.3, height: width * 0.18 });
    }
  }

  const path = createPatchMesh(pathTexture(), [{ x: BOARD_WIDTH / 2, z: BOARD_HEIGHT / 2, width: 80, height: 80 }], true);
  path.name = "woodland-path";
  path.renderOrder = -2;
  group.add(path);
  const pond = createPatchMesh(pondTexture(), [{ x: BOARD_WIDTH + 3.3, z: 3.4, width: 4.7, height: 5.2 }], true);
  pond.name = "pond";
  pond.renderOrder = -1;
  group.add(pond);

  // 靠近栅栏的树木按簇摆放，给花丛和小路留出空隙。
  for (const [x, z, height] of [
    [-3.4, 1.2, 3.8], [-4.2, 7.8, 4.3], [-3.8, 15.2, 3.6],
    [1.2, -4.3, 3.9], [5.6, -4.7, 4.8], [12.9, -4.5, 3.9], [17.8, -4.2, 4.6],
    [22.7, -2.8, 4.4], [23.1, 10.4, 4.1], [22.8, 17.3, 3.7],
  ]) {
    plant(rng.next() < 0.3 ? birch : oak, x, z, height, height * 0.8);
    plant(bush, x - 0.9, z + 0.3, 1.1);
    plant(mushroom, x + 0.8, z + 0.3, 0.56);
  }

  // 远处的林带覆盖宽屏两侧，也覆盖竖屏上下露出的草地。
  for (let z = -22; z <= 43; z += 5.2) {
    for (let x = -25; x <= 44; x += 5.3) {
      if (x > -5 && x < BOARD_WIDTH + 5 && z > -7 && z < BOARD_HEIGHT + 10) continue;
      if (rng.next() < 0.22) continue;
      const height = 3.4 + rng.next() * 2.1;
      const texture = rng.next() < 0.38 ? pine : rng.next() < 0.22 ? birch : oak;
      plant(texture, x + rng.next() * 2, z + rng.next() * 1.5, height, height * (texture === pine ? 0.64 : 0.8));
    }
  }

  for (const [x, z] of [
    [-1.9, 3.5], [-1.8, 10.5], [-1.8, 17.8], [2.1, -1.6], [10, -1.5], [16, -1.6],
    [20.8, 7.2], [21.1, 13.5], [20.9, 18.9], [2.5, 21.3], [9, 21.4], [16.4, 21.5],
  ]) {
    const flower = flowers[rng.int(0, flowers.length - 1)];
    for (let i = 0; i < 5; i += 1) {
      plant(i < 3 ? flower : grass, x + (rng.next() - 0.5) * 1.5, z + (rng.next() - 0.5) * 0.7, 0.55 + rng.next() * 0.28);
    }
  }

  for (let i = 0; i < 90; i += 1) {
    const x = -18 + rng.next() * 55;
    const z = -18 + rng.next() * 57;
    if (x > -2.5 && x < BOARD_WIDTH + 2.5 && z > -3.5 && z < BOARD_HEIGHT + 3.5) continue;
    if (x > BOARD_WIDTH + 0.6 && x < BOARD_WIDTH + 6 && z > 0.4 && z < 6.6) continue;
    plant(i % 5 === 0 ? stone : i % 3 === 0 ? bush : grass, x, z, 0.5 + rng.next() * 0.55);
  }

  plant(log, -2, 13.4, 0.9, 1.7);
  plant(log, 14.8, -1.4, 0.65, 1.25);
  plant(signTexture(), -1.8, -1.3, 1.25, 1.1);
  plant(mushroom, 5.8, 21, 0.62);
  plant(mushroom, 19.9, 17.1, 0.55);
  for (const [x, z] of [[20.4, 2.2], [21, 5.4], [23.5, 5.6], [24.7, 1.8]]) {
    plant(reeds, x, z, 1.1, 0.9);
    plant(stone, x + 0.4, z + 0.2, 0.5);
  }

  const shadowMesh = createPatchMesh(shadowTexture(), shadows, true);
  shadowMesh.name = "scenery-shadows";
  group.add(shadowMesh);
  for (const [texture, patches] of batches) group.add(createPatchMesh(texture, patches));
  return group;
}
