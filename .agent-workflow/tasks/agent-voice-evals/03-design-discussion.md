# 03 — Design discussion

## Estado actual

- Agente: `handleMessage` (`src/agent/wallet-agent.ts:523`) sobre `ToolLoopAgent` (AI SDK v7), modelo OpenCode `deepseek-v4-flash` (`src/agent/model.ts`). Seam inyectable: `HandleMessageOptions.model` (`:237`).
- Guardas de dinero: `buildGuardedTools` (`:389`) con errores tipados (`confirmation_required`, `recipient_revalidation_required`, `policy_rejected`); broadcast solo con preview pendiente.
- Voz: dos transports (LiveKit worker con Deepgram/ElevenLabs; nativo grabado vía `POST /v1/agent/transcribe` Whisper y `POST /v1/voice/speak` ElevenLabs). Ambos convergen en el mismo backend.
- Tests: Vitest (root + apps), suite de agente con fixtures WDK, E2E opt-in con LLM real. **Cero evals, cero CI.**

## Estado deseado

- `evals/` en la raíz del monorepo con evalite como runner: escenarios del agente (texto), judge de calidad conversacional, STT (WER) y TTS (round-trip).
- Dos modos: offline (modelo simulado / runtime determinístico + fixtures WDK) y real (modelo OpenCode, servicios de voz reales), controlado por env.
- Resultados persistidos y comparables: el harness acepta `EVAL_MODELS` para comparar modelos del mismo endpoint sin refactor.

## Opciones y tradeoffs (resumen de la discusión)

| Decisión | Elegida | Alternativas descartadas | Tradeoff aceptado |
| --- | --- | --- | --- |
| Motor de evals | **evalite** | harness propio Vitest; Promptfoo | Más infraestructura de setup; a cambio dashboard, historial y API tipo vitest |
| Juez conversacional | **modelo distinto, mismo endpoint OpenCode** | mismo modelo con rúbrica; sin judge en v1 | Requiere confirmar qué otros modelos ofrece el endpoint; evita self-preference bias |
| Matriz de modelos | **default + configurable (`EVAL_MODELS`)** | varios ahora; uno fijo | Comparabilidad futura sin costo v1 |
| Dataset STT | **~30 clips Common Voice ES, descarga scriptada, dir gitignored** | 10 smoke; 100+ | WER con confianza ±5-8pp; download es parte del setup |
| Alcance voz v1 | **STT (WER) + TTS (round-trip)** | incluir E2E voz; solo STT | E2E voz completo queda v2 |
| Modo | **dual: offline suite + real opt-in** | solo real; solo offline | Duplicación de escenarios mínima (mismos fixtures) |

## Diseño propuesto

### 1. Escenarios del agente (`evals/agent/`)

Dataset de escenarios en TS/JSON: `{ input, expected }` con expected estructurado, no string-match:

- **Selección de tool y parámetros**: "¿cuánta plata tengo?" → `get_balance` con token correcto; "mandale 50 a mamá" → `send_token` con `dryRun: true` (preview) y recipient resuelto.
- **Guardas**: pedido de transferencia sin datos → pide faltantes, nunca broadcast; intento de broadcast sin confirmación → `confirmation_required`; destinatario fuera de allowlist en live → `policy_rejected`; monto sobre el cap → rechazo.
- **Flujo preview→confirm**: preview correcto → "sí, confirmá" → broadcast (en fixture mode).
- **Resolución de destinatario**: "mamá" → contacto de memoria; nombres ambiguos → pregunta, no adivina.
- **Calidad conversacional (judge)**: rúbrica fija — claridad para no-técnicos, ausencia de jerga, español correcto, tono cálido, no menciona detalles técnicos internos. El judge (modelo distinto del endpoint) puntúa 1-5 por criterio con justificación.

Ejecución: los escenarios corren `handleMessage` con `options.model` = modelo simulado (offline) o modelo real (opt-in), `walletProvider` con fixtures WDK (`WDK_TOOLS_SOURCE=fixture`).

### 2. STT eval (`evals/voice/stt/`)

- Script `evals/voice/stt/download-dataset.ts`: baja ~30 clips del split validado de Common Voice ES (licencia CC0) a `evals/voice/.audio/` (gitignored) con su `manifest.json` de clips+transcripciones.
- Eval: por clip → `POST /v1/agent/transcribe` (configurable a Whisper directo) → normalización (minúsculas, sin puntuación, sin acentos comparativos consistente) → WER por clip y agregado.
- Umbral v1: WER medio < 15% reportado (umbral a calibrar en la primera corrida; se persiste baseline, no se hardcodea a ciegas).

### 3. TTS eval (`evals/voice/tts/`)

- Round-trip: texto de respuestas típicas de Nana (incluir montos, direcciones truncadas, español) → `POST /v1/voice/speak` (ElevenLabs real) → audio → transcribir de vuelta con el mismo STT → comparación semántica contra el texto original (normalizada + similitud).
- Smoke determinísticos: audio no vacío, duración proporcional al texto, formato válido.

### 4. Runner y salida

