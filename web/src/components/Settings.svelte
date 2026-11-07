<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { sizeLabel, type PhotoFormat, type Unit } from '../../../shared/formats';
  import { api, ApiError } from '../lib/api';
  import { errorText, t } from '../lib/i18n';
  import { app, loadSession, reloadFormats, savePrefs, showError, toast } from '../lib/state.svelte';

  const prefs = $state({ ...app.prefs! });

  async function save(e: Event) {
    e.preventDefault();
    try {
      await savePrefs({
        immichAlbum: prefs.immichAlbum,
        fitMode: prefs.fitMode,
        jpegQuality: Number(prefs.jpegQuality),
        includeGps: prefs.includeGps,
        units: prefs.units,
        dpi: prefs.dpi ? Number(prefs.dpi) : null,
      });
      toast(t('settings.saved'));
    } catch (err) {
      showError(err);
    }
  }

  /* ------------------------------ custom formats ------------------------------ */
  let editing = $state<{ id: string | null; name: string; width: number; height: number; unit: Unit } | null>(null);
  let formatError = $state('');

  function newFormat() {
    editing = { id: null, name: '', width: 10.2, height: 15.2, unit: 'cm' };
    formatError = '';
  }

  async function saveFormat(e: Event) {
    e.preventDefault();
    if (!editing) return;
    const body = { name: editing.name, width: Number(editing.width), height: Number(editing.height), unit: editing.unit };
    try {
      if (editing.id) await api.put(`/api/formats/${editing.id}`, body);
      else await api.post('/api/formats', body);
      editing = null;
      await reloadFormats();
    } catch (err) {
      formatError = err instanceof ApiError ? errorText(err.code) : t('errors.generic');
    }
  }

  async function deleteFormat(f: PhotoFormat) {
    await api.del(`/api/formats/${f.id}`).catch(showError);
    await reloadFormats();
  }

  async function toggleHidden(id: string, hidden: boolean) {
    const ids = hidden ? [...app.formats.hidden, id] : app.formats.hidden.filter((x) => x !== id);
    await api.put('/api/formats/hidden', { ids }).catch(showError);
    app.formats.hidden = ids;
  }

  /* ------------------------------- immich link ------------------------------- */
  let immich = $state<{ linked: boolean; credentialValid: boolean; account: { name: string; email: string } | null } | null>(null);
  let linkMethod = $state<'password' | 'apikey'>('password');
  let link = $state({ email: '', password: '', apiKey: '' });
  let linkError = $state('');

  async function loadImmich() {
    if (!app.config?.immich) return;
    try {
      immich = await api.get('/api/immich/status');
    } catch {
      immich = null;
    }
  }

  async function linkImmich(e: Event) {
    e.preventDefault();
    linkError = '';
    try {
      await api.post('/api/account/immich', linkMethod === 'apikey' ? { method: 'apikey', apiKey: link.apiKey } : { method: 'password', email: link.email, password: link.password });
      link = { email: '', password: '', apiKey: '' };
      await loadSession();
      await loadImmich();
    } catch (err) {
      linkError = err instanceof ApiError ? errorText(err.code) : t('errors.generic');
    }
  }

  async function unlinkImmich() {
    await api.del('/api/account/immich').catch(showError);
    await loadSession();
    await loadImmich();
  }

  /* --------------------------------- password --------------------------------- */
  let pw = $state({ current: '', password: '' });
  async function changePassword(e: Event) {
    e.preventDefault();
    try {
      await api.post('/api/account/password', pw);
      pw = { current: '', password: '' };
      toast(t('settings.saved'));
    } catch (err) {
      showError(err);
    }
  }

  onMount(loadImmich);
</script>

