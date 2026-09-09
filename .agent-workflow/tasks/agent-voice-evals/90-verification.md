# 90 — Verificación

Task: agent-voice-evals (RPI workflow). Fecha: 2026-09-04.
Worktree: `aleph-hackathon-worktrees/agent-voice-evals` (branch `agent-voice-evals`).

## Slices verificados

| Slice | Estado | Evidencia |
| --- | --- | --- |
| 1 — Setup evalite | ✅ | Humo 100% en `npm run eval`; dashboard HTTP 200 (3006); suite existente intacta |
| 2 — Evals agente offline | ✅ | 10 evals al 100%, sin red ni claves (`env -u` verificado); 4 grupos de escenarios |
| 3 — Judge conversacional | ✅ | Offline 100% (mock + schema + ordening bad<good); corrida real persistida en `judge-calibration.json` |
| 4 — Dataset STT | ✅ | 30 clips + manifest (FLEURS es_419, CC-BY-4.0); download idempotente; gitignored |
| 5 — Eval STT (WER) | ✅ | WER con TDD (10 unit tests RED→GREEN); baselines: gpt-4o-transcribe 2.2%, gpt-4o-mini-transcribe 2.7% |
| 6 — TTS round-trip | ⚠️ Superseded por Slice 8 (Amendment 2) | Harness conservado; baseline opcional ejecutado: WER 7.1% (openai-tts + openai-transcribe) |
| 7 — EVAL_MODELS + docs | ✅ | `EVAL_MODELS` parseado (unit check via tsx); factory de proveedores; `docs/evals.md` |
| 8 — E2E realtime | ✅ | 5/5 turnos exitosos (score 1.0), TTFA medio 2.6s, respuestas en español; offline harness 100% |

## Comandos ejecutados (corridas reales)

1. `EVAL_STT_PROVIDER=openai-transcribe EVAL_REAL=1 npx evalite run evals/voice/stt` → WER 2.2% (30 clips)
2. `EVAL_STT_PROVIDER=openai-mini-transcribe EVAL_REAL=1 npx evalite run evals/voice/stt` → WER 2.7% (30 clips)
3. `AGENT_PROVIDER=openai EVAL_JUDGE_PROVIDER=openai EVAL_JUDGE_MODEL=gpt-5.6-luna EVAL_REAL=1 npx evalite run evals/agent/conversational-quality` → 5 veredictos persistidos (hallazgo: gpt-5.6-luna no corre el agente por chat/completions — ver hallazgos)
4. `EVAL_REAL=1 npx evalite run evals/voice/realtime` → 5/5 exitosos
5. `EVAL_REAL=1 EVAL_TTS_PROVIDER=openai-tts EVAL_STT_PROVIDER=openai-transcribe npx evalite run --hideTable evals/voice/tts` → WER 7.1% (5 muestras)

## Verificación final

- `npm run eval` (offline, todo): **exit 0** — 6 archivos / 15 evals / 100%
- `npm test`: **278 passed | 17 skipped** (13 nuevos: 10 de WER + 3 de idioma de aclaración)
- `npm run typecheck`: **limpio**
- Corrida real E2E realtime: **exit 0**

### Fix post-verificación (2026-09-04)

Hallazgo #3 corregido con aprobación de ramiro: `clarificationMessage()` bilingüe (en/es) respetando `options.language`. TDD: `tests/unit/wallet-agent-clarification-language.test.ts` (RED→GREEN, 3 tests). Consecuencia: la aclaración de destinatario ambiguo ahora sale en español ("¿A qué destinatario te referís: …?"). Quedan en inglés (fuera de scope, anotado): mensajes `no_match`/`unavailable`.

## Checks manuales pendientes (dueño: ramiro)

- [ ] Abrir el dashboard: `npm run eval:serve` (Slice 1)
- [ ] Escuchar 2-3 clips de `evals/voice/.audio/` vs sus transcripciones (Slice 4)
- [ ] Escuchar 2-3 respuestas de audio del E2E realtime (Slice 8)
- [ ] Etiquetar `human_label` en `evals/agent/judge-calibration.json` (calibración del juez)

## No ejecutado / descartado

- Baseline STT de `nan` (Whisper): **descartado por decisión de ramiro** (2026-09-04) — el pipeline actual queda sin baseline; el provider `nan` se removió del registro de STT.
- Agente real con modelo OpenAI de texto: bloqueado por los 2 hallazgos de migración (Responses API + tool schema). No es falla del harness; corresponde al trabajo de integración.

## Desviaciones respecto al outline

Registradas en `04-structure-outline.md` → Deviations log (slices 1, 3, 4, 5, 7, 8; Amendments 1 y 2).

## Entrega

- Branch: `feat/agent-voice-evals` (5 work-unit commits, conventional, sin atribución)
- PR: <https://github.com/ram4-dev/nana-wallet/pull/2> (label `type:feature`)

## Próximo dueño

- ramiro: checks manuales + etiquetado del juez.
- Trabajo de integración (fuera de este task): migración del pipeline a `gpt-realtime-2.1-mini` (resuelve los hallazgos de migración).