- evalite en la raíz (`evalite.config.ts`), scripts npm: `eval` (offline), `eval:real` (con servicios reales), `eval:voice:dataset` (download).
- Cada eval persiste score + metadatos (modelo, timestamp, duración, costo estimado si disponible) para diff entre corridas.
- `EVAL_MODELS` acepta lista separada por comas de modelos del endpoint OpenCode para comparar.

### 5. Fuera de scope v1

- E2E de voz completo (clips → transcribe → turn → speak). v2.
- Ataques adversariales/jailbreak. Futuro.
- CI (no existe infraestructura; los evals son locales/manuales).
- Juez de audio (Audio-LLM). v2.

## Preguntas abiertas

- Ninguna bloqueante. Pendientes de confirmar en implementación: qué modelos no-default ofrece el endpoint OpenCode (para el judge y `EVAL_MODELS`), y umbrales de WER/judge tras la primera corrida real.

## Decisiones explícitas (aprobadas por el usuario en esta discusión)

1. Motor: evalite.
2. Juez: modelo distinto, mismo endpoint OpenCode, rúbrica fija.
3. Matriz: default + configurable por env.
4. Dataset STT: ~30 clips Common Voice ES scriptados, gitignored.
5. Voz v1: STT + TTS round-trip; E2E v2.
6. Alcance: decisión del agente + calidad conversacional + voz. Adversarial fuera.

## Amendment 1 (2026-09-04, aprobado por ramiro)

**Cambio de arquitectura objetivo:** en lugar de dos modelos OpenCode (evaluado `deepseek-v4-flash` + juez `glm-5.3`), el producto migrará a un **único modelo GPT multimodal realtime: `gpt-realtime-2.1-mini`** (OpenAI, key `OPEN_AI_API_KEY`). El pipeline STT→LLM→TTS converge a speech-to-speech.

Consecuencias aprobadas:

1. Judge pasa a ser texto vía GPT (mismo modelo por defecto; `EVAL_JUDGE_MODEL` queda como override). Self-preference bias documentado; calibración humana como contrapeso. El baseline histórico (deepseek+glm) se conserva en `judge-calibration.json`.
2. STT eval (Slice 5) pasa a **comparativa de proveedores** con el mismo dataset: nan Whisper (pipeline actual), `gpt-4o-transcribe`, `gpt-realtime-whisper` (OpenAI).
3. TTS eval (Slice 6): round-trip contra ElevenLabs + `gpt-4o-mini-tts` como comparación.
4. **Nuevo slice central:** E2E realtime — clips FLEURS → sesión `gpt-realtime-2.1-mini` → transcript de respuesta → task success (juez) + latencia. Era v2; con speech-to-speech pasa a ser el eval principal de voz.
5. Provider seam: `src/agent/model.ts` gana factory por env para correr el agente con cualquier proveedor.
6. Los evals offline (Slice 2) no cambian: son agnósticos del modelo por diseño.

```markdown
Gate ID: design-amendment-single-realtime-model
Decision / allowed mutation: aplicar las 6 consecuencias listadas; modificar outline en consecuencia
Explicit exclusions: no migra la app al modelo realtime (eso es otro trabajo); no borra evals del pipeline actual
Owning artifact / revision: 03-design-discussion.md (Amendment 1)
Decision owner: ramiro
Approved by: ramiro (aprobación explícita en chat, opción "si")
Approved at: 2026-09-04
Status: approved
Invalidated by: reversión del cambio de modelo único
```

## Amendment 2 (2026-09-04, aprobado por ramiro)

**ElevenLabs queda fuera del plan de evals** (decisión del usuario: no se usará más tras la migración a realtime speech-to-speech). Consecuencias:

1. **Slice 6 (TTS round-trip) superseded por Slice 8 (E2E realtime)** — la calidad de la voz sintética se mide sobre la respuesta de audio del modelo realtime, no sobre un TTS separado. El código de `evals/voice/tts/` se conserva con provider `openai-tts` (`gpt-4o-mini-tts`) como harness opcional, pero deja de ser entregable del plan.
2. Claves requeridas en `.env` del worktree solo: `NAN_API_KEY` (STT baseline) y `OPEN_AI_API_KEY` (STT OpenAI, judge, realtime E2E).

```markdown
Gate ID: design-amendment-drop-elevenlabs
Decision / allowed mutation: superseder Slice 6 por Slice 8; default de EVAL_TTS_PROVIDER = openai-tts
Explicit exclusions: no borra el código TTS existente
Owning artifact / revision: 03-design-discussion.md (Amendment 2)
Decision owner: ramiro
Approved by: ramiro (explícito en chat)
Approved at: 2026-09-04
Status: approved
Invalidated by: revivir ElevenLabs en el producto
```

## Approval record

```markdown
Gate ID: design-discussion-agent-voice-evals
Decision / allowed mutation: aprobar este diseño y autorizar la escritura del structure outline (04)
Explicit exclusions: no autoriza implementación de código; solo outline
Owning artifact / revision: 03-design-discussion.md (esta revisión)
Decision owner: ramiro
Approved by: ramiro (aprobación explícita en chat, opción "Aprobar diseño")
Approved at: 2026-09-03
Status: approved
Invalidated by: cambio de alcance, de motor de evals, o de los exclusions
```

**STOP: espero tu aprobación antes de escribir el structure outline.**
