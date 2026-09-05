import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { readSecret } from './read-secret.mjs';

test('secret input is returned without echoing it', async () => {
  const input = new PassThrough();
  let output = '';
  const target = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
  const result = readSecret('Secret:', input, target);
  input.write('local-fixture-secret\n');
  assert.equal(await result, 'local-fixture-secret');
  assert.equal(output, 'Secret:\n');
});
