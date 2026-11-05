import * as THREE from "three";
import { Rng } from "../engine/rng";
import type { Direction } from "../sim/types";

type RGBA = [number, number, number, number];

interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const CLEAR: RGBA = [0, 0, 0, 0];

const SNAKE_OUTLINE: RGBA = [24, 61, 35, 255];
const SNAKE_GREEN: RGBA = [126, 200, 67, 255];
const SNAKE_GREEN_ALT: RGBA = [87, 165, 50, 255];
const SNAKE_LIGHT: RGBA = [168, 229, 82, 255];
const SNAKE_HIGHLIGHT: RGBA = [208, 249, 123, 255];
const SNAKE_DARK: RGBA = [54, 123, 43, 255];
const SNAKE_DEEP: RGBA = [35, 91, 41, 255];
const SNAKE_BLOTCH: RGBA = [35, 91, 41, 255];
const SNAKE_BLOTCH_DARK: RGBA = [24, 61, 35, 255];
const SNAKE_BELLY: RGBA = [216, 219, 120, 255];
const SNAKE_BELLY_LIGHT: RGBA = [236, 237, 155, 255];
const SNAKE_BELLY_DARK: RGBA = [160, 180, 86, 255];
const EYE_WHITE: RGBA = [250, 252, 236, 255];
const EYE_SHADE: RGBA = [224, 232, 206, 255];
const EYE_PUPIL: RGBA = [26, 38, 28, 255];
const TONGUE: RGBA = [218, 70, 70, 255];
const TONGUE_DARK: RGBA = [164, 42, 52, 255];

const APPLE_OUTLINE: RGBA = [126, 40, 46, 255];
const APPLE_RED: RGBA = [226, 64, 64, 255];
const APPLE_LIGHT: RGBA = [250, 118, 96, 255];
const APPLE_SHINE: RGBA = [255, 196, 168, 255];
const APPLE_DARK: RGBA = [186, 48, 54, 255];
const STEM_BROWN: RGBA = [124, 80, 44, 255];
const STEM_DARK: RGBA = [92, 58, 34, 255];
const LEAF_OUTLINE: RGBA = [44, 96, 48, 255];
const LEAF_GREEN: RGBA = [92, 172, 72, 255];
const LEAF_LIGHT: RGBA = [134, 206, 96, 255];

const EARTH_BASE: RGBA = [130, 102, 66, 255];
const EARTH_LIGHT: RGBA = [154, 124, 84, 255];
const EARTH_DARK: RGBA = [102, 78, 50, 255];
const EARTH_DEEP: RGBA = [84, 62, 40, 255];
const BORDER_MOSS: RGBA = [100, 142, 74, 255];
const BORDER_MOSS_LIGHT: RGBA = [126, 166, 90, 255];
const BORDER_STONE: RGBA = [142, 138, 116, 255];
const BORDER_STONE_LIGHT: RGBA = [164, 158, 132, 255];

const FIELD_A: RGBA = [116, 162, 88, 255];
const FIELD_B: RGBA = [110, 156, 82, 255];
const FIELD_LIGHT: RGBA = [134, 180, 100, 255];
const FIELD_DARK: RGBA = [110, 156, 82, 255];

function buffer(width: number, height: number): PixelBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function put(buf: PixelBuffer, x: number, y: number, color: RGBA): void {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return;
  const i = (y * buf.width + x) * 4;
  buf.data[i] = color[0];
  buf.data[i + 1] = color[1];
  buf.data[i + 2] = color[2];
  buf.data[i + 3] = color[3];
}

function get(buf: PixelBuffer, x: number, y: number): RGBA {
  if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) return CLEAR;
  const i = (y * buf.width + x) * 4;
  return [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]];
}

function shade(color: RGBA, amount: number): RGBA {
  return [
    Math.max(0, Math.min(255, Math.round(color[0] * amount))),
    Math.max(0, Math.min(255, Math.round(color[1] * amount))),
    Math.max(0, Math.min(255, Math.round(color[2] * amount))),
    color[3],
  ];
}

