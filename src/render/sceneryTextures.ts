import * as THREE from "three";
import { Rng } from "../engine/rng";

/** 创建最近邻采样的像素贴图，绘制坐标以像素为单位。 */
function paintTexture(
  width: number,
  height: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("无法绘制场景贴图，请检查浏览器的 Canvas 支持");
  ctx.imageSmoothingEnabled = false;
  paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 用整像素横线绘制椭圆，让边缘呈现清晰的像素台阶。 */
function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
): void {
  ctx.fillStyle = color;
  for (let row = Math.ceil(-ry); row <= ry; row += 1) {
    const half = Math.round(rx * Math.sqrt(1 - (row * row) / (ry * ry)));
    ctx.fillRect(Math.round(x) - half, Math.round(y) + row, half * 2 + 1, 1);
  }
}

/** 绘制有分层树冠、树皮和树根的阔叶树。 */
export function treeTexture(golden = false): THREE.CanvasTexture {
  return paintTexture(48, 64, (ctx) => {
    const rng = new Rng(0x7ee);
    ctx.fillStyle = "#503d2c";
    ctx.fillRect(21, 29, 8, 32);
    // 树根延伸到贴图底边，使可见轮廓与地面锚点重合。
    ctx.fillRect(17, 59, 17, 5);
    ctx.fillRect(16, 35, 8, 5);
    ctx.fillRect(27, 30, 8, 5);
    ctx.fillStyle = golden ? "#c8c4a0" : "#99704b";
    ctx.fillRect(23, 32, 4, 28);
    ctx.fillRect(20, 58, 3, 4);
    ctx.fillStyle = "#69513a";
    ctx.fillRect(23, 46, 3, 2);
    ctx.fillRect(25, 53, 3, 2);
    const dark = golden ? "#74632e" : "#294e3b";
    const mid = golden ? "#bda24d" : "#47794a";
    const light = golden ? "#d5c276" : "#75a75c";
    ellipse(ctx, 24, 32, 21, 14, dark);
    ellipse(ctx, 13, 23, 12, 13, dark);
    ellipse(ctx, 32, 21, 13, 14, dark);
    ellipse(ctx, 23, 14, 15, 13, dark);
    ellipse(ctx, 24, 30, 19, 12, mid);
    ellipse(ctx, 13, 22, 10, 11, mid);
    ellipse(ctx, 32, 20, 11, 12, mid);
    ellipse(ctx, 23, 13, 13, 11, mid);
    ellipse(ctx, 18, 10, 8, 6, light);
    ellipse(ctx, 9, 21, 5, 7, light);
    ellipse(ctx, 29, 22, 9, 6, light);
    ellipse(ctx, 18, 32, 7, 5, light);
    // 只在树冠已有的像素上加斑点，树冠外保持透明。
    const pixels = ctx.getImageData(0, 0, 48, 45).data;
    for (let i = 0; i < 170; i += 1) {
      const x = rng.int(3, 44);
      const y = rng.int(3, 41);
      if (pixels[(y * 48 + x) * 4 + 3] === 0) continue;
      ctx.fillStyle = rng.next() < 0.5 ? mid : light;
      ctx.fillRect(x, y, 2, 1);
    }
  });
}

/** 绘制轮廓修长、枝叶分层的松树。 */
export function pineTexture(): THREE.CanvasTexture {
  return paintTexture(40, 64, (ctx) => {
    ctx.fillStyle = "#594934";
    ctx.fillRect(17, 39, 6, 25);
    ctx.fillRect(15, 62, 10, 2);
    ctx.fillStyle = "#9a7f50";
    ctx.fillRect(18, 43, 2, 18);
    for (let tier = 0; tier < 3; tier += 1) {
      const top = 2 + tier * 12;
      const height = 22 + tier * 2;
      for (let row = 0; row < height; row += 1) {
        const half = Math.floor(row * (0.48 + tier * 0.08));
        ctx.fillStyle = row > height - 4 ? "#274c3d" : "#3a7051";
        ctx.fillRect(20 - half, top + row, half * 2 + 1, 1);
        if (row > 4 && row < height - 4) {
          ctx.fillStyle = row % 5 < 2 ? "#70a36a" : "#528c5b";
          ctx.fillRect(20 - half + 1, top + row, Math.max(1, half - 1), 1);
        }
      }
    }
  });
}

