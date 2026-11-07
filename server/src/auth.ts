// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { randomToken, sha256 } from './crypto.js';
import { getAppSetting, setAppSetting } from './db.js';
import { type AppContext, HttpError, requireAdmin, requireUser, type SessionUser } from './context.js';
import { ImmichClient, ImmichError, type ImmichCredential } from './immich.js';

export const SESSION_COOKIE = 'fd_session';
const SESSION_DAYS = 30;
const NONE_USER_ID = 'default';

// Argon2id (OWASP recommendation: m=19 MiB, t=2, p=1)
const ARGON = { algorithm: 2 as const, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(pw: string): Promise<string> {
  return argonHash(pw, ARGON);
}

export function verifyPassword(hash: string, pw: string): Promise<boolean> {
  return argonVerify(hash, pw).catch(() => false);
}

interface UserRow {
  id: string;
  kind: 'local' | 'immich' | 'none';
  email: string | null;
  name: string;
  password_hash: string | null;
  is_admin: number;
  immich_user_id: string | null;
  immich_cred: string | null;
  immich_cred_type: string | null;
}

/* ---------- login throttling (per IP, in memory) ---------- */
const failures = new Map<string, { count: number; until: number }>();
function checkThrottle(ip: string): void {
  const f = failures.get(ip);
  if (f && f.count >= 10 && f.until > Date.now()) throw new HttpError(429, 'auth.tooManyAttempts');
}
function recordFailure(ip: string): void {
  const f = failures.get(ip);
  const now = Date.now();
  if (!f || f.until < now) failures.set(ip, { count: 1, until: now + 15 * 60_000 });
  else f.count++;
}

function validPassword(pw: unknown): pw is string {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;
}
function validEmail(e: unknown): e is string {
  return typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+$/.test(e);
}

export function decryptCred(ctx: AppContext, enc: string | null, type: string | null): ImmichCredential | null {
  if (!enc || (type !== 'token' && type !== 'apikey')) return null;
  const value = ctx.box.decrypt(enc);
  return value ? { type, value } : null;
}

/** Resolve the session cookie into the current user (onRequest hook). */
export function loadUser(ctx: AppContext, req: FastifyRequest): SessionUser | null {
  if (ctx.config.authMode === 'none') {
    const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(NONE_USER_ID) as UserRow | undefined;
    if (!row) return null;
    return toSessionUser(ctx, row, null, null, null);
  }
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const sid = sha256(unsigned.value);
  const row = ctx.db
    .prepare(
      `SELECT u.*, s.id AS sid, s.immich_cred AS s_cred, s.immich_cred_type AS s_type, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(sid) as (UserRow & { sid: string; s_cred: string | null; s_type: string | null; expires_at: number }) | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    ctx.db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    return null;
  }
  return toSessionUser(ctx, row, row.sid, row.s_cred, row.s_type);
}

function toSessionUser(ctx: AppContext, row: UserRow, sid: string | null, sCred: string | null, sType: string | null): SessionUser {
  const cred = decryptCred(ctx, sCred, sType) ?? decryptCred(ctx, row.immich_cred, row.immich_cred_type);
  return {
    id: row.id,
    kind: row.kind,
    email: row.email,
    name: row.name,
    isAdmin: !!row.is_admin,
    immichUserId: row.immich_user_id,
    sessionId: sid,
    immichCred: cred,
  };
}

function startSession(ctx: AppContext, reply: FastifyReply, userId: string, cred: ImmichCredential | null): void {
  const token = randomToken();
  const now = Date.now();
  ctx.db
    .prepare('INSERT INTO sessions(id, user_id, immich_cred, immich_cred_type, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, cred ? ctx.box.encrypt(cred.value) : null, cred?.type ?? null, now, now + SESSION_DAYS * 86400_000);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    signed: true,
    maxAge: SESSION_DAYS * 86400,
  });
}

export function publicUser(u: SessionUser) {
  return {
    id: u.id,
    kind: u.kind,
    email: u.email,
    name: u.name,
    isAdmin: u.isAdmin,
    immichLinked: !!u.immichCred,
    immichUserId: u.immichUserId,
  };
}

/** AUTH_MODE=immich: create or update the user from the Immich profile and start a session. */
export function signInImmichUser(
  ctx: AppContext,
  reply: FastifyReply,
  cred: ImmichCredential,
  me: { id: string; email: string; name: string; isAdmin: boolean },
): void {
  const id = `immich:${me.id}`;
  ctx.db
    .prepare(
      `INSERT INTO users(id, kind, email, name, is_admin, immich_user_id, created_at) VALUES (?, 'immich', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, is_admin = excluded.is_admin`,
    )
    .run(id, me.email, me.name || me.email, me.isAdmin ? 1 : 0, me.id, Date.now());
  startSession(ctx, reply, id, cred);
}

/** Local or single-user account: store the Immich credential on the user. */
export function linkImmichAccount(ctx: AppContext, userId: string, cred: ImmichCredential, immichUserId: string): void {
  ctx.db
    .prepare('UPDATE users SET immich_cred = ?, immich_cred_type = ?, immich_user_id = ? WHERE id = ?')
    .run(ctx.box.encrypt(cred.value), cred.type, immichUserId, userId);
}

/** Log in to Immich with password or API key; returns the credential and Immich profile. */
async function immichAuthenticate(ctx: AppContext, body: any) {
  const base = ctx.config.immichUrl!;
  if (body?.method === 'apikey') {
    const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!key || key.length > 500) throw new HttpError(400, 'auth.apiKeyRequired');
    const cred: ImmichCredential = { type: 'apikey', value: key };
    const me = await new ImmichClient(base, cred).me();
    return { cred, me };
  }
  if (!validEmail(body?.email) || typeof body?.password !== 'string' || !body.password) {
    throw new HttpError(400, 'auth.credentialsRequired');
  }
  const login = await new ImmichClient(base, null).login(body.email, body.password);
  const cred: ImmichCredential = { type: 'token', value: login.accessToken };
  const me = await new ImmichClient(base, cred).me();
  return { cred, me };
}

function mapImmichLoginError(err: unknown): never {
  if (err instanceof ImmichError) {
    if (err.code === 'immich.unauthorized' || err.code === 'immich.badRequest') throw new HttpError(401, 'auth.invalidCredentials');
    if (err.code === 'immich.forbidden') throw new HttpError(403, 'immich.forbidden');
    throw new HttpError(502, err.code);
  }
  throw err;
}

export async function ensureInitialUsers(ctx: AppContext): Promise<void> {
  const { config, db } = ctx;
  if (config.authMode === 'none') {
    db.prepare(
      `INSERT INTO users(id, kind, email, name, is_admin, created_at) VALUES (?, 'none', NULL, ?, 1, ?) ON CONFLICT(id) DO NOTHING`,
    ).run(NONE_USER_ID, 'Benutzer', Date.now());
  }
  if (config.authMode === 'local' && config.adminEmail && config.adminPassword) {
    const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(config.adminEmail);
    if (!exists) {
      if (!validPassword(config.adminPassword)) throw new Error('ADMIN_PASSWORD must be at least 8 characters');
      db.prepare(
        `INSERT INTO users(id, kind, email, name, password_hash, is_admin, created_at) VALUES (?, 'local', ?, ?, ?, 1, ?)`,
      ).run(crypto.randomUUID(), config.adminEmail, config.adminEmail.split('@')[0], await hashPassword(config.adminPassword), Date.now());
    }
  }
}

export function setupRequired(ctx: AppContext): boolean {
  if (ctx.config.authMode !== 'local') return false;
  const n = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE kind = 'local'`).get() as { n: number }).n;
  return n === 0;
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  app.post('/api/setup', async (req, reply) => {
    if (!setupRequired(ctx)) throw new HttpError(409, 'setup.done');
    const b = req.body as any;
    if (!validEmail(b?.email)) throw new HttpError(400, 'auth.invalidEmail');
    if (!validPassword(b?.password)) throw new HttpError(400, 'auth.weakPassword');
    const id = crypto.randomUUID();
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : b.email.split('@')[0];
    // the transaction guards against two concurrent setup requests
    const created = db.transaction((hash: string) => {
      if (!setupRequired(ctx)) return false;
      db.prepare(
        `INSERT INTO users(id, kind, email, name, password_hash, is_admin, created_at) VALUES (?, 'local', ?, ?, ?, 1, ?)`,
      ).run(id, b.email, name, hash, Date.now());
      return true;
    })(await hashPassword(b.password));
    if (!created) throw new HttpError(409, 'setup.done');
    startSession(ctx, reply, id, null);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (config.authMode === 'none') throw new HttpError(400, 'auth.disabled');
    checkThrottle(req.ip);
    const b = req.body as any;
    if (config.authMode === 'local') {
      if (typeof b?.email !== 'string' || typeof b?.password !== 'string') throw new HttpError(400, 'auth.credentialsRequired');
      const row = db.prepare(`SELECT * FROM users WHERE email = ? AND kind = 'local'`).get(b.email) as UserRow | undefined;
      const ok = row?.password_hash ? await verifyPassword(row.password_hash, b.password) : false;
      if (!row || !ok) {
        recordFailure(req.ip);
        throw new HttpError(401, 'auth.invalidCredentials');
      }
      startSession(ctx, reply, row.id, null);
      return { ok: true };
    }
    // AUTH_MODE=immich
    let result;
    try {
      result = await immichAuthenticate(ctx, b);
    } catch (err) {
      if (err instanceof ImmichError && (err.code === 'immich.unauthorized' || err.code === 'immich.badRequest')) recordFailure(req.ip);
      mapImmichLoginError(err);
    }
    signInImmichUser(ctx, reply, result.cred, result.me);
    return { ok: true };
  });

  app.post('/api/auth/register', async (req, reply) => {
    if (config.authMode !== 'local' || !getAppSetting(db, 'allowRegistration', false)) throw new HttpError(403, 'auth.registrationClosed');
    checkThrottle(req.ip);
    const b = req.body as any;
    if (!validEmail(b?.email)) throw new HttpError(400, 'auth.invalidEmail');
    if (!validPassword(b?.password)) throw new HttpError(400, 'auth.weakPassword');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email)) {
      recordFailure(req.ip);
      throw new HttpError(409, 'auth.emailTaken');
    }
    const id = crypto.randomUUID();
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : b.email.split('@')[0];
    db.prepare(
      `INSERT INTO users(id, kind, email, name, password_hash, is_admin, created_at) VALUES (?, 'local', ?, ?, ?, 0, ?)`,
    ).run(id, b.email, name, await hashPassword(b.password), Date.now());
    startSession(ctx, reply, id, null);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const u = req.user;
    if (u?.sessionId) {
      if (u.kind === 'immich' && u.immichCred?.type === 'token' && config.immichUrl) {
        await new ImmichClient(config.immichUrl, u.immichCred).logout().catch(() => undefined);
      }
      db.prepare('DELETE FROM sessions WHERE id = ?').run(u.sessionId);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const u = requireUser(req);
    return publicUser(u);
  });

  app.get('/api/auth/avatar', async (req, reply) => {
    const u = requireUser(req);
    if (!config.immichUrl || !u.immichCred) throw new HttpError(404, 'notFound');
    const client = new ImmichClient(config.immichUrl, u.immichCred);
    let id = u.immichUserId;
    if (!id) id = (await client.me()).id;
    try {
      const res = await client.profileImage(id);
      reply.header('content-type', res.headers.get('content-type') ?? 'image/jpeg');
      reply.header('cache-control', 'private, max-age=3600');
      return reply.send(Buffer.from(await res.arrayBuffer()));
    } catch {
      throw new HttpError(404, 'notFound');
    }
  });

  /* ---- own account ---- */
  app.post('/api/account/password', async (req) => {
    const u = requireUser(req);
    if (u.kind !== 'local') throw new HttpError(400, 'auth.notLocal');
    const b = req.body as any;
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(u.id) as { password_hash: string };
    if (typeof b?.current !== 'string' || !(await verifyPassword(row.password_hash, b.current))) {
      throw new HttpError(401, 'auth.invalidCredentials');
    }
    if (!validPassword(b?.password)) throw new HttpError(400, 'auth.weakPassword');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(b.password), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(u.id, u.sessionId);
    return { ok: true };
  });

  /** Link an Immich account to a local (or single-user) account. */
  app.post('/api/account/immich', async (req) => {
    const u = requireUser(req);
    if (!config.immichUrl) throw new HttpError(404, 'immich.notConfigured');
    if (u.kind === 'immich') throw new HttpError(400, 'immich.alreadyImmichLogin');
    let result;
    try {
      result = await immichAuthenticate(ctx, req.body);
    } catch (err) {
      mapImmichLoginError(err);
    }
    linkImmichAccount(ctx, u.id, result.cred, result.me.id);
    return { ok: true, immichName: result.me.name, immichEmail: result.me.email };
  });

  app.delete('/api/account/immich', async (req) => {
    const u = requireUser(req);
    if (u.kind === 'immich') throw new HttpError(400, 'immich.alreadyImmichLogin');
    const row = db.prepare('SELECT immich_cred, immich_cred_type FROM users WHERE id = ?').get(u.id) as UserRow;
    const cred = decryptCred(ctx, row.immich_cred, row.immich_cred_type);
    if (cred?.type === 'token' && config.immichUrl) {
      await new ImmichClient(config.immichUrl, cred).logout().catch(() => undefined);
    }
    db.prepare('UPDATE users SET immich_cred = NULL, immich_cred_type = NULL, immich_user_id = NULL WHERE id = ?').run(u.id);
    return { ok: true };
  });

  /* ---- administration (local mode) ---- */
  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    return db
      .prepare('SELECT id, kind, email, name, is_admin AS isAdmin, created_at AS createdAt FROM users ORDER BY created_at')
      .all()
      .map((r: any) => ({ ...r, isAdmin: !!r.isAdmin }));
  });

  app.post('/api/admin/users', async (req) => {
    requireAdmin(req);
    if (config.authMode !== 'local') throw new HttpError(400, 'auth.notLocal');
    const b = req.body as any;
    if (!validEmail(b?.email)) throw new HttpError(400, 'auth.invalidEmail');
    if (!validPassword(b?.password)) throw new HttpError(400, 'auth.weakPassword');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email)) throw new HttpError(409, 'auth.emailTaken');
    const id = crypto.randomUUID();
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 80) : b.email.split('@')[0];
    db.prepare(
      `INSERT INTO users(id, kind, email, name, password_hash, is_admin, created_at) VALUES (?, 'local', ?, ?, ?, ?, ?)`,
    ).run(id, b.email, name, await hashPassword(b.password), b.isAdmin ? 1 : 0, Date.now());
    return { id };
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    const b = req.body as any;
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!row) throw new HttpError(404, 'notFound');
    if (b?.password !== undefined) {
      if (row.kind !== 'local') throw new HttpError(400, 'auth.notLocal');
      if (!validPassword(b.password)) throw new HttpError(400, 'auth.weakPassword');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(b.password), id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    if (typeof b?.isAdmin === 'boolean' && row.kind === 'local') {
      if (id === admin.id && !b.isAdmin) throw new HttpError(400, 'auth.cannotDemoteSelf');
      db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(b.isAdmin ? 1 : 0, id);
    }
    return { ok: true };
  });

  app.delete('/api/admin/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const { id } = req.params as { id: string };
    if (id === admin.id) throw new HttpError(400, 'auth.cannotDeleteSelf');
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { ok: true };
  });

  app.get('/api/admin/settings', async (req) => {
    requireAdmin(req);
    return {
      allowRegistration: getAppSetting(db, 'allowRegistration', false),
      visiblePrinters: getAppSetting<string[] | null>(db, 'visiblePrinters', null),
    };
  });

  app.put('/api/admin/settings', async (req) => {
    requireAdmin(req);
    const b = req.body as any;
    if (typeof b?.allowRegistration === 'boolean') setAppSetting(db, 'allowRegistration', b.allowRegistration);
    if (b?.visiblePrinters === null || (Array.isArray(b?.visiblePrinters) && b.visiblePrinters.every((x: unknown) => typeof x === 'string'))) {
      setAppSetting(db, 'visiblePrinters', b.visiblePrinters);
    }
    return { ok: true };
  });
}
