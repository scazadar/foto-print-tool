// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { BUILTIN_FORMATS, type PhotoFormat, validateFormat } from '../../shared/formats.js';
import { type AppContext, HttpError, requireUser } from './context.js';
import { getUserSetting, setUserSetting } from './db.js';

export interface UserPrefs {
  immichAlbum: string;
  fitMode: 'fill' | 'fit' | 'border';
  jpegQuality: number;
  includeGps: boolean;
  units: 'cm' | 'in';
  dpi: number | null;
  printer: { id: string | null; media: string | null; mediaType: string | null; mediaSource: string | null; borderless: boolean };
}

export function defaultPrefs(): UserPrefs {
  return {
    immichAlbum: 'Druck',
    fitMode: 'fill',
    jpegQuality: 92,
    includeGps: false,
    units: 'cm',
    dpi: null,
    printer: { id: null, media: null, mediaType: null, mediaSource: null, borderless: false },
  };
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.slice(0, max) : null);

export function mergePrefs(cur: UserPrefs, b: any): UserPrefs {
  const out: UserPrefs = { ...cur, printer: { ...cur.printer } };
  if (typeof b?.immichAlbum === 'string') out.immichAlbum = b.immichAlbum.trim().slice(0, 200);
  if (['fill', 'fit', 'border'].includes(b?.fitMode)) out.fitMode = b.fitMode;
  if (Number.isFinite(b?.jpegQuality)) out.jpegQuality = Math.max(50, Math.min(100, Math.round(b.jpegQuality)));
  if (typeof b?.includeGps === 'boolean') out.includeGps = b.includeGps;
  if (b?.units === 'cm' || b?.units === 'in') out.units = b.units;
  if (b?.dpi === null) out.dpi = null;
  else if (Number.isFinite(b?.dpi)) out.dpi = Math.max(72, Math.min(1200, Math.round(b.dpi)));
  if (b?.printer && typeof b.printer === 'object') {
    const p = b.printer;
    if ('id' in p) out.printer.id = str(p.id, 500);
    if ('media' in p) out.printer.media = str(p.media, 200);
    if ('mediaType' in p) out.printer.mediaType = str(p.mediaType, 200);
    if ('mediaSource' in p) out.printer.mediaSource = str(p.mediaSource, 200);
    if (typeof p.borderless === 'boolean') out.printer.borderless = p.borderless;
  }
  return out;
}

interface FormatRow {
  id: string;
  name: string;
  width: number;
  height: number;
  unit: 'cm' | 'mm' | 'in';
}

function listCustom(ctx: AppContext, userId: string): PhotoFormat[] {
  const rows = ctx.db.prepare('SELECT * FROM custom_formats WHERE user_id = ? ORDER BY created_at').all(userId) as FormatRow[];
  return rows.map((r) => ({ id: r.id, name: r.name, width: r.width, height: r.height, unit: r.unit, group: 'custom', custom: true }));
}

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/settings', async (req) => {
    const u = requireUser(req);
    return { ...defaultPrefs(), ...getUserSetting<Partial<UserPrefs>>(ctx.db, u.id, 'prefs', {}) };
  });

  app.put('/api/settings', async (req) => {
    const u = requireUser(req);
    const cur = { ...defaultPrefs(), ...getUserSetting<Partial<UserPrefs>>(ctx.db, u.id, 'prefs', {}) };
    const next = mergePrefs(cur as UserPrefs, req.body);
    setUserSetting(ctx.db, u.id, 'prefs', next);
    return next;
  });

  app.get('/api/formats', async (req) => {
    const u = requireUser(req);
    return {
      builtin: BUILTIN_FORMATS,
      custom: listCustom(ctx, u.id),
      hidden: getUserSetting<string[]>(ctx.db, u.id, 'hiddenFormats', []),
      recent: getUserSetting<string[]>(ctx.db, u.id, 'recentFormats', []),
    };
  });

  app.post('/api/formats', async (req) => {
    const u = requireUser(req);
    const b = req.body as any;
    const f = { name: typeof b?.name === 'string' ? b.name.trim() : '', width: Number(b?.width), height: Number(b?.height), unit: b?.unit };
    const err = validateFormat(f);
    if (err) throw new HttpError(400, err);
    const count = (ctx.db.prepare('SELECT COUNT(*) AS n FROM custom_formats WHERE user_id = ?').get(u.id) as { n: number }).n;
    if (count >= 100) throw new HttpError(400, 'format.tooMany');
    const id = `custom-${crypto.randomUUID()}`;
    ctx.db
      .prepare('INSERT INTO custom_formats(id, user_id, name, width, height, unit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, u.id, f.name, f.width, f.height, f.unit, Date.now());
    return { id, ...f, group: 'custom', custom: true };
  });

  app.put('/api/formats/:id', async (req) => {
    const u = requireUser(req);
    const { id } = req.params as { id: string };
    const b = req.body as any;
    const f = { name: typeof b?.name === 'string' ? b.name.trim() : '', width: Number(b?.width), height: Number(b?.height), unit: b?.unit };
    const err = validateFormat(f);
    if (err) throw new HttpError(400, err);
    const res = ctx.db
      .prepare('UPDATE custom_formats SET name = ?, width = ?, height = ?, unit = ? WHERE id = ? AND user_id = ?')
      .run(f.name, f.width, f.height, f.unit, id, u.id);
    if (res.changes === 0) throw new HttpError(404, 'notFound');
    return { id, ...f, group: 'custom', custom: true };
  });

  app.delete('/api/formats/:id', async (req) => {
    const u = requireUser(req);
    ctx.db.prepare('DELETE FROM custom_formats WHERE id = ? AND user_id = ?').run((req.params as any).id, u.id);
    return { ok: true };
  });

  app.put('/api/formats/hidden', async (req) => {
    const u = requireUser(req);
    const ids = (req.body as any)?.ids;
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) throw new HttpError(400, 'invalid');
    const valid = new Set(BUILTIN_FORMATS.map((f) => f.id));
    setUserSetting(ctx.db, u.id, 'hiddenFormats', ids.filter((x: string) => valid.has(x)));
    return { ok: true };
  });

  app.post('/api/formats/recent', async (req) => {
    const u = requireUser(req);
    const id = (req.body as any)?.id;
    if (typeof id !== 'string' || id.length > 100) throw new HttpError(400, 'invalid');
    const recent = getUserSetting<string[]>(ctx.db, u.id, 'recentFormats', []).filter((x) => x !== id);
    recent.unshift(id);
    setUserSetting(ctx.db, u.id, 'recentFormats', recent.slice(0, 5));
    return { ok: true };
  });
}
