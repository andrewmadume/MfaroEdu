import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    serviceWorkers: 'block',
  },
  webServer:
    process.env.MFARO_E2E_EXTERNAL === '1'
      ? []
      : [
          {
            command:
              'node node_modules/vite/bin/vite.js preview --configLoader native --host 127.0.0.1 --outDir .e2e/plain --port 4173 --strictPort',
            url: 'http://127.0.0.1:4173',
            reuseExistingServer: !process.env.CI,
            env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
          },
          {
            command:
              'node node_modules/vite/bin/vite.js preview --configLoader native --host 127.0.0.1 --outDir .e2e/configured --port 4174 --strictPort',
            url: 'http://127.0.0.1:4174',
            reuseExistingServer: !process.env.CI,
            env: {
              VITE_SUPABASE_URL: 'https://test-school.supabase.co',
              VITE_SUPABASE_PUBLISHABLE_KEY: 'public-test-fixture',
            },
          },
        ],
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
});
