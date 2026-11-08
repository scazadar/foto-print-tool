<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { api, ApiError, uploadFile } from '../lib/api';
  import { errorText, t } from '../lib/i18n';
  import { app, type PhotoRef, refKey, showError, uploadRef } from '../lib/state.svelte';
  import PhotoGrid from './PhotoGrid.svelte';

  interface Job {
    id: number;
    name: string;
    progress: number;
    state: 'uploading' | 'processing' | 'done' | 'error';
    error?: string;
  }

  let uploads = $state<PhotoRef[]>([]);
  let jobs = $state<Job[]>([]);
  let dragging = $state(false);
  let loading = $state(true);
  let fileInput: HTMLInputElement;
  let cameraInput: HTMLInputElement;
  let galleryInput: HTMLInputElement;
  let jobCounter = 0;
  const accept = 'image/*,.heic,.heif,.avif,.tif,.tiff,.webp';
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  async function load() {
    loading = true;
    try {
      const res = await api.get<{ items: any[] }>('/api/uploads');
      uploads = res.items.map(uploadRef);
    } catch (err) {
      showError(err);
    } finally {
      loading = false;
    }
  }

  async function handleFiles(files: FileList | File[] | null) {
    if (!files) return;
    const list = Array.from(files);
    const maxBytes = (app.config?.uploadMaxMb ?? 100) * 1024 * 1024;
    // three at a time
    const queue = list.map((file) => {
      const job: Job = { id: ++jobCounter, name: file.name || 'Foto', progress: 0, state: 'uploading' };
      jobs.unshift(job);
      return { file, job: jobs[0] };
    });
    const worker = async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        const { file, job } = next;
        if (file.size > maxBytes) {
          job.state = 'error';
          job.error = errorText('upload.tooLarge', { maxMb: app.config?.uploadMaxMb ?? 100 });
          continue;
        }
        try {
          const res = await uploadFile(file, (p) => {
            job.progress = p;
            if (p >= 1) job.state = 'processing';
          });
          job.state = 'done';
          job.progress = 1;
          const ref = uploadRef(res);
          uploads = [ref, ...uploads];
          if (!app.selection.some((s) => refKey(s) === refKey(ref))) app.selection.push(ref);
        } catch (err) {
          job.state = 'error';
          job.error = err instanceof ApiError ? errorText(err.code, err.data) : t('errors.generic');
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setTimeout(() => (jobs = jobs.filter((j) => j.state !== 'done')), 4000);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    handleFiles(e.dataTransfer?.files ?? null);
  }

  function onPaste(e: ClipboardEvent) {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      handleFiles(files);
    }
  }

  async function remove(r: PhotoRef) {
    try {
      await api.del(`/api/uploads/${r.id}`);
      uploads = uploads.filter((u) => u.id !== r.id);
      app.selection = app.selection.filter((s) => refKey(s) !== refKey(r));
      app.items = app.items.filter((i) => i.key !== refKey(r));
    } catch (err) {
      showError(err);
    }
  }

  async function removeAll() {
    if (!confirm(t('upload.deleteAllConfirm'))) return;
    try {
      await api.del('/api/uploads');
      app.selection = app.selection.filter((s) => s.kind !== 'upload');
      app.items = app.items.filter((i) => i.ref.kind !== 'upload');
      uploads = [];
    } catch (err) {
      showError(err);
    }
  }

  onMount(() => {
    load();
    window.addEventListener('paste', onPaste);
  });
  onDestroy(() => window.removeEventListener('paste', onPaste));
</script>

<section
  class="drop"
  class:dragging
  aria-label={t('upload.drop')}
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  <p class="big">{t('upload.drop')}</p>
  <div class="row center">
    <button class="primary" onclick={() => fileInput.click()}>{t('upload.choose')}</button>
    {#if isMobile}
      <button onclick={() => cameraInput.click()}>📷 {t('upload.camera')}</button>
      <button onclick={() => galleryInput.click()}>{t('upload.gallery')}</button>
    {/if}
  </div>
  <p class="hint">{t('upload.formats', { mb: app.config?.uploadMaxMb ?? 100 })}</p>
  <input bind:this={fileInput} type="file" multiple {accept} hidden onchange={(e) => { handleFiles(e.currentTarget.files); e.currentTarget.value = ''; }} />
  <input bind:this={cameraInput} type="file" accept="image/*" capture="environment" hidden onchange={(e) => { handleFiles(e.currentTarget.files); e.currentTarget.value = ''; }} />
  <input bind:this={galleryInput} type="file" multiple accept="image/*" hidden onchange={(e) => { handleFiles(e.currentTarget.files); e.currentTarget.value = ''; }} />
</section>

{#if jobs.length}
  <ul class="jobs">
    {#each jobs as j (j.id)}
      <li>
        <span class="name">{j.name}</span>
        {#if j.state === 'error'}
          <span class="error-text">{t('upload.failed')}: {j.error}</span>
        {:else if j.state === 'done'}
          <span class="muted">{t('upload.done')}</span>
        {:else}
          <div class="progress grow"><div style="width: {Math.round(j.progress * 100)}%"></div></div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<section class="mine">
  <div class="row">
    <h2 class="grow">{t('sources.myUploads')}</h2>
    {#if uploads.length}
      <button onclick={() => uploads.forEach((u) => !app.selection.some((s) => refKey(s) === refKey(u)) && app.selection.push(u))}>{t('sources.selectAll')}</button>
      <button class="danger" onclick={removeAll}>{t('upload.deleteAll')}</button>
    {/if}
  </div>
  <p class="hint">
    {#if app.user?.kind === 'guest'}
      {t('upload.retentionGuest', { hours: app.config?.guestSessionHours ?? 24 })}
    {:else}
      {app.config && app.config.uploadRetentionDays > 0 ? t('upload.retention', { days: app.config.uploadRetentionDays }) : t('upload.retentionNever')}
    {/if}
  </p>
  {#if !loading && uploads.length === 0}
    <p class="muted">{t('upload.empty')}</p>
  {/if}
  <PhotoGrid items={uploads} {loading} onDelete={remove} />
</section>

<style>
  .drop { border: 2px dashed var(--line); border-radius: var(--radius); padding: 2rem 1rem; text-align: center; background: var(--panel); }
  .drop.dragging { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--panel)); }
  .big { font-size: 1.1rem; margin-top: 0; }
  .center { justify-content: center; }
  .jobs { list-style: none; padding: 0; margin: 1rem 0; }
  .jobs li { display: flex; gap: 0.8rem; align-items: center; padding: 0.3rem 0; }
  .jobs .name { width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mine { margin-top: 1.5rem; }
</style>
