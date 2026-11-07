// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import { type Canvas, createCanvas, ImageData } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { clampCenter, type EditState } from '../../shared/edit.js';
import { formatSizeMm, MM_PER_INCH, type Orientation, type PhotoFormat } from '../../shared/formats.js';
import { renderPhoto } from '../../shared/render.js';
import type { Placement, SheetLayout } from '../../shared/sheet.js';
import type { RawImage } from './images.js';

const factory = (w: number, h: number) => {
  const canvas = createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  return { canvas, ctx: canvas.getContext('2d') };
};

/** Pixels → canvas that can be drawn from. */
export function rawToCanvas(raw: RawImage) {
  const c = createCanvas(raw.width, raw.height);
  const ctx = c.getContext('2d');
  const data = new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength);
  ctx.putImageData(new ImageData(data, raw.width, raw.height), 0, 0);
  return c;
}

export interface FrameJob {
  raw: RawImage;
  format: PhotoFormat;
  orientation: Orientation;
  edit: EditState;
}

function canvasToRaw(canvas: Canvas): RawImage {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), width: canvas.width, height: canvas.height };
}

/** Exact pixel size of the format at the given dpi. */
export function frameSizePx(format: PhotoFormat, orientation: Orientation, dpi: number) {
  const mm = formatSizeMm(format, orientation);
  return { w: Math.round((mm.w / MM_PER_INCH) * dpi), h: Math.round((mm.h / MM_PER_INCH) * dpi), mm };
}

function drawFrame(target: Canvas, x: number, y: number, w: number, h: number, pxPerMm: number, job: FrameJob, source: Canvas) {
  const ctx = target.getContext('2d');
  const edit = clampCenter(job.edit, w, h, pxPerMm, job.raw.width, job.raw.height);
  renderPhoto({
    ctx,
    x,
    y,
    frameW: w,
    frameH: h,
    pxPerMm,
    image: source,
    imgW: job.raw.width,
    imgH: job.raw.height,
    edit,
    createCanvas: factory,
  });
}

/** Render one photo into its format from the full resolution original. */
export function renderFrame(job: FrameJob, dpi: number): RawImage {
  const { w, h, mm } = frameSizePx(job.format, job.orientation, dpi);
  const canvas = createCanvas(w, h);
  const source = rawToCanvas(job.raw);
  drawFrame(canvas, 0, 0, w, h, w / mm.w, job, source);
  return canvasToRaw(canvas);
}

export interface SheetRenderOptions {
  dpi: number;
  cropMarks: boolean;
}

/**
 * Render one sheet page. `load(index)` returns the frame job for a picture;
 * pictures are loaded one after another to keep memory low.
 */
export async function renderSheetPage(
  layout: SheetLayout,
  page: number,
  load: (index: number) => Promise<FrameJob>,
  o: SheetRenderOptions,
): Promise<RawImage> {
  const pxPerMm = o.dpi / MM_PER_INCH;
  const W = Math.round(layout.sheetW * pxPerMm);
  const H = Math.round(layout.sheetH * pxPerMm);
  const sheet = createCanvas(W, H);
  const sctx = sheet.getContext('2d');
  sctx.fillStyle = '#ffffff';
  sctx.fillRect(0, 0, W, H);
  const placements = layout.pages[page].placements;
  const cache = new Map<number, { job: FrameJob; source: Canvas }>();
  for (const p of placements) {
    let entry = cache.get(p.index);
    if (!entry) {
      cache.clear(); // only keep the current picture in memory
      const job = await load(p.index);
      const fresh = { job, source: rawToCanvas(job.raw) };
      cache.set(p.index, fresh);
      entry = fresh;
    }
    const { job, source } = entry;
    const x = Math.round(p.x * pxPerMm);
    const y = Math.round(p.y * pxPerMm);
    const w = Math.round(p.w * pxPerMm);
    const h = Math.round(p.h * pxPerMm);
    if (!p.rotated) {
      drawFrame(sheet, x, y, w, h, pxPerMm, job, source);
    } else {
      // render upright, then place turned by 90°
      const tmp = createCanvas(h, w);
      drawFrame(tmp, 0, 0, h, w, pxPerMm, job, source);
      sctx.save();
      sctx.translate(x + w, y);
      sctx.rotate(Math.PI / 2);
      sctx.drawImage(tmp, 0, 0);
      sctx.restore();
    }
  }
  if (o.cropMarks) drawCropMarks(sctx, placements, pxPerMm);
  return canvasToRaw(sheet);
}

function drawCropMarks(ctx: any, placements: Placement[], pxPerMm: number) {
  const len = 3 * pxPerMm;
  const off = 1 * pxPerMm;
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = Math.max(1, 0.1 * pxPerMm);
  ctx.beginPath();
  const inside = (x: number, y: number) =>
    placements.some((p) => x > p.x * pxPerMm + 0.5 && x < (p.x + p.w) * pxPerMm - 0.5 && y > p.y * pxPerMm + 0.5 && y < (p.y + p.h) * pxPerMm - 0.5);
  const seg = (x1: number, y1: number, x2: number, y2: number) => {
    // skip marks that would cover a neighbouring picture
    if (inside((x1 + x2) / 2, (y1 + y2) / 2)) return;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  };
  for (const p of placements) {
    const x0 = p.x * pxPerMm;
    const y0 = p.y * pxPerMm;
    const x1 = (p.x + p.w) * pxPerMm;
    const y1 = (p.y + p.h) * pxPerMm;
    for (const [cx, sx] of [
      [x0, -1],
      [x1, 1],
    ] as const) {
      for (const [cy, sy] of [
        [y0, -1],
        [y1, 1],
      ] as const) {
        seg(cx + sx * off, cy, cx + sx * (off + len), cy);
        seg(cx, cy + sy * off, cx, cy + sy * (off + len));
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** PDF with pages of exactly the given size in mm, each showing one JPEG full-bleed. */
export async function buildPdf(pages: { jpeg: Buffer; wMm: number; hMm: number }[], title: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator('Fotodruck');
  doc.setProducer('Fotodruck (pdf-lib)');
  const pt = (mm: number) => (mm / MM_PER_INCH) * 72;
  for (const p of pages) {
    const img = await doc.embedJpg(p.jpeg);
    const page = doc.addPage([pt(p.wMm), pt(p.hMm)]);
    page.drawImage(img, { x: 0, y: 0, width: pt(p.wMm), height: pt(p.hMm) });
  }
  return Buffer.from(await doc.save());
}
