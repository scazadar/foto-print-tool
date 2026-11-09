// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import { ZipArchive } from 'archiver';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PassThrough } from 'node:stream';
import { sanitizeEdit, type EditState } from '../../shared/edit.js';
import { formatFileTag, formatSizeMm, type Orientation, type PhotoFormat, validateFormat } from '../../shared/formats.js';
import { layoutSheet, SHEETS, type SheetItem, type SheetLayout } from '../../shared/sheet.js';
import { type AppContext, HttpError, immichFor, requireUser, type SessionUser } from './context.js';
import { getUserSetting } from './db.js';
import { defaultPrefs, type UserPrefs } from './settings.js';
import { type ImmichClient } from './immich.js';
import { encodeJpeg, encodePng, type ExifSubset, type RawImage } from './images.js';
import { buildPdf, type FrameJob, renderFrame, renderSheetPage } from './render.js';
import { loadPhoto, parseSourceRef, type LoadedPhoto, type SourceRef } from './sources.js';

export type OutputType = 'jpeg' | 'png' | 'pdf';

export interface OutputItem {
  source: SourceRef;
  format: PhotoFormat;
  orientation: Orientation;
  edit: EditState;
  copies: number;
}

export interface SheetRequest {
  sheetId: string;
  marginMm: number;
  gapMm: number;
  cropMarks: boolean;
  allowRotate: boolean;
}

export interface OutputRequest {
  items: OutputItem[];
  dpi: number;
  type: OutputType;
  quality: number;
  includeGps: boolean;
  sheet: SheetRequest | null;
}

const MAX_ITEMS = 200;

function parseFormat(v: any): PhotoFormat {
  const f = {
    id: typeof v?.id === 'string' ? v.id.slice(0, 80) : 'custom',
    name: typeof v?.name === 'string' ? v.name : '',
    width: Number(v?.width),
    height: Number(v?.height),
    unit: v?.unit,
    group: 'custom' as const,
  };
  const err = validateFormat(f);
  if (err) throw new HttpError(400, err);
  return f as PhotoFormat;
}

export function parseOutputRequest(body: any, defaultDpi: number): OutputRequest {
  if (!body || !Array.isArray(body.items) || body.items.length === 0) throw new HttpError(400, 'output.noItems');
  if (body.items.length > MAX_ITEMS) throw new HttpError(400, 'output.tooManyItems');
  const items: OutputItem[] = body.items.map((it: any) => ({
    source: parseSourceRef(it?.source),
    format: parseFormat(it?.format),
    orientation: it?.orientation === 'landscape' ? 'landscape' : 'portrait',
    edit: sanitizeEdit(it?.edit),
    copies: Math.max(1, Math.min(99, Math.floor(Number(it?.copies) || 1))),
  }));
  const dpi = Math.floor(Number(body.dpi) || defaultDpi);
  if (dpi < 72 || dpi > 1200) throw new HttpError(400, 'output.invalidDpi');
  const type: OutputType = ['jpeg', 'png', 'pdf'].includes(body.type) ? body.type : 'jpeg';
  const quality = Math.max(50, Math.min(100, Math.floor(Number(body.quality) || 92)));
  let sheet: SheetRequest | null = null;
  if (body.sheet) {
    const s = body.sheet;
    if (!SHEETS.some((x) => x.id === s.sheetId)) throw new HttpError(400, 'sheet.invalid');
    sheet = {
      sheetId: s.sheetId,
      marginMm: Math.max(0, Math.min(30, Number(s.marginMm) || 0)),
      gapMm: Math.max(0, Math.min(30, Number(s.gapMm) || 0)),
      cropMarks: s.cropMarks !== false,
      allowRotate: s.allowRotate !== false,
    };
  }
  // keep the pixel count within reason (≈ 50 × 70 cm at 300 dpi)
  for (const it of items) {
    const mm = formatSizeMm(it.format, it.orientation);
    const px = ((mm.w / 25.4) * dpi) * ((mm.h / 25.4) * dpi);
    if (px > 80_000_000) throw new HttpError(400, 'output.tooLarge');
  }
  return { items, dpi, type, quality, includeGps: body.includeGps === true, sheet };
}

