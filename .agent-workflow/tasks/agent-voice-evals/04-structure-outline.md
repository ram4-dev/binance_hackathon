# 04 — Structure outline

Vertical slices. Cada slice tiene resultado observable, checks y stop condition. Cada slice se verifica antes de arrancar el siguiente.

## Slice 1 — Setup de evalite + infraestructura base

- **Outcome:** `evalite` instalado y configurado en la raíz (`evalite.config.ts`), scripts npm (`eval`, `eval:real`), un eval trivial de humo corre y muestra el dashboard. Directorio `evals/` con estructura `agent/`, `voice/stt/`, `voice/tts/`. `.gitignore` para `evals/voice/.audio/` y outputs de evalite.
- **Files:** `package.json`, `evalite.config.ts`, `evals/**` (scaffolding), `tsconfig` si hace falta, `.gitignore`.
- **Automated checks:** `npm run eval` corre el humo sin errores; suite de tests existente sigue en verde (`npx vitest run` root + apps).
- **Riesgo verificado en review (2026-09-03):** `evalite@0.19.0` pina `@ai-sdk/provider ^2.0.0` y `@vitest/runner ^4.0.0`; el repo tiene `ai@7.0.77` con `@ai-sdk/provider@4.0.7` y `vitest@4.1.11`. Vitest 4 es compatible; el mismatch de `@ai-sdk/provider` debe validarse con el humo de este slice. Si evalite rompe con ai@7, fallback aceptado: harness propio delgado sobre Vitest (decisión ya descartada en diseño se reabre solo con evidencia).
- **E2E/real-route:** n/a.
- **Manual checks:** dashboard de evalite se abre y muestra el resultado del humo.
- **Stop condition:** humo verde en dashboard + suite existente verde.

## Slice 2 — Evals del agente offline (decisiones + guardas + preview→confirm)

- **Outcome:** dataset de escenarios (`evals/agent/scenarios/*.ts`) con expected estructurado corriendo `handleMessage` con modelo simulado (offline) y fixtures WDK. Escenarios cubren: selección de tool/parámetros, guardas (`confirmation_required`, `recipient_revalidation_required`, `policy_rejected`, cap de monto), flujo preview→confirm en fixture mode, resolución de destinatario (memoria + ambiguo → pregunta).
- **Files:** `evals/agent/scenarios/**`, `evals/agent/wallet-agent.evals.ts` (o equivalente), simulador de modelo reutilizando el patrón de los tests unitarios existentes, fixtures WDK existentes.
- **Automated checks:** todos los escenarios offline pasan; no golpean red (verificable: corren sin claves); suite existente verde.
- **E2E/real-route:** n/a (offline).
- **Manual checks:** los escenarios cubren todos los grupos listados en el diseño §1 (revisión del dataset).
- **Stop condition:** score 100% en los asertos determinísticos offline.

## Slice 3 — Judge de calidad conversacional

- **Outcome:** judge con rúbrica fija (claridad, no-jerga, español correcto, tono, sin detalles técnicos internos) puntúa 1-5 por criterio con justificación, usando un modelo distinto del evaluado en el mismo endpoint. Corre en modo real opt-in. Calibración inicial: sample de 5 respuestas etiquetadas a mano como referencia, guardada junto al judge.
- **Files:** `evals/agent/judge.ts` (rúbrica + scoring + zod schema del veredicto), `evals/agent/conversational-quality.evals.ts`, `evals/agent/judge-calibration.json`.
- **Automated checks:** el judge produce veredictos schema-válidos (Zod) para el sample; offline smoke del judge con respuesta simulada.
- **E2E/real-route:** corrida real contra OpenCode (mismo endpoint, modelo distinto) sobre N respuestas reales del agente — resultados persistidos, sin umbral de fallo en v1 (reporte).
- **Manual checks:** comparar el veredicto del judge contra las etiquetas humanas del sample de calibración; documentar desacuerdos.
- **Stop condition:** veredictos válidos y persistidos + calibración documentada. (No se exige score mínimo: primer baseline.)

## Slice 4 — Download del dataset STT (Common Voice ES)

