/**
 * Native-resolution procedural pixel-art textures for a 2.5D Snake game.
 * Nothing is loaded from /public: RGBA8 -> ImageData -> CanvasTexture.
 * Pixel art is an editable, hand-authored palette + one-character-per-pixel map.
 * Asset sizes: head 32x32, body 32x18 (2 variants), apple 24x24.
 * Head always points NORTH in the source map. Direction is rotated at runtime.
 */
import * as THREE from 'three';
import type { Direction } from "../sim/types";

export class PixelBuffer {
  readonly data: Uint8ClampedArray;

  constructor(public readonly width: number, public readonly height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  set(x: number, y: number, rgba: readonly [number, number, number, number]): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = rgba[0];
    this.data[i + 1] = rgba[1];
    this.data[i + 2] = rgba[2];
    this.data[i + 3] = rgba[3];
  }
}

const COLORS = {
  ' ': '#00000000', // transparent, including transparent outer margin
  "O": "#183D23",
  "D": "#235B29",
  "S": "#367B2B",
  "M": "#57A532",
  "G": "#7EC843",
  "L": "#A8E552",
  "H": "#D0F97B",
  "W": "#F5FFC1",
  "P": "#397C2E",
  "p": "#4A9030",
  "o": "#62733C",
  "B": "#A0B456",
  "Y": "#D8DB78",
  "y": "#ECED9B",
  "K": "#14271F",
  "E": "#241E20",
  "I": "#5E7F2A",
  "F": "#FFFFFF",
  "N": "#285B21",
  "A": "#E94C51",
  "a": "#A8333F",
  "C": "#FC7370",
  "c": "#FFB3A6",
  "T": "#5F432A",
  "V": "#56B75F",
} as const;

type PixelKey = keyof typeof COLORS;
const PALETTE = Object.fromEntries(
  Object.entries(COLORS).map(([key, hex]) => [
    key,
    [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
      hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255,
    ] as const,
  ]),
) as Record<PixelKey, readonly [number, number, number, number]>;

// HEAD, 32 x 32 px. Leading/trailing spaces are transparent pixels.
const HEAD_ROWS = [
  "                                ",
  "                                ",
  "            OOOOOOOO            ",
  "         OOODDDDDDDDDOOO        ",
  "        OODSSSSSSSSSSDDOO       ",
  "      OOODMGGppppLLLLGSDDOO     ",
  "     OODSMGHLLHHHHLLLLGSSDOO    ",
  "     ODSSMSSHHLLLLHHLLSLMSDO    ",
  "    ODDSMPSLLLLLLLLLLLSLGSDDO   ",
  "    ODSMPSSLLNNLLLNNLLLSLMSDO   ",
  "   ODDSPPSLLLLLLLLLLLLLSLGSDO   ",
  "   ODSMKKKKKLLLLLLLLLLKKKKMSDO  ",
  "  ODDSMKIIIIKSLLLLLSSKKIKKKSDO  ",
  "  ODSMKIFFEEIKSSSSSSKIFFEIKSSO  ",
  "  ODSMKIFFEEIIGGGGGKKIFFEEKKSO  ",
  "  ODSKKEEEEEEIKGGGGKIEEEEEIKSO  ",
  "  ODSKIEEEEEEIKGGGKKIEEEEEIKSDO ",
  "  ODSKIIEEEWEIKGGGKIIEEEEWIKSDO ",
  "  ODSKKIEEEEEKGGGGGKIIEEEEIKSDO ",
  "   OSSKKIIEIIKpGGGPKKIIEIIKSSDO ",
  "   OoSMKKKKIKppGGGPPPKKKIHSSoO  ",
  "   OoYHMMMMKpppGGPPPPPKMHSSYoO  ",
  "    DoYHHHHMMMMMMMGPMMMHSSyYoO  ",
  "    OoYBySSMMMMMMMMMSSSSYyyYo   ",
  "     ooYByySSSSSSSSSSSByyyYoO   ",
  "     OoYBByyyyByyyyyyyBBByoO    ",
  "      OoYYByyyBByyyyyyBBYooO    ",
  "       OooYyyyBByyyyyyBoooO     ",
  "        OOooYYYBBYYYooooO       ",
  "          OOooooooooooOO        ",
  "            OOOOOOOOO           ",
  "                                ",
] as const;

