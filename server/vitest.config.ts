// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Fotodruck contributors

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', '../shared/**/*.test.ts'],
    testTimeout: 30000,
  },
  server: { fs: { allow: ['..'] } },
});
