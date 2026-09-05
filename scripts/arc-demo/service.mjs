import { randomUUID } from 'node:crypto';
import { verifyReceipt } from './send-once.mjs';

export const CHAIN = 'ARC-TESTNET';
export const TOKEN = '0x3600000000000000000000000000000000000000';
export const AMOUNT = '0.000001';
export const SOURCE = '0x6983977dfa3fd16f8cb3a0e94c797ab4c7f06efc';

export function transferInput(recipient, idempotencyKey) {
  return {
    walletAddress: SOURCE, blockchain: CHAIN, tokenAddress: TOKEN,
    destinationAddress: recipient, amount: [AMOUNT],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    idempotencyKey, refId: idempotencyKey,
  };
}

export async function arcRpc(method, params = []) {
  const response = await fetch('https://rpc.testnet.arc.io', {
    method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok || data.error || !('result' in data)) throw new Error('Arc RPC unavailable.');
  return data.result;
}

function plainUnits(units, decimals) {
  const value = BigInt(units).toString().padStart(decimals + 1, '0');
  const fraction = value.slice(-decimals).replace(/0+$/, '');
  return value.slice(0, -decimals) + (fraction ? '.' + fraction : '');
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Circle request timeout.')), 20000);
    })]);
  } finally { clearTimeout(timer); }
}

