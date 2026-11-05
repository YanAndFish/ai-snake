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

const SNAKE_OUTLINE: RGBA = [40, 82, 46, 255];
const SNAKE_GREEN: RGBA = [104, 190, 80, 255];
const SNAKE_GREEN_ALT: RGBA = [101, 186, 78, 255];
const SNAKE_LIGHT: RGBA = [150, 224, 114, 255];
const SNAKE_DARK: RGBA = [68, 142, 58, 255];
const SNAKE_DEEP: RGBA = [52, 112, 50, 255];
const EYE_WHITE: RGBA = [250, 252, 236, 255];
const EYE_SHADE: RGBA = [224, 232, 206, 255];
const EYE_PUPIL: RGBA = [30, 46, 34, 255];
const TONGUE: RGBA = [232, 84, 98, 255];
const TONGUE_DARK: RGBA = [190, 56, 76, 255];

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

const FIELD_A: RGBA = [114, 160, 88, 255];
const FIELD_B: RGBA = [108, 154, 82, 255];
const FIELD_EDGE_A: RGBA = [104, 148, 80, 255];
const FIELD_EDGE_B: RGBA = [99, 143, 75, 255];

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
  const buf = buffer(width * cell, height * cell);
  const rng = new Rng(0x9f1e1d);
  for (let tileY = 0; tileY < height; tileY += 1) {
    const band = Math.floor(tileY / 2) % 2 === 0;
    for (let tileX = 0; tileX < width; tileX += 1) {
      const base = band ? FIELD_A : FIELD_B;
      const edge = band ? FIELD_EDGE_A : FIELD_EDGE_B;
      const tint = jitter(base, 4, rng);
      for (let py = 0; py < cell; py += 1) {
        for (let px = 0; px < cell; px += 1) {
          let color = jitter(tint, 5, rng);
          if (px === 0 || py === 0) color = jitter(edge, 4, rng);
          else if (rng.next() < 0.028) color = shade(color, 0.955);
          else if (rng.next() < 0.022) color = shade(color, 1.04);
          if (rng.next() < 0.008) color = shade(color, 0.9);
          put(buf, tileX * cell + px, tileY * cell + py, color);
        }
      }
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

function drawCapsule(variant: number): PixelBuffer {
  const width = 32;
  const height = 18;
  const buf = buffer(width, height);
  const rng = new Rng(0x51a7e + variant * 977);
  const base = variant === 0 ? SNAKE_GREEN : SNAKE_GREEN_ALT;
  fillRounded(buf, 0, 0, width - 1, height - 1, 8, SNAKE_OUTLINE);
  for (let y = 1; y <= height - 2; y += 1) {
    for (let x = 1; x <= width - 2; x += 1) {
      if (!insideRounded(x, y, 1, 1, width - 2, height - 2, 7)) continue;
      let color = base;
      if (y <= 3) color = rng.next() < 0.8 ? SNAKE_LIGHT : base;
      else if (y >= height - 4) color = rng.next() < 0.8 ? SNAKE_DARK : shade(base, 0.92);
      else {
        const roll = rng.next();
        if (roll < 0.12) color = SNAKE_DARK;
        else if (roll < 0.22) color = SNAKE_LIGHT;
        else if (roll < 0.28) color = shade(base, 1.04);
      }
      put(buf, x, y, color);
    }
  }
  const shift = variant === 0 ? 0 : 1;
  const scales: Array<[number, number]> = [
    [8, 8 + shift],
    [14, 9 - shift],
    [20, 8 + shift],
    [25, 9 - shift],
  ];
  for (const [sx, sy] of scales) {
    put(buf, sx, sy, SNAKE_LIGHT);
    put(buf, sx + 1, sy, SNAKE_DARK);
  }
  put(buf, 5, 7, SNAKE_LIGHT);
  put(buf, 26, 10, SNAKE_DARK);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x > 2 && x < width - 3) continue;
      const color = get(buf, x, y);
      if (color[0] === SNAKE_OUTLINE[0] && color[1] === SNAKE_OUTLINE[1]) {
        put(buf, x, y, base);
      }
    }
  }
  return buf;
}

export function snakeBodyTexture(variant: number): THREE.CanvasTexture {
  return toTexture(drawCapsule(variant));
}