/** 绘制一簇高低不同的野花，颜色用于区分花丛。 */
export function wildflowerTexture(petals: string): THREE.CanvasTexture {
  return paintTexture(24, 24, (ctx) => {
    for (const [x, y] of [[5, 10], [11, 5], [18, 12], [14, 15]]) {
      ctx.fillStyle = "#3e713d";
      ctx.fillRect(x, y + 2, 1, 21 - y);
      ctx.fillStyle = "#91b76a";
      ctx.fillRect(x - 3, y + 7, 3, 2);
      ctx.fillRect(x + 1, y + 5, 3, 2);
      ctx.fillStyle = petals;
      ctx.fillRect(x - 3, y - 1, 7, 3);
      ctx.fillRect(x - 1, y - 3, 3, 7);
      ctx.fillStyle = "#f3d984";
      ctx.fillRect(x, y, 2, 2);
    }
  });
}

/** 绘制红色蘑菇和浅色菌柄。 */
export function mushroomTexture(): THREE.CanvasTexture {
  return paintTexture(24, 20, (ctx) => {
    ctx.fillStyle = "#a69c72";
    ctx.fillRect(7, 10, 4, 9);
    ctx.fillRect(17, 14, 3, 5);
    ctx.fillStyle = "#eadcb1";
    ctx.fillRect(7, 10, 2, 8);
    ctx.fillRect(17, 14, 2, 4);
    ellipse(ctx, 9, 9, 8, 6, "#813e36");
    ellipse(ctx, 9, 7, 7, 4, "#bd5c48");
    ellipse(ctx, 18, 13, 5, 4, "#a04c3e");
    ctx.fillStyle = "#f4dfb6";
    ctx.fillRect(5, 5, 3, 2);
    ctx.fillRect(11, 8, 3, 2);
    ctx.fillRect(17, 11, 2, 2);
  });
}

/** 绘制带年轮和苔藓的倒木。 */
export function logTexture(): THREE.CanvasTexture {
  return paintTexture(40, 24, (ctx) => {
    ctx.fillStyle = "#513e2e";
    ctx.fillRect(6, 6, 28, 16);
    ctx.fillStyle = "#89623e";
    ctx.fillRect(6, 7, 27, 10);
    ctx.fillStyle = "#b08a54";
    ctx.fillRect(9, 8, 22, 2);
    ctx.fillStyle = "#66472e";
    ctx.fillRect(12, 13, 15, 2);
    ellipse(ctx, 33, 14, 6, 8, "#513e2e");
    ellipse(ctx, 33, 14, 4, 6, "#c6a474");
    ellipse(ctx, 33, 14, 2, 3, "#926d47");
    ctx.fillStyle = "#78944e";
    ctx.fillRect(8, 5, 10, 3);
    ctx.fillRect(14, 4, 9, 3);
  });
}

/** 绘制池边的芦苇和香蒲。 */
export function reedsTexture(): THREE.CanvasTexture {
  return paintTexture(24, 32, (ctx) => {
    for (let i = 0; i < 5; i += 1) {
      const x = 4 + i * 4;
      const top = 6 + ((i * 7) % 12);
      ctx.fillStyle = i % 2 === 0 ? "#65814a" : "#9aaf65";
      ctx.fillRect(x, top, 1, 31 - top);
      ctx.fillRect(x - 2, 20 + i, 2, 7 - i);
      if (i % 2 === 0) {
        ctx.fillStyle = "#70513b";
        ctx.fillRect(x - 1, top - 4, 3, 7);
      }
    }
  });
}