- **Outcome:** script `evals/voice/stt/download-dataset.ts` baja ~30 clips del split validado de Common Voice ES a `evals/voice/.audio/` (gitignored) y genera `manifest.json` (clip → transcripción oficial). Re-ejecutable e idempotente.
- **Files:** `evals/voice/stt/download-dataset.ts`, `.gitignore` (ya en slice 1), `evals/voice/.audio/**` (gitignored).
- **Automated checks:** script idempotente (segunda corrida no re-descarga); manifest con 30 clips con path+transcript válidos.
- **E2E/real-route:** descarga real desde el CDN de Common Voice.
- **Manual checks:** audio de 2-3 clips se escucha y coincide con el transcript.
- **Stop condition:** 30 clips + manifest válidos en disco.

## Slice 8 — E2E realtime (nuevo por Amendment 1, el eval central de voz)

- **Outcome:** eval E2E contra `gpt-realtime-2.1-mini` (OpenAI): por clip de FLEURS (o query de voz scriptada), se abre sesión realtime (WebSocket), se envía el audio, se captura el transcript de la respuesta; el juez (texto) puntúa task success/claridad y se registra latencia. Baseline persistido.
- **Files:** `evals/voice/realtime/realtime.evals.ts`, `evals/voice/realtime/session.ts` (cliente WS realtime), reutiliza manifest + judge.
- **Automated checks:** offline: la construcción de mensajes/sesión se testea con mock; real: corrida opt-in con baseline persistido.
- **E2E/real-route:** sesión realtime real por clip (costo acotado: ≤30 clips).
- **Manual checks:** escuchar 2-3 respuestas de audio.
- **Stop condition:** baseline E2E persistido (success rate + latencia).

## Slice 5 — Eval STT (WER) — scope ampliado por Amendment 1

- **Outcome:** eval que corre cada clip contra un **proveedor STT configurable** (`EVAL_STT_PROVIDER`: `nan` (Whisper, pipeline actual) | `openai-transcribe` (`gpt-4o-transcribe`) | `openai-realtime-whisper` (`gpt-realtime-whisper`)), normaliza, calcula WER por clip y agregado; baseline por proveedor.
- **Files:** `evals/voice/stt/wer.ts` (normalización + WER), `evals/voice/stt/stt.evals.ts`, `evals/voice/stt/providers.ts`.
- **Files:** `evals/voice/stt/wer.ts` (normalización + WER), `evals/voice/stt/stt.evals.ts`.
- **Automated checks:** WER function con unit test (casos conocidos: substitution/insertion/deletion); eval corre con `--grep stt` contra servicios reales y persiste WER medio.
- **E2E/real-route:** corrida real contra el STT (clave existente). Prerequisito verificado: el endpoint `POST /v1/agent/transcribe` requiere el server Fastify corriendo (`npm run dev`) y `NAN_API_KEY`; alternativa aceptada si no se quiere levantar server: llamar al upstream directo (`${NAN_BASE_URL}/audio/transcriptions`). Decidir y documentar en este slice.
- **Manual checks:** escuchar 2-3 clips con peor WER y validar que el transcript esperado no estaba mal.
- **Stop condition:** baseline de WER persistido; umbral calibrado y documentado (no hardcodeado a ciegas).

## Slice 6 — Eval TTS (round-trip + smoke)

- **Outcome:** eval que convierte textos típicos de Nana (montos, truncamiento de direcciones, español) en audio vía `POST /v1/voice/speak` (ElevenLabs real), lo re-transcribe con el mismo STT, y compara semánticamente contra el original. Smoke determinísticos: audio no vacío, duración proporcional, formato válido.
- **Files:** `evals/voice/tts/tts.evals.ts` (reutiliza wer.ts/normalización), fixtures de textos de respuesta en `evals/voice/tts/samples.ts`.
- **Automated checks:** smoke checks determinísticos; round-trip corre con servicios reales y persiste similitud.
- **E2E/real-route:** corrida real contra ElevenLabs + STT. Mismo prerequisito que Slice 5 (`ELEVENLABS_API_KEY`; server o upstream directo).
- **Manual checks:** escuchar 2-3 audios generados.
- **Stop condition:** baseline de round-trip persistido.

- **Slice 6 — SUPERSEDED por Slice 8 (Amendment 2).** El harness queda en `evals/voice/tts/` con provider `openai-tts` como opcional; no es entregable del plan.

## Slice 7 — Cierre: `EVAL_MODELS`, docs y verificación final

