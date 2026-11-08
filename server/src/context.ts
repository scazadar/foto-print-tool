// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { SecretBox } from './crypto.js';
import type { DB } from './db.js';
import { ImmichClient, ImmichError, type ImmichCredential } from './immich.js';

export interface AppContext {
  config: Config;
  db: DB;
  box: SecretBox;
}

export interface SessionUser {
  id: string;
  kind: 'local' | 'immich' | 'none' | 'guest';
  email: string | null;
  name: string;
  isAdmin: boolean;
  immichUserId: string | null;
  sessionId: string | null;
  immichCred: ImmichCredential | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, 'auth.required');
  return req.user;
}

export function requireAdmin(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (!u.isAdmin) throw new HttpError(403, 'auth.adminOnly');
  return u;
}

/** Guests may only upload, edit, download and print in the browser. */
export function requireNotGuest(user: SessionUser): void {
  if (user.kind === 'guest') throw new HttpError(403, 'auth.guestNotAllowed');
}

export function immichFor(ctx: AppContext, user: SessionUser): ImmichClient {
  requireNotGuest(user);
  if (!ctx.config.immichUrl) throw new HttpError(404, 'immich.notConfigured');
  if (!user.immichCred) throw new HttpError(409, 'immich.notLinked');
  return new ImmichClient(ctx.config.immichUrl, user.immichCred);
}

/** Map Immich errors to API errors. Expired credentials end the session in AUTH_MODE=immich. */
export function handleImmichError(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, err: ImmichError): void {
  const user = req.user;
  if (err.code === 'immich.unauthorized' && user) {
    if (user.kind === 'immich' && user.sessionId) {
      ctx.db.prepare('DELETE FROM sessions WHERE id = ?').run(user.sessionId);
      reply.clearCookie('fd_session', { path: '/' });
      reply.status(401).send({ error: 'immich.sessionExpired' });
      return;
    }
    reply.status(409).send({ error: 'immich.credentialInvalid' });
    return;
  }
  const status = err.code === 'immich.unreachable' ? 502 : err.status >= 500 ? 502 : err.status;
  req.log.warn({ code: err.code, status: err.status, detail: err.message }, 'immich request failed');
  reply.status(status).send({ error: err.code });
}
