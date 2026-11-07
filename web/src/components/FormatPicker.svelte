<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { aspectLabel, type PhotoFormat, sizeLabel } from '../../../shared/formats';
  import { t } from '../lib/i18n';
  import { app, allFormats } from '../lib/state.svelte';

  let { value, onSelect }: { value: string; onSelect: (id: string) => void } = $props();

  const groups = ['classic', 'large', 'square', 'panorama', 'din', 'id', 'custom'] as const;
  const visible = $derived(allFormats().filter((f) => f.custom || !app.formats.hidden.includes(f.id) || f.id === value));
  const recent = $derived(app.formats.recent.map((id) => visible.find((f) => f.id === id)).filter((f): f is PhotoFormat => !!f));

  function label(f: PhotoFormat): string {
    const units = app.prefs?.units ?? 'cm';
    const primary = sizeLabel(f, 'portrait', units);
    const other = sizeLabel(f, 'portrait', units === 'cm' ? 'in' : 'cm');
    const named = /^[\d ×,.]+$/.test(f.name) ? '' : `${f.name} – `;
    return `${named}${primary} · ${other} (${aspectLabel(f)})`;
  }
</script>

<select aria-label={t('editor.format')} {value} onchange={(e) => onSelect(e.currentTarget.value)}>
  {#if recent.length}
    <optgroup label={t('editor.recent')}>
      {#each recent as f (f.id)}<option value={f.id}>{label(f)}</option>{/each}
    </optgroup>
  {/if}
  {#each groups as g (g)}
    {@const list = visible.filter((f) => f.group === g)}
    {#if list.length}
      <optgroup label={t(`format.group.${g}`)}>
        {#each list as f (f.id)}<option value={f.id}>{label(f)}</option>{/each}
      </optgroup>
    {/if}
  {/each}
</select>

<style>
  select { width: 100%; }
</style>
