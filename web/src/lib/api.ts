// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public data: Record<string, any> = {},
  ) {
    super(code);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function handle(res: Response): Promise<Response> {
  if (res.ok) return res;
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* not json */
  }
  if (res.status === 401 && onUnauthorized) onUnauthorized();
  throw new ApiError(res.status, data.error ?? 'generic', data);
}

export async function request(method: string, url: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (method !== 'GET' && method !== 'HEAD') headers['x-fotodruck'] = '1';
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network');
  }
  return handle(res);
}

export const api = {
  get: async <T>(url: string): Promise<T> => (await request('GET', url)).json(),
  post: async <T>(url: string, body?: unknown): Promise<T> => (await request('POST', url, body ?? {})).json(),
  put: async <T>(url: string, body?: unknown): Promise<T> => (await request('PUT', url, body ?? {})).json(),
  patch: async <T>(url: string, body?: unknown): Promise<T> => (await request('PATCH', url, body ?? {})).json(),
  del: async <T>(url: string): Promise<T> => (await request('DELETE', url)).json(),
  blob: async (url: string, body: unknown): Promise<{ blob: Blob; name: string; warning: string | null }> => {
    const res = await request('POST', url, body);
    const cd = res.headers.get('content-disposition') ?? '';
    const m = /filename\*=UTF-8''([^;]+)/.exec(cd) ?? /filename="([^"]+)"/.exec(cd);
    const name = m ? decodeURIComponent(m[1]) : 'download';
    return { blob: await res.blob(), name, warning: res.headers.get('x-fotodruck-warning') };
  },
};

/** Upload with progress (fetch has no upload progress). */
export function uploadFile(file: File, onProgress: (p: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');
    xhr.setRequestHeader('x-fotodruck', '1');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else {
        if (xhr.status === 401 && onUnauthorized) onUnauthorized();
        reject(new ApiError(xhr.status, data.error ?? 'generic', data));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'network'));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