function jitter(color: RGBA, amount: number, rng: Rng): RGBA {
  const delta = Math.round((rng.next() - 0.5) * amount);
  return [
    Math.max(0, Math.min(255, color[0] + delta)),
    Math.max(0, Math.min(255, color[1] + delta)),
    Math.max(0, Math.min(255, color[2] + delta)),
    color[3],
  ];
}

function insideRounded(
  x: number,
  y: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
): boolean {
  const px = x + 0.5;
  const py = y + 0.5;
  if (px < x0 || px > x1 + 1 || py < y0 || py > y1 + 1) return false;
  const nearLeft = px < x0 + radius;
  const nearRight = px > x1 + 1 - radius;
  const nearTop = py < y0 + radius;
  const nearBottom = py > y1 + 1 - radius;
  if (!nearLeft && !nearRight) return true;
  if (!nearTop && !nearBottom) return true;
  const cx = nearLeft ? x0 + radius : x1 + 1 - radius;
  const cy = nearTop ? y0 + radius : y1 + 1 - radius;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function fillRounded(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  color: RGBA,
): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (insideRounded(x, y, x0, y0, x1, y1, radius)) put(buf, x, y, color);
    }
  }
}

function fillRect(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: RGBA,
): void {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) put(buf, x, y, color);
  }
}

function fillEllipse(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: RGBA,
): void {
  const x0 = Math.floor(cx - rx);
  const x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry);
  const y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) put(buf, x, y, color);
    }
  }
}

function insideEllipse(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): boolean {
  const dx = (x + 0.5 - cx) / rx;
  const dy = (y + 0.5 - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function paintBlotch(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: RGBA,
): void {
  const x0 = Math.floor(cx - rx);
  const x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry);
  const y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const current = get(buf, x, y);
      if (current[3] === 0) continue;
      if (
        current[0] === SNAKE_OUTLINE[0] &&
        current[1] === SNAKE_OUTLINE[1] &&
        current[2] === SNAKE_OUTLINE[2]
      ) {
        continue;
      }
      put(buf, x, y, color);
    }
  }
}

function rotateBuffer(source: PixelBuffer, quarterTurns: number): PixelBuffer {
  let current = source;
  for (let turn = 0; turn < quarterTurns; turn += 1) {
    const size = current.width;
    const next = buffer(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const color = get(current, x, y);
        put(next, size - 1 - y, x, color);
      }
    }
    current = next;
  }
  return current;
}

function toTexture(buf: PixelBuffer): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = buf.width;
  canvas.height = buf.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("2d canvas unavailable");
  const image = ctx.createImageData(buf.width, buf.height);
  image.data.set(buf.data);
  ctx.putImageData(image, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  return tex;
}

export function boardTexture(width: number, height: number): THREE.CanvasTexture {
  const cell = 10;
  const w = width * cell;
  const h = height * cell;
  const buf = buffer(w, h);
  const rng = new Rng(0x9f1e1d);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let color = jitter(FIELD_A, 5, rng);
      const roll = rng.next();
      if (roll < 0.022) color = shade(color, 0.95);
      else if (roll < 0.042) color = shade(color, 1.025);
      if (rng.next() < 0.005) color = jitter(FIELD_LIGHT, 4, rng);
      if (rng.next() < 0.003) color = jitter(FIELD_DARK, 4, rng);
      put(buf, x, y, color);
    }
  }
  return toTexture(buf);
}

export function groundTexture(): THREE.CanvasTexture {
  const size = 16;
  const buf = buffer(size, size);
  const rng = new Rng(0x6304d);
  const palette: RGBA[] = [
    [94, 142, 74, 255],
    [101, 149, 80, 255],
    [87, 134, 70, 255],
    [108, 156, 85, 255],
  ];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const roll = rng.next();
      let color = palette[0];
      if (roll < 0.26) color = palette[1];
      else if (roll < 0.42) color = palette[2];
      else if (roll < 0.5) color = palette[3];
      if (rng.next() < 0.07) color = shade(color, 0.9);
      if (rng.next() < 0.035) color = shade(color, 1.06);
      if (rng.next() < 0.012) color = [124, 168, 96, 255];
      put(buf, x, y, color);
    }
  }
  const tex = toTexture(buf);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(120, 120);
  return tex;
}