<h1>{t('settings.title')}</h1>
<div class="cols">
  <form class="panel" onsubmit={save}>
    <h2>{t('settings.prefs')}</h2>
    {#if app.config?.immich}
      <label class="field"><span>{t('settings.album')}</span><input bind:value={prefs.immichAlbum} maxlength="200" /></label>
      <p class="hint">{t('settings.albumHint')}</p>
    {/if}
    <label class="field"><span>{t('settings.fitMode')}</span>
      <select bind:value={prefs.fitMode}>
        {#each ['fill', 'fit', 'border'] as m (m)}<option value={m}>{t(`editor.mode.${m}`)}</option>{/each}
      </select>
    </label>
    <label class="field"><span>{t('settings.jpegQuality')} ({prefs.jpegQuality})</span><input type="range" min="50" max="100" bind:value={prefs.jpegQuality} /></label>
    <label class="field"><span>{t('settings.dpi')}</span>
      <select bind:value={prefs.dpi}>
        <option value={null}>{t('settings.dpiDefault', { dpi: app.config?.defaultDpi ?? 300 })}</option>
        {#each [150, 200, 240, 300, 360, 400, 600] as d (d)}<option value={d}>{d}</option>{/each}
      </select>
    </label>
    <label class="field"><span>{t('settings.units')}</span>
      <select bind:value={prefs.units}>
        <option value="cm">{t('settings.unitCm')}</option>
        <option value="in">{t('settings.unitIn')}</option>
      </select>
    </label>
    <label class="check"><input type="checkbox" bind:checked={prefs.includeGps} /> {t('output.gps')}</label>
    <button class="primary" type="submit">{t('common.save')}</button>
  </form>

  <section class="panel">
    <h2>{t('format.manage')}</h2>
    <p class="hint">{t('format.labHint')}</p>
    <h3>{t('format.group.custom')}</h3>
    {#if app.formats.custom.length}
      <table>
        <tbody>
          {#each app.formats.custom as f (f.id)}
            <tr>
              <td>{f.name}<br /><span class="muted small">{sizeLabel(f, 'portrait', 'cm')} · {sizeLabel(f, 'portrait', 'in')}</span></td>
              <td class="actions">
                <button onclick={() => (editing = { id: f.id, name: f.name, width: f.width, height: f.height, unit: f.unit })}>{t('common.edit')}</button>
                <button class="danger" onclick={() => deleteFormat(f)}>{t('common.delete')}</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    {#if editing}
      <form class="fmt" onsubmit={saveFormat}>
        <label class="field"><span>{t('format.name')}</span><input bind:value={editing.name} required maxlength="60" /></label>
        <div class="row">
          <label class="field"><span>{t('format.width')}</span><input type="number" step="0.01" min="0.1" bind:value={editing.width} required /></label>
          <label class="field"><span>{t('format.height')}</span><input type="number" step="0.01" min="0.1" bind:value={editing.height} required /></label>
          <label class="field"><span>{t('format.unit')}</span>
            <select bind:value={editing.unit}><option value="cm">cm</option><option value="mm">mm</option><option value="in">Zoll</option></select>
          </label>
        </div>
        {#if formatError}<p class="error-text">{formatError}</p>{/if}
        <div class="row">
          <button class="primary" type="submit">{t('common.save')}</button>
          <button type="button" onclick={() => (editing = null)}>{t('common.cancel')}</button>
        </div>
      </form>
    {:else}
      <button onclick={newFormat}>+ {t('format.new')}</button>
    {/if}

    <h3 class="mt">{t('format.hide')}</h3>
    <div class="hidden-list">
      {#each app.formats.builtin as f (f.id)}
        <div class="row builtin">
          <label class="check grow"><input type="checkbox" checked={!app.formats.hidden.includes(f.id)} onchange={(e) => toggleHidden(f.id, !e.currentTarget.checked)} /> {f.name} <span class="muted small">{sizeLabel(f, 'portrait', 'cm')}</span></label>
          <button class="small" title={t('format.adjustHint')} onclick={() => { editing = { id: null, name: `${f.name} (${t('format.adjusted')})`, width: f.width, height: f.height, unit: f.unit }; formatError = ''; }}>{t('format.adjust')}</button>
        </div>
      {/each}
    </div>
  </section>

  {#if app.config?.immich}
    <section class="panel">
      <h2>{t('settings.immich')}</h2>
      {#if app.user?.kind === 'immich'}
        <p>{t('settings.immichByLogin', { name: app.user.name })}</p>
      {:else if immich?.linked && immich.account}
        <p>{t('settings.immichLinked', { name: immich.account.name, email: immich.account.email })}</p>
        <button class="danger" onclick={unlinkImmich}>{t('settings.immichUnlink')}</button>
      {:else}
        {#if immich?.linked}<p class="error-text">{errorText('immich.credentialInvalid')}</p>{/if}
        <div class="tabs">
          <button class:active={linkMethod === 'password'} onclick={() => (linkMethod = 'password')}>{t('login.withPassword')}</button>
          <button class:active={linkMethod === 'apikey'} onclick={() => (linkMethod = 'apikey')}>{t('login.withApiKey')}</button>
        </div>
        <form onsubmit={linkImmich}>
          {#if linkMethod === 'apikey'}
            <label class="field"><span>{t('login.apiKey')}</span><input type="password" autocomplete="off" bind:value={link.apiKey} required /></label>
            <p class="hint">{t('login.apiKeyHint')}</p>
          {:else}
            <label class="field"><span>{t('login.email')}</span><input type="email" bind:value={link.email} required autocomplete="off" /></label>
            <label class="field"><span>{t('login.password')}</span><input type="password" bind:value={link.password} required autocomplete="off" /></label>
          {/if}
          {#if linkError}<p class="error-text">{linkError}</p>{/if}
          <button class="primary" type="submit">{t('settings.immichLink')}</button>
        </form>
      {/if}
    </section>
  {/if}

  {#if app.user?.kind === 'local'}
    <form class="panel" onsubmit={changePassword}>
      <h2>{t('settings.password')}</h2>
      <label class="field"><span>{t('settings.currentPassword')}</span><input type="password" bind:value={pw.current} required autocomplete="current-password" /></label>
      <label class="field"><span>{t('settings.newPassword')}</span><input type="password" bind:value={pw.password} required minlength="8" autocomplete="new-password" /></label>
      <button class="primary" type="submit">{t('common.save')}</button>
    </form>
  {/if}
</div>

<style>
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem; align-items: start; }
  input:not([type='checkbox']):not([type='range']), select { width: 100%; }
  .row .field { flex: 1; }
  .actions { white-space: nowrap; text-align: right; }
  .fmt { margin-top: 0.8rem; }
  .mt { margin-top: 1.2rem; }
  .hidden-list { max-height: 320px; overflow: auto; }
  .builtin { flex-wrap: nowrap; }
  .builtin button { min-height: 28px; padding: 0.2em 0.6em; font-size: 0.8rem; }
</style>
