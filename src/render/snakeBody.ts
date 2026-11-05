import * as THREE from "three";

/** 每格的中心线采样数，用于连接身体拐角。 */
export const BODY_SAMPLES = 6;
/** 每一段由两个三角形连接左右边缘。 */
export const BODY_SIDES = 1;
/** 蛇身宽度的一半，以棋盘格为单位。 */
export const BODY_RADIUS = 0.4;
/** 平面贴图离地面的高度，用于分开蛇身和地面。 */
export const BODY_Y = 0.08;

/** 创建带像素轮廓、斑纹和腹边的平面蛇身贴图。 */
function bodyTexture(): THREE.CanvasTexture {
  const rows = [
    "OOOOOOOOOOOOOOOO",
    "LLLLLLLLLLLLLLLL",
    "GGGGGGGGGGGGGGGG",
    "GGGGGGGGGGGGGGGG",
    "GGGGPPPGGGGGGGGG",
    "GGGPPPPPGGGGGGGG",
    "GGGPPPPPGGGGGGGG",
    "GGGGPPPGGGGGGGGG",
    "GGGGGGGGGGGGGGGG",
    "GGGGGGGGGGGGGGGG",
    "MMMMMMMMMMMMMMMM",
    "SSSSSSSSSSSSSSSS",
    "YYYYYYYYYYYYYYYY",
    "YYBYYYBYYYBYYYBY",
    "YYYYYYYYYYYYYYYY",
    "OOOOOOOOOOOOOOOO",
  ];
  const palette: Record<string, string> = {
    O: "#183d23", L: "#a8e552", G: "#7ec843", P: "#367b2b",
    M: "#57a532", S: "#235b29", Y: "#d8db78", B: "#a0b456",
  };
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("无法创建蛇身贴图");
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      context.fillStyle = palette[rows[y][x]];
      context.fillRect(x, y, 1, 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 创建贴在棋盘平面上的像素蛇身；每帧只更新顶点和绘制范围。 */
export function createSnakeBody(maxCells: number): THREE.Mesh {
  const rings = (maxCells - 1) * BODY_SAMPLES + 1;
  const positions = new Float32Array(rings * 2 * 3);
  const uv = new Float32Array(rings * 2 * 2);
  const indices = new Uint16Array((rings - 1) * 6);
  for (let ring = 0; ring < rings; ring += 1) {
    uv.set([ring / BODY_SAMPLES, 0, ring / BODY_SAMPLES, 1], ring * 4);
    if (ring === rings - 1) continue;
    const a = ring * 2;
    indices.set([a, a + 2, a + 1, a + 2, a + 3, a + 1], ring * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    map: bodyTexture(),
    toneMapped: false,
    side: THREE.DoubleSide,
  }));
  // 顶点在世界坐标中更新，禁用依赖静态包围球的裁剪。
  mesh.frustumCulled = false;
  return mesh;
}

/** 创建沿蛇身延伸的柔边阴影，顶点在渲染时跟随身体更新。 */
export function createSnakeShadow(body: THREE.Mesh): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("无法创建蛇身阴影");
  const pixels = context.createImageData(1, 16);
  for (let y = 0; y < 16; y += 1) {
    const distance = Math.abs((y + 0.5) / 8 - 1);
    pixels.data[y * 4] = 24;
    pixels.data[y * 4 + 1] = 50;
    pixels.data[y * 4 + 2] = 30;
    pixels.data[y * 4 + 3] = Math.round(145 * (1 - distance * distance));
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  const shadow = new THREE.Mesh(body.geometry.clone(), new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  }));
  shadow.frustumCulled = false;
  return shadow;
}
