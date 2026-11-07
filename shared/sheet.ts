// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/** Placing several pictures on one sheet with little waste. */

export interface SheetSize {
  id: string;
  name: string;
  /** portrait size in mm */
  w: number;
  h: number;
}

export const SHEETS: SheetSize[] = [
  { id: 'a4', name: 'DIN A4', w: 210, h: 297 },
  { id: 'a3', name: 'DIN A3', w: 297, h: 420 },
  { id: 'letter', name: 'Letter', w: 215.9, h: 279.4 },
  { id: '10x15', name: '10 × 15 cm', w: 100, h: 150 },
];

export interface SheetItem {
  /** Index into the caller's list of pictures. */
  index: number;
  w: number;
  h: number;
}

export interface Placement {
  index: number;
  /** position on the sheet in mm (top left) */
  x: number;
  y: number;
  /** size on the sheet in mm (after rotation) */
  w: number;
  h: number;
  /** picture is turned by 90° on the sheet */
  rotated: boolean;
}

export interface SheetPage {
  placements: Placement[];
}

export interface SheetLayout {
  sheetW: number;
  sheetH: number;
  pages: SheetPage[];
  /** items that are larger than the printable area */
  tooLarge: number[];
}

export interface SheetOptions {
  marginMm: number;
  gapMm: number;
  allowRotate: boolean;
}

const EPS = 1e-6;

interface Shelf {
  y: number;
  h: number;
  x: number;
}

function packPage(items: SheetItem[], uw: number, uh: number, o: SheetOptions): { placed: Placement[]; rest: SheetItem[] } {
  const shelves: Shelf[] = [];
  const placed: Placement[] = [];
  const rest: SheetItem[] = [];
  let nextY = 0;
  for (const it of items) {
    const options: { w: number; h: number; rotated: boolean }[] = [{ w: it.w, h: it.h, rotated: false }];
    if (o.allowRotate && Math.abs(it.w - it.h) > EPS) options.push({ w: it.h, h: it.w, rotated: true });
    let best: { shelf: Shelf; opt: (typeof options)[number]; waste: number } | null = null;
    for (const s of shelves) {
      for (const opt of options) {
        const x = s.x === 0 ? 0 : s.x + o.gapMm;
        if (x + opt.w <= uw + EPS && opt.h <= s.h + EPS) {
          const waste = s.h - opt.h;
          if (!best || waste < best.waste) best = { shelf: s, opt, waste };
        }
      }
    }
    if (best) {
      const x = best.shelf.x === 0 ? 0 : best.shelf.x + o.gapMm;
      placed.push({ index: it.index, x, y: best.shelf.y, w: best.opt.w, h: best.opt.h, rotated: best.opt.rotated });
      best.shelf.x = x + best.opt.w;
      continue;
    }
    // new shelf: prefer the orientation that puts more pictures in a row
    const y = shelves.length === 0 ? 0 : nextY + o.gapMm;
    const fitting = options
      .filter((opt) => opt.w <= uw + EPS && y + opt.h <= uh + EPS)
      .sort((a, b) => {
        const perRowA = Math.floor((uw + o.gapMm) / (a.w + o.gapMm));
        const perRowB = Math.floor((uw + o.gapMm) / (b.w + o.gapMm));
        return perRowB / b.h - perRowA / a.h;
      });
    if (fitting.length === 0) {
      rest.push(it);
      continue;
    }
    const opt = fitting[0];
    const shelf = { y, h: opt.h, x: opt.w };
    shelves.push(shelf);
    nextY = y + opt.h;
    placed.push({ index: it.index, x: 0, y, w: opt.w, h: opt.h, rotated: opt.rotated });
  }
  return { placed, rest };
}

function layoutOn(sheetW: number, sheetH: number, items: SheetItem[], o: SheetOptions): SheetLayout {
  const uw = sheetW - 2 * o.marginMm;
  const uh = sheetH - 2 * o.marginMm;
  const tooLarge: number[] = [];
  let queue = items.filter((it) => {
    const fits = (it.w <= uw + EPS && it.h <= uh + EPS) || (o.allowRotate && it.h <= uw + EPS && it.w <= uh + EPS);
    if (!fits) tooLarge.push(it.index);
    return fits;
  });
  // largest first packs better
  queue = [...queue].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  const pages: SheetPage[] = [];
  while (queue.length) {
    const { placed, rest } = packPage(queue, uw, uh, o);
    if (placed.length === 0) break;
    // centre the block on the sheet
    const maxX = Math.max(...placed.map((p) => p.x + p.w));
    const maxY = Math.max(...placed.map((p) => p.y + p.h));
    const dx = o.marginMm + (uw - maxX) / 2;
    const dy = o.marginMm + (uh - maxY) / 2;
    pages.push({ placements: placed.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) });
    queue = rest;
  }
  return { sheetW, sheetH, pages, tooLarge };
}

/** Try the sheet upright and turned, keep the one with fewer pages / more pictures on page 1. */
export function layoutSheet(sheet: SheetSize, items: SheetItem[], o: SheetOptions): SheetLayout {
  const a = layoutOn(sheet.w, sheet.h, items, o);
  const b = layoutOn(sheet.h, sheet.w, items, o);
  const score = (l: SheetLayout) => [l.tooLarge.length, l.pages.length, -(l.pages[0]?.placements.length ?? 0)];
  const sa = score(a);
  const sb = score(b);
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return sa[i] < sb[i] ? a : b;
  }
  return a;
}

/** How many pictures of one size fit on a sheet. */
export function sheetCapacity(sheet: SheetSize, w: number, h: number, o: SheetOptions): number {
  const many: SheetItem[] = Array.from({ length: 400 }, (_, i) => ({ index: i, w, h }));
  const l = layoutSheet(sheet, many, o);
  return l.pages[0]?.placements.length ?? 0;
}
