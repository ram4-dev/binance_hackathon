# 02 — Research

Sources: repo files (explorer handoff, full reads) + Circle docs via MCP search
and developers.circle.com fetches. All findings carry source paths.

## RQ1 — Provider boundary surface

`src/wallet/provider.ts` (44 lines) defines the exact integration surface:

- Types: `WalletContext`, `WalletProviderHealth`, `WalletNetwork`
  `{network; kind}`, `WalletToken` `{network; token; decimals}`,
  `WalletAddress`, `WalletBalance`, `WalletHistory`, `BroadcastOutcome`
  (`submitted | uncertain | not_dispatched`), `FinalityOutcome`
  (`confirmed | reverted | receipt_invalid` + hash + reason), `FinalityRequest`,
  `TransferRequest`.
- `WalletProvider` interface methods: `health`, `listNetworks`, `listTokens`,
  `getAddress`, `getBalance`, `getHistory`, `previewTransfer`, `broadcastTransfer`,
  `waitForFinality`, `close`. Plus `id` and `mode: 'fixture'|'live'`.
- HTTP contract (`src/contracts/http.ts`): `TransferPreview`
  `{network, token, recipient, amount, estimatedFee}`, `TransactionResult`
  `{network, transactionHash, explorerUrl}`.

**Constraint found:** `FinalityOutcome.network` is typed as the literal
`'sepolia'` (L19-24) — adding a second live network requires touching this type.

## RQ2 — Provider selection and gating

- `src/runtime/dependencies.ts` L37-44: `createWalletProvider` →
  `WDK_TOOLS_SOURCE === "live"` selects `WdkWalletProvider`; **anything else
  selects `FixtureWalletProvider`** (safe default).
- Nuance (L48-50): in fixture mode, `walletReads` is a `WdkWalletProvider`
  wired to `legacyToolSource()` (6 legacy tools), not the fixture provider.
- Other env: `SEPOLIA_RPC_URL`, `WDK_WALLET_NAME`, `WDK_NETWORK`, `WDK_TOKEN`
  (default `USDT`), `WDK_MAX_TRANSFER_AMOUNT`, `WDK_ALLOWED_RECIPIENTS`,
  broadcast gates `WDK_LIVE`/`WDK_ALLOW_BROADCAST`/`WDK_BROADCAST_APPROVED`
  (docs/local-live-runbook.md).
- `isFixtureMode()` (`src/agent/wdk-tools.ts` L23-25) =
  `process.env.WDK_TOOLS_SOURCE !== 'live'`.

## RQ3 — Current live WDK path

- WDK MCP server is bundled: `@tetherto/wdk-cli/bin/wdk-mcp.mjs` spawned over
  stdio with an allowlisted env (`src/wdk/mcp-client.ts`). Single-use clients,
  required tools asserted (`get_networks … send_token`).
- Wallet provisioning is **manual CLI**: `wdk wallet create --words 12`,
  `unlock --ttl`, fund test USDT + gas token (`docs/create-wallet.md`).
  Self-custody: seed phrase local, socket-auth, no third party.
- `previewTransfer` calls `send_token {dryRun: true}` and reads
  `estimatedFeeFormatted` (`src/wallet/wdk-provider.ts` L143-151).
- Finality: `waitForSepoliaTransactionReceipt` polls
  `eth_getTransactionReceipt` against `SEPOLIA_RPC_URL` (default publicnode,
  4s poll), validates `status 0x1/0x0` (`src/wdk/transaction-receipt.ts`).
  **Hard-wired to Sepolia chain id 11155111.**

## RQ4 — Circle Wallets on ARC-TESTNET

Primary sources: developers.circle.com
`/wallets/dev-controlled/create-your-first-wallet`,
`/wallets/dev-controlled/transfer-tokens-across-wallets`,
`/w3s/asynchronous-states-and-statuses`, release notes 2025.10.27, plus the
MCP SDK resource list for `@circle-fin/developer-controlled-wallets`.

**Support:** `ARC-TESTNET` added 2025.10.27 to wallets, transfers, signing,
contract execution, fee estimation, validateAddress, monitored tokens.
Full infrastructure support (broadcast + indexing + webhooks + Gas Station +
Paymaster + Gateway) — not the "signing-only" tier.

**Requirements to stand up:**

1. Circle Console account + **API key** (Standard Key).
2. **Entity Secret**: 32-byte key generated locally, registered with Circle
   (recovery file download); Circle never stores it. Sent with every request
   as ciphertext (`generateEntitySecretCiphertext`).
3. SDK: npm `@circle-fin/developer-controlled-wallets`
   (`initiateDeveloperControlledWalletsClient({apiKey, entitySecret})`).
   Node.js 22+ (repo already uses Node 22).
4. `createWalletSet({name})` → `createWallets({walletSetId, blockchains:
   ["ARC-TESTNET"], count})` → EOA by default; `accountType: "SCA"` optional.
   All EVM wallets in a set share the same address (unified addressing).
5. Funding: Circle Faucet (faucet.circle.com) provides Arc testnet USDC;
   SDK also exposes `requestTestnetTokens` (usdc/native/eurc flags).
   **Gas is USDC on Arc — no separate ETH needed.**

**Transaction flow:**

