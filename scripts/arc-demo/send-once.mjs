import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, openSync, closeSync, unlinkSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const DIRECTORY = fileURLToPath(new URL('../../.local/arc-demo/', import.meta.url));
const SOURCE = '0x6983977dfa3fd16f8cb3a0e94c797ab4c7f06efc';
const TOKEN = '0x3600000000000000000000000000000000000000';
const AMOUNT = '0.000001';
const CHAIN = 'ARC-TESTNET';

function save(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}

async function rpc(method, params = []) {
  const r = await fetch('https://rpc.testnet.arc.io', {
    method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000),
  });
  const body = await r.json();
  if (!r.ok || body.error) throw new Error('RPC verification unavailable.');
  return body.result;
}

export function verifyReceipt(transaction, receipt, destination, hash) {
  const input = transaction?.input?.toLowerCase();
  const sameHash = receipt?.transactionHash?.toLowerCase() === hash.toLowerCase()
    && transaction?.hash?.toLowerCase() === hash.toLowerCase();
  const senderMatches = transaction?.from?.toLowerCase() === SOURCE
    && receipt?.from?.toLowerCase() === SOURCE;
  if (!sameHash || !senderMatches || receipt?.status !== '0x1'
    || transaction?.chainId && BigInt(transaction.chainId) !== 5042002n) return false;
  const native = transaction.to?.toLowerCase() === destination.toLowerCase()
    && BigInt(transaction.value ?? '0') === 1000000000000n && (input === '0x' || input === '');
  const transferInput = '0xa9059cbb' + destination.slice(2).toLowerCase().padStart(64, '0') + '1'.padStart(64, '0');
  const erc20 = transaction.to?.toLowerCase() === TOKEN && BigInt(transaction.value ?? '0') === 0n
    && input === transferInput && receipt.logs?.some(log =>
      log.address?.toLowerCase() === TOKEN
      && log.topics?.[0]?.toLowerCase() === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
      && log.topics?.[1]?.slice(-40).toLowerCase() === SOURCE.slice(2)
      && log.topics?.[2]?.slice(-40).toLowerCase() === destination.slice(2).toLowerCase()
      && BigInt(log.data) === 1n);
  return Boolean(native || erc20);
}

