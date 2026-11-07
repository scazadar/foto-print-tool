// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,              -- local | immich | none
    email TEXT UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    immich_user_id TEXT,
    immich_cred TEXT,                -- encrypted, linked account (local/none mode)
    immich_cred_type TEXT,           -- token | apikey
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,             -- sha256 of the cookie token
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    immich_cred TEXT,                -- encrypted, AUTH_MODE=immich
    immich_cred_type TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE user_settings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  CREATE TABLE custom_formats (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    unit TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    format TEXT NOT NULL,            -- detected input format
    width INTEGER NOT NULL,          -- oriented
    height INTEGER NOT NULL,
    size INTEGER NOT NULL,
    exif TEXT,                       -- JSON subset
    taken_at TEXT,
    warning TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX uploads_user ON uploads(user_id, created_at);
  CREATE TABLE print_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    printer_uri TEXT NOT NULL,
    printer_name TEXT NOT NULL,
    job_id INTEGER,
    job_uri TEXT,
    title TEXT NOT NULL,
    state TEXT NOT NULL,
    message TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX print_jobs_user ON print_jobs(user_id, created_at);
  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function openDb(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'fotodruck.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function openMemoryDb(): DB {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function getAppSetting<T>(db: DB, key: string, def: T): T {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : def;
}

export function setAppSetting(db: DB, key: string, value: unknown): void {
  db.prepare('INSERT INTO app_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

export function getUserSetting<T>(db: DB, userId: string, key: string, def: T): T {
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : def;
}

export function setUserSetting(db: DB, userId: string, key: string, value: unknown): void {
  db.prepare(
    'INSERT INTO user_settings(user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
  ).run(userId, key, JSON.stringify(value));
}