const HEAD_OUTER: Array<[number, number, number]> = [
  [3, 12, 19],
  [4, 11, 20],
  [5, 10, 21],
  [6, 9, 22],
  [7, 9, 22],
  [8, 8, 23],
  [9, 7, 24],
  [10, 6, 25],
  [11, 4, 27],
  [12, 3, 28],
  [13, 2, 29],
  [14, 2, 29],
  [15, 2, 29],
  [16, 2, 29],
  [17, 2, 29],
  [18, 2, 29],
  [19, 2, 29],
  [20, 2, 29],
  [21, 3, 28],
  [22, 4, 27],
  [23, 6, 25],
  [24, 8, 23],
  [25, 8, 23],
  [26, 8, 23],
  [27, 8, 23],
  [28, 8, 23],
  [29, 8, 23],
  [30, 9, 22],
];

const HEAD_INNER: Array<[number, number, number]> = [
  [4, 12, 19],
  [5, 11, 20],
  [6, 10, 21],
  [7, 10, 21],
  [8, 9, 22],
  [9, 8, 23],
  [10, 7, 24],
  [11, 5, 26],
  [12, 4, 27],
  [13, 3, 28],
  [14, 3, 28],
  [15, 3, 28],
  [16, 3, 28],
  [17, 3, 28],
  [18, 3, 28],
  [19, 3, 28],
  [20, 3, 28],
  [21, 4, 27],
  [22, 5, 26],
  [23, 7, 24],
  [24, 9, 22],
  [25, 9, 22],
  [26, 9, 22],
  [27, 9, 22],
  [28, 9, 22],
  [29, 9, 22],
  [30, 10, 21],
];

function drawHeadUp(): PixelBuffer {
  const buf = buffer(32, 32);
  for (const [y, x0, x1] of HEAD_OUTER) fillRect(buf, x0, y, x1, y, SNAKE_OUTLINE);
  for (const [y, x0, x1] of HEAD_INNER) fillRect(buf, x0, y, x1, y, SNAKE_GREEN);

  fillRect(buf, 12, 5, 19, 6, SNAKE_LIGHT);
  fillRect(buf, 8, 9, 9, 11, SNAKE_LIGHT);
  put(buf, 10, 8, SNAKE_LIGHT);
  put(buf, 6, 13, SNAKE_LIGHT);
  put(buf, 7, 12, SNAKE_LIGHT);

  fillRect(buf, 9, 28, 22, 30, SNAKE_DARK);
  fillRect(buf, 10, 30, 21, 30, SNAKE_DEEP);

  fillRounded(buf, 6, 11, 12, 17, 3, SNAKE_OUTLINE);
  fillRounded(buf, 19, 11, 25, 17, 3, SNAKE_OUTLINE);
  fillRounded(buf, 7, 12, 11, 16, 2, EYE_WHITE);
  fillRounded(buf, 20, 12, 24, 16, 2, EYE_WHITE);
  put(buf, 10, 15, EYE_SHADE);
  put(buf, 21, 15, EYE_SHADE);
  fillRect(buf, 9, 13, 10, 15, EYE_PUPIL);
  fillRect(buf, 21, 13, 22, 15, EYE_PUPIL);
  put(buf, 9, 13, EYE_WHITE);
  put(buf, 21, 13, EYE_WHITE);

  fillRect(buf, 3, 18, 5, 20, SNAKE_DARK);
  fillRect(buf, 26, 18, 28, 20, SNAKE_DARK);

  fillRect(buf, 10, 8, 21, 8, SNAKE_OUTLINE);
  fillRect(buf, 10, 9, 12, 9, SNAKE_OUTLINE);
  fillRect(buf, 19, 9, 21, 9, SNAKE_OUTLINE);
  put(buf, 13, 7, SNAKE_OUTLINE);
  put(buf, 18, 7, SNAKE_OUTLINE);

  fillRect(buf, 15, 3, 16, 9, TONGUE);
  fillRect(buf, 16, 3, 16, 9, TONGUE_DARK);
  put(buf, 13, 0, TONGUE);
  put(buf, 18, 0, TONGUE);
  put(buf, 13, 1, TONGUE);
  put(buf, 14, 1, TONGUE);
  put(buf, 17, 1, TONGUE_DARK);
  put(buf, 18, 1, TONGUE);
  put(buf, 14, 2, TONGUE);
  put(buf, 15, 2, TONGUE);
  put(buf, 16, 2, TONGUE_DARK);
  put(buf, 17, 2, TONGUE);
  put(buf, 15, 3, TONGUE);
  put(buf, 16, 3, TONGUE_DARK);

  return buf;
}

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