export function borderTexture(): THREE.CanvasTexture {
  const width = 32;
  const height = 16;
  const buf = buffer(width, height);
  const rng = new Rng(0xb0d3e);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let color = EARTH_BASE;
      if (y % 6 === 0) color = EARTH_DARK;
      else if (y % 6 === 2) color = EARTH_LIGHT;
      else if (y % 6 === 5) color = EARTH_DEEP;
      const roll = rng.next();
      if (roll < 0.16) color = shade(color, rng.next() < 0.5 ? 0.92 : 1.06);
      const mossy = y < 5 ? rng.next() < 0.5 : rng.next() < 0.14;
      if (mossy) color = rng.next() < 0.35 ? BORDER_MOSS_LIGHT : BORDER_MOSS;
      if (rng.next() < 0.05) color = rng.next() < 0.5 ? BORDER_STONE : BORDER_STONE_LIGHT;
      put(buf, x, y, color);
    }
  }
  for (let i = 0; i < 12; i += 1) {
    const x = rng.int(1, width - 3);
    const y = rng.int(2, height - 3);
    put(buf, x, y, BORDER_STONE_LIGHT);
    put(buf, x + 1, y, BORDER_STONE);
    put(buf, x, y + 1, BORDER_STONE);
  }
  const tex = toTexture(buf);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 1);
  return tex;
}

export function soilTexture(): THREE.CanvasTexture {
  const size = 16;
  const buf = buffer(size, size);
  const rng = new Rng(0x5011);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let color = EARTH_DEEP;
      if (y % 5 === 0) color = EARTH_DARK;
      else if (y % 5 === 2) color = shade(EARTH_BASE, 0.9);
      const roll = rng.next();
      if (roll < 0.14) color = shade(color, 0.9);
      else if (roll < 0.2) color = EARTH_BASE;
      if (rng.next() < 0.06) color = BORDER_STONE;
      if (rng.next() < 0.035) color = BORDER_MOSS;
      put(buf, x, y, color);
    }
  }
  const tex = toTexture(buf);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 1);
  return tex;
}

export type SnakeBodyAxis = "horizontal" | "vertical";

function bodyColor(u: number, v: number, variant: number, uLen: number): RGBA {
  let color: RGBA;
  if (v === 0) color = SNAKE_DARK;
  else if (v <= 2) color = SNAKE_LIGHT;
  else if (v <= 9) color = SNAKE_GREEN;
  else if (v <= 12) color = SNAKE_GREEN_ALT;
  else if (v <= 14) color = SNAKE_DARK;
  else if (v === 15) color = SNAKE_DEEP;
  else color = SNAKE_BELLY;

  const c = variant === 0 ? uLen * 0.82 : uLen * 0.18;
  const du = (u - c) / (uLen * 0.34);
  const dv = (v - 6) / 2.8;
  if (v >= 3 && v <= 9 && du * du + dv * dv <= 1) color = SNAKE_BLOTCH;

  if (v >= 16 && u % 8 === 0) color = SNAKE_BELLY_DARK;
  return color;
}

function drawBody(variant: number, axis: SnakeBodyAxis): PixelBuffer {
  const horizontal = axis === "horizontal";
  const width = horizontal ? 25 : 18;
  const height = horizontal ? 18 : 20;
  const buf = buffer(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = horizontal ? x : y;
      const v = horizontal ? y : x;
      put(buf, x, y, bodyColor(u, v, variant, horizontal ? width : height));
    }
  }
  return buf;
}

export function snakeBodyTexture(
  variant: 0 | 1 = 0,
  axis: SnakeBodyAxis = "horizontal",
): THREE.CanvasTexture {
  return toTexture(drawBody(variant, axis));
}

