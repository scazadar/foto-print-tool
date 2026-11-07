// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import type { FastifyInstance, FastifyReply } from 'fastify';
import { type AppContext, HttpError, immichFor, requireUser } from './context.js';
import { ImmichClient, MIN_IMMICH_VERSION, versionAtLeast } from './immich.js';
import type { ExifSubset } from './images.js';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function assertUuid(id: unknown): string {
  if (typeof id !== 'string' || !UUID.test(id)) throw new HttpError(400, 'invalidId');
  return id;
}

function nextParam(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  if (!/^(c:[A-Za-z0-9_\-=+/.:]{1,500}|p:\d{1,6})$/.test(v)) throw new HttpError(400, 'invalidCursor');
  return v;
}

function isoDate(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new HttpError(400, 'invalidDate');
  return d.toISOString();
}

export interface ServerVersionInfo {
  reachable: boolean;
  version: string | null;
  tooOld: boolean;
}

let versionCache: { at: number; info: ServerVersionInfo } | null = null;

export async function immichServerInfo(ctx: AppContext, force = false): Promise<ServerVersionInfo> {
  if (!ctx.config.immichUrl) return { reachable: false, version: null, tooOld: false };
  if (!force && versionCache && Date.now() - versionCache.at < 60_000) return versionCache.info;
  const client = new ImmichClient(ctx.config.immichUrl, null);
  let info: ServerVersionInfo;
  try {
    await client.ping();
    const v = await client.version();
    info = { reachable: true, version: `${v.major}.${v.minor}.${v.patch}`, tooOld: !versionAtLeast(v) };
  } catch {
    info = { reachable: false, version: null, tooOld: false };
  }
  versionCache = { at: Date.now(), info };
  return info;
}

const ORIENT_SWAP = new Set(['5', '6', '7', '8']);

/** Oriented size of the original. Immich stores the raw EXIF size plus the orientation tag. */
export function orientedAssetSize(a: any): { width: number | null; height: number | null } {
  const ew = a.exifInfo?.exifImageWidth ?? null;
  const eh = a.exifInfo?.exifImageHeight ?? null;
  if (ew && eh) {
    const swap = ORIENT_SWAP.has(String(a.exifInfo?.orientation ?? ''));
    return swap ? { width: eh, height: ew } : { width: ew, height: eh };
  }
  return { width: a.width ?? null, height: a.height ?? null };
}

export function exifFromAsset(a: any): ExifSubset {
  const e = a.exifInfo ?? {};
  const out: ExifSubset = {};
  if (e.make) out.make = e.make;
  if (e.model) out.model = e.model;
  if (e.lensModel) out.lens = e.lensModel;
  if (e.dateTimeOriginal) out.dateTimeOriginal = new Date(e.dateTimeOriginal).toISOString();
  if (typeof e.latitude === 'number' && typeof e.longitude === 'number') {
    out.latitude = e.latitude;
    out.longitude = e.longitude;
  }
  return out;
}

async function pipeImage(reply: FastifyReply, res: Response): Promise<FastifyReply> {
  reply.header('content-type', res.headers.get('content-type') ?? 'image/jpeg');
  reply.header('cache-control', 'private, max-age=86400');
  return reply.send(Buffer.from(await res.arrayBuffer()));
}

