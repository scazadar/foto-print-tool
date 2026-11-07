// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/**
 * Draws one photo into a frame according to an EditState. Used by the browser
 * (HTMLCanvasElement) for the live preview and by the server (@napi-rs/canvas)
 * for the full-resolution output, so both look the same.
 */

import { applyAdjustments, isNeutral } from './adjust.js';
import { computeLayout, type EditState, type Layout } from './edit.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Ctx2D = any;
export type Drawable = any;

export interface CanvasFactory {
  (w: number, h: number): { canvas: Drawable; ctx: Ctx2D };
}

export interface RenderOptions {
  ctx: Ctx2D;
  /** Offset of the frame inside ctx (for sheet layouts). */
  x?: number;
  y?: number;
  frameW: number;
  frameH: number;
  pxPerMm: number;
  image: Drawable;
  imgW: number;
  imgH: number;
  edit: EditState;
  createCanvas: CanvasFactory;
  /** Skip the (slow) sharpening, e.g. while dragging. */
  fast?: boolean;
}

export const FONT_STACKS: Record<string, string> = {
  sans: '"DejaVu Sans", "Helvetica Neue", Arial, sans-serif',
  serif: '"DejaVu Serif", Georgia, "Times New Roman", serif',
  mono: '"DejaVu Sans Mono", Menlo, Consolas, monospace',
  hand: '"Comic Neue", "Segoe Print", "Bradley Hand", cursive',
};

function backgroundColor(e: EditState): string {
  if (e.background === 'black') return '#000000';
  if (e.background === 'color') return e.bgColor;
  return '#ffffff';
}

export function drawPicture(ctx: Ctx2D, layout: Layout, image: Drawable, imgW: number, imgH: number, e: EditState): void {
  ctx.save();
  ctx.translate(layout.centerX, layout.centerY);
  ctx.rotate(layout.theta);
  ctx.scale(layout.scale * (e.flipH ? -1 : 1), layout.scale * (e.flipV ? -1 : 1));
  ctx.rotate((e.rot90 * Math.PI) / 180);
  ctx.drawImage(image, -imgW / 2, -imgH / 2, imgW, imgH);
  ctx.restore();
}

function drawBlurBackground(o: RenderOptions, target: Ctx2D, w: number, h: number): void {
  // cheap, deterministic blur: downscale to a tiny picture, then scale up smoothly
  const small = 24;
  const ratio = w / h;
  const sw = ratio >= 1 ? small : Math.max(2, Math.round(small * ratio));
  const sh = ratio >= 1 ? Math.max(2, Math.round(small / ratio)) : small;
  const tiny = o.createCanvas(sw, sh);
  const cover = Math.max(sw / o.imgW, sh / o.imgH);
  tiny.ctx.imageSmoothingEnabled = true;
  tiny.ctx.imageSmoothingQuality = 'high';
  tiny.ctx.drawImage(o.image, (sw - o.imgW * cover) / 2, (sh - o.imgH * cover) / 2, o.imgW * cover, o.imgH * cover);
  target.save();
  target.imageSmoothingEnabled = true;
  target.imageSmoothingQuality = 'high';
  target.drawImage(tiny.canvas, 0, 0, sw, sh, 0, 0, w, h);
  target.fillStyle = 'rgba(0,0,0,0.12)';
  target.fillRect(0, 0, w, h);
  target.restore();
}

export function renderPhoto(o: RenderOptions): Layout {
  const { ctx, frameW, frameH, edit: e } = o;
  const ox = o.x ?? 0;
  const oy = o.y ?? 0;
  const layout = computeLayout(frameW, frameH, o.pxPerMm, o.imgW, o.imgH, e);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.beginPath();
  ctx.rect(0, 0, frameW, frameH);
  ctx.clip();
  ctx.fillStyle = e.mode === 'fill' ? '#ffffff' : backgroundColor(e);
  ctx.fillRect(0, 0, frameW, frameH);

  // picture layer of the inner rect, so corrections only touch the photo
  const ix = Math.round(layout.inner.x);
  const iy = Math.round(layout.inner.y);
  const iw = Math.max(1, Math.round(layout.inner.w));
  const ih = Math.max(1, Math.round(layout.inner.h));
  const layer = o.createCanvas(iw, ih);
  const lctx = layer.ctx;
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = 'high';
  if (e.mode === 'fit' && e.background === 'blur') {
    drawBlurBackground(o, lctx, iw, ih);
  } else if (e.mode === 'fit') {
    lctx.fillStyle = backgroundColor(e);
    lctx.fillRect(0, 0, iw, ih);
  }
  lctx.translate(-ix, -iy);
  drawPicture(lctx, layout, o.image, o.imgW, o.imgH, e);
  lctx.setTransform(1, 0, 0, 1, 0, 0);

  const adj = o.fast ? { ...e.adjust, sharpness: 0 } : e.adjust;
  if (!isNeutral(adj)) {
    const img = lctx.getImageData(0, 0, iw, ih);
    applyAdjustments(img.data, iw, ih, adj);
    lctx.putImageData(img, 0, 0);
  }
  ctx.drawImage(layer.canvas, ix, iy);

  if (e.caption && e.caption.text) drawCaption(ctx, layout, o.pxPerMm, e);
  ctx.restore();
  return layout;
}

function drawCaption(ctx: Ctx2D, layout: Layout, pxPerMm: number, e: EditState): void {
  const cap = e.caption!;
  const size = cap.sizeMm * pxPerMm;
  const bottomSpace = layout.frameH - (layout.inner.y + layout.inner.h);
  ctx.save();
  ctx.fillStyle = cap.color;
  ctx.font = `${size}px ${FONT_STACKS[cap.font] ?? FONT_STACKS.sans}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const y = bottomSpace > size * 1.2 ? layout.inner.y + layout.inner.h + bottomSpace / 2 : layout.frameH - size;
  ctx.fillText(cap.text, layout.frameW / 2, y, layout.frameW * 0.92);
  ctx.restore();
}
