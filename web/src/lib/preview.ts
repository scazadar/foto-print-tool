// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import { clampCenter, type EditState } from '../../../shared/edit';
import { formatSizeMm, type PhotoFormat } from '../../../shared/formats';
import { renderPhoto } from '../../../shared/render';
import type { EditorItem } from './state.svelte';

const factory = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: true })! };
};

/** Small rendering of an item exactly as it will be printed (for the paper preview). */
export function renderThumb(item: EditorItem, format: PhotoFormat, longSide = 360): string | null {
  if (!item.img || !item.loaded) return null;
  const mm = formatSizeMm(format, item.orientation);
  const s = longSide / Math.max(mm.w, mm.h);
  const w = Math.round(mm.w * s);
  const h = Math.round(mm.h * s);
  const { canvas, ctx } = factory(w, h);
  const edit = clampCenter(JSON.parse(JSON.stringify(item.edit)) as EditState, w, h, s, item.img.naturalWidth, item.img.naturalHeight);
  renderPhoto({ ctx, frameW: w, frameH: h, pxPerMm: s, image: item.img, imgW: item.img.naturalWidth, imgH: item.img.naturalHeight, edit, createCanvas: factory });
  return canvas.toDataURL('image/jpeg', 0.8);
}