- **Outcome:** `EVAL_MODELS` acepta lista de modelos para corrida comparada (agent + judge usan el modelo evaluado / juez consistente); README o sección en `docs/` sobre cómo correr los evals (offline, real, voz, prerequisitos de claves); `90-verification.md` completo.
- **Files:** `evals/**` (config de matriz), `README.md` o `docs/evals.md`, `90-verification.md`.
- **Automated checks:** `EVAL_MODELS=a,b` parsea y genera 2 corridas en el eval de humo; suite existente verde; todos los evals offline en un solo comando.
- **E2E/real-route:** una corrida real completa documentada (comandos ejecutados, resultados).
- **Manual checks:** docs siguen siendo suficientes para correr los evals en una terminal limpia.
- **Stop condition:** verificación completa registrada en `90-verification.md`.

## Dependencias

- Slice 1 → todo lo demás.
- Slice 3 depende de Slice 2 (necesita respuestas del agente).
- Slice 5 depende de Slice 4. Slice 6 depende de Slice 5 (reutiliza normalización/STT).
- Slice 7 cierra.

## Deviations log

- **Decisiones finales de ramiro (2026-09-04):** (1) sin baseline STT de nan Whisper — provider `nan` removido del registro, default `EVAL_STT_PROVIDER=openai-transcribe`; (2) sin default implícito de modelo OpenAI de texto — `AGENT_PROVIDER=openai` exige `AGENT_MODEL` (el placeholder gpt-5.6-luna quedó solo como referencia en hallazgos, no como default).
- **Juez recalibrado (2026-09-04, decisión de ramiro):** juez = `deepseek-v4-pro` (OpenCode), evaluado = `deepseek-v4-flash`. Overall 3,3,3,1,5 — jerga técnica (2) y el mensaje de aclaración en inglés son los puntos débiles. **Hallazgo real #3 del eval:** `clarificationMessage()` en `src/agent/wallet-agent.ts` hardcodea el texto de aclaración en inglés e ignora `options.language`. **RESUELTO (2026-09-04, aprobado por ramiro):** `CLARIFICATION_COPY` bilingüe en/es + `language` propagado al call site; TDD con 3 tests nuevos (`tests/unit/wallet-agent-clarification-language.test.ts`, RED→GREEN). Suite: 278 passed. Pendiente similar (fuera de scope): los mensajes `no_match`/`unavailable` siguen en inglés.

- **Slice 8 (2026-09-04):** E2E realtime funcional. API v2 de `gpt-realtime-2.1-mini` exigidió: formato `audio/pcm` con `rate` ≥ 24000 (resampler lineal 16k→24k agregado), `output_modalities: ['audio']` (no admite mix text+audio), `turn_detection: null` para commit manual determinista (el server VAD no detecta fin de habla en clips con ruido de cola → timeouts), chunks de audio ≥ 200ms (chunks de 100ms morían la sesión), y transcript de delta como string directo. Además: evalite exige columnas consistentes entre evals de un mismo archivo (crash de render) → columnas alineadas 3/3; el render detallado revienta con salios de línea en outputs → sanitizados. Baseline final: 5/5 turnos exitosos, TTFA medio 2.6s. Docs en `docs/evals.md`; verificación completa en `90-verification.md`.

- **Slice 7 (2026-09-04):** factory de proveedores en `evals/agent/model-factory.ts` (eval-only, sin tocar `src/agent/model.ts` — la migración de la app es otro trabajo): `chatModelFor(provider, model)` + `EVAL_MODELS` (soporta `model` y `provider:model`, ej. `openai:gpt-5.6-luna, opencode:deepseek-v4-flash`). Juez vía `EVAL_JUDGE_PROVIDER`+`EVAL_JUDGE_MODEL`. **Hallazgo real del eval (migración gpt-5.6-luna):** (1) `/v1/chat/completions` rechaza function tools de gpt-5.6-luna — exige Responses API; (2) `stage_user_memory` tiene schema JSON inválido para OpenAI (`z.discriminatedUnion` produce `type: None`, OpenAI exige `type: object` al tope). El juez comportó correctamente: puntuó 1/5 los mensajes de error técnico. Re-calibración persistida con evaluated=judge=gpt-5.6-luna (los scores 1,1,1,3,1 miden respuestas de error, no calidad conversacional real). Bloqueador de migración anotado para el trabajo de integración.

