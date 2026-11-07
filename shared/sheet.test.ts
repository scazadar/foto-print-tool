// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import { describe, expect, it } from 'vitest';
import { layoutSheet, sheetCapacity, SHEETS } from './sheet.js';

const sheet = (id: string) => SHEETS.find((s) => s.id === id)!;
const o = { marginMm: 5, gapMm: 2, allowRotate: true };

describe('sheet layout', () => {
  it('puts 4 × A6 on A4', () => {
    expect(sheetCapacity(sheet('a4'), 105, 148, { marginMm: 0, gapMm: 0, allowRotate: true })).toBe(4);
  });

  it('puts 8 passport photos on 10 × 15', () => {
    expect(sheetCapacity(sheet('10x15'), 35, 45, { marginMm: 3, gapMm: 1, allowRotate: true })).toBe(8);
  });

  it('keeps every picture inside the printable area and apart from each other', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ index: i, w: i % 2 ? 100 : 90, h: i % 2 ? 150 : 130 }));
    const l = layoutSheet(sheet('a3'), items, o);
    const all = l.pages.flatMap((p) => p.placements);
    expect(all).toHaveLength(9);
    for (const p of l.pages) {
      for (const a of p.placements) {
        expect(a.x).toBeGreaterThanOrEqual(o.marginMm - 1e-6);
        expect(a.y).toBeGreaterThanOrEqual(o.marginMm - 1e-6);
        expect(a.x + a.w).toBeLessThanOrEqual(l.sheetW - o.marginMm + 1e-6);
        expect(a.y + a.h).toBeLessThanOrEqual(l.sheetH - o.marginMm + 1e-6);
        for (const b of p.placements) {
          if (a === b) continue;
          const apart = a.x + a.w + o.gapMm <= b.x + 1e-6 || b.x + b.w + o.gapMm <= a.x + 1e-6 || a.y + a.h + o.gapMm <= b.y + 1e-6 || b.y + b.h + o.gapMm <= a.y + 1e-6;
          expect(apart).toBe(true);
        }
      }
    }
  });

  it('reports pictures larger than the sheet', () => {
    const l = layoutSheet(sheet('10x15'), [{ index: 0, w: 210, h: 297 }], o);
    expect(l.tooLarge).toEqual([0]);
  });
});
