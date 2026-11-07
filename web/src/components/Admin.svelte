<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '../lib/api';
  import { errorText, fmtDate, t } from '../lib/i18n';
  import { app, showError, toast } from '../lib/state.svelte';

  interface U {
    id: string;
    kind: 'local' | 'immich' | 'none';
    email: string | null;
    name: string;
    isAdmin: boolean;
    createdAt: number;
  }
  let users = $state<U[]>([]);
  let settings = $state<{ allowRegistration: boolean; visiblePrinters: string[] | null }>({ allowRegistration: false, visiblePrinters: null });
  let printers = $state<{ id: string; name: string }[]>([]);
  let printersError = $state('');
  let form = $state({ email: '', name: '', password: '', isAdmin: false });
  let formError = $state('');
  const local = $derived(app.config?.authMode === 'local');

  async function load() {
    try {
      [users, settings] = await Promise.all([api.get<U[]>('/api/admin/users'), api.get<typeof settings>('/api/admin/settings')]);
    } catch (err) {
      showError(err);
    }
    if (app.config?.print) {
      try {
        printers = (await api.get<{ items: { id: string; name: string }[] }>('/api/admin/printers')).items;
      } catch (err) {
        printersError = err instanceof ApiError ? errorText(err.code) : t('errors.generic');
      }
    }
  }

  async function create(e: Event) {
    e.preventDefault();
    formError = '';
    try {
      await api.post('/api/admin/users', form);
      form = { email: '', name: '', password: '', isAdmin: false };
      await load();
    } catch (err) {
      formError = err instanceof ApiError ? errorText(err.code) : t('errors.generic');
    }
  }

  async function resetPassword(u: U) {
    const pw = prompt(t('admin.newPasswordPrompt', { email: u.email ?? u.name }));
    if (!pw) return;
    try {
      await api.patch(`/api/admin/users/${encodeURIComponent(u.id)}`, { password: pw });
      toast(t('settings.saved'));
    } catch (err) {
      showError(err);
    }
  }

  async function setAdmin(u: U, isAdmin: boolean) {
    try {
      await api.patch(`/api/admin/users/${encodeURIComponent(u.id)}`, { isAdmin });
      u.isAdmin = isAdmin;
    } catch (err) {
      showError(err);
      await load();
    }
  }

  async function remove(u: U) {
    if (!confirm(t('admin.deleteConfirm', { email: u.email ?? u.name }))) return;
    await api.del(`/api/admin/users/${encodeURIComponent(u.id)}`).catch(showError);
    await load();
  }

  async function saveSettings(patch: Partial<typeof settings>) {
    try {
      await api.put('/api/admin/settings', patch);
      settings = { ...settings, ...patch };
      toast(t('settings.saved'));
    } catch (err) {
      showError(err);
    }
  }

  function togglePrinter(id: string, on: boolean) {
    const cur = settings.visiblePrinters ?? printers.map((p) => p.id);
    const next = on ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    saveSettings({ visiblePrinters: next });
  }

  onMount(load);
</script>

<h1>{t('admin.title')}</h1>
<div class="cols">
  <section class="panel">
    <h2>{t('admin.users')}</h2>
    <table>
      <tbody>
        {#each users as u (u.id)}
          <tr>
            <td>{u.name}<br /><span class="muted small">{u.email ?? ''} · {t(`admin.kind.${u.kind}`)} · {fmtDate(new Date(u.createdAt).toISOString())}</span></td>
            <td>
              {#if u.kind === 'local'}
                <label class="check"><input type="checkbox" checked={u.isAdmin} disabled={u.id === app.user?.id} onchange={(e) => setAdmin(u, e.currentTarget.checked)} /> {t('admin.isAdmin')}</label>
              {:else if u.isAdmin}
                <span class="badge">{t('admin.isAdmin')}</span>
              {/if}
            </td>
            <td class="actions">
              {#if u.kind === 'local'}<button onclick={() => resetPassword(u)}>{t('admin.resetPassword')}</button>{/if}
              {#if u.id !== app.user?.id}<button class="danger" onclick={() => remove(u)}>{t('common.delete')}</button>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if local}
      <form class="new" onsubmit={create}>
        <h3>{t('admin.newUser')}</h3>
        <label class="field"><span>{t('login.name')}</span><input bind:value={form.name} /></label>
        <label class="field"><span>{t('login.email')}</span><input type="email" bind:value={form.email} required /></label>
        <label class="field"><span>{t('settings.newPassword')}</span><input type="password" bind:value={form.password} minlength="8" required autocomplete="new-password" /></label>
        <label class="check"><input type="checkbox" bind:checked={form.isAdmin} /> {t('admin.isAdmin')}</label>
        {#if formError}<p class="error-text">{formError}</p>{/if}
        <button class="primary" type="submit">{t('common.add')}</button>
      </form>
      <label class="check reg"><input type="checkbox" checked={settings.allowRegistration} onchange={(e) => saveSettings({ allowRegistration: e.currentTarget.checked })} /> {t('admin.registration')}</label>
    {/if}
  </section>

  {#if app.config?.print}
    <section class="panel">
      <h2>{t('admin.printers')}</h2>
      {#if printersError}<p class="error-text">{printersError}</p>{/if}
      <label class="check"><input type="checkbox" checked={settings.visiblePrinters === null} onchange={(e) => saveSettings({ visiblePrinters: e.currentTarget.checked ? null : printers.map((p) => p.id) })} /> {t('admin.printersAll')}</label>
      {#each printers as p (p.id)}
        <label class="check"><input type="checkbox" disabled={settings.visiblePrinters === null} checked={settings.visiblePrinters === null || settings.visiblePrinters.includes(p.id)} onchange={(e) => togglePrinter(p.id, e.currentTarget.checked)} /> {p.name} <span class="muted small">{p.id}</span></label>
      {/each}
      {#if !printers.length && !printersError}<p class="muted">{t('print.noPrinters')}</p>{/if}
    </section>
  {/if}
</div>

<style>
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1rem; align-items: start; }
  .actions { text-align: right; white-space: nowrap; }
  .new { margin-top: 1rem; }
  .new input { width: 100%; }
  .reg { margin-top: 1rem; }
</style>
