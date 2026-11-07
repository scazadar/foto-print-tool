<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api';
  import { errorText, t } from '../lib/i18n';
  import { app, immichRef, type PhotoRef, showError } from '../lib/state.svelte';
  import PhotoGrid from './PhotoGrid.svelte';

  interface Status {
    reachable: boolean;
    version: string | null;
    tooOld: boolean;
    minVersion: string;
    linked: boolean;
    credentialValid: boolean;
  }
  interface Album {
    id: string;
    name: string;
    assetCount: number;
    thumbnailAssetId: string | null;
    shared: boolean;
  }

  let status = $state<Status | null>(null);
  let statusError = $state('');
  let tab = $state<'albums' | 'timeline' | 'search'>('albums');
  let albums = $state<Album[]>([]);
  let album = $state<Album | null>(null);
  let photos = $state<PhotoRef[]>([]);
  let next = $state<string | null>(null);
  let loading = $state(false);
  let people = $state<{ id: string; name: string }[]>([]);
  let q = $state({ query: '', takenAfter: '', takenBefore: '', city: '', personId: '' });
  let lastLoader = $state<((cursor: string | null) => Promise<{ items: any[]; next: string | null }>) | null>(null);

  async function loadStatus() {
    try {
      status = await api.get<Status>('/api/immich/status');
      if (status.linked && status.credentialValid) await loadAlbums();
    } catch (err) {
      statusError = err instanceof ApiError ? errorText(err.code) : t('errors.generic');
    }
  }

  async function loadAlbums() {
    loading = true;
    try {
      albums = (await api.get<{ items: Album[] }>('/api/immich/albums')).items;
    } catch (err) {
      showError(err);
    } finally {
      loading = false;
    }
  }

  async function run(loader: (cursor: string | null) => Promise<{ items: any[]; next: string | null }>, append = false) {
    lastLoader = loader;
    loading = true;
    try {
      const res = await loader(append ? next : null);
      const refs = res.items.map(immichRef);
      photos = append ? [...photos, ...refs] : refs;
      next = res.next;
    } catch (err) {
      showError(err);
    } finally {
      loading = false;
    }
  }

  const more = () => lastLoader && run(lastLoader, true);

  function openAlbum(a: Album) {
    album = a;
    photos = [];
    run((c) => api.get(`/api/immich/albums/${a.id}/assets${c ? `?next=${encodeURIComponent(c)}` : ''}`));
  }

  function showTimeline() {
    tab = 'timeline';
    photos = [];
    run((c) => api.get(`/api/immich/timeline${c ? `?next=${encodeURIComponent(c)}` : ''}`));
  }

  async function showSearch() {
    tab = 'search';
    photos = [];
    next = null;
    if (!people.length) {
      try {
        people = (await api.get<{ items: { id: string; name: string }[] }>('/api/immich/people')).items;
      } catch {
        people = [];
      }
    }
  }

  function search(e: Event) {
    e.preventDefault();
    const body = {
      query: q.query,
      takenAfter: q.takenAfter ? new Date(q.takenAfter + 'T00:00:00').toISOString() : undefined,
      takenBefore: q.takenBefore ? new Date(q.takenBefore + 'T23:59:59').toISOString() : undefined,
      city: q.city || undefined,
      personIds: q.personId ? [q.personId] : undefined,
    };
    photos = [];
    run((c) => api.post('/api/immich/search', { ...body, next: c }));
  }

  onMount(loadStatus);
</script>

{#if statusError}
  <div class="notice err">{statusError}</div>
{:else if !status}
  <p class="muted">{t('common.loading')}</p>
{:else if !status.reachable}
  <div class="notice err">{t('immich.unreachable')} <button onclick={loadStatus}>{t('common.refresh')}</button></div>
{:else if !status.linked || !status.credentialValid}
  <div class="notice">
    {status.linked ? errorText('immich.credentialInvalid') : t('immich.notLinked')}
    {#if app.user?.kind !== 'immich'}
      <button class="primary" onclick={() => (app.view = 'settings')}>{t('immich.linkNow')}</button>
    {/if}
  </div>
{:else}
  {#if status.tooOld}
    <div class="notice warn">{t('immich.tooOld', { version: status.version ?? '?', min: status.minVersion })}</div>
  {/if}
  <div class="tabs sub" role="tablist">
    <button role="tab" class:active={tab === 'albums'} aria-selected={tab === 'albums'} onclick={() => { tab = 'albums'; album = null; photos = []; }}>{t('immich.albums')}</button>
    <button role="tab" class:active={tab === 'timeline'} aria-selected={tab === 'timeline'} onclick={showTimeline}>{t('immich.timeline')}</button>
    <button role="tab" class:active={tab === 'search'} aria-selected={tab === 'search'} onclick={showSearch}>{t('immich.search')}</button>
  </div>

  {#if tab === 'albums' && !album}
    <div class="albums">
      {#each albums as a (a.id)}
        <button class="album" onclick={() => openAlbum(a)}>
          {#if a.thumbnailAssetId}
            <img src={`/api/immich/assets/${a.thumbnailAssetId}/thumb`} alt="" loading="lazy" />
          {:else}
            <div class="ph"></div>
          {/if}
          <span class="title">{a.name}</span>
          <span class="muted small">{t('immich.photos', { n: a.assetCount })}{a.shared ? ` · ${t('immich.shared')}` : ''}</span>
        </button>
      {/each}
    </div>
    {#if loading}<p class="muted">{t('common.loading')}</p>{/if}
  {:else}
    {#if tab === 'albums' && album}
      <div class="row head">
        <button onclick={() => { album = null; photos = []; }}>← {t('immich.backToAlbums')}</button>
        <h2 class="grow">{album.name}</h2>
        {#if photos.length}<button onclick={() => photos.forEach((p) => !app.selection.some((s) => s.id === p.id) && app.selection.push(p))}>{t('sources.selectAll')}</button>{/if}
      </div>
    {/if}
    {#if tab === 'search'}
      <form class="search panel" onsubmit={search}>
        <input class="q" type="search" bind:value={q.query} placeholder={t('immich.searchPlaceholder')} aria-label={t('immich.search')} />
        <label><span class="label">{t('immich.takenAfter')}</span><input type="date" bind:value={q.takenAfter} /></label>
        <label><span class="label">{t('immich.takenBefore')}</span><input type="date" bind:value={q.takenBefore} /></label>
        <label><span class="label">{t('immich.city')}</span><input bind:value={q.city} /></label>
        {#if people.length}
          <label><span class="label">{t('immich.person')}</span>
            <select bind:value={q.personId}>
              <option value="">{t('immich.anyPerson')}</option>
              {#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
            </select>
          </label>
        {/if}
        <button class="primary" type="submit">{t('immich.searchButton')}</button>
      </form>
    {/if}
    {#if !loading && photos.length === 0 && (tab !== 'search' || lastLoader)}
      <p class="muted">{t('immich.noResults')}</p>
    {/if}
    <PhotoGrid items={photos} {loading} onMore={next ? more : null} />
  {/if}
{/if}

<style>
  .albums { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
  .album { display: flex; flex-direction: column; align-items: stretch; text-align: left; padding: 0; overflow: hidden; gap: 2px; padding-bottom: 6px; }
  .album img, .album .ph { width: 100%; aspect-ratio: 1; object-fit: cover; background: var(--line); }
  .album .title { font-weight: 600; padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .album .small { padding: 0 8px; }
  .head { margin-bottom: 0.8rem; }
  .head h2 { margin: 0; }
  .search { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: flex-end; margin-bottom: 1rem; }
  .search .q { flex: 1 1 100%; }
</style>
