# 00 — Intake

## Outcome

Add model/agent evals to Nana Wallet, including evaluation of the voice pipeline (STT → agent → TTS), so that agent behavior (tool selection, transfer guards, confirmation flow) and voice quality can be measured repeatably instead of only spot-checked manually.

## Acceptance evidence (provisional)

- An eval harness runnable via a package script or CLI command.
- Eval results with scores/verdicts persisted (files or reports) for a defined scenario set.
- Voice evals with a defined measurement approach (see research).
- Existing test suite still green after integration.

## Granted authority

- Read: entire repository, docs.
- Write (planning artifacts): `.agent-workflow/tasks/agent-voice-evals/`.
- Write (implementation): NOT yet granted — bound to design approval and structure outline gates.

## Read scope

- `src/agent/`, `src/conversations/`, `src/livekit/`, `src/api/`, `src/wallet/`
- `apps/nana-wallet/src/features/agent/voice/`, `apps/nana-wallet/src/routes/`
- `tests/`, `apps/nana-wallet/src/mocks/`, package.json scripts
- External (web): industry practice for LLM-as-judge, voice-agent evals (STT WER, TTS quality, agent task success).

## Write scope (implementation, tentative until design approval)

- Likely a new `evals/` area (backend) and supporting fixtures; possible small seams in agent code if needed.

## Non-goals (provisional)

- No CI setup (none exists today) unless explicitly decided in design.
- No changes to the transfer-guard security behavior — evals measure it, never weaken it.
- No production telemetry/observability platform adoption; evals are repo-local.

## Selected route

RPI workflow (humanlayer-rpi-workflow skill). Current phase: research questions → research.

## Active gate

Research gate: scope must cover the unknown current state (partly answered by repo scan; user questions pending).
