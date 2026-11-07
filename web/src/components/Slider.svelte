<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Fotodruck contributors -->
<script lang="ts">
  import { t } from '../lib/i18n';

  let {
    label,
    value = $bindable(),
    min,
    max,
    step = 1,
    reset = 0,
    unit = '',
    digits = 0,
    onBegin,
    onEnd,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    reset?: number;
    unit?: string;
    digits?: number;
    onBegin: () => void;
    onEnd: () => void;
  } = $props();
</script>

<label class="slider" title={t('editor.sliderHint')}>
  <span class="top"><span>{label}</span><span class="val">{value.toLocaleString('de-DE', { maximumFractionDigits: digits })}{unit}</span></span>
  <input
    type="range"
    {min}
    {max}
    {step}
    bind:value
    onpointerdown={onBegin}
    onkeydown={onBegin}
    onfocus={onBegin}
    onchange={onEnd}
    ondblclick={() => {
      onBegin();
      value = reset;
      onEnd();
    }}
  />
</label>

<style>
  .slider { margin-bottom: 0.5rem; }
  .top { display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--muted); }
  .val { font-variant-numeric: tabular-nums; color: var(--text); }
</style>