- `createTransaction({walletId | blockchain+walletAddress, tokenId |
  blockchain+tokenAddress, amounts, destinationAddress, fee: {feeLevel LOW/
  MEDIUM/HIGH} | absolute {gasLimit, maxFee, priorityFee} | gas, refId?,
  idempotencyKey?})` → returns `{id, state}`. **Native idempotency key
  support at the API level.**
- `estimateTransferFee` → per-level `{gasLimit, gasPrice, maxFee, priorityFee,
  networkFee}` (useful for `previewTransfer`).
- `getTransaction(id)` / `listTransactions({txHash, walletIds…})` for polling.
- States: `INITIATED → QUEUED → CLEARED → SENT → STUCK? → CONFIRMED →
  COMPLETE` (terminal) or `CANCELLED/FAILED/DENIED` (terminal, with
  `errorReason`/`errorDetails`). Cancel only in INITIATED/QUEUED/SENT;
  accelerate in SENT/STUCK.
- Webhooks available (`createSubscription`) as an alternative to polling.
- Custody model: developer-controlled (Circle holds key shares, we hold the
  entity secret) vs user-controlled (PIN/session, user-managed). For Nana's
  agent wallet, developer-controlled is the matching model.

**Balance model on Arc:** native USDC (18 decimals, `eth_getBalance` view)
vs ERC-20 interface (6 decimals, `balanceOf`) — same balance, two views.
Circle balances are token-based (returns per-token amounts); display must
normalize to 6-dec USDC and never list the ERC-20 contract as a second asset
(docs.arc.io/integrate/wallets). Dust < 1e-6 shows `balanceOf() = 0` but is
still spendable as gas.

## RQ5 — Payment flow constraints

- Idempotency: `previewId` is the conversation-flow idempotency token
  (`conversationDecisionRequestSchema` L205-208); atomic claim in Postgres
  (`claimPendingTransfer`, `postgres-repository.ts` L364-415,
  `status='previewed' → 'broadcasting'` with `claim_id`), plus
  `FinancialTaskRegistry` per `operationId`. **Circle's own `idempotencyKey`
  param is a second, complementary layer (protects against double POST to
  Circle itself).**
- Rejection vs ambiguity mapping lives in `wdk-provider.broadcastTransfer`
  (L129-160): `not_dispatched` if `attempted === false`; anything without a
  reliable hash → `{kind:'uncertain'}`. Circle maps cleanly:
  - Not dispatched = terminal `DENIED`/`FAILED` before `SENT` (no txHash) →
    definitive rejection.
  - `uncertain` = network error before Circle confirms receipt of the request
    → poll `listTransactions({refId or txHash})` to resolve.
  - `submitted` = response contains transaction `id` (even before txHash).
- Finality: `CONFIRMED → COMPLETE`. On Arc, finality is deterministic (<1s, no
  reorgs), so `COMPLETE` ≈ instant; `waitForFinality` maps to polling
  `getTransaction` until terminal, then `confirmed`/`reverted` from
  `errorReason`. `receipt_invalid` has no direct analog (Circle is the
  receipt source, not raw RPC).
- **Gap found (explorer):** the frontend payment-intent flow
  (`apps/nana-wallet/src/lib/api.ts` L104-109, L252-264: `Idempotency-Key`
  header, `/v1/payments/:intentId/confirm`) has **no backend implementation**
  in `src/` — it exists only in MSW mocks. Confirm endpoint in backend is
  `POST /v1/conversations/:conversationId/decisions`. This is a pre-existing
  contract divergence, independent of this spike.

## RQ6 — Test / eval dependency

- Contract parity: `tests/unit/wallet-provider-contract.test.ts` runs
  `assertContract` over `FixtureWalletProvider` and `WdkWalletProvider` — a
  third implementation would be added there.
- Selection: `tests/unit/worker-dependencies.test.ts` mocks both providers;
  would need a case for the new gate.
- Evals never touch `wdk-mcp`; they use `RecordingWalletProvider` +
  `FixtureWalletProvider` and assert `mode === 'fixture'`
  (`evals/voice/realtime/eval-fixtures.ts` L311-316) — **unaffected** as long
  as default remains fixture.
- E2E gating precedent: `tests/e2e/wdk-mcp-connection.e2e.test.ts` gated by
  `WDK_E2E === '1'`. A Circle provider would follow the same pattern
  (secret-less CI, opt-in local run).
- CI has no Circle credentials; nothing live can run in CI — consistent with
  repo policy (no secrets, fixture default).

## RQ7 — Arc testnet operational parameters

- Chain ID `5042002` (testnet); RPC `https://rpc.testnet.arc.io`;
  explorer `testnet.arcscan.app`; USDC ERC-20 contract
  `0x3600000000000000000000000000000000000000` (docs.arc.io/integrate/wallets,
  connect-to-arc). CCTP domain `26` (Circle quickstart).
- viem ships `arcTestnet` chain def (Circle quickstart imports it).
- Faucet: faucet.circle.com (Arc testnet USDC). Gas paid in native USDC.
- Webhooks/notifications available from Circle (deposit/withdrawal, tx state).

## Remaining gaps

1. Whether `wdk-token` modules (the WDK token abstraction) matter on Arc —
   out of scope: spike targets the `WalletProvider` boundary, not WDK token
   extensions.
2. Circle pricing on testnet (free tier limits) — operational detail to
   verify during the spike with a real console account.
3. Frontend payment-intent backend gap (RQ5) — pre-existing, separate change.
