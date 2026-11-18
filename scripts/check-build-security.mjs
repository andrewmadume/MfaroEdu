import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url),
  picomatch = require('picomatch');
for (const pattern of ['+(*)', '+(*a)', '*(*)', '@(a|b)', '!(a)']) {
  assert.throws(
    () => picomatch.makeRe(pattern, { noext: false, noextglob: false }),
    /Extended glob syntax is disabled/,
  );
  assert.throws(
    () => picomatch.parse(pattern, { noext: false, noextglob: false }),
    /Extended glob syntax is disabled/,
  );
}
assert.equal(picomatch.isMatch('assets/app.js', '**/*.{js,css}'), true);
assert.equal(picomatch.isMatch('assets/image.png', '**/*.{js,css}'), false);
console.log(
  'Build glob mitigation verified: vulnerable syntax is rejected; normal asset patterns work.',
);
