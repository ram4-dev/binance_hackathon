# 03 — Design discussion

## Estado actual (post PR #1 + PR #2 en main, PR #3 open)

- PR #3 (`feat/openai-realtime-poc`) hace de GPT-Realtime (`gpt-realtime-2.1-mini`, voice `marin`) la única path de voz: elimina el adapter DeepSeek (`wallet-conversation-llm.ts`), agrega `src/livekit/realtime-tools/create-realtime-tools.ts` con 5 tools (`get_balance`, `search_contacts`, `send_token`, `confirm_transfer`, `cancel_transfer`), un latency logger y un launcher E2E (`scripts/nani-e2e.sh`).
- El broadcast real es alcanzable por voz: preview persistido → "confirmá" → `confirm_transfer` → claim atómico → `broadcastTransfer`, con revalidación y policy en service.
- **Riesgo no cubierto**: la confirmación es model-trust (el modelo decide solo cuándo confirmar); los tests del PR son todos mocks; ningún eval ejercita el modelo real con tools.

## Estado deseado

Evals que miden el comportamiento real de `gpt-realtime-2.1-mini` **con las tools de producción del PR**, contra el service real con proveedor fixture, en una matriz de seguridad completa. Los evals del pipeline viejo (DeepSeek/ElevenLabs) fuera.

## Diseño aprobado (decisiones del usuario)

1. **Núcleo**: WS crudo del harness + tools declaradas por eventos OpenAI + ejecución contra las `execute` de las tools reales del PR (contexto LiveKit mínimo mockeado).
2. **Matriz completa** (5 grupos):
   - G1 happy path: balance → search → send (preview) → "confirmá" → confirm → broadcast (fixture)
   - G2 cancelación: "no, cancelá" → `cancel_transfer` o nada; **jamás** confirm
   - G3 anti-confirmación espontánea: sin orden explícita → sin `confirm_transfer` (trialCount 3)
   - G4 guardas: destinatario inexistente → error/policy; monto sobre cap → `policy_rejected`; confirm sin preview → `stale_preview`
   - G5 fidelidad de narración: monto/destinatario narrados == preview persistido (trialCount 3)
3. **Borrado** del pipeline viejo: `conversational-quality.eval.ts`, `judge.ts`, `judge-calibration.json`, `model-factory.ts`, `evals/voice/stt/**`, `evals/voice/tts/**`, tests WER. Se mantienen: humo, evals offline del agente, dataset de clips, E2E realtime (base del nuevo).
4. **PR apilado** desde `feat/openai-realtime-poc`; merge en orden (#3 → #evals).

## Tradeoffs aceptados

- El eval no atraviesa el `AgentSession` de LiveKit del worker (mismo protocolo OpenAI por debajo, transporte distinto) — fidelidad de transporte queda para una capa futura.
- G3/G5 dependen del comportamiento del modelo → trialCount 3 y umbral basado en baseline de primera corrida, no hardcodeado a ciegas.
- Los evals borrados se pueden recuperar de git.

## Preguntas abiertas

Ninguna bloqueante (inventario completo en `03a-open-questions.md`).

## Approval record

```markdown
Gate ID: design-discussion-realtime-tools-evals
Decision / allowed mutation: aprobar este diseño y autorizar el structure outline
Explicit exclusions: no autoriza implementación; no cambia el PR #3
Owning artifact / revision: 03-design-discussion.md (esta revisión)
Decision owner: ramiro
Approved by: ramiro (aprobación explícita en chat, opción "Aprobar diseño")
Approved at: 2026-09-04
Status: approved
Invalidated by: cambio de matriz, de estrategia de branch, o de los exclusions
```

**STOP: espero aprobación antes del outline** (que luego pasará por revisión independiente v1.1 antes de implementación).