export function bodyJointTexture(): THREE.CanvasTexture {
  const size = 32;
  const buf = buffer(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - 16) / 15;
      const dy = (y + 0.5 - 16) / 15;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const light = (x / 31) * 0.45 + (y / 31) * 0.55;
      let color: RGBA;
      if (light < 0.2) color = SNAKE_LIGHT;
      else if (light < 0.45) color = SNAKE_GREEN;
      else if (light < 0.7) color = SNAKE_GREEN_ALT;
      else if (light < 0.88) color = SNAKE_DARK;
      else color = SNAKE_DEEP;
      const radius = Math.sqrt(d2);
      if (radius > 0.82 && (dx > 0.05 || dy > 0.05)) color = SNAKE_BELLY;
      const fade = Math.max(0, Math.min(1, (1 - radius) * 3.2));
      put(buf, x, y, [color[0], color[1], color[2], Math.round(255 * fade)]);
    }
  }
  return toTexture(buf);
}

/** 绘制朝上的俯视像素蛇头，后颈收窄以衔接蛇身。 */
function drawHeadUp(): PixelBuffer {
  const buf = buffer(20, 20);
  const outline: Array<[number, number, number]> = [
    [3, 7, 12], [4, 5, 14], [5, 3, 16], [6, 2, 17],
    [7, 1, 18], [8, 1, 18], [9, 1, 18], [10, 2, 17],
    [11, 2, 17], [12, 3, 16], [13, 3, 16], [14, 4, 15],
    [15, 4, 15], [16, 4, 15], [17, 4, 15], [18, 4, 15], [19, 4, 15],
  ];
  for (const [y, left, right] of outline) {
    fillRect(buf, left, y, right, y, SNAKE_OUTLINE);
    for (let x = left + 1; x < right; x += 1) {
      let color = SNAKE_GREEN;
      if (x === right - 1) color = SNAKE_LIGHT;
      else if (x <= left + 2 && y >= 10) color = SNAKE_BELLY;
      else if (x === left + 3 && y >= 10) color = SNAKE_DEEP;
      else if (x === left + 4 && y >= 10) color = SNAKE_GREEN_ALT;
      put(buf, x, y, color);
    }
  }
  // 两只眼睛靠近前端，朝向由整张像素贴图旋转得到。
  fillRect(buf, 3, 5, 7, 10, SNAKE_OUTLINE);
  fillRect(buf, 4, 6, 6, 9, EYE_WHITE);
  fillRect(buf, 5, 6, 6, 8, EYE_PUPIL);
  put(buf, 6, 6, EYE_WHITE);
  fillRect(buf, 12, 5, 16, 10, SNAKE_OUTLINE);
  fillRect(buf, 13, 6, 15, 9, EYE_WHITE);
  fillRect(buf, 13, 6, 14, 8, EYE_PUPIL);
  put(buf, 14, 6, EYE_WHITE);
  put(buf, 7, 4, SNAKE_DARK);
  put(buf, 12, 4, SNAKE_DARK);
  fillRect(buf, 8, 12, 10, 14, SNAKE_DARK);
  put(buf, 11, 13, SNAKE_DARK);
  fillRect(buf, 9, 1, 10, 3, TONGUE);
  put(buf, 8, 0, TONGUE);
  put(buf, 11, 0, TONGUE);
  return buf;
}

export function tailTexture(): THREE.CanvasTexture {
  const buf = buffer(16, 16);
  fillEllipse(buf, 7.5, 7.5, 6.5, 6.5, SNAKE_OUTLINE);
  fillEllipse(buf, 7.5, 7.5, 5.5, 5.5, SNAKE_GREEN);
  fillEllipse(buf, 6, 5, 2.4, 1.6, SNAKE_BLOTCH);
  fillRect(buf, 5, 2, 8, 2, SNAKE_HIGHLIGHT);
  put(buf, 9, 3, SNAKE_HIGHLIGHT);
  for (let y = 8; y <= 12; y += 1) {
    for (let x = 3; x <= 12; x += 1) {
      const dx = (x + 0.5 - 7.5) / 5.5;
      const dy = (y + 0.5 - 7.5) / 5.5;
      if (dx * dx + dy * dy > 1) continue;
      put(buf, x, y, x % 4 === 0 ? SNAKE_BELLY_DARK : SNAKE_BELLY);
    }
  }
  return toTexture(buf);
}

