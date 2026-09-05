import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, lstatSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const DEFAULT_DIR = fileURLToPath(new URL('../../.local/arc-demo/', import.meta.url));

function writePrivate(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  renameSync(temp, path);
}

function publicWallet(wallet) {
  if (wallet?.blockchain !== 'ARC-TESTNET' || wallet?.accountType !== 'EOA'
    || wallet?.custodyType !== 'DEVELOPER' || !wallet.id
    || !/^0x[0-9a-fA-F]{40}$/.test(wallet.address)) {
    throw new Error('Circle did not return the expected developer-controlled Arc Testnet EOA.');
  }
  return { id: wallet.id, address: wallet.address, blockchain: wallet.blockchain, accountType: wallet.accountType, custodyType: wallet.custodyType };
}

export async function provision(apiKey, { directory = DEFAULT_DIR, sdk } = {}) {
  if (!/^TEST_API_KEY:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/.test(apiKey)) {
    throw new Error('A complete Circle TEST_API_KEY is required.');
  }
  process.umask(0o077);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) {
    throw new Error('Provisioning directory must be private (0700) and not a symlink.');
  }
  const lockPath = join(directory, 'setup.lock');
  const lock = openSync(lockPath, 'wx', 0o600);
  try {
    const statePath = join(directory, 'provisioning.json');
    if (existsSync(statePath)) {
      const stateStat = lstatSync(statePath);
      if (!stateStat.isFile() || stateStat.isSymbolicLink() || (stateStat.mode & 0o077)) {
        throw new Error('Provisioning state must be a private regular file.');
      }
    }
    const state = existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, 'utf8'))
      : { registration: 'new', entitySecret: randomBytes(32).toString('hex'), walletSetKey: randomUUID(), walletKey: randomUUID() };
    // Persist the secret before any registration request, including crash cases.
    writePrivate(statePath, state);
    if (state.registration === 'pending' || state.registration === 'blocked') {
      throw new Error('Previous registration needs manual checking. No retry or secret rotation performed.');
    }
    const circle = sdk ?? await import('@circle-fin/developer-controlled-wallets');
    if (state.registration === 'new') {
      state.registration = 'pending';
      writePrivate(statePath, state);
      const recoveryDirectory = join(directory, 'recovery');
      mkdirSync(recoveryDirectory, { mode: 0o700 });
      try {
        // This is the first-registration POST helper, never a rotation endpoint.
        const response = await circle.registerEntitySecretCiphertext({
          apiKey, entitySecret: state.entitySecret, recoveryFileDownloadPath: recoveryDirectory,
        });
        if (!response.data?.recoveryFile) throw new Error('Missing recovery file.');
        writePrivate(join(recoveryDirectory, 'recovery.json'), { recoveryFile: response.data.recoveryFile });
        state.registration = 'registered';
        writePrivate(statePath, state);
      } catch (error) {
        state.registration = 'blocked';
        state.registrationErrorCode = typeof error?.code === 'number' ? error.code : undefined;
        writePrivate(statePath, state);
        throw new Error(`Registration could not be completed. Check Circle Console for an existing entity secret. No rotation was attempted. Code: ${state.registrationErrorCode ?? 'unavailable'}`);
      }
    }
    const client = circle.initiateDeveloperControlledWalletsClient({ apiKey, entitySecret: state.entitySecret });
    if (!state.walletSetId) {
      const response = await client.createWalletSet({ name: 'Nana Arc Testnet Demo', idempotencyKey: state.walletSetKey });
      if (!response.data?.walletSet?.id) throw new Error('Missing wallet set ID. Keep state for a same-key retry.');
      state.walletSetId = response.data.walletSet.id;
      writePrivate(statePath, state);
    }
    if (!state.wallet) {
      const response = await client.createWallets({
        walletSetId: state.walletSetId, blockchains: ['ARC-TESTNET'], count: 1,
        accountType: 'EOA', metadata: [{ name: 'Nana demo sender', refId: 'nana-arc-demo' }],
        idempotencyKey: state.walletKey,
      });
      if (response.data?.wallets?.length !== 1) throw new Error('Unexpected wallet response. Keep state for a same-key retry.');
      state.wallet = publicWallet(response.data.wallets[0]);
      writePrivate(statePath, state);
    }
    const live = await client.getWallet({ id: state.wallet.id });
    const wallet = publicWallet(live.data?.wallet);
    if (wallet.id !== state.wallet.id || wallet.address.toLowerCase() !== state.wallet.address.toLowerCase()) {
      throw new Error('Wallet identity mismatch.');
    }
    return wallet;
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Caller disables terminal echo. The key is not in argv, disk, or output.
  const input = createInterface({ input: process.stdin, terminal: false });
  const apiKey = await new Promise(resolveKey => input.once('line', resolveKey));
  input.close();
  try {
    const wallet = await provision(apiKey.trim());
    console.log(JSON.stringify({ ...wallet, explorer: `https://testnet.arcscan.app/address/${wallet.address}`, fundsSent: false }, null, 2));
  } catch (error) {
    // Never print SDK errors, request configs, response bodies or headers.
    const own = error instanceof Error && !error.response && !error.request && !error.config;
    console.error(own && error.message.startsWith('Registration could not')
      ? error.message : 'Setup stopped. Private state preserved; no funds sent.');
    process.exitCode = 1;
  }
}