/** 绘制带箭头的木路牌。 */
export function signTexture(): THREE.CanvasTexture {
  return paintTexture(28, 32, (ctx) => {
    ctx.fillStyle = "#654e34";
    ctx.fillRect(12, 11, 4, 20);
    ctx.fillRect(2, 3, 22, 12);
    ctx.fillStyle = "#c2a06a";
    ctx.fillRect(3, 4, 20, 9);
    ctx.fillRect(24, 6, 2, 6);
    ctx.fillStyle = "#70573a";
    ctx.fillRect(7, 7, 12, 2);
    ctx.fillRect(16, 5, 2, 6);
    ctx.fillRect(18, 6, 2, 4);
    ctx.fillStyle = "#e0c28a";
    ctx.fillRect(4, 4, 18, 1);
  });
}

/** 绘制不规则池岸、浅水、涟漪和睡莲，供地面贴片使用。 */
export function pondTexture(): THREE.CanvasTexture {
  return paintTexture(96, 80, (ctx) => {
    ellipse(ctx, 48, 41, 45, 34, "#536c44");
    ellipse(ctx, 34, 29, 29, 25, "#536c44");
    ellipse(ctx, 48, 40, 42, 31, "#b2ac76");
    ellipse(ctx, 34, 29, 26, 22, "#b2ac76");
    ellipse(ctx, 48, 38, 39, 28, "#689c92");
    ellipse(ctx, 34, 29, 23, 19, "#689c92");
    ellipse(ctx, 48, 35, 33, 23, "#477f80");
    ellipse(ctx, 49, 30, 26, 17, "#528e8b");
    const rng = new Rng(0x90ad);
    for (let i = 0; i < 28; i += 1) {
      const x = rng.int(22, 71);
      const y = rng.int(21, 48);
      ctx.fillStyle = i % 3 === 0 ? "#8fbdb0" : "#68a49a";
      ctx.fillRect(x, y, rng.int(2, 6), 1);
    }
    for (const [x, y] of [[29, 42], [68, 29], [60, 53]]) {
      ellipse(ctx, x, y, 6, 4, "#365f4a");
      ellipse(ctx, x, y - 1, 5, 3, "#8aaf63");
      ctx.fillStyle = "#477f80";
      ctx.fillRect(x, y, 6, 1);
    }
    ctx.fillStyle = "#f0d6ca";
    ctx.fillRect(67, 25, 3, 3);
    ctx.fillStyle = "#e4b67b";
    ctx.fillRect(68, 26, 1, 1);
  });
}

/** 在场地外围绘制弯曲土路，透明区域露出草地。 */
export function pathTexture(): THREE.CanvasTexture {
  return paintTexture(640, 640, (ctx) => {
    const rng = new Rng(0x9a7);
    // 每个世界单位对应八个像素，棋盘中心位于贴图中心。
    for (let step = 0; step < 640; step += 1) {
      const world = step / 8 - 30.5;
      const north = Math.round((-2.6 + Math.sin(world * 0.24) * 0.55 + 30.5) * 8);
      const west = Math.round((-3.1 + Math.sin(world * 0.28) * 0.65 + 30.5) * 8);
      ellipse(ctx, step, north, 6, 6, "#8c8d59");
      ellipse(ctx, step, north, 4, 4, "#b5a478");
      if (world > -2.5) {
        ellipse(ctx, west, step, 6, 6, "#8c8d59");
        ellipse(ctx, west, step, 4, 4, "#b5a478");
      }
      ctx.fillStyle = rng.next() < 0.5 ? "#c8b58b" : "#9b9064";
      ctx.fillRect(step, north + rng.int(-3, 3), 1, 1);
      if (world > -2.5) ctx.fillRect(west + rng.int(-3, 3), step, 1, 1);
    }
  });
}
