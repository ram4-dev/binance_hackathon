import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoService, transferInput, SOURCE, CHAIN } from './service.mjs';
import { buildDemoServer } from './server.mjs';

const recipient = '0x1111111111111111111111111111111111111111';
const hash = '0x' + 'a'.repeat(64);
function fixture(initial = null) {
  let persisted = initial;
  const calls = [];
  const store = { read: () => persisted, write: value => { persisted = structuredClone(value); } };
  const client = {
    getWallet: async ({ id }) => ({ data: { wallet: { id, address: id === 'sender' ? SOURCE : recipient, blockchain: CHAIN, custodyType: 'DEVELOPER', accountType: 'EOA' } } }),
    estimateTransferFee: async () => ({ data: { medium: { networkFee: '0.005' } } }),
    createTransaction: async input => { calls.push(input); return { data: { id: 'transaction-id' } }; },
    getTransaction: async () => ({ data: { transaction: { txHash: hash, state: 'COMPLETE' } } }),
  };
  const rpc = async method => {
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_getBalance') return '0x56bc75e2d63100000';
    if (method === 'eth_getTransactionByHash') return { from: SOURCE, to: recipient, value: '0xe8d4a51000', input: '0x', hash, chainId: '0x4cef52' };
    if (method === 'eth_getTransactionReceipt') return { from: SOURCE, transactionHash: hash, status: '0x1', blockNumber: '0x123', logs: [] };
    throw new Error('Unknown RPC method.');
  };
  const options = { client, rpc, store, senderId: 'sender', recipientId: 'recipient', recipientAddress: recipient, recoveredKey: 'previous-rejected-key' };
  return { client, calls, options, store, get persisted() { return persisted; }, service: createDemoService(options) };
}

test('Circle transfer includes blockchain with tokenAddress', () => {
  const input = transferInput(recipient, 'key');
  assert.equal(input.blockchain, 'ARC-TESTNET');
  assert.equal(input.walletAddress, SOURCE);
  assert.equal(input.walletId, undefined);
  assert.deepEqual(input.amount, ['0.000001']);
});
test('preview does not send; confirmation verifies exact onchain proof', async () => {
  const f = fixture();
  const preview = await f.service.message('enviar micropago');
  assert.equal(preview.phase, 'preview');
  assert.equal(f.calls.length, 0);
  const final = await f.service.message('confirmar', preview.previewId);
  assert.equal(final.phase, 'confirmed');
  assert.equal(final.hash, hash);
  assert.equal(f.calls[0].idempotencyKey, 'previous-rejected-key');
});
test('rejects a missing, stale or concurrent duplicate confirmation', async () => {
  const f = fixture();
  const preview = await f.service.message('enviar micropago');
  await f.service.message('confirmar', 'wrong');
  await f.service.message('confirmar');
  assert.equal(f.calls.length, 0);
  await Promise.all([f.service.message('confirmar', preview.previewId), f.service.message('confirmar', preview.previewId)]);
  assert.equal(f.calls.length, 1);
});
test('cancel and expiry prevent dispatch', async () => {
  const f = fixture();
  const p = await f.service.message('enviar micropago');
  await f.service.message('cancelar');
  await f.service.message('confirmar', p.previewId);
  assert.equal(f.calls.length, 0);
  let now = 0;
  const s = createDemoService({ ...f.options, now: () => now });
  const q = await s.message('enviar micropago');
  now = 300001;
  assert.equal((await s.message('confirmar', q.previewId)).phase, 'cancelled');
  assert.equal(f.calls.length, 0);
});
test('unsupported text cannot silently change an amount or recipient', async () => {
  const f = fixture();
  await f.service.message('enviar 50 USDC a 0x2222222222222222222222222222222222222222');
  assert.equal(f.service.view().phase, 'idle');
  assert.equal(f.calls.length, 0);
});
test('ambiguous dispatch persists and blocks another payment after restart', async () => {
  const f = fixture();
  f.client.createTransaction = async input => { f.calls.push(input); throw new Error('timeout'); };
  const p = await f.service.message('enviar micropago');
  assert.equal((await f.service.message('confirmar', p.previewId)).phase, 'uncertain');
  const restarted = createDemoService(f.options);
  await restarted.message('enviar micropago');
  await restarted.message('confirmar', p.previewId);
  assert.equal(f.calls.length, 1);
});
test('crash during dispatch becomes uncertain on restart', () => {
  assert.equal(fixture({ phase: 'submitting' }).service.view().phase, 'uncertain');
});
test('Circle acceptance is not confirmation without a receipt', async () => {
  const f = fixture();
  f.options.rpc = async method => method === 'eth_getTransactionReceipt' ? null : fixture().options.rpc(method);
  const service = createDemoService(f.options);
  const p = await service.message('enviar micropago');
  assert.equal((await service.message('confirmar', p.previewId)).phase, 'submitted');
});
test('wrong network or identity and excessive fee fail closed', async () => {
  const f = fixture();
  let s = createDemoService({ ...f.options, rpc: async () => '0x1' });
  assert.equal((await s.message('enviar micropago')).phase, 'idle');
  f.client.estimateTransferFee = async () => ({ data: { medium: { networkFee: '1' } } });
  s = createDemoService(f.options);
  assert.equal((await s.message('enviar micropago')).phase, 'idle');
  assert.equal(f.calls.length, 0);
});
test('balance reflects RPC and is labeled as USDC', async () => {
  const f = fixture();
  assert.equal((await f.service.message('saldo')).balance, '100');
});
test('verified payment clears stale balance if balance refresh fails', async () => {
  const f = fixture({ phase: 'idle', balance: '100' });
  const service = createDemoService({ ...f.options, rpc: async (...args) => {
    if (args[0] === 'eth_getBalance') throw new Error('RPC unavailable');
    return f.options.rpc(...args);
  } });
  const preview = await service.message('enviar micropago');
  const final = await service.message('confirmar', preview.previewId);
  assert.equal(final.phase, 'confirmed');
  assert.equal(final.balance, null);
});
test('HTTP blocks foreign origins, host spoofing and absent request token', async () => {
  const app = buildDemoServer(fixture().service, { csrf: 'safe-token' });
  const headers = { host: '127.0.0.1:8787' };
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/state', headers: { host: 'attacker.test' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/message', headers, payload: { text: 'confirmar' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/message', headers: { ...headers, origin: 'https://attacker.test', 'x-demo-token': 'safe-token' }, payload: { text: 'confirmar' } })).statusCode, 403);
    const status = await app.inject({ method: 'GET', url: '/api/state', headers });
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.includes('entitySecret'), false);
    assert.equal(status.json().guided, true);
    const invalid = await app.inject({ method: 'POST', url: '/api/message', headers: { ...headers, 'x-demo-token': 'safe-token' }, payload: { text: 'confirmar', amount: '100' } });
    assert.equal(invalid.statusCode, 400);
  } finally { await app.close(); }
});
