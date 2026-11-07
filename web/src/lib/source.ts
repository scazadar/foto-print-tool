// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/** Link to the source of the running version (AGPL §13). */
export function sourceLink(c: { sourceUrl: string; commit: string; version: string }): string {
  const base = c.sourceUrl.replace(/\/+$/, '');
  if (/github\.com|gitlab|codeberg\.org|gitea/.test(base)) {
    if (c.commit && c.commit !== 'unknown') return `${base}/tree/${c.commit}`;
    return `${base}/releases/tag/v${c.version}`;
  }
  return base;
}
