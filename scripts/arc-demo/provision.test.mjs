import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provision } from './provision.mjs';

const key = 'TEST_API_KEY:local:fixture';
const wallet = { id: 'wallet-id', address: '0x1111111111111111111111111111111111111111', blockchain: 'ARC-TESTNET', accountType: 'EOA', custodyType: 'DEVELOPER' };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'nana-circle-setup-test-'));
  const calls = [];
  const client = {
    createWalletSet: async input => { calls.push(['set', input]); return { data: { walletSet: { id: 'set-id' } } }; },
    createWallets: async input => { calls.push(['wallet', input]); return { data: { wallets: [wallet] } }; },
    getWallet: async () => ({ data: { wallet } }),
  };
  const sdk = {
    registerEntitySecretCiphertext: async () => { calls.push(['register']); return { data: { recoveryFile: 'fixture-recovery' } }; },
    initiateDeveloperControlledWalletsClient: () => client,
  };
  return { directory, calls, sdk, client };
}

test('creates only a testnet EOA, protects secrets, and does not recreate on rerun', async () => {
  const f = fixture();
  assert.deepEqual(await provision(key, f), wallet);
  assert.deepEqual(await provision(key, f), wallet);
  assert.deepEqual(f.calls.map(c => c[0]), ['register', 'set', 'wallet']);
  assert.equal(f.calls[2][1].count, 1);
  assert.deepEqual(f.calls[2][1].blockchains, ['ARC-TESTNET']);
  const statePath = join(f.directory, 'provisioning.json');
  assert.equal(statSync(statePath).mode & 0o777, 0o600);
  assert.equal(readFileSync(statePath, 'utf8').includes(key), false);
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).entitySecret.length, 64);
});

test('rejects production API keys before calling SDK', async () => {
  const f = fixture();
  await assert.rejects(provision('LIVE_API_KEY:local:fixture', f), /TEST_API_KEY/);
  assert.equal(f.calls.length, 0);
});

test('registration error blocks repeats and never rotates an existing secret', async () => {
  const f = fixture();
  let attempts = 0;
  f.sdk.registerEntitySecretCiphertext = async () => { attempts++; throw new Error('secret must never reach output'); };
  await assert.rejects(provision(key, f), /No rotation was attempted/);
  await assert.rejects(provision(key, f), /manual checking/);
  assert.equal(attempts, 1);
});

test('wallet creation retry reuses its persisted idempotency key', async () => {
  const f = fixture();
  const inputs = [];
  f.client.createWallets = async input => {
    inputs.push(input);
    if (inputs.length === 1) throw new Error('network timeout');
    return { data: { wallets: [wallet] } };
  };
  await assert.rejects(provision(key, f), /network timeout/);
  await provision(key, f);
  assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(f.calls.filter(c => c[0] === 'set').length, 1);
});

test('rejects a response on the wrong chain', async () => {
  const f = fixture();
  f.client.createWallets = async () => ({ data: { wallets: [{ ...wallet, blockchain: 'ETH' }] } });
  await assert.rejects(provision(key, f), /Arc Testnet EOA/);
});
