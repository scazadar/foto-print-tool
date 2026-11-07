<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { EditState } from '../../../shared/edit';
  import { formatSizeMm } from '../../../shared/formats';
  import { layoutSheet, sheetCapacity, SHEETS, type SheetItem } from '../../../shared/sheet';
  import { api, ApiError, saveBlob } from '../lib/api';
  import { renderThumb } from '../lib/preview';
  import { browserPrint, type PrintPage } from '../lib/print';
  import { errorText, t } from '../lib/i18n';
  import { app, currentFormat, type EditorItem, showError, toast } from '../lib/state.svelte';

  type Tab = 'download' | 'immich' | 'print';
  let tab = $state<Tab>('download');
  let scope = $state<'all' | 'current'>('all');
  let fileType = $state<'jpeg' | 'png' | 'pdf'>('jpeg');
  let busy = $state(false);

  const sheet = $state({ on: false, sheetId: 'a4', marginMm: 5, gapMm: 2, cropMarks: true, allowRotate: true });

  const items = $derived(scope === 'all' ? app.items : app.items.slice(app.current, app.current + 1));
  const format = $derived(currentFormat());
  const dpi = $derived(app.prefs?.dpi ?? app.config?.defaultDpi ?? 300);

  function requestBody(extra: Record<string, unknown> = {}) {
    const f = format;
    return {
      items: items.map((it) => ({
        source: { kind: it.ref.kind, id: it.ref.id },
        format: { id: f.id, name: f.name, width: f.width, height: f.height, unit: f.unit },
        orientation: it.orientation,
        edit: $state.snapshot(it.edit) as EditState,
        copies: it.copies,
      })),
      dpi,
      quality: app.prefs?.jpegQuality ?? 92,
      includeGps: app.prefs?.includeGps ?? false,
      sheet: sheet.on ? { sheetId: sheet.sheetId, marginMm: sheet.marginMm, gapMm: sheet.gapMm, cropMarks: sheet.cropMarks, allowRotate: sheet.allowRotate } : null,
      ...extra,
    };
  }

  /* ----------------------------- sheet preview ----------------------------- */
  const sheetLayout = $derived.by(() => {
    if (!sheet.on) return null;
    const s = SHEETS.find((x) => x.id === sheet.sheetId)!;
    const list: SheetItem[] = [];
    items.forEach((it, index) => {
      const mm = formatSizeMm(format, it.orientation);
      for (let c = 0; c < it.copies; c++) list.push({ index, w: mm.w, h: mm.h });
    });
    return layoutSheet(s, list, { marginMm: sheet.marginMm, gapMm: sheet.gapMm, allowRotate: sheet.allowRotate });
  });

  function fillSheet() {
    const it = app.items[app.current];
    if (!it) return;
    const s = SHEETS.find((x) => x.id === sheet.sheetId)!;
    const mm = formatSizeMm(format, it.orientation);
    scope = 'current';
    it.copies = Math.max(1, sheetCapacity(s, mm.w, mm.h, { marginMm: sheet.marginMm, gapMm: sheet.gapMm, allowRotate: sheet.allowRotate }));
  }

  /* -------------------------------- download -------------------------------- */
  async function download() {
    busy = true;
    try {
      const { blob, name, warning } = await api.blob('/api/output/download', requestBody({ type: fileType }));
      saveBlob(blob, name);
      if (warning) toast(t(`warnings.${warning.split(',')[0]}`));
    } catch (err) {
      showError(err);
    } finally {
      busy = false;
    }
  }

  /* --------------------------------- immich --------------------------------- */
  let albumMode = $state<'default' | 'none' | 'id'>(app.prefs?.immichAlbum ? 'default' : 'none');
  let albumId = $state('');
  let albums = $state<{ id: string; name: string }[]>([]);
  let describe = $state(true);
  let saved = $state<{ assetId: string; status: string; name: string; url: string | null }[]>([]);

  async function loadAlbums() {
    if (albums.length) return;
    try {
      albums = (await api.get<{ items: { id: string; name: string }[] }>('/api/immich/albums')).items;
      if (!albumId && albums[0]) albumId = albums[0].id;
    } catch (err) {
      showError(err);
    }
  }

  async function saveToImmich() {
    busy = true;
    saved = [];
    try {
      const album = albumMode === 'id' ? { mode: 'id', id: albumId } : albumMode === 'default' ? { mode: 'default' } : { mode: 'none' };
      const res = await api.post<{ items: typeof saved }>('/api/output/immich', requestBody({ album, description: describe }));
      saved = res.items;
      toast(t('output.saved', { n: res.items.length }));
    } catch (err) {
      showError(err);
    } finally {
      busy = false;
    }
  }

  /* ------------------------------ browser print ------------------------------ */
  let printMode = $state<'browser' | 'server'>('browser');
  let paper = $state<string>('format');
  const PAPERS = [{ id: 'format', name: '' }, ...SHEETS.map((s) => ({ id: s.id, name: s.name }))];

  const paperPreview = $derived.by(() => {
    const it = items[0];
    if (!it) return null;
    if (sheet.on && sheetLayout) return { pw: sheetLayout.sheetW, ph: sheetLayout.sheetH, boxes: sheetLayout.pages[0]?.placements ?? [] };
    const mm = formatSizeMm(format, it.orientation);
    const p = SHEETS.find((s) => s.id === paper);
    let pw = mm.w;
    let ph = mm.h;
    if (p) {
      // paper upright or turned, whichever matches the photo
      const portrait = mm.h >= mm.w;
      pw = portrait ? p.w : p.h;
      ph = portrait ? p.h : p.w;
    }
    return { pw, ph, boxes: [{ index: 0, x: (pw - mm.w) / 2, y: (ph - mm.h) / 2, w: mm.w, h: mm.h, rotated: false }] };
  });

  // previews of the real crop, refreshed when anything changes
  const thumbs = $derived.by(() => {
    if (tab !== 'print') return [] as (string | null)[];
    return items.map((it) => {
      JSON.stringify(it.edit);
      void it.orientation;
      void it.loaded;
      return renderThumb(it, format);
    });
  });

  async function renderJpeg(it: EditorItem): Promise<Blob> {
    const body = requestBody({ type: 'jpeg', sheet: null });
    body.items = body.items.filter((x) => x.source.id === it.ref.id && x.source.kind === it.ref.kind).slice(0, 1);
    return (await api.blob('/api/output/download', body)).blob;
  }

  async function printInBrowser() {
    busy = true;
    try {
      const blobs = new Map<number, Blob>();
      for (let i = 0; i < items.length; i++) blobs.set(i, await renderJpeg(items[i]));
      const pages: PrintPage[] = [];
      if (sheet.on && sheetLayout) {
        for (const pg of sheetLayout.pages) {
          pages.push({ wMm: sheetLayout.sheetW, hMm: sheetLayout.sheetH, images: pg.placements.map((p) => ({ blob: blobs.get(p.index)!, ...p })), cropMarks: sheet.cropMarks });
        }
      } else {
        items.forEach((it, i) => {
          const mm = formatSizeMm(format, it.orientation);
          const p = SHEETS.find((s) => s.id === paper);
          const portrait = mm.h >= mm.w;
          const pw = p ? (portrait ? p.w : p.h) : mm.w;
          const ph = p ? (portrait ? p.h : p.w) : mm.h;
          for (let c = 0; c < it.copies; c++) {
            pages.push({ wMm: pw, hMm: ph, images: [{ blob: blobs.get(i)!, x: (pw - mm.w) / 2, y: (ph - mm.h) / 2, w: mm.w, h: mm.h, rotated: false }], cropMarks: false });
          }
        });
      }
      await browserPrint(pages);
    } catch (err) {
      showError(err);
    } finally {
      busy = false;
    }
  }

  /* ------------------------------- server print ------------------------------- */
  interface Printer {
    id: string;
    name: string;
    info: string | null;
    state: string;
    accepting: boolean;
    media: { key: string; label: string }[];
    mediaDefault: string | null;
    mediaTypes: string[];
    mediaSources: string[];
    borderless: boolean;
    maxCopies: number;
  }
  let printers = $state<Printer[] | null>(null);
  let printersError = $state('');
  const pref = app.prefs?.printer;
  let printerId = $state(pref?.id ?? '');
  let media = $state(pref?.media ?? '');
  let mediaType = $state(pref?.mediaType ?? '');
  let mediaSource = $state(pref?.mediaSource ?? '');
  let borderless = $state(pref?.borderless ?? false);
  let copies = $state(1);
  let jobs = $state<{ id: number; title: string; printer: string; state: string; message: string | null; createdAt: number }[]>([]);
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const printer = $derived(printers?.find((p) => p.id === printerId) ?? null);

  async function loadPrinters(refresh = false) {
    printersError = '';
    try {
      const res = await api.get<{ configured: boolean; items: Printer[] }>(`/api/print/printers${refresh ? '?refresh=1' : ''}`);
      printers = res.items;
      if (!printers.some((p) => p.id === printerId) && printers[0]) printerId = printers[0].id;
      const p = printers.find((x) => x.id === printerId);
      if (p && !p.media.some((m) => m.key === media)) media = p.mediaDefault ?? p.media[0]?.key ?? '';
    } catch (err) {
      printersError = err instanceof ApiError ? errorText(err.code) : t('errors.generic');
    }
    loadJobs();
  }

  async function loadJobs() {
    clearTimeout(pollTimer);
    try {
      jobs = (await api.get<{ items: typeof jobs }>('/api/print/jobs')).items;
    } catch {
      /* ignore */
    }
    if (jobs.some((j) => j.state === 'waiting' || j.state === 'printing')) pollTimer = setTimeout(loadJobs, 4000);
  }

  async function printOnServer() {
    if (!printer) return;
    busy = true;
    try {
      await api.post('/api/print/jobs', requestBody({ printer: printer.id, media, mediaType: mediaType || undefined, mediaSource: mediaSource || undefined, borderless, copies }));
      toast(t('print.submitted'));
      api.put('/api/settings', { printer: { id: printer.id, media, mediaType: mediaType || null, mediaSource: mediaSource || null, borderless } }).catch(() => undefined);
      loadJobs();
    } catch (err) {
      showError(err);
    } finally {
      busy = false;
    }
  }

  async function cancelJob(id: number) {
    await api.del(`/api/print/jobs/${id}`).catch(showError);
    loadJobs();
  }

  $effect(() => {
    if (tab === 'immich' && albumMode === 'id') loadAlbums();
  });
  $effect(() => {
    if (tab === 'print' && printMode === 'server' && printers === null) loadPrinters();
  });
  onDestroy(() => clearTimeout(pollTimer));

  const fmtLen = (mm: number) => (app.prefs?.units === 'in' ? `${(mm / 25.4).toFixed(2)} in` : `${(mm / 10).toLocaleString('de-DE', { maximumFractionDigits: 2 })} cm`);
