// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppContext } from './context.js';

/** Directory-safe form of a user id ("immich:<uuid>" contains a colon). */
export function userDirName(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9-]/g, '_');
}

export function uploadsDir(ctx: AppContext, userId: string): string {
  return path.join(ctx.config.dataDir, 'uploads', userDirName(userId));
}

export function uploadDir(ctx: AppContext, userId: string, uploadId: string): string {
  if (!/^[a-f0-9-]{36}$/.test(uploadId)) throw new Error('invalid upload id');
  return path.join(uploadsDir(ctx, userId), uploadId);
}

/** Per-user cache of Immich originals, kept at most 24 h. */
export function cacheDir(ctx: AppContext, userId: string): string {
  return path.join(ctx.config.dataDir, 'cache', userDirName(userId));
}

const DAY = 86400_000;

/** Delete expired uploads (UPLOAD_RETENTION_DAYS) and cached originals (24 h). */
export async function cleanup(ctx: AppContext, now = Date.now()): Promise<{ uploads: number; cache: number }> {
  let uploads = 0;
  if (ctx.config.uploadRetentionDays > 0) {
    const cutoff = now - ctx.config.uploadRetentionDays * DAY;
    const rows = ctx.db.prepare('SELECT id, user_id FROM uploads WHERE created_at < ?').all(cutoff) as {
      id: string;
      user_id: string;
    }[];
    for (const r of rows) {
      await fs.rm(uploadDir(ctx, r.user_id, r.id), { recursive: true, force: true });
      ctx.db.prepare('DELETE FROM uploads WHERE id = ?').run(r.id);
      uploads++;
    }
  }
  let cache = 0;
  const root = path.join(ctx.config.dataDir, 'cache');
  const users = await fs.readdir(root).catch(() => [] as string[]);
  for (const u of users) {
    const dir = path.join(root, u);
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of files) {
      const p = path.join(dir, f);
      const st = await fs.stat(p).catch(() => null);
      if (st && st.mtimeMs < now - DAY) {
        await fs.rm(p, { force: true });
        cache++;
      }
    }
  }
  // orphaned upload folders (e.g. deleted users)
  const upRoot = path.join(ctx.config.dataDir, 'uploads');
  const known = new Set(
    (ctx.db.prepare('SELECT id, user_id FROM uploads').all() as { id: string; user_id: string }[]).map(
      (r) => `${userDirName(r.user_id)}/${r.id}`,
    ),
  );
  for (const u of await fs.readdir(upRoot).catch(() => [] as string[])) {
    for (const id of await fs.readdir(path.join(upRoot, u)).catch(() => [] as string[])) {
      if (!known.has(`${u}/${id}`)) {
        const p = path.join(upRoot, u, id);
        const st = await fs.stat(p).catch(() => null);
        // leave very recent folders alone: an upload may be in progress
        if (st && st.mtimeMs < now - 3600_000) await fs.rm(p, { recursive: true, force: true });
      }
    }
  }
  return { uploads, cache };
}
