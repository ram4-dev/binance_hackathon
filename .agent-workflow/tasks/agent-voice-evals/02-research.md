# 02 — Research

## Respuestas a las preguntas abiertas

### R6 — Alcance de los evals del modelo (decisión del usuario)

Elegido: (a) decisión del agente + (b) calidad conversacional + voz (STT/TTS). Adversarial/jailbreak queda fuera del scope v1 (puede reentrar como escenarios futuros; las guardas del flujo preview→confirm SÍ quedan dentro de la decisión del agente).

### R9 — Modo de ejecución (decisión del usuario)

Ambos modos: offline (fixtures / modelo simulado / runtime determinístico) para suite rápida y reproducible, más modo opt-in contra el modelo real OpenCode (`deepseek-v4-flash` vía `https://opencode.ai/zen/go/v1`).

### R10 — Servicios de voz reales (decisión del usuario)

Hay claves y margen: los evals de voz pueden golpear Whisper (nan.builders) y ElevenLabs reales.

### R11 — Población de voz (decisión del usuario)

Español genérico → dataset público (Common Voice ES) como fuente de audio etiquetado.

## R7 — Cómo se hacen evals de agentes LLM con herramientas (fuentes web)

Práctica consolidada (dev.to/llmtools.cc/futureagi 2025-2026, guía OpenAI cookbook para realtime):

1. **Evaluar comportamiento multi-paso, no solo el texto final**: qué herramienta eligió, si llamó/no llamó, validez de argumentos (Zod/JSON schema), orden de llamadas, y task completion.
2. **Asertos determinísticos para contratos exactos**: herramienta seleccionada, validez de schema, argumentos requeridos, secuencia. **LLM-as-judge para calidad semántica** y resultados abiertos (claridad, tono).
3. **Progresión recomendada**: unit/contract tests → evals con LLM-judge calibrado → eval online con traces/latencia/tokens. Para Nana v1: los dos primeros niveles.
4. **Calibración del judge**: un LLM-judge debe validarse contra etiquetas humanas; no se puede asumir fiable por defecto.
5. **Frameworks**: DeepEval (code-first, integración AI SDK via OpenTelemetry), Promptfoo (CLI/config, YAML), Braintrust (hosted), evalite (TS, vitest-like). Python-centric los más maduros; para este repo TS con Vitest, un harness propio delgado sobre Vitest es viable y evita lock-in — decisión de diseño, no de research.

**Mapeo a Nana:** el seam ya existe — `HandleMessageOptions.model` permite inyectar el modelo real o un modelo simulado, y `walletProvider`/fixtures (`tests/integration/wdk-fixtures/*.json`) permiten correr el agente sin fondos ni claves. Las guardas exponen errores tipados (`confirmation_required`, `recipient_revalidation_required`, `policy_rejected`) → asertos determinísticos directos sobre el resultado del turno.

## R8 — Cómo se hacen evals de voz (aievals.co, OpenAI cookbook realtime eval, EVA/EVA-Bench)

Tres capas separadas:

1. **STT**: WER/CER contra transcript de referencia (Python `jiwer` o equivalente TS); WER como umbral, no ranking absoluto. Fuentes: Common Voice (cubre "español genérico"), o audios propios verificados. Normalizar puntuación/mayúsculas/espacios en referencia e hipótesis — el preprocesado cambia mucho el score.
2. **TTS**: MOS humano es el estándar pero subjetivo; automated MOS predictors y Audio-LLM judges son prometedores pero requieren validación. Para v1 pragmática: smoke tests determinísticos (audio válido, idioma correcto vía STT round-trip: TTS→STT→comparar texto) + revisión humana puntual.
3. **Agente de voz end-to-end**: task success rate en escenarios multi-turno scriptados, latencia por turno (percentiles), interrupciones/barge-in. Referencias: EVA-Bench (ServiceNow/eva, open source), guía realtime eval de OpenAI cookbook.

Caveats: ningún metric único captura la calidad de un voice agent; los benchmarks no generalizan a audio/acento/dominio de producción.

**Mapeo a Nana:**

- STT eval: dataset chico de clips de Common Voice ES con sus transcripciones oficiales → `POST /v1/agent/transcribe` (Whisper real) → WER vía lib TS (implementar WER a mano es trivial y evita depender de Python).
- TTS eval: round-trip — texto → `POST /v1/voice/speak` (ElevenLabs real) → audio → transcribir de vuelta → comparación semántica; smoke checks de formato/duración. (Opcional v2: Audio-LLM judge.)
- Agente de voz E2E: en modo nativo el pipeline es grabar→transcribe→turn→speak, todo HTTP, así que un eval E2E puede simular el "usuario" con clips de Common Voice y validar el turno final del agente + audio de respuesta.

## Contradicciones y gaps

- El scout detectó posibles referencias fuera de scope en `src/conversations/service.ts` (`broadcast`, `finality`) — archivo parcialmente reescrito; confirmar estado actual antes de apoyar evals de la ruta de servicio.
- No existe CI: decidir en diseño si los evals deben correr en CI o solo local/manual.
- Common Voice ES: confirmar licencia (CC0) y tamaño de split a usar; los clips requieren descarga previa (no commitear audio pesado; puede usarse Git LFS, carpeta local ignorada, o descarga scriptada).

## Gaps restantes para research

- Ninguno bloqueante. Los presupuestos concretos por ejecución (costo por eval con claves reales) se miden en implementación, no en research.
