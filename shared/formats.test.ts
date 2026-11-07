// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import { describe, expect, it } from 'vitest';
import { aspectLabel, BUILTIN_FORMATS, formatFileTag, formatSizePx, mmToPx, sizeLabel, validateFormat } from './formats.js';

// table from the specification: pixel size at 300 dpi (portrait) and aspect ratio
const TABLE: [string, number, number, string][] = [
  ['9x13', 1063, 1535, 'ca. 7:10'],
  ['10x15', 1181, 1772, '2:3'],
  ['13x18', 1535, 2126, 'ca. 5:7'],
  ['15x20', 1772, 2362, '3:4'],
  ['15x21', 1772, 2480, '5:7'],
  ['18x24', 2126, 2835, '3:4'],
  ['20x25', 2362, 2953, '4:5'],
  ['20x30', 2362, 3543, '2:3'],
  ['30x40', 3543, 4724, '3:4'],
  ['30x45', 3543, 5315, '2:3'],
  ['40x60', 4724, 7087, '2:3'],
  ['50x70', 5906, 8268, '5:7'],
  ['10x10', 1181, 1181, '1:1'],
  ['13x13', 1535, 1535, '1:1'],
  ['20x20', 2362, 2362, '1:1'],
  ['30x30', 3543, 3543, '1:1'],
  ['10x30', 1181, 3543, '1:3'],
  ['20x60', 2362, 7087, '1:3'],
  ['a6', 1240, 1748, '1:√2'],
  ['a5', 1748, 2480, '1:√2'],
  ['a4', 2480, 3508, '1:√2'],
  ['a3', 3508, 4961, '1:√2'],
  ['passport-eu', 413, 531, '7:9'],
  ['passport-us', 600, 600, '1:1'],
];

describe('built-in formats', () => {
  it('contains every format of the table', () => {
    expect(BUILTIN_FORMATS.map((f) => f.id).sort()).toEqual(TABLE.map((r) => r[0]).sort());
  });

  it.each(TABLE)('%s has %i × %i px at 300 dpi and ratio %s', (id, w, h, ratio) => {
    const f = BUILTIN_FORMATS.find((x) => x.id === id)!;
    expect(formatSizePx(f, 'portrait', 300)).toEqual({ w, h });
    expect(formatSizePx(f, 'landscape', 300)).toEqual({ w: h, h: w });
    expect(aspectLabel(f)).toBe(ratio);
  });

  it('computes px = mm / 25.4 × dpi', () => {
    expect(mmToPx(100, 300)).toBe(1181);
    expect(mmToPx(150, 300)).toBe(1772);
    expect(mmToPx(100, 600)).toBe(2362);
  });

  it('shows cm and inch labels', () => {
    const f = BUILTIN_FORMATS.find((x) => x.id === '10x15')!;
    expect(sizeLabel(f, 'portrait', 'cm')).toBe('10 × 15 cm');
    expect(sizeLabel(f, 'landscape', 'in')).toBe('5.91 × 3.94 in');
    expect(formatFileTag(f, 'landscape')).toBe('10x15');
  });

  it('validates custom formats', () => {
    expect(validateFormat({ name: 'Labor', width: 10.2, height: 15.2, unit: 'cm' })).toBeNull();
    expect(validateFormat({ name: '', width: 10, height: 15, unit: 'cm' })).toBe('format.invalidName');
    expect(validateFormat({ name: 'x', width: 0.5, height: 15, unit: 'cm' })).toBe('format.invalidSize');
    expect(validateFormat({ name: 'x', width: 10, height: 15, unit: 'ft' as any })).toBe('format.invalidUnit');
  });
});
