// GHSA-fc5q-39xc-vjpf has no upstream fix as of this release. Build configuration
// uses ordinary glob syntax only. Disable extglob parsing, including explicit
// caller overrides, in every installed picomatch parser until an upstream fix.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const marker = '/* MfaroEdu: disable extglobs until GHSA-fc5q-39xc-vjpf is patched */';
let found = 0;
async function visit(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.isSymbolicLink() || e.name === '.bin') continue;
    const current = path.join(dir, e.name);
    if (e.name === 'picomatch') {
      const file = path.join(current, 'lib/parse.js');
      let source = await readFile(file, 'utf8');
      if (!source.includes(marker)) {
        const anchor = "  if (typeof opts.noext === 'boolean') {";
        if (!source.includes(anchor) || !source.includes('const opts = { ...options };'))
          throw new Error(
            'Review the picomatch mitigation against the new parser before building.',
          );
        source = source.replace(
          anchor,
          `  ${marker}\n  opts.noextglob = true;\n  opts.noext = true;\n${anchor}`,
        );
      }
      if (!source.includes('MfaroEdu: reject extended glob syntax')) {
        const entry = 'const parse = (input, options) => {';
        if (!source.includes(entry)) throw new Error('Review the picomatch parser entry point.');
        source = source.replace(
          entry,
          `${entry}\n  // MfaroEdu: reject extended glob syntax, including explicit caller overrides.\n  if (typeof input === 'string' && /[?+*@!]\\(/.test(input)) {\n    throw new SyntaxError('Extended glob syntax is disabled pending the picomatch security fix.');\n  }`,
        );
      }
      await writeFile(file, source, 'utf8');
      found++;
    }
    if (e.name === 'node_modules' || dir.endsWith('node_modules') || e.name.startsWith('@'))
      await visit(current);
    else {
      try {
        await visit(path.join(current, 'node_modules'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
}
await visit('node_modules');
if (!found) throw new Error('Expected picomatch dependency was not found.');
console.log(`Guarded ${found} picomatch parser(s); extglob syntax is disabled for build tools.`);