export function createDemoService({ client, rpc = arcRpc, store, senderId, recipientId, recipientAddress, recoveredKey, now = Date.now }) {
  const normalized = recipientAddress?.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized ?? '') || normalized === SOURCE || /^0x0{36}(0000|dead)$/.test(normalized)) throw new Error('Invalid demo recipient.');
  let state = store.read() ?? { phase: 'idle' };
  if (state.phase === 'submitting') {
    state.phase = 'uncertain';
    store.write(state);
  }
  let queue = Promise.resolve();
  function exclusive(fn) {
    const pending = queue.then(fn);
    queue = pending.catch(() => {});
    return pending;
  }
  function save(next) { store.write(next); state = next; }
  function view(message) {
    return {
      phase: state.phase, network: 'Arc Testnet', token: 'USDC', amount: AMOUNT,
      sender: SOURCE, recipient: recipientAddress,
      balance: state.balance ?? null, estimatedFee: state.estimatedFee ?? null,
      previewId: state.phase === 'preview' ? state.previewId : null,
      hash: state.hash ?? null,
      explorer: state.hash ? `https://testnet.arcscan.app/tx/${state.hash}` : null,
      message: message ?? state.message ?? 'Hola, soy Nani. Esta demo guiada permite consultar el saldo y enviar un micropago a tu wallet de prueba.',
      guided: true,
    };
  }
  async function verifyWallets() {
    const [sender, recipient, chainId] = await Promise.all([
      bounded(client.getWallet({ id: senderId })), bounded(client.getWallet({ id: recipientId })), rpc('eth_chainId'),
    ]);
    if (BigInt(chainId) !== 5042002n) throw new Error('Wrong chain.');
    for (const [response, expectedId, address] of [[sender, senderId, SOURCE], [recipient, recipientId, normalized]]) {
      const wallet = response.data?.wallet;
      if (wallet?.id !== expectedId || wallet?.blockchain !== CHAIN || wallet?.accountType !== 'EOA'
        || wallet?.custodyType !== 'DEVELOPER' || wallet?.address?.toLowerCase() !== address) throw new Error('Wallet identity mismatch.');
    }
  }
  async function refresh() {
    if (!state.transactionId || !['submitted', 'uncertain'].includes(state.phase)) return view();
    try {
      const tx = (await bounded(client.getTransaction({ id: state.transactionId }))).data?.transaction;
      if (tx?.txHash && /^0x[0-9a-fA-F]{64}$/.test(tx.txHash)) {
        save({ ...state, hash: tx.txHash });
        if (BigInt(await rpc('eth_chainId')) !== 5042002n) throw new Error('Wrong chain.');
        const [onchain, receipt] = await Promise.all([
          rpc('eth_getTransactionByHash', [tx.txHash]), rpc('eth_getTransactionReceipt', [tx.txHash]),
        ]);
        if (verifyReceipt(onchain, receipt, recipientAddress, tx.txHash)) {
          let balance = null;
          try { balance = plainUnits(await rpc('eth_getBalance', [SOURCE, 'latest']), 18); } catch { /* Keep verified payment if balance lookup fails. */ }
          save({ ...state, balance, phase: 'confirmed', message: 'Listo. El micropago de 0.000001 USDC está confirmado en Arc Testnet.', block: receipt.blockNumber });
        } else if (receipt) {
          save({ ...state, phase: 'uncertain', message: 'Hay un recibo, pero no pude validar el pago esperado. No lo voy a repetir.' });
        }
      } else if (['FAILED', 'CANCELLED', 'DENIED'].includes(tx?.state)) {
        // Require manual review before allowing another payment, even after provider rejection.
        save({ ...state, phase: 'rejected', message: 'Circle rechazó esta operación. No se reintentará automáticamente.' });
      }
    } catch {
      save({ ...state, message: 'Todavía no pude verificar el resultado. No repitas el envío; podés volver a consultar.' });
    }
    return view();
  }
  async function message(text, previewId) {
    const command = text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.!?]+$/, '');
    if (['saldo', 'ver saldo', 'cuanto tengo'].includes(command)) {
      try {
        if (BigInt(await rpc('eth_chainId')) !== 5042002n) throw new Error('Wrong chain.');
        const balance = plainUnits(await rpc('eth_getBalance', [SOURCE, 'latest']), 18);
        save({ ...state, balance });
        return view(`Tenés ${balance} USDC de prueba en Arc Testnet.`);
      } catch { return view('No pude consultar el saldo. No se envió ninguna transacción.'); }
    }
    if (['verificar', 'ver transaccion', 'estado'].includes(command)) return refresh();
    if (['cancelar', 'cancelo'].includes(command)) {
      if (state.phase !== 'preview') return view('No hay un preview que se pueda cancelar. Un envío iniciado no se cancela desde acá.');
      save({ ...state, phase: 'cancelled', previewId: null, message: 'Cancelado. No envié el micropago.' });
      return view();
    }
    if (['enviar micropago', 'manda un micropago', 'manda un micropago a la wallet demo', 'enviar', 'micropago'].includes(command)) {
      if (['preview', 'submitting', 'submitted', 'uncertain', 'rejected'].includes(state.phase)) return view('Ya hay una operación para revisar. Confirmá o cancelá el preview, o consultá el estado del envío.');
      try {
        await verifyWallets();
        const result = await bounded(client.estimateTransferFee({
          walletId: senderId, tokenAddress: TOKEN, blockchain: CHAIN,
          destinationAddress: recipientAddress, amount: [AMOUNT],
        }));
        const fee = result.data?.medium?.networkFee;
        if (typeof fee !== 'string' || !/^\d+(\.\d+)?$/.test(fee) || Number(fee) > 0.1) throw new Error('Fee exceeds demo policy.');
        const idempotencyKey = !state.hasSubmitted && recoveredKey ? recoveredKey : randomUUID();
        save({ phase: 'preview', balance: state.balance, hasSubmitted: state.hasSubmitted ?? false,
          previewId: randomUUID(), idempotencyKey, estimatedFee: fee, previewedAt: now(),
          message: 'Preparé el micropago. Revisá el importe, el destino y la comisión. Escribí confirmar o cancelar.',
        });
        return view();
      } catch { return view('No pude preparar un preview seguro. No envié fondos.'); }
    }
    if (['confirmar', 'confirmo'].includes(command)) {
      if (state.phase !== 'preview' || !previewId || previewId !== state.previewId) return view('No hay un preview vigente que coincida con esta confirmación.');
      if (now() - state.previewedAt > 300000) {
        save({ ...state, phase: 'cancelled', previewId: null });
        return view('El preview venció. Pedí uno nuevo antes de confirmar.');
      }
      try { await verifyWallets(); }
      catch { return view('No pude verificar las wallets. No envié fondos.'); }
      save({ ...state, phase: 'submitting', hasSubmitted: true, message: 'Enviando el micropago aprobado.' });
      try {
        const response = await bounded(client.createTransaction(transferInput(recipientAddress, state.idempotencyKey)));
        if (!response.data?.id) throw new Error('Unknown dispatch.');
        save({ ...state, phase: 'submitted', transactionId: response.data.id, message: 'Circle aceptó el envío. Estoy esperando la confirmación en Arc.' });
      } catch (error) {
        const rejected = error?.status === 400 && error?.code === 2;
        save({ ...state, phase: rejected ? 'rejected' : 'uncertain',
          message: rejected ? 'Circle rechazó los parámetros. No reintentaré el pago automáticamente.'
            : 'No pude determinar si Circle aceptó el envío. No lo voy a repetir.',
        });
      }
      return refresh();
    }
    return view('Esta demo usa comandos guiados: saldo, enviar micropago, confirmar, cancelar y verificar. El importe es fijo: 0.000001 USDC.');
  }
  return { view: () => view(), message: (text, previewId) => exclusive(() => message(text, previewId)), refresh: () => exclusive(refresh) };
}
