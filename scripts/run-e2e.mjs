// Own preview processes directly, avoiding Windows npm/shell process-tree teardown hangs.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const servers = [];
const healthy = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
};
async function serve(mode, port) {
  const url = `http://127.0.0.1:${port}`;
  if (await healthy(url)) return;
  const child = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--configLoader',
      'native',
      '--host',
      '127.0.0.1',
      '--outDir',
      `.e2e/${mode}`,
      '--port',
      String(port),
      '--strictPort',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  servers.push(child);
  const started = Date.now();
  while (!(await healthy(url))) {
    if (child.exitCode !== null || Date.now() - started > 30000)
      throw new Error(`Preview did not start on ${port}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
try {
  await serve('plain', 4173);
  await serve('configured', 4174);
  const runner = spawn(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
    { stdio: 'inherit', windowsHide: true, env: { ...process.env, MFARO_E2E_EXTERNAL: '1' } },
  );
  const [code] = await once(runner, 'exit');
  process.exitCode = code ?? 1;
} finally {
  for (const child of servers) {
    child.kill();
  }
}