/* ---------- render queue: one heavy render at a time ---------- */
let queue: Promise<unknown> = Promise.resolve();
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export interface RenderedFile {
  name: string;
  mime: string;
  data: Buffer;
  /** for Immich upload */
  takenAt: string | null;
  baseName: string;
  label: string;
  warning: string | null;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const EXT: Record<OutputType, string> = { jpeg: 'jpg', png: 'png', pdf: 'pdf' };
const MIME: Record<OutputType, string> = { jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };

async function encode(raw: RawImage, req: OutputRequest, type: OutputType, exif: ExifSubset | undefined, wMm: number, hMm: number, title: string) {
  const enc = { dpi: req.dpi, quality: req.quality, exif, includeGps: req.includeGps };
  if (type === 'png') return encodePng(raw, enc);
  const jpeg = await encodeJpeg(raw, enc);
  if (type === 'jpeg') return jpeg;
  return buildPdf([{ jpeg, wMm, hMm }], title);
}

/** Render every picture on its own (no sheet). */
export async function renderSingles(ctx: AppContext, user: SessionUser, req: OutputRequest, type: OutputType): Promise<RenderedFile[]> {
  const out: RenderedFile[] = [];
  const used = new Set<string>();
  for (const it of req.items) {
    const photo = await loadPhoto(ctx, user, it.source);
    const raw = await serialized(async () => renderFrame({ raw: photo.raw, format: it.format, orientation: it.orientation, edit: it.edit }, req.dpi));
    const mm = formatSizeMm(it.format, it.orientation);
    const tag = formatFileTag(it.format, it.orientation);
    let name = `${photo.baseName}_${tag}_${today()}`;
    for (let n = 2; used.has(name); n++) name = `${photo.baseName}_${tag}_${today()}_${n}`;
    used.add(name);
    const data = await encode(raw, req, type, photo.exif, mm.w, mm.h, name);
    out.push({
      name: `${name}.${EXT[type]}`,
      mime: MIME[type],
      data,
      takenAt: photo.takenAt,
      baseName: photo.baseName,
      label: `${it.format.name}`,
      warning: photo.warning,
    });
  }
  return out;
}

export function planSheet(req: OutputRequest): SheetLayout {
  const sheet = SHEETS.find((s) => s.id === req.sheet!.sheetId)!;
  const items: SheetItem[] = [];
  req.items.forEach((it, index) => {
    const mm = formatSizeMm(it.format, it.orientation);
    for (let c = 0; c < it.copies; c++) items.push({ index, w: mm.w, h: mm.h });
  });
  const layout = layoutSheet(sheet, items, { marginMm: req.sheet!.marginMm, gapMm: req.sheet!.gapMm, allowRotate: req.sheet!.allowRotate });
  if (layout.tooLarge.length) throw new HttpError(400, 'sheet.itemTooLarge');
  return layout;
}

/** Render sheet pages. Returns the JPEG (or PNG) of every page. */
export async function renderSheet(ctx: AppContext, user: SessionUser, req: OutputRequest, type: 'jpeg' | 'png') {
  const layout = planSheet(req);
  const photos = new Map<number, LoadedPhoto>();
  const load = async (index: number): Promise<FrameJob> => {
    let p = photos.get(index);
    if (!p) {
      photos.clear();
      p = await loadPhoto(ctx, user, req.items[index].source);
      photos.set(index, p);
    }
    const it = req.items[index];
    return { raw: p.raw, format: it.format, orientation: it.orientation, edit: it.edit };
  };
  const pages: Buffer[] = [];
  for (let i = 0; i < layout.pages.length; i++) {
    const raw = await serialized(() => renderSheetPage(layout, i, load, { dpi: req.dpi, cropMarks: req.sheet!.cropMarks }));
    const enc = { dpi: req.dpi, quality: req.quality };
    pages.push(type === 'png' ? await encodePng(raw, enc) : await encodeJpeg(raw, enc));
  }
  return { layout, pages };
}

export async function renderOutput(ctx: AppContext, user: SessionUser, req: OutputRequest): Promise<RenderedFile[]> {
  if (!req.sheet) {
    if (req.type === 'pdf' && req.items.length > 1) {
      // one PDF with a page per picture
      const files = await renderSingles(ctx, user, { ...req, type: 'jpeg' }, 'jpeg');
      const pdf = await buildPdf(
        files.map((f, i) => {
          const mm = formatSizeMm(req.items[i].format, req.items[i].orientation);
          return { jpeg: f.data, wMm: mm.w, hMm: mm.h };
        }),
        'Fotodruck',
      );
      return [{ name: `Fotodruck_${today()}.pdf`, mime: MIME.pdf, data: pdf, takenAt: null, baseName: 'Fotodruck', label: '', warning: null }];
    }
    return renderSingles(ctx, user, req, req.type);
  }
  const sheet = SHEETS.find((s) => s.id === req.sheet!.sheetId)!;
  const { layout, pages } = await renderSheet(ctx, user, req, req.type === 'png' ? 'png' : 'jpeg');
  const base = `Bogen_${sheet.id}_${today()}`;
  if (req.type === 'pdf') {
    const pdf = await buildPdf(pages.map((jpeg) => ({ jpeg, wMm: layout.sheetW, hMm: layout.sheetH })), base);
    return [{ name: `${base}.pdf`, mime: MIME.pdf, data: pdf, takenAt: null, baseName: base, label: sheet.name, warning: null }];
  }
  return pages.map((data, i) => ({
    name: pages.length > 1 ? `${base}_${i + 1}.${EXT[req.type]}` : `${base}.${EXT[req.type]}`,
    mime: MIME[req.type],
    data,
    takenAt: null,
    baseName: base,
    label: sheet.name,
    warning: null,
  }));
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function sendFiles(reply: FastifyReply, files: RenderedFile[]) {
  const warnings = [...new Set(files.map((f) => f.warning).filter(Boolean))];
  if (warnings.length) reply.header('x-fotodruck-warning', warnings.join(','));
  if (files.length === 1) {
    reply.header('content-type', files[0].mime);
    reply.header('content-disposition', contentDisposition(files[0].name));
    return reply.send(files[0].data);
  }
  const zip = new ZipArchive({ store: true });
  const stream = new PassThrough();
  zip.pipe(stream);
  for (const f of files) zip.append(f.data, { name: f.name });
  void zip.finalize();
  reply.header('content-type', 'application/zip');
  reply.header('content-disposition', contentDisposition(`Fotodruck_${today()}.zip`));
  return reply.send(stream);
}

async function findOrCreateAlbum(client: ImmichClient, name: string): Promise<string> {
  const albums = await client.albums();
  const norm = (s: string) => s.trim().toLocaleLowerCase('de');
  const hit = albums.find((a) => a.name === name) ?? albums.find((a) => norm(a.name) === norm(name));
  if (hit) return hit.id;
  return (await client.createAlbum(name)).id;
}

export function registerOutputRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/output/download', async (req, reply) => {
    const user = requireUser(req);
    const r = parseOutputRequest(req.body, ctx.config.defaultDpi);
    const files = await renderOutput(ctx, user, r);
    return sendFiles(reply, files);
  });

  app.post('/api/output/immich', async (req) => {
    const user = requireUser(req);
    const client = immichFor(ctx, user);
    const body = req.body as any;
    const r = parseOutputRequest({ ...body, type: 'jpeg' }, ctx.config.defaultDpi);
    const files = await renderOutput(ctx, user, r);

    // album: explicit id, a name (created on demand) or the user's default
    let albumId: string | null = null;
    // same defaults as GET /api/settings: "Druck" unless the user changed it
    const settings = { ...defaultPrefs(), ...getUserSetting<Partial<UserPrefs>>(ctx.db, user.id, 'prefs', {}) };
    const album = body?.album ?? { mode: 'default' };
    if (album.mode === 'id' && typeof album.id === 'string') albumId = album.id;
    else if (album.mode === 'name' && typeof album.name === 'string' && album.name.trim()) {
      albumId = await findOrCreateAlbum(client, album.name.trim().slice(0, 200));
    } else if (album.mode === 'default' && settings.immichAlbum) {
      albumId = await findOrCreateAlbum(client, String(settings.immichAlbum).slice(0, 200));
    }
    const describe = body?.description !== false;

    const results: { assetId: string; status: string; name: string; url: string | null }[] = [];
    let albumError: string | null = null;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const now = new Date().toISOString();
      const created = f.takenAt ? new Date(f.takenAt).toISOString() : now;
      const res = await client.upload({ data: f.data, filename: f.name, mime: f.mime, fileCreatedAt: created, fileModifiedAt: now });
      if (describe && !r.sheet) {
        const it = r.items[i];
        const tag = formatFileTag(it.format, it.orientation).replace(/x/, '×');
        await client.updateAsset(res.id, { description: `Druckversion ${tag} von ${f.baseName}` }).catch(() => undefined);
      }
      if (albumId) {
        // Immich answers 200 with a per-asset result; "duplicate" means it is already in the album
        const added = await client.addToAlbum(albumId, [res.id]).catch((err) => [{ success: false, error: (err as Error).message }]);
        const failed = (added as { success?: boolean; error?: string }[]).find((a) => !a.success && a.error !== 'duplicate');
        if (failed) {
          albumError = failed.error ?? 'unknown';
          req.log.warn({ albumId, error: failed.error }, 'adding to album failed');
        }
      }
      results.push({
        assetId: res.id,
        status: res.status,
        name: f.name,
        url: ctx.config.immichPublicUrl ? `${ctx.config.immichPublicUrl}/photos/${res.id}` : null,
      });
    }
    return { items: results, albumId, albumError };
  });

  /** Sheet planning for the preview in the browser. */
  app.post('/api/output/sheet-plan', async (req) => {
    requireUser(req);
    const r = parseOutputRequest(req.body, ctx.config.defaultDpi);
    if (!r.sheet) throw new HttpError(400, 'sheet.invalid');
    return planSheet(r);
  });
}