</script>

<details open class="out">
  <summary>{t('editor.output')}</summary>
  <div class="tabs" role="tablist">
    <button role="tab" class:active={tab === 'download'} aria-selected={tab === 'download'} onclick={() => (tab = 'download')}>{t('output.download')}</button>
    {#if app.config?.immich && app.user?.immichLinked}
      <button role="tab" class:active={tab === 'immich'} aria-selected={tab === 'immich'} onclick={() => (tab = 'immich')}>{t('output.immich')}</button>
    {/if}
    <button role="tab" class:active={tab === 'print'} aria-selected={tab === 'print'} onclick={() => (tab = 'print')}>{t('output.print')}</button>
  </div>

  {#if app.items.length > 1}
    <div class="row seg">
      <button aria-pressed={scope === 'all'} onclick={() => (scope = 'all')}>Alle ({app.items.length})</button>
      <button aria-pressed={scope === 'current'} onclick={() => (scope = 'current')}>Nur aktuelles Bild</button>
    </div>
  {/if}

  <details class="sheet">
    <summary>{t('sheet.title')}</summary>
    <label class="check"><input type="checkbox" bind:checked={sheet.on} /> {t('sheet.enable')}</label>
    {#if sheet.on}
      <div class="row">
        <label class="field grow"><span>{t('sheet.sheet')}</span>
          <select bind:value={sheet.sheetId}>{#each SHEETS as s (s.id)}<option value={s.id}>{s.name}</option>{/each}</select>
        </label>
        <label class="field"><span>{t('sheet.margin')}</span><input type="number" min="0" max="30" step="0.5" bind:value={sheet.marginMm} style="width: 5em" /></label>
        <label class="field"><span>{t('sheet.gap')}</span><input type="number" min="0" max="30" step="0.5" bind:value={sheet.gapMm} style="width: 5em" /></label>
      </div>
      <label class="check"><input type="checkbox" bind:checked={sheet.cropMarks} /> {t('sheet.cropMarks')}</label>
      <label class="check"><input type="checkbox" bind:checked={sheet.allowRotate} /> {t('sheet.rotate')}</label>
      <button onclick={fillSheet}>{t('sheet.fill')}</button>
      {#if sheetLayout}
        <p class="small muted">{t('sheet.summary', { n: sheetLayout.pages.reduce((a, p) => a + p.placements.length, 0), pages: sheetLayout.pages.length })}</p>
        {#if sheetLayout.tooLarge.length}<p class="error-text small">{errorText('sheet.itemTooLarge')}</p>{/if}
      {/if}
    {/if}
  </details>

  {#if tab === 'download'}
    <label class="field"><span>{t('output.fileType')}</span>
      <select bind:value={fileType}>
        <option value="jpeg">JPEG</option>
        <option value="png">PNG</option>
        <option value="pdf">PDF</option>
      </select>
    </label>
    <p class="hint">{t('output.dpi')}: {dpi} · {t('output.quality')}: {app.prefs?.jpegQuality ?? 92} · {t('output.gps')}: {app.prefs?.includeGps ? t('common.yes') : t('common.no')}</p>
    <button class="primary wide" onclick={download} disabled={busy || !items.length}>{busy ? t('output.rendering') : t('output.download')}</button>
  {:else if tab === 'immich'}
    <label class="field"><span>{t('output.album')}</span>
      <select bind:value={albumMode}>
        {#if app.prefs?.immichAlbum}<option value="default">{t('output.albumDefault', { name: app.prefs.immichAlbum })}</option>{/if}
        <option value="id">{t('output.albumPick')}</option>
        <option value="none">{t('output.albumNone')}</option>
      </select>
    </label>
    {#if albumMode === 'id'}
      <select bind:value={albumId} aria-label={t('output.album')}>{#each albums as a (a.id)}<option value={a.id}>{a.name}</option>{/each}</select>
    {/if}
    <label class="check"><input type="checkbox" bind:checked={describe} /> {t('output.description')}</label>
    <p class="hint">{t('output.originalUntouched')}</p>
    <button class="primary wide" onclick={saveToImmich} disabled={busy || !items.length}>{busy ? t('output.rendering') : t('output.saveButton')}</button>
    {#if saved.length}
      <ul class="saved">
        {#each saved as s (s.assetId)}
          <li>{s.name}{s.status === 'duplicate' ? ` (${t('output.duplicate')})` : ''} {#if s.url}· <a href={s.url} target="_blank" rel="noopener">{t('output.openInImmich')}</a>{/if}</li>
        {/each}
      </ul>
    {/if}
  {:else}
    {#if app.config?.print}
      <div class="row seg">
        <button aria-pressed={printMode === 'browser'} onclick={() => (printMode = 'browser')}>{t('print.browser')}</button>
        <button aria-pressed={printMode === 'server'} onclick={() => (printMode = 'server')}>{t('print.server')}</button>
      </div>
    {/if}

    {#if paperPreview}
      <figure class="paper">
        <svg viewBox={`0 0 ${paperPreview.pw} ${paperPreview.ph}`} role="img" aria-label={t('print.preview')}>
          <rect x="0" y="0" width={paperPreview.pw} height={paperPreview.ph} fill="#fff" stroke="#9ca3af" stroke-width="0.6" />
          {#each paperPreview.boxes as b, i (i)}
            {@const it = items[b.index]}
            {#if it}
              {#if b.rotated}
                <image href={thumbs[b.index] ?? it.ref.thumbUrl} x={0} y={0} width={b.h} height={b.w} preserveAspectRatio="xMidYMid slice" transform={`translate(${b.x + b.w} ${b.y}) rotate(90)`} />
              {:else}
                <image href={thumbs[b.index] ?? it.ref.thumbUrl} x={b.x} y={b.y} width={b.w} height={b.h} preserveAspectRatio="xMidYMid slice" />
              {/if}
              <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="#2563eb" stroke-width="0.4" />
            {/if}
          {/each}
        </svg>
        <figcaption class="small muted">{t('print.preview')}: {fmtLen(paperPreview.pw)} × {fmtLen(paperPreview.ph)}</figcaption>
      </figure>
    {/if}

    {#if printMode === 'browser' || !app.config?.print}
      {#if !sheet.on}
        <label class="field"><span>{t('print.paper')}</span>
          <select bind:value={paper}>
            {#each PAPERS as p (p.id)}<option value={p.id}>{p.id === 'format' ? t('print.paperSameAsFormat') : p.name}</option>{/each}
          </select>
        </label>
      {/if}
      <div class="notice small">{t('print.browserHint')}</div>
      <button class="primary wide" onclick={printInBrowser} disabled={busy || !items.length}>{busy ? t('output.rendering') : t('print.browserButton')}</button>
    {:else}
      {#if printersError}
        <div class="notice err small">{printersError} <button onclick={() => loadPrinters(true)}>{t('common.refresh')}</button></div>
      {:else if printers === null}
        <p class="muted">{t('common.loading')}</p>
      {:else if printers.length === 0}
        <p class="muted">{t('print.noPrinters')}</p>
      {:else}
        <label class="field"><span>{t('print.printer')}</span>
          <div class="row">
            <select class="grow" bind:value={printerId}>
              {#each printers as p (p.id)}<option value={p.id}>{p.name} – {t(`print.printerState.${p.state}`)}</option>{/each}
            </select>
            <button class="icon" onclick={() => loadPrinters(true)} aria-label={t('common.refresh')} title={t('common.refresh')}>↻</button>
          </div>
        </label>
        {#if printer}
          {#if !printer.accepting || printer.state === 'stopped'}<div class="notice err small">{errorText('print.printerOffline')}</div>{/if}
          <label class="field"><span>{t('print.media')}</span>
            <select bind:value={media}>{#each printer.media as m (m.key)}<option value={m.key}>{m.label}</option>{/each}</select>
          </label>
          {#if printer.mediaTypes.length}
            <label class="field"><span>{t('print.mediaType')}</span>
              <select bind:value={mediaType}><option value="">–</option>{#each printer.mediaTypes as m (m)}<option value={m}>{m}</option>{/each}</select>
            </label>
          {/if}
          {#if printer.mediaSources.length}
            <label class="field"><span>{t('print.mediaSource')}</span>
              <select bind:value={mediaSource}><option value="">–</option>{#each printer.mediaSources as m (m)}<option value={m}>{m}</option>{/each}</select>
            </label>
          {/if}
          {#if printer.borderless}
            <label class="check"><input type="checkbox" bind:checked={borderless} /> {t('print.borderless')}</label>
          {:else}
            <p class="hint">{t('print.borderlessUnsupported')}</p>
          {/if}
          <label class="field"><span>{t('print.copies')}</span><input type="number" min="1" max={printer.maxCopies} bind:value={copies} style="width: 6em" /></label>
          <button class="primary wide" onclick={printOnServer} disabled={busy || !items.length}>{busy ? t('output.rendering') : t('print.submit')}</button>
        {/if}
      {/if}
      <h3 class="jobs-title">{t('print.jobs')}</h3>
      {#if jobs.length === 0}
        <p class="muted small">{t('print.noJobs')}</p>
      {:else}
        <ul class="jobs">
          {#each jobs as j (j.id)}
            <li>
              <span class="grow">{j.title} <span class="muted small">· {j.printer}</span></span>
              <span class="badge" class:good={j.state === 'done'} class:bad={j.state === 'error'} class:ok={j.state === 'printing'}>{t(`print.state.${j.state}`)}</span>
              {#if j.state === 'waiting' || j.state === 'printing'}<button class="small" onclick={() => cancelJob(j.id)}>{t('print.cancelJob')}</button>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/if}
</details>

<style>
  .out .tabs { margin-bottom: 0.6rem; flex-wrap: wrap; }
  .out .tabs button { padding: 0.5em 0.7em; }
  .seg button { flex: 1; }
  .wide { width: 100%; margin-top: 0.4rem; }
  .sheet { margin: 0.4rem 0 0.8rem; border-style: dashed; }
  .paper { margin: 0.5rem 0; text-align: center; }
  .paper svg { max-width: 100%; max-height: 260px; background: var(--line); padding: 6px; border-radius: 6px; }
  .saved, .jobs { list-style: none; padding: 0; margin: 0.6rem 0; }
  .jobs li { display: flex; gap: 0.5rem; align-items: center; padding: 0.3rem 0; border-bottom: 1px solid var(--line); }
  .jobs-title { margin-top: 1rem; }
  select { width: 100%; }
</style>
