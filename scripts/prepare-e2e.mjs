import { execFileSync } from 'node:child_process';
for (const mode of ['plain', 'configured']) {
  execFileSync(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'build',
      '--configLoader',
      'native',
      '--outDir',
      `.e2e/${mode}`,
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_SUPABASE_URL: mode === 'configured' ? 'https://test-school.supabase.co' : '',
        VITE_SUPABASE_PUBLISHABLE_KEY: mode === 'configured' ? 'public-test-fixture' : '',
      },
    },
  );
}
