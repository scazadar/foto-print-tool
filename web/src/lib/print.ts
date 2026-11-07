// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

/**
 * Browser printing: a print page whose @page size and image positions are
 * given in millimetres, so that printing at 100 % gives the exact size.
 */

export interface PrintImage {
  blob: Blob;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
}

export interface PrintPage {
  wMm: number;
  hMm: number;
  images: PrintImage[];
  cropMarks: boolean;
}

const n = (v: number) => `${Math.round(v * 1000) / 1000}mm`;

export function buildPrintHtml(pages: PrintPage[], urls: Map<Blob, string>): string {
  const sizes = [...new Set(pages.map((p) => `${n(p.wMm)} ${n(p.hMm)}`))];
  // named pages let one document mix portrait and landscape pages
  const pageRules = sizes.map((s, i) => `@page p${i} { size: ${s}; margin: 0; }`).join('\n');
  const body = pages
    .map((p) => {
      const idx = sizes.indexOf(`${n(p.wMm)} ${n(p.hMm)}`);
      const imgs = p.images
        .map((im) => {
          const url = urls.get(im.blob)!;
          if (!im.rotated) return `<img src="${url}" style="left:${n(im.x)};top:${n(im.y)};width:${n(im.w)};height:${n(im.h)}">`;
          // the picture is rendered upright (h × w) and turned by 90° into its slot
          return `<img src="${url}" style="left:${n(im.x + im.w)};top:${n(im.y)};width:${n(im.h)};height:${n(im.w)};transform:rotate(90deg);transform-origin:0 0">`;
        })
        .join('');
      const marks = p.cropMarks ? cropMarks(p) : '';
      return `<div class="page" style="page:p${idx};width:${n(p.wMm)};height:${n(p.hMm)}">${imgs}${marks}</div>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fotodruck</title><style>
@page { size: ${sizes[0]}; margin: 0; }
${pageRules}
html, body { margin: 0; padding: 0; background: #fff; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; overflow: hidden; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
.page img { position: absolute; display: block; }
.mark { position: absolute; background: #000; }
</style></head><body>${body}</body></html>`;
}

function cropMarks(p: PrintPage): string {
  const len = 3;
  const off = 1;
  const t = 0.15;
  const inside = (x: number, y: number) => p.images.some((im) => x > im.x + 0.05 && x < im.x + im.w - 0.05 && y > im.y + 0.05 && y < im.y + im.h - 0.05);
  const out: string[] = [];
  for (const im of p.images) {
    for (const [cx, sx] of [[im.x, -1], [im.x + im.w, 1]] as const) {
      for (const [cy, sy] of [[im.y, -1], [im.y + im.h, 1]] as const) {
        const hx = sx < 0 ? cx - off - len : cx + off;
        if (!inside(hx + len / 2, cy)) out.push(`<div class="mark" style="left:${n(hx)};top:${n(cy - t / 2)};width:${n(len)};height:${n(t)}"></div>`);
        const vy = sy < 0 ? cy - off - len : cy + off;
        if (!inside(cx, vy + len / 2)) out.push(`<div class="mark" style="left:${n(cx - t / 2)};top:${n(vy)};width:${n(t)};height:${n(len)}"></div>`);
      }
    }
  }
  return out.join('');
}

export async function browserPrint(pages: PrintPage[]): Promise<void> {
  const urls = new Map<Blob, string>();
  for (const p of pages) for (const im of p.images) if (!urls.has(im.blob)) urls.set(im.blob, URL.createObjectURL(im.blob));
  const html = buildPrintHtml(pages, urls);
  const docUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    frame.src = docUrl;
  });
  const doc = frame.contentDocument!;
  await Promise.all(Array.from(doc.images).map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  // print() blocks in most browsers; clean up a little later in any case
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(docUrl);
    for (const u of urls.values()) URL.revokeObjectURL(u);
  }, 60_000);
}
