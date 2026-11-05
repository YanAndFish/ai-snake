import * as THREE from "three";
import { Rng } from "../engine/rng";

type RGB = [number, number, number];

function pixelTexture(
  size: number,
  colorAt: (x: number, y: number) => RGB,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = colorAt(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function dither(seed: number, a: RGB, b: RGB): THREE.CanvasTexture {
  const rng = new Rng(seed);
  return pixelTexture(16, () => rng.pick([a, b]));
}

export function grassTexture(seed: number): THREE.CanvasTexture {
  return dither(seed, [46, 72, 52], [37, 60, 44]);
}

export function wallTexture(): THREE.CanvasTexture {
  const rng = new Rng(0xbeef);
  return pixelTexture(16, (x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const base: RGB = edge ? [22, 26, 21] : [46, 50, 41];
    if (rng.next() < 0.12) return [34, 38, 31];
    return base;
  });
}

export function snakeTexture(): THREE.CanvasTexture {
  const rng = new Rng(0x5ca1e);
  return pixelTexture(16, () => {
    const scale = rng.next() < 0.5 ? [86, 140, 80] : [68, 116, 64];
    return scale as RGB;
  });
}

export function headTexture(): THREE.CanvasTexture {
  return dither(0x11ead, [118, 168, 102], [96, 142, 84]);
}

export function appleTexture(): THREE.CanvasTexture {
  const rng = new Rng(0xfeed);
  return pixelTexture(16, () => {
    const speckle = rng.next() < 0.18;
    return (speckle ? [178, 82, 64] : [158, 62, 52]) as RGB;
  });
}

export function leafTexture(): THREE.CanvasTexture {
  return dither(0x1eaf, [88, 124, 62], [70, 100, 50]);
}

export function stemTexture(): THREE.CanvasTexture {
  return dither(0x51e5, [120, 82, 40], [92, 62, 30]);
}
