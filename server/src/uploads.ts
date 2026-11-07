// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { type AppContext, HttpError, requireUser } from './context.js';
import { decodeOriented, detectFormat, type ExifSubset, readExif, type RawImage } from './images.js';
import { uploadDir, uploadsDir } from './storage.js';

export interface UploadRow {
  id: string;
  user_id: string;
  original_name: string;
  format: string;
  width: number;
  height: number;
  size: number;
  exif: string | null;
  taken_at: string | null;
  warning: string | null;
  created_at: number;
}

export function publicUpload(r: UploadRow) {
  return {
    id: r.id,
    name: r.original_name,
    format: r.format,
    width: r.width,
    height: r.height,
    size: r.size,
    takenAt: r.taken_at,
    warning: r.warning,
    createdAt: r.created_at,
  };
}

export function getUpload(ctx: AppContext, userId: string, id: string): UploadRow {
  const row = ctx.db.prepare('SELECT * FROM uploads WHERE id = ? AND user_id = ?').get(id, userId) as UploadRow | undefined;
  if (!row) throw new HttpError(404, 'upload.notFound');
  return row;
}

/** Stored master file of an upload (re-encoded, EXIF orientation applied). */
export async function uploadMasterPath(ctx: AppContext, row: UploadRow): Promise<string> {
  const dir = uploadDir(ctx, row.user_id, row.id);
  for (const f of ['original.png', 'original.jpg']) {
    const p = path.join(dir, f);
    if (await fs.stat(p).catch(() => null)) return p;
  }
  throw new HttpError(404, 'upload.notFound');
}

function safeName(name: string): string {
  const base = path.basename(name || 'foto').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 120);
  return base || 'foto';
}

/** Re-encode so that no foreign data (scripts, polyglots, odd metadata) is passed on. */
async function storeImage(dir: string, raw: RawImage, lossless: boolean): Promise<void> {
  const input = () =>
    sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } }).flatten({ background: '#ffffff' });
  await fs.mkdir(dir, { recursive: true });
  if (lossless) await input().png({ compressionLevel: 6 }).toFile(path.join(dir, 'original.png'));
  else await input().jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(path.join(dir, 'original.jpg'));
  await input().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(path.join(dir, 'preview.jpg'));
  await input().resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(path.join(dir, 'thumb.jpg'));
}

export async function processUpload(ctx: AppContext, userId: string, name: string, buf: Buffer) {
  const format = await detectFormat(buf);
  const exif: ExifSubset = format === 'heic' ? {} : await readExif(buf);
  const raw = await decodeOriented(buf);
  const id = crypto.randomUUID();
  const dir = uploadDir(ctx, userId, id);
  try {
    await storeImage(dir, raw, format === 'png' || format === 'tiff' || format === 'gif');
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
  const row: UploadRow = {
    id,
    user_id: userId,
    original_name: safeName(name),
    format,
    width: raw.width,
    height: raw.height,
    size: buf.length,
    exif: JSON.stringify(exif),
    taken_at: exif.dateTimeOriginal ?? null,
    warning: null,
    created_at: Date.now(),
  };
  ctx.db
    .prepare(
      `INSERT INTO uploads(id, user_id, original_name, format, width, height, size, exif, taken_at, warning, created_at)
       VALUES (@id, @user_id, @original_name, @format, @width, @height, @size, @exif, @taken_at, @warning, @created_at)`,
    )
    .run(row);
  return publicUpload(row);
}

export function registerUploadRoutes(app: FastifyInstance, ctx: AppContext): void {
  const maxBytes = ctx.config.uploadMaxMb * 1024 * 1024;

  app.post('/api/uploads', async (req) => {
    const user = requireUser(req);
    const file = await req.file({ limits: { fileSize: maxBytes, files: 1 } });
    if (!file) throw new HttpError(400, 'upload.noFile');
    let buf: Buffer;
    try {
      buf = await file.toBuffer();
    } catch (err: any) {
      if (err?.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, 'upload.tooLarge', { maxMb: ctx.config.uploadMaxMb });
      throw err;
    }
    if (file.file.truncated) throw new HttpError(413, 'upload.tooLarge', { maxMb: ctx.config.uploadMaxMb });
    if (buf.length === 0) throw new HttpError(400, 'upload.noFile');
    return processUpload(ctx, user.id, file.filename, buf);
  });

  app.get('/api/uploads', async (req) => {
    const user = requireUser(req);
    const rows = ctx.db.prepare('SELECT * FROM uploads WHERE user_id = ? ORDER BY created_at DESC').all(user.id) as UploadRow[];
    return {
      items: rows.map(publicUpload),
      retentionDays: ctx.config.uploadRetentionDays,
    };
  });

  app.get('/api/uploads/:id', async (req) => {
    const user = requireUser(req);
    return publicUpload(getUpload(ctx, user.id, (req.params as any).id));
  });

  for (const kind of ['thumb', 'preview'] as const) {
    app.get(`/api/uploads/:id/${kind}`, async (req, reply) => {
      const user = requireUser(req);
      const row = getUpload(ctx, user.id, (req.params as any).id);
      const p = path.join(uploadDir(ctx, user.id, row.id), `${kind}.jpg`);
      const data = await fs.readFile(p).catch(() => null);
      if (!data) throw new HttpError(404, 'upload.notFound');
      reply.header('content-type', 'image/jpeg');
      reply.header('cache-control', 'private, max-age=86400, immutable');
      return reply.send(data);
    });
  }

  app.delete('/api/uploads/:id', async (req) => {
    const user = requireUser(req);
    const row = getUpload(ctx, user.id, (req.params as any).id);
    await fs.rm(uploadDir(ctx, user.id, row.id), { recursive: true, force: true });
    ctx.db.prepare('DELETE FROM uploads WHERE id = ? AND user_id = ?').run(row.id, user.id);
    return { ok: true };
  });

  app.delete('/api/uploads', async (req) => {
    const user = requireUser(req);
    await fs.rm(uploadsDir(ctx, user.id), { recursive: true, force: true });
    ctx.db.prepare('DELETE FROM uploads WHERE user_id = ?').run(user.id);
    return { ok: true };
  });
}