// BODY A, 32 x 18 px. Leading/trailing spaces are transparent pixels.
const BODY_A_ROWS = [
  "      OOOOOOOOOOOOOOOOOOOO      ",
  "     OSSSSSSSSSSSSSSSSSSSDOO    ",
  "   OOSMGLLLLLLLLLLLLLLLLLSSOOO  ",
  "  OOSMGGLLHHWHLLppppLLLHLLSSSOO ",
  " OOSSGGLPLLLLLLppppppLLLHHLGSSO ",
  " OSSMGPPPPPLLLLpppppppLLLLGGMSOO",
  "ODSMGGPPPPPLLLpppppppLLLLLPGGMSO",
  "ODSMGGPPPPPPLLLppppppLLPPPPGGMSO",
  "OSSMMGPPPPPGGGGGpGGGGGGPPPPPMMSO",
  "OSSSMGGGGPGGpppGGGGGGGPPPPPGMMSO",
  "OooSSMMGGGGGpppGGGGGGGPPPPMMMSoO",
  "OoYoSSSMMGGGppppGGGGGGGGMMMSSYoO",
  "OooYYSSSMMMMMMMMMMMMMMMMMMSSYooO",
  " OoYYyyYSSSSSSSSSSSSSSSSYYYyYoO ",
  "  OoYYYyByyyyyyByyyyyyByyyYooO  ",
  "   OOoYYyByyyyyyByyyyyyByYooO   ",
  "     OOoYBYYYYYYBYYYYYoBoOO     ",
  "       OOOOOOOOOOOOOOOOOO       ",
] as const;

// BODY B, 32 x 18 px. Leading/trailing spaces are transparent pixels.
const BODY_B_ROWS = [
  "      OOOOOOOOOOOOOOOOOOOO      ",
  "     OSSSSSSSSSSSSSSSSSSSDOO    ",
  "   OOSMGLLLLLLLLLLLLLLLLLSSOOO  ",
  "  OOSMGHWHHppLLLLLLLLLLLLLSSSOO ",
  " OOSSGHLppppppLLLLLLPPPPLLLGSSO ",
  " OSSMGGLLppppppLLLPPPPPPHLGGMSOO",
  "ODSMGGLLLpppppLLLLLPPPPPPHHGGMSO",
  "ODSMGGGGLppppLLLLLLLPPPPPGGGGMSO",
  "OSSMMPPPPLGGGGGGGGpGGGGPGGGGMMSO",
  "OSSSMPPPPPGGGGGGppppGGGGGGGGMMSO",
  "OooSSPPPPPPGGGGGppppppGGGGMMMSoO",
  "OoYoSSSMPGGGGGGGppppGGGGMMMSSYoO",
  "OooYYSSSMMMMMMMMMMMMMMMMMMSSYooO",
  " OoYYyyYSSSSSSSSSSSSSSSSYYYyYoO ",
  "  OoYYYyByyyyyyByyyyyyByyyYooO  ",
  "   OOoYYyByyyyyyByyyyyyByYooO   ",
  "     OOoYBYYYYYYBYYYYYoBoOO     ",
  "       OOOOOOOOOOOOOOOOOO       ",
] as const;

// APPLE, 24 x 24 px. Leading/trailing spaces are transparent pixels.
const APPLE_ROWS = [
  "                        ",
  "            TT          ",
  "           TTT VVVVV    ",
  "           TTTVVLLV     ",
  "         O TTVLLVVV     ",
  "       OaOOTTVVVVOOO    ",
  "    OOOCaaaTTVVVAaaaO   ",
  "    OaCCCAaaaTACAAAAO   ",
  "   OaacccCCAACCCCCCAaO  ",
  "   OaccccCCCCCCCCCCAaOO ",
  "  OaACcCCCCCCCCCCCCAAaO ",
  "  OaACcCCCCCCCCCCCCAAaO ",
  "  OaACCCCCCCCCCCCCCAAaO ",
  "  OaACCCCCCCCCCCCCAAAaO ",
  "  OaAACCCCCCCCCCCCAAaaO ",
  "  OaaAACCCCCCCCCCAAAaaO ",
  "   OaAACCCCCCCCCCAAAaO  ",
  "   OaaAACCCCCCCAAAAAOO  ",
  "    OaAAAAAAACAAAAAaO   ",
  "    OaaaAAAAAAAAAAaOO   ",
  "     OOaaaAaaaaaAOOO    ",
  "       OOaOOOOOaOO      ",
  "         O     O        ",
  "                        ",
] as const;