async function run(apiKey, mode) {
  if (!/^TEST_API_KEY:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/.test(apiKey)) throw new Error('Test key required.');
  if (!['prepare', 'send', 'verify'].includes(mode)) throw new Error('Choose prepare, send or verify.');
  process.umask(0o077);
  for (const path of [DIRECTORY, `${DIRECTORY}/provisioning.json`]) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Private provisioning files required.');
  }
  const lockPath = `${DIRECTORY}/smoke.lock`;
  const lock = openSync(lockPath, 'wx', 0o600);
  try {
    const provisioning = JSON.parse(readFileSync(`${DIRECTORY}/provisioning.json`, 'utf8'));
    if (provisioning.registration !== 'registered' || provisioning.wallet?.address?.toLowerCase() !== SOURCE) throw new Error('Wrong sender configuration.');
    const { initiateDeveloperControlledWalletsClient } = await import('@circle-fin/developer-controlled-wallets');
    const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret: provisioning.entitySecret });
    const path = `${DIRECTORY}/smoke.json`;
    const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {
      walletKey: randomUUID(), transferKey: randomUUID(), amount: AMOUNT, sender: SOURCE,
    };
    if (state.amount !== AMOUNT || state.sender !== SOURCE) throw new Error('Payment scope mismatch.');
    save(path, state);
    if (BigInt(await rpc('eth_chainId')) !== 5042002n) throw new Error('Wrong chain.');
    const sender = (await client.getWallet({ id: provisioning.wallet.id })).data?.wallet;
    if (sender?.address?.toLowerCase() !== SOURCE || sender.blockchain !== CHAIN || sender.accountType !== 'EOA') throw new Error('Sender verification failed.');
    if (!state.recipient) {
      if (mode !== 'prepare') throw new Error('Prepare the recipient first.');
      const result = await client.createWallets({
        walletSetId: provisioning.walletSetId, blockchains: [CHAIN], count: 1, accountType: 'EOA',
        metadata: [{ name: 'Nana demo recipient', refId: 'nana-arc-demo-recipient' }], idempotencyKey: state.walletKey,
      });
      const wallet = result.data?.wallets?.[0];
      if (wallet?.blockchain !== CHAIN || wallet.accountType !== 'EOA' || wallet.custodyType !== 'DEVELOPER'
        || !/^0x[0-9a-fA-F]{40}$/.test(wallet.address) || wallet.address.toLowerCase() === SOURCE) throw new Error('Recipient verification failed.');
      state.recipient = { id: wallet.id, address: wallet.address };
      save(path, state);
    }
    const recipient = (await client.getWallet({ id: state.recipient.id })).data?.wallet;
    if (recipient?.address?.toLowerCase() !== state.recipient.address.toLowerCase() || recipient?.blockchain !== CHAIN) throw new Error('Recipient identity mismatch.');
    const transfer = {
      walletAddress: SOURCE, blockchain: CHAIN, tokenAddress: TOKEN, destinationAddress: state.recipient.address,
      amount: [AMOUNT], fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      idempotencyKey: state.transferKey, refId: state.transferKey,
    };
    if (mode === 'prepare') {
      if (state.dispatchStarted) throw new Error('Payment already dispatched. Use verify.');
      const estimate = await client.estimateTransferFee({ walletId: provisioning.wallet.id, tokenAddress: TOKEN, blockchain: CHAIN, destinationAddress: state.recipient.address, amount: [AMOUNT] });
      const fee = estimate.data?.medium?.networkFee;
      if (typeof fee !== 'string' || !/^\d+(\.\d+)?$/.test(fee) || Number(fee) > 0.1) throw new Error('Fee missing or above demo limit.');
      state.estimatedFee = fee;
      state.previewedAt = Date.now();
      save(path, state);
      console.log(JSON.stringify({ preview: true, network: CHAIN, token: 'USDC', amount: AMOUNT, from: SOURCE, to: state.recipient.address, estimatedFeeUSDC: fee }));
      return;
    }
    if (mode === 'send' && !state.transactionId) {
      if (state.dispatchStarted) throw new Error('Previous dispatch is uncertain. Do not create another payment.');
      if (!state.previewedAt || Date.now() - state.previewedAt > 600000) throw new Error('Prepare a fresh preview first.');
      // This CLI is only invoked after user approval of this single micropayment.
      state.dispatchStarted = true;
      save(path, state);
      const response = await client.createTransaction(transfer);
      if (!response.data?.id) throw new Error('Dispatch result uncertain.');
      state.transactionId = response.data.id;
      save(path, state);
    }
    if (!state.transactionId) throw new Error('No dispatched transaction to verify.');
    for (let attempt = 0; attempt < 20; attempt++) {
      const transaction = (await client.getTransaction({ id: state.transactionId })).data?.transaction;
      if (transaction?.txHash) {
        state.hash = transaction.txHash;
        save(path, state);
        const [onchain, receipt] = await Promise.all([
          rpc('eth_getTransactionByHash', [state.hash]), rpc('eth_getTransactionReceipt', [state.hash]),
        ]);
        if (verifyReceipt(onchain, receipt, state.recipient.address, state.hash)) {
          state.confirmed = true;
          state.blockNumber = receipt.blockNumber;
          save(path, state);
          console.log(JSON.stringify({ confirmed: true, hash: state.hash, amountUSDC: AMOUNT, recipient: state.recipient.address, explorer: `https://testnet.arcscan.app/tx/${state.hash}` }));
          return;
        }
        if (receipt) throw new Error('Receipt did not validate the authorized transfer.');
      }
      if (['FAILED', 'DENIED', 'CANCELLED'].includes(transaction?.state)) throw new Error('Circle reported a terminal non-success state.');
      await delay(2000);
    }
    console.log(JSON.stringify({ confirmed: false, state: 'verification_pending', transactionId: state.transactionId, hash: state.hash }));
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = createInterface({ input: process.stdin, terminal: false });
  const key = await new Promise(resolveKey => input.once('line', resolveKey));
  input.close();
  try { await run(key.trim(), process.argv[2]); }
  catch (error) {
    console.error(JSON.stringify({ completed: false, code: typeof error?.code === 'number' ? error.code : undefined, message: 'Demo stopped. Keep local state and verify before any retry. No credential details logged.' }));
    process.exitCode = 1;
  }
}
