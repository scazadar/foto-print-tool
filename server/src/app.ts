// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { ensureInitialUsers, loadUser, registerAuthRoutes, setupRequired } from './auth.js';
import type { Config } from './config.js';
import { type AppContext, handleImmichError, HttpError } from './context.js';
import { SecretBox } from './crypto.js';
import { type DB, getAppSetting } from './db.js';
import { ImmichError, TESTED_IMMICH_API } from './immich.js';
import { registerImmichRoutes } from './immich-routes.js';
import { registerOutputRoutes } from './output.js';
import { registerPrintRoutes } from './print.js';
import { registerSettingsRoutes } from './settings.js';
import { registerUploadRoutes } from './uploads.js';

export const CSRF_HEADER = 'x-fotodruck';

export async function buildApp(config: Config, db: DB, opts: { logger?: boolean } = {}): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const ctx: AppContext = { config, db, box: new SecretBox(config.sessionSecret) };
  await ensureInitialUsers(ctx);

  const app = Fastify({
    logger: opts.logger === false ? false : { level: process.env.LOG_LEVEL || 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(multipart, { limits: { fileSize: config.uploadMaxMb * 1024 * 1024, files: 1, fields: 10 } });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    // CSRF protection: state-changing API calls need a custom header, which a
    // cross-site form or image cannot send (and CORS is not enabled)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw new HttpError(403, 'csrf');
    }
    req.user = loadUser(ctx, req);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'SAMEORIGIN');
    if (!req.url.startsWith('/api/')) {
      reply.header(
        'content-security-policy',
        "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'",
      );
    }
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ImmichError) return handleImmichError(ctx, req, reply, err);
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.code, ...(err.details ?? {}) });
    }
    const status = (err as any).statusCode;
    if (status && status < 500) {
      const code = (err as any).code === 'FST_REQ_FILE_TOO_LARGE' ? 'upload.tooLarge' : 'badRequest';
      return reply.status(status).send({ error: code, maxMb: config.uploadMaxMb });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'internal' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/config', async (req) => ({
    authMode: config.authMode,
    immich: !!config.immichUrl,
    immichPublicUrl: config.immichPublicUrl,
    print: !!config.cupsUrl,
    version: config.version,
    commit: config.commit,
    sourceUrl: config.sourceUrl,
    license: 'AGPL-3.0-or-later',
    setupRequired: setupRequired(ctx),
    registration: config.authMode === 'local' && getAppSetting(db, 'allowRegistration', false),
    defaultDpi: config.defaultDpi,
    uploadMaxMb: config.uploadMaxMb,
    uploadRetentionDays: config.uploadRetentionDays,
    testedImmichApi: TESTED_IMMICH_API,
    loggedIn: !!req.user,
  }));

  registerAuthRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerUploadRoutes(app, ctx);
  registerImmichRoutes(app, ctx);
  registerOutputRoutes(app, ctx);
  registerPrintRoutes(app, ctx);

  // single page app
  if (fs.existsSync(path.join(config.webDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.webDir,
      index: ['index.html'],
      cacheControl: false,
      setHeaders(res, filePath) {
        // hashed bundles never change; index.html must always be fresh
        const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
        res.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'notFound' });
      return reply.type('text/html').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: 'notFound' }));
  }

  return { app, ctx };
}