- **Slice 5 (2026-09-04):** WER implementado con TDD (10 unit tests). Descubrimiento crítico: el `fetch` de Node negocia HTTP/2 y las sesiones compartidas entre workers de vitest mueren (`ERR_HTTP2_INVALID_SESSION`/`bad record mac`) → fix con dispatcher undici `allowH2: false` + keep-alive corto + retry con backoff para sockets transitorios. `gpt-realtime-whisper` NO sirve por REST (404; es solo sesión realtime WebSocket) → reemplazado por `gpt-4o-mini-transcribe`. Baselines (30 clips FLEURS es_419): **gpt-4o-transcribe WER 2.2%** (peor clip 22%, ~5.4s/clip) · **gpt-4o-mini-transcribe WER 2.7%** (~6.1s/clip). nan Whisper pendiente: la clave en la vault está revocada (401 real; el 415 inicial no validaba auth — error de lectura mío). Claves NAN/OPEN_AI volcadas al `.env` (worktree y checkout principal) vía `/api/env.sh` del vault local, sin exponer valores.

- **Amendment 2 (2026-09-04):** ElevenLabs fuera del plan (el usuario confirma que no se usará más tras la migración). Slice 6 superseded por Slice 8; `evals/voice/tts/` queda como harness opcional con `openai-tts` default. Claves requeridas en worktree `.env`: `NAN_API_KEY` + `OPEN_AI_API_KEY`. Estado de claves verificado (2026-09-04): las copias de `.env` de NAN y ElevenLabs están revocadas (401); las versiones de la vault responden 200, pero el sandbox de la vault no puede escribir en el worktree → el usuario las vuelca manualmente. modelo único `gpt-realtime-2.1-mini` (ver catálogo OpenAI). Outline actualizado: Slice 5 → comparativa STT por proveedor; Slice 8 nuevo (E2E realtime). Baseline histórico del pipeline actual conservado. Pendiente: `OPEN_AI_API_KEY` en `.env` del worktree (la vault no puede escribir ahí; la agrega el usuario).
- **Slice 4 (2026-09-04):** dataset swap: Common Voice ES → **FLEURS es_419** (Common Voice está gated detrás de auth de Mozilla, inviable scriptado; FLEURS es público anónimo, CC-BY-4.0, español latinoamericano). El parquet embebido de FLEURS pesa 703MB → el script streamea el tarball y corta la descarga al extraer los 30 clips (~10MB reales). Dep agregada: `tar-stream@3.2.1`. Idempotencia verificada (segunda corrida no descarga). Clips + manifest en `evals/voice/.audio/` (gitignored). Manual check pendiente: escuchar 2-3 clips.

- **Slice 3 (2026-09-04):** judge `glm-5.3` (elegido del catálogo del endpoint, familia distinta al evaluado), override por env `EVAL_JUDGE_MODEL`. `testTimeout` de evalite subido a 300s en `evalite.config.ts` (las corridas reales del agente + juez exceden el default de 30s; flake intermitente a 120s). Corrida real: 5 samples en `evals/agent/judge-calibration.json` (overall 2-4/5, jerga técnica es el criterio débil) con `human_label: null` pendiente de etiquetado humano. Script `eval:real` agregado.

- **Slice 1 (2026-09-04):** implementado en worktree `aleph-hackathon-worktrees/agent-voice-evals` (branch `agent-voice-evals`). `better-sqlite3@11` de evalite no compila contra Node 26 → override a `^13.0.3` en `package.json` (binding verificado con CRUD). API real de evalite 0.19: `evalite(name, { data, task, scorers })`; el scorer exige `{ name }` (retornar número pelado rompe `scores.name NOT NULL`). Humo `evals/smoke.eval.ts` 100% verde; `evalite/ai-sdk` (traceAISDKModel) carga OK con `ai@7` — el riesgo de `@ai-sdk/provider` no bloquea el runtime; validación real con modelos en Slices 2-3. Scripts: `eval` (run), `eval:serve` (UI, puerto default 3006). Suite existente 265 passed, typecheck limpio. Manual check pendiente: abrir el dashboard (`npm run eval:serve`).

- **Review del outline (2026-09-03):** verificado contra el repo: endpoints `/v1/agent/transcribe` y `/v1/voice/speak` existen (`src/api/voice.ts`), seam `HandleMessageOptions` en `wallet-agent.ts:237/:526`, fixtures WDK en `tests/integration/wdk-fixtures/` (reads/preview/broadcast/closure/discovery/failure), y el patrón de modelo simulado ya existe en el repo (`MockLanguageModelV3` de `ai/test` en `tests/e2e/recipient-memory-release.e2e.test.ts`) — el Slice 2 lo reutiliza en vez de crear uno nuevo. Riesgo de compatibilidad de evalite documentado en Slice 1 con fallback aceptado.
