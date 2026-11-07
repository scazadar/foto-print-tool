// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/**
 * Colour corrections on RGBA pixel buffers. Pure JavaScript so that the
 * browser preview and the server render produce identical results (CSS
 * canvas filters are not available in every browser).
 */

import type { Adjustments } from './edit.js';

export function isNeutral(a: Adjustments): boolean {
  return (
    a.brightness === 0 &&
    a.contrast === 0 &&
    a.saturation === 0 &&
    a.temperature === 0 &&
    a.sharpness === 0 &&
    a.filter === 'none' &&
    !a.levels
  );
}

/** Per-channel lookup tables for levels, brightness, contrast and temperature. */
export function buildLuts(a: Adjustments): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] {
  const luts: [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] = [
    new Uint8ClampedArray(256),
    new Uint8ClampedArray(256),
    new Uint8ClampedArray(256),
  ];
  const b = a.brightness / 100; // -1 … 1
  const c = a.contrast / 100;
  // contrast factor: 0 → 1, 100 → ~3, -100 → 0.25
  const cf = c >= 0 ? 1 + c * 2 : 1 + c * 0.75;
  const t = a.temperature / 100;
  const tShift = [t * 30, t * 6, -t * 30];
  for (let ch = 0; ch < 3; ch++) {
    const lo = a.levels ? a.levels.lo[ch] : 0;
    const hi = a.levels ? a.levels.hi[ch] : 255;
    const range = Math.max(1, hi - lo);
    for (let v = 0; v < 256; v++) {
      let x = ((v - lo) / range) * 255; // levels
      x = Math.min(255, Math.max(0, x)) / 255;
      // brightness as gamma-like lift that keeps black and white anchored
      if (b !== 0) x = b > 0 ? 1 - Math.pow(1 - x, 1 + b * 1.5) : Math.pow(x, 1 - b * 1.5);
      x = (x - 0.5) * cf + 0.5;
      luts[ch][v] = x * 255 + tShift[ch];
    }
  }
  return luts;
}

/** Compute auto levels (0.5 % clipping per channel) from RGBA data. */
export function autoLevels(data: Uint8ClampedArray | Uint8Array): { lo: [number, number, number]; hi: [number, number, number] } {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;
  const step = Math.max(1, Math.floor(data.length / 4 / 250000)) * 4;
  for (let i = 0; i < data.length; i += step) {
    if (data[i + 3] < 128) continue;
    hist[0][data[i]]++;
    hist[1][data[i + 1]]++;
    hist[2][data[i + 2]]++;
    n++;
  }
  const clip = n * 0.005;
  const lo = [0, 0, 0] as [number, number, number];
  const hi = [255, 255, 255] as [number, number, number];
  for (let ch = 0; ch < 3; ch++) {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[ch][v];
      if (acc > clip) {
        lo[ch] = v;
        break;
      }
    }
    acc = 0;
    for (let v = 255; v >= 0; v--) {
      acc += hist[ch][v];
      if (acc > clip) {
        hi[ch] = v;
        break;
      }
    }
    if (hi[ch] - lo[ch] < 32) {
      lo[ch] = 0;
      hi[ch] = 255;
    }
  }
  return { lo, hi };
}

/** Apply all adjustments in place. `width`/`height` are needed for sharpening. */
export function applyAdjustments(data: Uint8ClampedArray, width: number, height: number, a: Adjustments): void {
  if (isNeutral(a)) return;
  if (a.sharpness > 0) sharpen(data, width, height, a.sharpness / 100);
  const [lr, lg, lb] = buildLuts(a);
  const sat = 1 + a.saturation / 100;
  const doSat = a.saturation !== 0;
  const filter = a.filter;
  for (let i = 0; i < data.length; i += 4) {
    let r = lr[data[i]];
    let g = lg[data[i + 1]];
    let b = lb[data[i + 2]];
    if (doSat || filter !== 'none') {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (filter === 'bw') {
        r = g = b = y;
      } else if (filter === 'sepia') {
        r = y * 1.07 + 20;
        g = y * 0.89 + 10;
        b = y * 0.7;
      } else {
        r = y + (r - y) * sat;
        g = y + (g - y) * sat;
        b = y + (b - y) * sat;
      }
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/** Unsharp mask with a 3×3 box blur (separable: two passes of three). amount 0 … 1. */
function sharpen(data: Uint8ClampedArray, w: number, h: number, amount: number): void {
  if (w < 3 || h < 3) return;
  const k = (amount * 1.5) / 9;
  const k1 = 1 + amount * 1.5;
  const row = w * 4;
  // horizontal sums of three neighbours
  const hs = new Uint16Array(data.length);
  for (let y = 0; y < h; y++) {
    const base = y * row;
    for (let x = 1; x < w - 1; x++) {
      const i = base + x * 4;
      hs[i] = data[i - 4] + data[i] + data[i + 4];
      hs[i + 1] = data[i - 3] + data[i + 1] + data[i + 5];
      hs[i + 2] = data[i - 2] + data[i + 2] + data[i + 6];
    }
  }
  // vertical pass: out = src·(1+a) − blur·a, with blur = sum/9
  for (let y = 1; y < h - 1; y++) {
    const base = y * row;
    for (let x = 1; x < w - 1; x++) {
      const i = base + x * 4;
      data[i] = data[i] * k1 - (hs[i - row] + hs[i] + hs[i + row]) * k;
      data[i + 1] = data[i + 1] * k1 - (hs[i - row + 1] + hs[i + 1] + hs[i + row + 1]) * k;
      data[i + 2] = data[i + 2] * k1 - (hs[i - row + 2] + hs[i + 2] + hs[i + row + 2]) * k;
    }
  }
}
