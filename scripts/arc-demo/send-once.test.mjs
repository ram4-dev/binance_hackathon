import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyReceipt } from './send-once.mjs';

const from = '0x6983977dfa3fd16f8cb3a0e94c797ab4c7f06efc';
const to = '0x1111111111111111111111111111111111111111';
const hash = '0x' + 'a'.repeat(64);
const tx = { hash, from, to, input: '0x', value: '0xe8d4a51000', chainId: '0x4cef52' };
const receipt = { transactionHash: hash, from, status: '0x1', logs: [] };

test('accepts exactly the approved native Arc micropayment', () => {
  assert.equal(verifyReceipt(tx, receipt, to, hash), true);
});
test('rejects wrong amount, sender, destination, chain, hash and reverted receipt', () => {
  for (const patch of [{ value: '0x1' }, { from: to }, { to: from }, { chainId: '0x1' }, { hash: '0x00' }]) {
    assert.equal(verifyReceipt({ ...tx, ...patch }, receipt, to, hash), false);
  }
  assert.equal(verifyReceipt(tx, { ...receipt, status: '0x0' }, to, hash), false);
  assert.equal(verifyReceipt(null, null, to, hash), false);
});
test('ERC20 success requires matching calldata and Transfer log', () => {
  const token = '0x3600000000000000000000000000000000000000';
  const erc20 = { ...tx, to: token, value: '0x0', input: '0xa9059cbb' + to.slice(2).padStart(64, '0') + '1'.padStart(64, '0') };
  const log = { address: token, data: '0x' + '1'.padStart(64, '0'), topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x' + from.slice(2).padStart(64, '0'), '0x' + to.slice(2).padStart(64, '0')] };
  assert.equal(verifyReceipt(erc20, { ...receipt, logs: [log] }, to, hash), true);
  assert.equal(verifyReceipt(erc20, receipt, to, hash), false);
});
