// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import de from '../locales/de.json';

// Further languages: add src/locales/<lang>.json and register it here.
const LOCALES: Record<string, Record<string, string>> = { de };
let current: Record<string, string> = de;

export function setLocale(lang: string): void {
  current = LOCALES[lang] ?? de;
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  const s = current[key] ?? de[key as keyof typeof de] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

export function errorText(code: string | undefined, params: Record<string, string | number> = {}): string {
  if (!code) return t('errors.generic');
  const key = `errors.${code}`;
  const s = t(key, params);
  return s === key ? t('errors.generic') : s;
}

export function fmtNum(n: number, digits = 1): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: digits });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE');
}
