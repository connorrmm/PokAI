import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // `server-only` throws by design when imported outside a server bundle,
      // which would make every module that guards itself with it untestable.
      // The guard exists to stop secrets reaching the browser, not to stop
      // tests -- and the modules it protects are exactly the ones handling
      // money and other people's collections, so they need testing most.
      'server-only': path.resolve(__dirname, '__tests__/stubs/server-only.ts'),
    },
  },
  test: { environment: 'node' },
});