/** 返回指定方向的俯视蛇头贴图，轮廓和配色与蛇身一致。 */
export function headTexture(direction: Direction): THREE.CanvasTexture {
  const canonical = drawHeadUp();
  let turns = 0;
  if (direction === "right") turns = 1;
  else if (direction === "down") turns = 2;
  else if (direction === "left") turns = 3;
  return toTexture(rotateBuffer(canonical, turns));
}

export function appleTexture(): THREE.CanvasTexture {
  const buf = buffer(24, 24);
  fillEllipse(buf, 16, 5.4, 4.4, 2.5, LEAF_OUTLINE);
  fillEllipse(buf, 15.7, 5.2, 3.5, 1.7, LEAF_GREEN);
  put(buf, 15, 4, LEAF_LIGHT);
  put(buf, 16, 4, LEAF_LIGHT);

  fillRect(buf, 11, 2, 12, 7, STEM_BROWN);
  fillRect(buf, 11, 2, 11, 6, STEM_DARK);

  fillEllipse(buf, 11.5, 14.4, 9.6, 8.4, APPLE_OUTLINE);
  fillEllipse(buf, 11.5, 14.1, 8.5, 7.3, APPLE_RED);
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 24; x += 1) {
      if (!insideEllipse(x, y, 11.5, 14.1, 8.5, 7.3)) continue;
      if (y >= 18) put(buf, x, y, shade(APPLE_RED, 0.84));
      else if (x >= 18) put(buf, x, y, shade(APPLE_RED, 0.93));
    }
  }
  fillEllipse(buf, 8.4, 10.3, 2.6, 1.6, APPLE_LIGHT);
  put(buf, 7, 10, APPLE_SHINE);
  put(buf, 8, 9, APPLE_SHINE);
  put(buf, 17, 15, shade(APPLE_RED, 0.9));
  return toTexture(buf);
}

export function particleTexture(): THREE.CanvasTexture {
  const buf = buffer(16, 16);
  const red: RGBA = [238, 92, 78, 255];
  const orange: RGBA = [255, 172, 88, 255];
  const cream: RGBA = [255, 236, 186, 255];
  fillEllipse(buf, 7.5, 7.5, 2.6, 2.6, red);
  fillRect(buf, 7, 2, 8, 3, orange);
  fillRect(buf, 7, 12, 8, 13, orange);
  fillRect(buf, 2, 7, 3, 8, orange);
  fillRect(buf, 12, 7, 13, 8, orange);
  put(buf, 7, 4, red);
  put(buf, 8, 4, red);
  put(buf, 7, 11, red);
  put(buf, 8, 11, red);
  put(buf, 4, 7, red);
  put(buf, 4, 8, red);
  put(buf, 11, 7, red);
  put(buf, 11, 8, red);
  fillRect(buf, 7, 7, 8, 8, cream);
  return toTexture(buf);
}

export function grassTuftTexture(): THREE.CanvasTexture {
  const buf = buffer(16, 16);
  const dark: RGBA = [58, 118, 52, 255];
  const mid: RGBA = [94, 168, 70, 255];
  const light: RGBA = [130, 202, 92, 255];
  fillRect(buf, 4, 12, 12, 14, dark);
  fillRect(buf, 5, 8, 5, 11, mid);
  fillRect(buf, 6, 6, 6, 11, light);
  fillRect(buf, 7, 4, 7, 12, mid);
  fillRect(buf, 8, 5, 8, 12, light);
  fillRect(buf, 9, 9, 9, 12, mid);
  fillRect(buf, 10, 7, 10, 12, light);
  fillRect(buf, 11, 10, 11, 12, mid);
  put(buf, 7, 3, light);
  put(buf, 10, 6, light);
  put(buf, 6, 5, light);
  return toTexture(buf);
}

