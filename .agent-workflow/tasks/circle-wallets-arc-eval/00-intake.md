# 00 — Intake: Circle Wallets on Arc (option 2)

## Outcome

A researched, evidence-based design discussion (no code) on adopting **Circle Wallets** as the wallet provider for **Arc Testnet** in Nana Wallet, evaluated against the existing `WalletProvider` boundary. Ends in either an approved design that moves to `openspec/` (Stage 2) or a documented decision to stay on WDK.

## Acceptance evidence

- Research answers every question in `01-research-questions.md` with source paths or primary docs.
- `03-design-discussion.md` presents current state, desired state, options, tradeoffs, and a recommendation.
- All controlling questions in `03a-open-questions.md` resolved or explicitly deferred.

## Granted authority

Read-only inspection of the repository + web research of Circle/Arc docs. **No code changes, no env/secret changes, no live-mode enablement.**

## Read scope

- `src/wallet/provider.ts`, `src/wallet/wdk-provider.ts`, `src/wallet/fixture-provider.ts`
- `src/runtime/dependencies.ts` (provider selection / `WDK_TOOLS_SOURCE` gate)
- `src/contracts/http.ts` (preview/confirmation/idempotency contract)
- `docs/local-live-runbook.md`, `docs/create-wallet.md`, `docs/architecture.md`
- `tests/integration/wdk-mcp.test.ts`, `tests/e2e/wdk-mcp-connection.e2e.test.ts`
- Circle docs (developers.circle.com, docs.arc.io) via MCP/web

## Write scope

Only this scaffold: `.agent-workflow/tasks/circle-wallets-arc-eval/`.

## Non-goals

- Implementing anything (Stage 2 only after approved design).
- Enabling `WDK_TOOLS_SOURCE=live` or touching seeds/private keys.
- Switching the default mode away from fixture.
- Mainnet considerations (Arc testnet only).

## Selected route

RPI (humanlayer-rpi-workflow) — Stage 1 of nana-wallet-flow.

## Explicit decision (scope)

**Objective: Spike de integración** (user-approved). The research targets what a
`CircleWalletProvider` behind the existing `WalletProvider` boundary requires
(endpoints, credentials, custody model, lifecycle mapping). Comparative
migration analysis is out of scope; WDK remains the default until an approved
design says otherwise.

## Active gate

Research (RQ1–RQ7)
