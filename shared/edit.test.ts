// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import { describe, expect, it } from 'vitest';
import { applyAdjustments, autoLevels, buildLuts } from './adjust.js';
import {
  baseScale,
  centerOnBox,
  clampCenter,
  computeLayout,
  copyStyle,
  defaultEdit,
  dpiLevel,
  effectiveDpi,
  sanitizeEdit,
  toOrientedPoint,
} from './edit.js';

describe('fit modes', () => {
  it('fill covers the frame and crops the overhang', () => {
    // 4000 × 3000 landscape into a 100 × 150 portrait frame
    const l = computeLayout(100, 150, 1, 4000, 3000, defaultEdit('fill'));
    expect(l.scale).toBeCloseTo(150 / 3000);
    expect(4000 * l.scale).toBeGreaterThan(100);
    expect(l.centerX).toBeCloseTo(50);
    expect(l.centerY).toBeCloseTo(75);
  });

  it('fit shows the whole picture', () => {
    const l = computeLayout(100, 150, 1, 4000, 3000, defaultEdit('fit'));
    expect(l.scale).toBeCloseTo(100 / 4000);
    expect(3000 * l.scale).toBeLessThanOrEqual(150);
  });

  it('border mode shrinks the inner area by the border', () => {
    const e = { ...defaultEdit('border'), borderMm: 5, borderBottomMm: 15 };
    const l = computeLayout(100, 150, 1, 1000, 1500, e);
    expect(l.inner).toEqual({ x: 5, y: 5, w: 90, h: 125 });
  });

  it('a rotated picture still covers the frame', () => {
    const theta = (10 * Math.PI) / 180;
    const s = baseScale(100, 150, 1000, 1500, theta, 'fill');
    // the four corners of the frame, turned into picture space, lie inside the picture
    for (const [x, y] of [[-50, -75], [50, -75], [-50, 75], [50, 75]]) {
      const px = (x * Math.cos(-theta) - y * Math.sin(-theta)) / s;
      const py = (x * Math.sin(-theta) + y * Math.cos(-theta)) / s;
      expect(Math.abs(px)).toBeLessThanOrEqual(500 + 1e-6);
      expect(Math.abs(py)).toBeLessThanOrEqual(750 + 1e-6);
    }
  });

  it('clamps the crop so that no gap appears', () => {
    const e = { ...defaultEdit('fill'), cx: 0.5 };
    // 3000 × 2000 into a square frame: only horizontal room
    const c = clampCenter(e, 100, 100, 1, 3000, 2000);
    // visible width = 2000 px of 3000 → centre may move ±500 px = ±1/6
    expect(c.cx).toBeCloseTo(1 / 6);
    expect(clampCenter({ ...defaultEdit('fill'), cy: 0.3 }, 100, 100, 1, 3000, 2000).cy).toBeCloseTo(0);
  });

  it('keeps the picture centre when the format changes', () => {
    const e = { ...defaultEdit('fill'), cx: 0.1, cy: -0.05, zoom: 2 };
    const a = computeLayout(100, 150, 1, 4000, 3000, e);
    const b = computeLayout(150, 100, 1, 4000, 3000, e);
    // the same picture point (cx, cy) is in the middle of both frames
    for (const l of [a, b]) {
      const fx = l.centerX + e.cx * 4000 * l.scale;
      const fy = l.centerY + e.cy * 3000 * l.scale;
      expect(fx).toBeCloseTo(l.frameW / 2);
      expect(fy).toBeCloseTo(l.frameH / 2);
    }
  });
});

describe('effective dpi', () => {
  it('is 300 dpi when a 1181 × 1772 picture fills 10 × 15', () => {
    expect(effectiveDpi(100, 150, 1181, 1772, defaultEdit())).toBeCloseTo(300, 0);
  });

  it('halves when zooming in 2×', () => {
    expect(effectiveDpi(100, 150, 1181, 1772, { ...defaultEdit(), zoom: 2 })).toBeCloseTo(150, 0);
  });

  it('uses the visible crop: a 24 MP photo on 20 × 30 cm', () => {
    // 6000 × 4000 landscape on 30 × 20 cm landscape
    expect(effectiveDpi(300, 200, 6000, 4000, defaultEdit())).toBeCloseTo(508, 0);
  });

  it('classifies the quality', () => {
    expect(dpiLevel(300)).toBe('good');
    expect(dpiLevel(299)).toBe('ok');
    expect(dpiLevel(150)).toBe('ok');
    expect(dpiLevel(149)).toBe('bad');
  });
});

describe('orientation helpers', () => {
  it('maps points through 90° rotation and mirroring', () => {
    expect(toOrientedPoint(0.5, 0, { rot90: 90, flipH: false, flipV: false })).toEqual({ x: 0.5, y: 0 });
    expect(toOrientedPoint(1, 0.5, { rot90: 0, flipH: true, flipV: false })).toEqual({ x: -0.5, y: 0 });
    const e = centerOnBox(defaultEdit(), { x1: 0.6, y1: 0.2, x2: 0.8, y2: 0.4 });
    expect(e.cx).toBeCloseTo(0.2);
    expect(e.cy).toBeCloseTo(-0.2);
  });

  it('applies style to all pictures but not the crop', () => {
    const from = { ...defaultEdit('border'), cx: 0.2, adjust: { ...defaultEdit().adjust, contrast: 30 } };
    const to = { ...defaultEdit('fill'), cx: -0.1 };
    const r = copyStyle(from, to);
    expect(r.mode).toBe('border');
    expect(r.adjust.contrast).toBe(30);
    expect(r.cx).toBe(-0.1);
  });

  it('sanitises untrusted input', () => {
    const e = sanitizeEdit({ mode: 'evil', zoom: 1e9, angle: -100, adjust: { brightness: 500, filter: 'x' }, caption: { text: 'Hallo', color: 'red' } });
    expect(e.mode).toBe('fill');
    expect(e.zoom).toBe(8);
    expect(e.angle).toBe(-45);
    expect(e.adjust.brightness).toBe(100);
    expect(e.adjust.filter).toBe('none');
    expect(e.caption?.color).toBe('#222222');
  });
});

describe('corrections', () => {
  it('neutral settings leave values unchanged', () => {
    const [r] = buildLuts(defaultEdit().adjust);
    for (const v of [0, 64, 128, 255]) expect(r[v]).toBe(v);
  });

  it('auto levels stretch a flat histogram', () => {
    const data = new Uint8ClampedArray(4 * 1000);
    for (let i = 0; i < 1000; i++) {
      const v = 60 + (i % 100);
      data.set([v, v, v, 255], i * 4);
    }
    const l = autoLevels(data);
    expect(l.lo[0]).toBeGreaterThanOrEqual(60);
    expect(l.hi[0]).toBeLessThanOrEqual(159);
  });

  it('sharpening equals a plain 3 × 3 unsharp mask', () => {
    const w = 23;
    const h = 17;
    const src = new Uint8ClampedArray(w * h * 4).map((_, i) => (i * 7919) % 256);
    const fast = new Uint8ClampedArray(src);
    applyAdjustments(fast, w, h, { ...defaultEdit().adjust, sharpness: 60 });
    const a = 0.6 * 1.5;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += src[((y + dy) * w + x + dx) * 4 + c];
          const j = (y * w + x) * 4 + c;
          const expected = Math.min(255, Math.max(0, Math.round(src[j] + (src[j] - sum / 9) * a)));
          expect(Math.abs(fast[j] - expected)).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
