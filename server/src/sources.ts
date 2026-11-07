// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/**
 * Photo sources behind one interface. Upload and Immich are built in; further
 * sources (WebDAV, a folder in the container, …) can implement PhotoSource.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { type AppContext, HttpError, immichFor, type SessionUser } from './context.js';
import { exifFromAsset } from './immich-routes.js';
import { decodeOriented, type ExifSubset, type RawImage } from './images.js';
import { cacheDir } from './storage.js';
import { getUpload, type UploadRow, uploadMasterPath } from './uploads.js';

export interface SourceRef {
  kind: 'upload' | 'immich';
  id: string;
}

export interface LoadedPhoto {
  raw: RawImage;
  /** file name without extension */
  baseName: string;
  exif: ExifSubset;
  /** ISO date of the capture (for the Immich timeline) */
  takenAt: string | null;
  warning: string | null;
}

export interface PhotoSource {
  kind: SourceRef['kind'];
  /** full resolution, oriented original */
  loadOriginal(ctx: AppContext, user: SessionUser, id: string): Promise<LoadedPhoto>;
}

function baseName(name: string): string {
  return path.basename(name).replace(/\.[^.]+$/, '') || 'foto';
}

const uploadSource: PhotoSource = {
  kind: 'upload',
  async loadOriginal(ctx, user, id) {
    const row: UploadRow = getUpload(ctx, user.id, id);
    const buf = await fs.readFile(await uploadMasterPath(ctx, row));
    const raw = await decodeOriented(buf);
    return {
      raw,
      baseName: baseName(row.original_name),
      exif: row.exif ? JSON.parse(row.exif) : {},
      takenAt: row.taken_at,
      warning: row.warning,
    };
  },
};

const immichSource: PhotoSource = {
  kind: 'immich',
  async loadOriginal(ctx, user, id) {
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw new HttpError(400, 'invalidId');
    const client = immichFor(ctx, user);
    const asset = await client.asset(id);
    if (asset.type !== 'IMAGE') throw new HttpError(400, 'source.notAnImage');
    const dir = cacheDir(ctx, user.id);
    await fs.mkdir(dir, { recursive: true });
    const cached = path.join(dir, `${id}.orig`);
    let buf = await fs.readFile(cached).catch(() => null);
    if (!buf) {
      const res = await client.original(id);
      buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(cached, buf);
    }
    // the cleanup removes cached originals 24 h after the download, also while in use
    let raw: RawImage;
    let warning: string | null = null;
    try {
      raw = await decodeOriented(buf);
    } catch {
      // e.g. RAW files: fall back to the large preview Immich generated
      const res = await client.thumbnail(id, 'fullsize').catch(() => client.thumbnail(id, 'preview'));
      raw = await decodeOriented(Buffer.from(await res.arrayBuffer()));
      warning = 'source.lowResolution';
    }
    const exif = exifFromAsset(asset);
    return {
      raw,
      baseName: baseName(asset.originalFileName ?? id),
      exif,
      takenAt: exif.dateTimeOriginal ?? asset.fileCreatedAt ?? null,
      warning,
    };
  },
};

const SOURCES: Record<SourceRef['kind'], PhotoSource> = { upload: uploadSource, immich: immichSource };

export function parseSourceRef(v: unknown): SourceRef {
  const s = v as SourceRef;
  if (!s || (s.kind !== 'upload' && s.kind !== 'immich') || typeof s.id !== 'string') throw new HttpError(400, 'source.invalid');
  return { kind: s.kind, id: s.id };
}

export function loadPhoto(ctx: AppContext, user: SessionUser, ref: SourceRef): Promise<LoadedPhoto> {
  return SOURCES[ref.kind].loadOriginal(ctx, user, ref.id);
}
