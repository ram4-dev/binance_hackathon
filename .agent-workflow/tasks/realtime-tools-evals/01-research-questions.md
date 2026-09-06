# 01 — Research questions

## Respondidas por inspección (repo main ff94a07 + PR #3, 2026-09-04)

### R1 — ¿El PR #3 ya conecta tools de wallet a la sesión realtime?

Sí. `src/livekit/realtime-tools/create-realtime-tools.ts` expone 5 tools a GPT-Realtime vía plugins de LiveKit (`tool()` de `@livekit/agents`): `get_balance`, `search_contacts`, `send_token`, `confirm_transfer`, `cancel_transfer`. Schemas zod estrictos: `send_token` acepta solo `{amount, recipientId, recipientVersion, memo?}` — `dryRun` y direcciones libres son imposibles por schema.

### R2 — ¿Qué guardas aplica el path realtime vs los evals offline?

**Presentes** (vía `service.ts`): revalidación de destinatario en preview y en broadcast, `policy_rejected` (allowlist + cap, modo live), send_token preview-only **más estricto que offline** (schema impide broadcast directo), confirm requiere preview vigente (`stale_preview` si no).
**Más débiles / diferentes**:

- La confirmación es **model-trust**: el modelo Realtime decide solo cuándo llamar `confirm_transfer` (sin params); el matching determinista de frases (`isConfirmation`) queda bypassed en esta path.
- No hay cross-check entre lo que el modelo narró y el preview persistido al confirmar (mitigado por claim + revalidación, pero no verificado).

### R3 — ¿Se puede broadcastear por voz en el PR #3?

**Sí, broadcast real alcanzable**: `send_token` → preview persistido → "confirmá" → modelo llama `confirm_transfer` → `resolveDecision` → claim atómico → `broadcastTransfer`. No es preview-only como el runtime nativo de main (PR #1).

### R4 — ¿Qué modelo proveedor usa la path realtime?

`openai.realtime.RealtimeModel` (plugin LiveKit OpenAI), model `gpt-realtime-2.1-mini` (default), voice `marin`, `OPENAI_API_KEY`. Sin STT/TTS/VAD separados (audio nativo del modelo). Instrucciones de Nana hardcodeadas en español. `wallet-conversation-llm.ts` (path DeepSeek) eliminada en esa branch.

### R5 — ¿Qué cubren los tests del PR y qué falta?

Los tests del PR son **todos mocks**: schema, delegación a service, stale_preview, config de env. **Nada prueba al modelo real**: ni el orden search→send→confirm, ni que `confirm_transfer` dispare solo tras un "confirmá" genuino, ni guardas end-to-end con el modelo Realtime. Ese es exactamente el hueco para los evals.

### R6 — ¿Interacción entre PR #3 y evals/ (main)?

Sin conflicto de archivos (disjoint), pero **conceptualmente divergentes**: `evals/voice/realtime/session.ts` usa un cliente WS crudo propio y NO ejercita la path del PR (create-agent-session + realtime-tools). El PR no tiene `evals/`. La path real de la app con tools por realtime tiene **cero cobertura de eval**.

### R7 — Estado del worktree del POC

Junk: archivo vacío `1{printf` en la raíz. `scripts/nani-e2e.sh` nuevo (launcher E2E de un comando). Commit-level sin verificar (worktree read-only).

## Scope exclusions

- No se evalúa el pipeline DeepSeek/ElevenLabs viejo (deprecado por el PR) — los evals de STT/TTS round-trip y el judge conversacional del texto quedan re-clasificados (comparador o deprecado).
- No se implementa la migración: el PR #3 ya la hace.