export function registerImmichRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/immich/status', async (req) => {
    const user = requireUser(req);
    const info = await immichServerInfo(ctx);
    let account: { name: string; email: string } | null = null;
    let credentialValid = false;
    if (info.reachable && user.immichCred) {
      try {
        const me = await new ImmichClient(ctx.config.immichUrl!, user.immichCred).me();
        account = { name: me.name, email: me.email };
        credentialValid = true;
      } catch {
        credentialValid = false;
      }
    }
    return {
      configured: !!ctx.config.immichUrl,
      ...info,
      minVersion: `${MIN_IMMICH_VERSION.major}.${MIN_IMMICH_VERSION.minor}.${MIN_IMMICH_VERSION.patch}`,
      linked: !!user.immichCred,
      credentialValid,
      account,
      publicUrl: ctx.config.immichPublicUrl,
    };
  });

  app.get('/api/immich/albums', async (req) => {
    const client = immichFor(ctx, requireUser(req));
    return { items: await client.albums() };
  });

  app.get('/api/immich/albums/:id/assets', async (req) => {
    const client = immichFor(ctx, requireUser(req));
    const id = assertUuid((req.params as any).id);
    const q = req.query as any;
    // GET /albums/{id} no longer embeds the assets in current versions: search by album instead
    return client.search('metadata', { albumIds: [id] }, nextParam(q.next));
  });

  app.get('/api/immich/timeline', async (req) => {
    const client = immichFor(ctx, requireUser(req));
    return client.search('metadata', {}, nextParam((req.query as any).next));
  });

  app.post('/api/immich/search', async (req) => {
    const client = immichFor(ctx, requireUser(req));
    const b = (req.body ?? {}) as any;
    const filter: Record<string, unknown> = {};
    const after = isoDate(b.takenAfter);
    const before = isoDate(b.takenBefore);
    if (after) filter.takenAfter = after;
    if (before) filter.takenBefore = before;
    if (typeof b.city === 'string' && b.city.trim()) filter.city = b.city.trim().slice(0, 100);
    if (typeof b.country === 'string' && b.country.trim()) filter.country = b.country.trim().slice(0, 100);
    if (Array.isArray(b.personIds) && b.personIds.length) filter.personIds = b.personIds.slice(0, 10).map(assertUuid);
    if (typeof b.albumId === 'string' && b.albumId) filter.albumIds = [assertUuid(b.albumId)];
    const query = typeof b.query === 'string' ? b.query.trim().slice(0, 300) : '';
    if (query) return client.search('smart', { ...filter, query }, nextParam(b.next));
    return client.search('metadata', filter, nextParam(b.next));
  });

  app.get('/api/immich/people', async (req) => {
    const client = immichFor(ctx, requireUser(req));
    const res = await client.people();
    return {
      items: (res.people ?? [])
        .filter((p: any) => p.name)
        .map((p: any) => ({ id: p.id, name: p.name })),
    };
  });

  app.get('/api/immich/people/:id/thumb', async (req, reply) => {
    const client = immichFor(ctx, requireUser(req));
    return pipeImage(reply, await client.personThumbnail(assertUuid((req.params as any).id)));
  });

  app.get('/api/immich/assets/:id', async (req) => {
    const client = immichFor(ctx, requireUser(req));
    const id = assertUuid((req.params as any).id);
    const a = await client.asset(id);
    const size = orientedAssetSize(a);
    let faces: { x1: number; y1: number; x2: number; y2: number; name: string | null }[] = [];
    try {
      const raw = await client.faces(id);
      faces = (raw ?? [])
        .filter((f: any) => f.imageWidth > 0 && f.imageHeight > 0)
        .map((f: any) => ({
          x1: f.boundingBoxX1 / f.imageWidth,
          y1: f.boundingBoxY1 / f.imageHeight,
          x2: f.boundingBoxX2 / f.imageWidth,
          y2: f.boundingBoxY2 / f.imageHeight,
          name: f.person?.name || null,
        }));
    } catch {
      faces = [];
    }
    return {
      id: a.id,
      name: a.originalFileName,
      mime: a.originalMimeType ?? null,
      width: size.width,
      height: size.height,
      takenAt: a.exifInfo?.dateTimeOriginal ?? a.localDateTime ?? a.fileCreatedAt ?? null,
      fileCreatedAt: a.fileCreatedAt,
      type: a.type,
      faces,
      url: ctx.config.immichPublicUrl ? `${ctx.config.immichPublicUrl}/photos/${a.id}` : null,
    };
  });

  app.get('/api/immich/assets/:id/thumb', async (req, reply) => {
    const client = immichFor(ctx, requireUser(req));
    const id = assertUuid((req.params as any).id);
    const size = (req.query as any).size === 'preview' ? 'preview' : 'thumbnail';
    return pipeImage(reply, await client.thumbnail(id, size));
  });
}
