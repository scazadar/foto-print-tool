// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import builtin from './formats.json' with { type: 'json' };

export type Unit = 'cm' | 'mm' | 'in';
export type FormatGroup = 'classic' | 'large' | 'square' | 'panorama' | 'din' | 'id' | 'custom';
export type Orientation = 'portrait' | 'landscape';

export interface PhotoFormat {
  id: string;
  name: string;
  /** Short side (or the first side for custom formats). */
  width: number;
  /** Long side. */
  height: number;
  unit: Unit;
  group: FormatGroup;
  /** Shows passport guide lines for this standard. */
  passport?: 'eu' | 'us';
  custom?: boolean;
}

export const MM_PER_INCH = 25.4;

export const BUILTIN_FORMATS: PhotoFormat[] = (builtin as { formats: PhotoFormat[] }).formats;

export function toMm(value: number, unit: Unit): number {
  switch (unit) {
    case 'mm':
      return value;
    case 'cm':
      return value * 10;
    case 'in':
      return value * MM_PER_INCH;
  }
}

/** Physical size in mm for the given orientation. */
export function formatSizeMm(f: PhotoFormat, orientation: Orientation): { w: number; h: number } {
  const a = toMm(f.width, f.unit);
  const b = toMm(f.height, f.unit);
  const short = Math.min(a, b);
  const long = Math.max(a, b);
  return orientation === 'portrait' ? { w: short, h: long } : { w: long, h: short };
}

/** px = mm / 25.4 × dpi, rounded to the nearest pixel. */
export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

export function formatSizePx(f: PhotoFormat, orientation: Orientation, dpi: number): { w: number; h: number } {
  const { w, h } = formatSizeMm(f, orientation);
  return { w: mmToPx(w, dpi), h: mmToPx(h, dpi) };
}

function gcd(a: number, b: number): number {
  return b < 1e-9 ? a : gcd(b, a % b);
}

/** Human readable aspect ratio of the short:long side, e.g. "2:3", "ca. 5:7", "1:√2". */
export function aspectLabel(f: PhotoFormat): string {
  const a = toMm(f.width, f.unit);
  const b = toMm(f.height, f.unit);
  const short = Math.min(a, b);
  const long = Math.max(a, b);
  const r = long / short;
  if (Math.abs(r - Math.SQRT2) < 0.01) return '1:√2';
  // exact small integer ratios
  const g = gcd(Math.round(short * 10), Math.round(long * 10));
  const s = Math.round(short * 10) / g;
  const l = Math.round(long * 10) / g;
  if (s <= 8 && l <= 12) return `${s}:${l}`;
  // closest simple ratio
  let best = { s: 1, l: 1, err: Infinity };
  for (let ds = 1; ds <= 7; ds++) {
    const dl = Math.round(ds * r);
    const err = Math.abs(dl / ds - r);
    if (err < best.err - 1e-9) best = { s: ds, l: dl, err };
  }
  return `ca. ${best.s}:${best.l}`;
}

function trim(n: number, digits: number): string {
  return n.toFixed(digits).replace(/\.?0+$/, '');
}

/** "10 × 15 cm" or "4 × 6 in" style label in the requested unit system. */
export function sizeLabel(f: PhotoFormat, orientation: Orientation, unit: 'cm' | 'in'): string {
  const { w, h } = formatSizeMm(f, orientation);
  if (unit === 'in') return `${trim(w / MM_PER_INCH, 2)} × ${trim(h / MM_PER_INCH, 2)} in`;
  return `${trim(w / 10, 2)} × ${trim(h / 10, 2)} cm`;
}

/** Validate a user supplied format definition. Returns an error key or null. */
export function validateFormat(f: Partial<PhotoFormat>): string | null {
  if (!f.name || typeof f.name !== 'string' || f.name.length > 60) return 'format.invalidName';
  if (!(f.unit === 'cm' || f.unit === 'mm' || f.unit === 'in')) return 'format.invalidUnit';
  for (const v of [f.width, f.height]) {
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) return 'format.invalidSize';
    const mm = toMm(v, f.unit);
    if (mm < 10 || mm > 2000) return 'format.invalidSize';
  }
  return null;
}

/** Safe file name part for a format, e.g. "10x15" (short side first, like the format's name). */
export function formatFileTag(f: PhotoFormat, _orientation?: Orientation): string {
  const { w, h } = formatSizeMm(f, 'portrait');
  if (f.unit === 'in') return `${trim(w / MM_PER_INCH, 2)}x${trim(h / MM_PER_INCH, 2)}in`;
  if (f.unit === 'mm') return `${trim(w, 1)}x${trim(h, 1)}mm`;
  return `${trim(w / 10, 2)}x${trim(h / 10, 2)}`.replace(/\./g, ',');
}
