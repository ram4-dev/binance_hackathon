# 00 — Intake

## Outcome

Evaluar con evals el pipeline realtime con GPT (PR #3 `feat/openai-realtime-poc`): las tools de wallet dentro de la sesión realtime (`send_token`, guardas, preview→confirm) y la calidad del comportamiento de voz end-to-end. Los evals del pipeline viejo (STT/TTS separado con DeepSeek/ElevenLabs, calidad conversacional del texto) pierden prioridad porque realtime con GPT es la única path de voz hacia adelante.

## Acceptance evidence (provisional)

- Evals que corren contra la sesión realtime del PR #3 (o su equivalente) verificando: tool calls correctas, guardas (preview-only, confirmation_required, policy_rejected), flujo de confirmación por voz.
- Los evals existentes re-clasificados: qué queda, qué queda como comparador, qué se depreca.
- Suite verde post-integración.

## Granted authority

- Read: todo el repo + PR #3 (branch `feat/openai-realtime-poc`).
- Write (planning): `.agent-workflow/tasks/realtime-tools-evals/`.
- Write (implementation): NO concedido — gate de design + outline + worktree.

## Read scope

- PR #3: `src/livekit/realtime-tools/**`, `create-agent-session.ts`, `service.ts` (+103), `realtime-latency-logger.ts`, `worker.ts`, `memory/runtime.ts`, tests nuevos del PR.
- `evals/` (harness existente, PR #2).
- Main (ff94a07): runtime nativo LiveKit (PR #1).

## Non-goals (provisional)

- No migrar código: PR #3 ya es la migración — este task es sobre evals.
- No implementar CI.
- No evals adversariales (mismo scope-out que v1).

## Selected route

RPI workflow v1.1 (humanlayer-rpi-workflow). Fase: research questions → research (revisión del PR #3).

## Active gate

Research gate: cobertura del estado actual (PR #3 + harness existente).