/** Decode palette pixels into a raw RGBA8 buffer; no intermediary Image element. */
function fromRows(rows: readonly string[]): PixelBuffer {
  const width = rows[0]?.length ?? 0;
  const buffer = new PixelBuffer(width, rows.length);
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    if (row.length !== width) throw new Error(`Invalid texture row ${y}`);
    for (let x = 0; x < width; x++) {
      const rgba = PALETTE[row[x] as PixelKey];
      if (!rgba) throw new Error(`Unknown palette key: ${row[x]}`);
      buffer.set(x, y, rgba);
    }
  }
  return buffer;
}

/** Clockwise quarter-turns in image coordinates (positive y points downward). */
function rotate90(source: PixelBuffer): PixelBuffer {
  const rotated = new PixelBuffer(source.height, source.width);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const i = (y * source.width + x) * 4;
      rotated.set(source.height - y - 1, x, [
        source.data[i]!,
        source.data[i + 1]!,
        source.data[i + 2]!,
        source.data[i + 3]!,
      ]);
    }
  }
  return rotated;
}

/** Same CanvasTexture pipeline as your existing renderer. Browser runtime only. */
export function toTexture(pixels: PixelBuffer): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('2D Canvas context is unavailable');
  const image = ctx.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export type SnakeBodyAxis = 'horizontal' | 'vertical';

/** 32x32. Defaults to upward facing; other directions are 90-degree rotations. */
export function headTexture(direction: Direction = "up"): THREE.CanvasTexture {
  const turns: Record<Direction, number> = { up: 0, right: 1, down: 2, left: 3 };
  let pixels = fromRows(HEAD_ROWS);
  for (let i = 0; i < turns[direction]; i++) pixels = rotate90(pixels);
  return toTexture(pixels);
}

function stripBodyEnds(pixels: PixelBuffer): void {
  const { width, height, data } = pixels;
  for (let y = 0; y < height; y += 1) {
    let left = 0;
    while (left < width && data[(y * width + left) * 4 + 3] === 0) left += 1;
    let right = width - 1;
    while (right >= 0 && data[(y * width + right) * 4 + 3] === 0) right -= 1;
    if (left > right) continue;
    const leftInside = Math.min(right, left + 4);
    const rightInside = Math.max(left, right - 4);
    const li = (y * width + leftInside) * 4;
    const ri = (y * width + rightInside) * 4;
    const lc: readonly [number, number, number, number] = [
      data[li]!,
      data[li + 1]!,
      data[li + 2]!,
      data[li + 3]!,
    ];
    const rc: readonly [number, number, number, number] = [
      data[ri]!,
      data[ri + 1]!,
      data[ri + 2]!,
      data[ri + 3]!,
    ];
    for (let x = left; x <= Math.min(left + 2, right); x += 1) {
      const i = (y * width + x) * 4;
      if (data[i] === PALETTE.O[0] && data[i + 1] === PALETTE.O[1] && data[i + 2] === PALETTE.O[2]) {
        pixels.set(x, y, lc);
      }
    }
    for (let x = Math.max(right - 2, left); x <= right; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i] === PALETTE.O[0] && data[i + 1] === PALETTE.O[1] && data[i + 2] === PALETTE.O[2]) {
        pixels.set(x, y, rc);
      }
    }
  }
}

/** 32x18 horizontally, or 18x32 vertically. Supports two art variants. */
export function snakeBodyTexture(
  variant: 0 | 1 = 0,
  axis: SnakeBodyAxis = 'horizontal',
): THREE.CanvasTexture {
  let pixels = fromRows(variant === 0 ? BODY_A_ROWS : BODY_B_ROWS);
  stripBodyEnds(pixels);
  if (axis === 'vertical') pixels = rotate90(pixels);
  return toTexture(pixels);
}

/** 24x24, kept for compatibility with the existing apple texture. */
export function appleTexture(): THREE.CanvasTexture {
  return toTexture(fromRows(APPLE_ROWS));
}

/** Create all directional assets once during scene setup; dispose on teardown. */
export function createSnakeTextureSet() {
  return {
    heads: {
      up: headTexture('up'),
      right: headTexture('right'),
      down: headTexture('down'),
      left: headTexture('left'),
    },
    bodies: {
      horizontal: [snakeBodyTexture(0), snakeBodyTexture(1)] as const,
      vertical: [snakeBodyTexture(0, 'vertical'), snakeBodyTexture(1, 'vertical')] as const,
    },
    apple: appleTexture(),
  };
}
