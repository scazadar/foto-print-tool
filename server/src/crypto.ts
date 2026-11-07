// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import crypto from 'node:crypto';

/** AES-256-GCM encryption of stored Immich tokens and API keys, key derived from SESSION_SECRET. */
export class SecretBox {
  private key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(crypto.hkdfSync('sha256', secret, 'fotodruck', 'token-encryption-v1', 32));
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`;
  }

  decrypt(box: string): string | null {
    const parts = box.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(parts[1], 'base64url'));
      decipher.setAuthTag(Buffer.from(parts[3], 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}
