// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import path from 'node:path';

export type AuthMode = 'local' | 'immich' | 'none';

export interface Config {
  sessionSecret: string;
  authMode: AuthMode;
  adminEmail: string | null;
  adminPassword: string | null;
  immichUrl: string | null;
  immichPublicUrl: string | null;
  /** Public base URL of Fotodruck (for the OAuth callback); default: from the request */
  publicUrl: string | null;
  /** anonymous guest login (upload, edit, download, browser print only) */
  guestAccess: boolean;
  guestSessionHours: number;
  guestMaxUploads: number;
  uploadMaxMb: number;
  uploadRetentionDays: number;
  cupsUrl: string | null;
  defaultDpi: number;
  port: number;
  sourceUrl: string;
  dataDir: string;
  trustProxy: boolean;
  version: string;
  commit: string;
  webDir: string;
}

export const OFFICIAL_SOURCE_URL = 'https://github.com/scazadar/foto-print-tool';

function int(name: string, def: number, min: number, max: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return v;
}

function url(name: string, env: NodeJS.ProcessEnv, protocols: string[]): string | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL: ${raw}`);
  }
  if (!protocols.includes(u.protocol)) throw new Error(`${name} must use ${protocols.join(' or ')}`);
  return raw.replace(/\/+$/, '').replace(/\/api$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET is required and must be at least 32 characters (e.g. `openssl rand -hex 32`).');
  }
  const immichUrl = url('IMMICH_URL', env, ['http:', 'https:']);
  const rawMode = (env.AUTH_MODE ?? '').trim().toLowerCase();
  let authMode: AuthMode;
  if (rawMode === '') authMode = immichUrl ? 'immich' : 'local';
  else if (rawMode === 'local' || rawMode === 'immich' || rawMode === 'none') authMode = rawMode;
  else throw new Error('AUTH_MODE must be local, immich or none');
  if (authMode === 'immich' && !immichUrl) throw new Error('AUTH_MODE=immich requires IMMICH_URL');

  return {
    sessionSecret,
    authMode,
    adminEmail: env.ADMIN_EMAIL?.trim() || null,
    adminPassword: env.ADMIN_PASSWORD || null,
    immichUrl,
    immichPublicUrl: url('IMMICH_PUBLIC_URL', env, ['http:', 'https:']) ?? immichUrl,
    publicUrl: url('PUBLIC_URL', env, ['http:', 'https:']),
    guestAccess: /^(1|true|yes)$/i.test(env.GUEST_ACCESS ?? ''),
    guestSessionHours: int('GUEST_SESSION_HOURS', 24, 1, 720, env),
    guestMaxUploads: int('GUEST_MAX_UPLOADS', 30, 1, 1000, env),
    uploadMaxMb: int('UPLOAD_MAX_MB', 100, 1, 2048, env),
    uploadRetentionDays: int('UPLOAD_RETENTION_DAYS', 7, 0, 36500, env),
    cupsUrl: url('CUPS_URL', env, ['ipp:', 'ipps:', 'http:', 'https:']),
    defaultDpi: int('DEFAULT_DPI', 300, 72, 1200, env),
    port: int('PORT', 8080, 1, 65535, env),
    sourceUrl: env.SOURCE_URL?.trim() || OFFICIAL_SOURCE_URL,
    dataDir: path.resolve(env.DATA_DIR || '/data'),
    trustProxy: /^(1|true|yes)$/i.test(env.TRUST_PROXY ?? ''),
    version: env.APP_VERSION || process.env.npm_package_version || '0.2.0',
    commit: env.GIT_COMMIT || 'unknown',
    webDir: path.resolve(env.WEB_DIR || path.join(process.cwd(), '..', 'web', 'dist')),
  };
}
