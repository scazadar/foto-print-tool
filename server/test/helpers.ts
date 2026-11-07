// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openMemoryDb } from '../src/db.js';

export const SECRET = 'test-secret-test-secret-test-secret-0123456789';

export async function makeApp(env: Record<string, string> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fotodruck-test-'));
  const config = loadConfig({ SESSION_SECRET: SECRET, DATA_DIR: dataDir, WEB_DIR: path.join(dataDir, 'no-web'), ...env });
  const db = openMemoryDb();
  const { app, ctx } = await buildApp(config, db, { logger: false });
  await app.ready();
  return { app, ctx, dataDir, close: async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

/** Cookie jar for app.inject */
export class Agent {
  cookie = '';
  constructor(private app: any) {}
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method,
      url,
      payload: body as any,
      headers: { 'x-fotodruck': '1', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    const set = res.headers['set-cookie'];
    if (set) {
      const list = Array.isArray(set) ? set : [set];
      for (const c of list) {
        const [kv] = c.split(';');
        if (kv.startsWith('fd_session=')) this.cookie = kv.endsWith('=') ? '' : kv;
      }
    }
    return res;
  }
  async upload(name: string, data: Buffer, mime = 'image/jpeg') {
    const boundary = '----fotodrucktest';
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`;
    const payload = Buffer.concat([Buffer.from(head), data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return this.req('POST', '/api/uploads', payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  }
}