export function daisyTexture(): THREE.CanvasTexture {
  const buf = buffer(16, 16);
  const stem: RGBA = [74, 138, 60, 255];
  const leaf: RGBA = [104, 180, 78, 255];
  const petal: RGBA = [252, 248, 224, 255];
  const petalShade: RGBA = [226, 226, 196, 255];
  const center: RGBA = [250, 196, 72, 255];
  fillRect(buf, 7, 7, 8, 14, stem);
  fillEllipse(buf, 5, 11, 1.7, 0.9, leaf);
  fillEllipse(buf, 10, 12, 1.6, 0.8, leaf);
  fillEllipse(buf, 7.5, 5, 1.2, 2.2, petal);
  fillEllipse(buf, 7.5, 5, 2.2, 1.2, petal);
  put(buf, 4, 3, petalShade);
  put(buf, 11, 3, petal);
  put(buf, 4, 7, petal);
  put(buf, 11, 7, petalShade);
  put(buf, 5, 4, petal);
  put(buf, 10, 6, petal);
  fillEllipse(buf, 7.5, 5, 1.1, 1.1, center);
  return toTexture(buf);
}

export function bushTexture(): THREE.CanvasTexture {
  const buf = buffer(16, 16);
  const rng = new Rng(0xb05b);
  const outline: RGBA = [48, 102, 48, 255];
  const green: RGBA = [86, 156, 68, 255];
  const light: RGBA = [122, 194, 88, 255];
  const dark: RGBA = [66, 128, 58, 255];
  fillRounded(buf, 1, 6, 14, 14, 5, outline);
  fillRounded(buf, 2, 7, 13, 13, 4, green);
  for (let y = 8; y <= 12; y += 1) {
    for (let x = 3; x <= 12; x += 1) {
      const roll = rng.next();
      if (roll < 0.16) put(buf, x, y, light);
      else if (roll < 0.3) put(buf, x, y, dark);
    }
  }
  fillRect(buf, 1, 13, 14, 14, outline);
  return toTexture(buf);
}

export function stoneTexture(): THREE.CanvasTexture {
  const buf = buffer(16, 16);
  const rng = new Rng(0x570e);
  const stone: RGBA = [140, 138, 118, 255];
  const light: RGBA = [166, 160, 136, 255];
  const dark: RGBA = [108, 106, 92, 255];
  const moss: RGBA = [104, 146, 78, 255];
  fillRounded(buf, 1, 6, 14, 14, 5, dark);
  fillRounded(buf, 2, 7, 13, 13, 4, stone);
  for (let y = 7; y <= 13; y += 1) {
    for (let x = 2; x <= 13; x += 1) {
      const roll = rng.next();
      if (roll < 0.18) put(buf, x, y, light);
      else if (roll < 0.32) put(buf, x, y, dark);
    }
  }
  fillRect(buf, 5, 6, 8, 6, moss);
  put(buf, 9, 7, moss);
  fillRect(buf, 2, 13, 13, 14, dark);
  return toTexture(buf);
}

export function shadowTexture(): THREE.CanvasTexture {
  const width = 32;
  const height = 20;
  const buf = buffer(width, height);
  const color: RGBA = [24, 50, 30, 255];
  const radiusX = 11.5;
  const radiusY = 6.5;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x + 0.5 - width / 2) / radiusX;
      const dy = (y + 0.5 - height / 2) / radiusY;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const falloff = (1 - d2) * (1 - Math.sqrt(d2) * 0.3);
      const alpha = Math.round(178 * falloff);
      if (alpha <= 0) continue;
      put(buf, x, y, [color[0], color[1], color[2], alpha]);
    }
  }
  return toTexture(buf);
}

export function groundShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const buf = buffer(size, size);
  const color: RGBA = [22, 46, 30, 255];
  const half = 60;
  const radius = 20;
  const feather = 9;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5 - size / 2;
      const py = y + 0.5 - size / 2;
      const qx = Math.abs(px) - (half - radius);
      const qy = Math.abs(py) - (half - radius);
      const outsideX = Math.max(qx, 0);
      const outsideY = Math.max(qy, 0);
      const outside = Math.sqrt(outsideX * outsideX + outsideY * outsideY);
      const inside = Math.min(Math.max(qx, qy), 0);
      const distance = outside + inside - radius;
      if (distance >= 0) continue;
      const alpha = Math.round(165 * Math.min(1, -distance / feather));
      if (alpha <= 0) continue;
      put(buf, x, y, [color[0], color[1], color[2], alpha]);
    }
  }
  return toTexture(buf);
}
