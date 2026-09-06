# 01 — Research questions

Current-state questions only. No solution choices smuggled in.

## RQ1 — Provider boundary surface

**Question:** What operations does the `WalletProvider` interface require, and what types does it return?
**Why it matters:** Any Circle Wallets integration must satisfy this exact boundary; it defines the migration surface.
**Evidence to inspect:** `src/wallet/provider.ts`, `src/contracts/http.ts`.
**Scope exclusions:** Frontend concerns.

## RQ2 — Provider selection and gating

**Question:** How are `fixture` vs `wdk-mcp` (live) providers selected today (`WDK_TOOLS_SOURCE`, env vars, wiring in `src/runtime/dependencies.ts`)?
**Why it matters:** A Circle provider would need an equivalent selection/gate path; the default must remain fixture.
**Evidence to inspect:** `src/runtime/dependencies.ts`, `docs/local-live-runbook.md`.
**Scope exclusions:** Secret values themselves.

## RQ3 — Current live WDK path

**Question:** What does the current WDK live path require end to end (MCP server `wdk-transaction-agent`, wallet creation, networks list, seeds, transaction flow)?
**Why it matters:** This is the baseline Circle Wallets would replace; also reveals what WDK already provides "for free".
**Evidence to inspect:** `docs/create-wallet.md`, `docs/local-live-runbook.md`, `src/wallet/wdk-provider.ts`, `tests/integration/wdk-mcp.test.ts`.
**Scope exclusions:** Key/seed values.

## RQ4 — Circle Wallets requirements on Arc testnet

**Question:** What does standing up Circle Wallets on `ARC-TESTNET` require — API surface, credentials/API keys, custody model (developer-controlled vs user-controlled/PIN), walletset creation, gas station setup, USDC balance model (native 18-dec vs ERC-20 6-dec)?
**Why it matters:** Determines the operational cost and security model tradeoff vs WDK self-custody.
**Evidence to inspect:** developers.circle.com (Wallets, Gas Station, ARC-TESTNET release notes), docs.arc.io wallet integration.
**Scope exclusions:** Circle mainnet-only features.

## RQ5 — Payment flow constraints (preview + confirmation + idempotency)

**Question:** Which parts of the preview → confirm → execute flow (with idempotency key) live in the provider vs in the agent/HTTP layer, and what does the Circle transaction lifecycle (pending/final states, deterministic finality, blocklist reverts) map onto?
**Why it matters:** The repo's non-negotiable payment flow must stay intact; "un rechazo definitivo vs error de red ambiguo" mapping must be preserved.
**Evidence to inspect:** `src/contracts/http.ts`, `src/wallet/provider.ts`, `src/wdk/transaction-receipt.ts`, Circle Wallets transaction states docs.
**Scope exclusions:** Agent prompt/instructions redesign.

## RQ6 — Test and eval dependency on the provider boundary

**Question:** Which tests/evals exercise `WalletProvider` and would a second live provider implementation affect them (fixture parity expectations, integration/e2e gating on `WDK_E2E`)?
**Why it matters:** Estimating the real cost of adding a provider variant without breaking CI or evals.
**Evidence to inspect:** `tests/` tree (unit/integration/simulation/e2e), `evals/`, `docs/evals.md`.
**Scope exclusions:** Frontend tests.

## RQ7 — Arc testnet operational specifics

**Question:** What are the concrete Arc testnet parameters (chain ID, RPC, faucet, explorer, USDC contract) and Circle-side features (Gas Station paymaster, CCTP in) needed for a working testnet wallet?
**Why it matters:** Feasibility check with real numbers before any design decision.
**Evidence to inspect:** docs.arc.io references, Circle faucet docs, release notes.
**Scope exclusions:** Mainnet.
