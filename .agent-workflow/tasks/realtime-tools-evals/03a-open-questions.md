# 03a — Inventario de preguntas de control

Estado: **sin preguntas de control sin responder** — todas resueltas con el usuario (2026-09-04).

| # | Pregunta | Respuesta | Racional / tradeoff aceptado | Estado |
| --- | --- | --- | --- | --- |
| 1 | ¿Cómo se evalúa el comportamiento del modelo con tools por realtime? | WS crudo del harness + tools declaradas por eventos + ejecución contra las tools/service reales del PR #3 | Headless y rápido; mide el modelo real (el riesgo model-trust). No atraviesa el AgentSession de LiveKit — fidelidad al transporte delegada a una capa futura | ✅ resuelta |
| 2 | ¿Qué escenarios cubre la matriz? | Completa: happy path, cancelación ("no, cancelá" → jamás confirm), anti-confirmación espontánea, guardas reales, fidelidad de narración vs preview | Los grupos 3 y 5 son lluviosos → trialCount para estabilizar; es la cobertura completa del riesgo central | ✅ resuelta |
| 3 | ¿Qué pasa con los evals del pipeline viejo? | Se borran: judge conversacional, factory de modelos, STT/WER, TTS round-trip, downloader. Se mantienen: humo, 10 evals offline del agente, dataset de clips (lo usa el E2E realtime) | Historia de git preserva los borrados; cero evals muertos | ✅ resuelta |
| 4 | ¿Dónde viven los evals nuevos? | PR apilado: branch de evals desde `feat/openai-realtime-poc` | Los evals acompañan y revisan el POC; merge en orden (#3 → #evals); rebase barato si el review cambia firmas | ✅ resuelta |
| 5 | ¿Quién ejecuta las tool calls cuando el modelo las emite? | Las funciones `execute` de las tools reales del PR (mockeando el contexto LiveKit mínimo) | Duplicar lógica en el eval mediría otra cosa; el eval debe correr las tools de producción | ✅ resuelta (decisión técnica, no requiere usuario) |
| 6 | ¿Contra qué proveedor corren los broadcast en los evals? | FixtureWalletProvider (modo fixture) — cero dinero real | Estándar del repo | ✅ resuelta (estándar) |
| 7 | ¿Estabilización de escenarios lluviosos? | trialCount 3 en los grupos 3 y 5 (anti-confirmación espontánea y fidelidad) | Balance costo/señal; configurable | ✅ resuelta (decisión técnica) |

Preguntas diferidas explícitamente: ninguna.
