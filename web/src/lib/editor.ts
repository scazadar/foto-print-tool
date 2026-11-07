// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import { autoLevels } from '../../../shared/adjust';
import { type EditState, matchingOrientation } from '../../../shared/edit';
import { api } from './api';
import { t } from './i18n';
import type { EditorItem, Face } from './state.svelte';

const HISTORY_LIMIT = 50;

/** Load the preview picture and the original's size (and faces) for an item. */
export async function loadItem(item: EditorItem): Promise<void> {
  if (item.loaded || item.img) return;
  const img = new Image();
  img.decoding = 'async';
  img.src = item.ref.previewUrl;
  item.img = img;
  try {
    const infoP =
      item.ref.kind === 'immich'
        ? api.get<{ width: number | null; height: number | null; faces: Face[]; mime: string | null }>(`/api/immich/assets/${item.ref.id}`)
        : api.get<{ width: number; height: number; warning: string | null }>(`/api/uploads/${item.ref.id}`);
    await img.decode();
    const info: any = await infoP.catch(() => null);
    let w = info?.width ?? item.origW;
    let h = info?.height ?? item.origH;
    if (!w || !h) {
      // unknown: assume the preview has the original's resolution
      w = img.naturalWidth;
      h = img.naturalHeight;
    }
    // the preview is always upright: make the original size match its orientation
    const previewPortrait = img.naturalHeight > img.naturalWidth;
    const origPortrait = h > w;
    if (Math.abs(img.naturalWidth - img.naturalHeight) > 2 && previewPortrait !== origPortrait) [w, h] = [h, w];
    item.origW = w;
    item.origH = h;
    if (info?.faces) item.faces = info.faces;
    if (info?.warning) item.warning = info.warning;
    if (item.history.length === 0) item.orientation = matchingOrientation(w, h);
    item.loaded = true;
  } catch {
    item.error = t('upload.failed');
    item.img = null;
  }
}

/** Snapshot taken when a change starts; pushed to the history when it ends. */
const pending = new WeakMap<object, { edit: EditState; orientation: EditorItem['orientation'] }>();

function snapshot(item: EditorItem) {
  return { edit: JSON.parse(JSON.stringify(item.edit)) as EditState, orientation: item.orientation };
}

export function beginChange(item: EditorItem): void {
  if (!pending.has(item)) pending.set(item, snapshot(item));
}

export function endChange(item: EditorItem): void {
  const before = pending.get(item);
  pending.delete(item);
  if (!before) return;
  if (JSON.stringify(before) === JSON.stringify(snapshot(item))) return;
  item.history.push(before);
  if (item.history.length > HISTORY_LIMIT) item.history.shift();
  item.future = [];
}

/** Discrete change (button). */
export function change(item: EditorItem, fn: () => void): void {
  beginChange(item);
  fn();
  endChange(item);
}

export function undo(item: EditorItem): void {
  const prev = item.history.pop();
  if (!prev) return;
  item.future.push(snapshot(item));
  item.edit = prev.edit;
  item.orientation = prev.orientation;
}

export function redo(item: EditorItem): void {
  const next = item.future.pop();
  if (!next) return;
  item.history.push(snapshot(item));
  item.edit = next.edit;
  item.orientation = next.orientation;
}

/** Auto levels from the preview picture. */
export function computeAutoLevels(img: HTMLImageElement): EditState['adjust']['levels'] {
  const c = document.createElement('canvas');
  const s = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return autoLevels(ctx.getImageData(0, 0, c.width, c.height).data);
}
