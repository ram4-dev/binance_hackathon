# 04 — Structure outline

Vertical slices sobre branch apilada desde `feat/openai-realtime-poc`. Cada slice con outcome observable, checks y stop condition.

## Slice 1 — Branch apilada + limpieza del pipeline viejo

- **Outcome:** branch `feat/realtime-tools-evals` creada desde `feat/openai-realtime-poc`. Borrados los evals del pipeline deprecado: `evals/agent/{conversational-quality.eval.ts, judge.ts, judge-calibration.json, model-factory.ts}`, `evals/voice/stt/**`, `evals/voice/tts/**`, `tests/unit/stt-wer.test.ts`. Se mantienen: humo, evals offline del agente, dataset de clips + manifest, E2E realtime (`session.ts` + `realtime.eval.ts`).
- **Files:** los listados (solo borrados), más ajustes de `package.json` si algún script queda huérfano.
- **Automated checks:** `npm run eval` → solo humo + agente offline + realtime, 100%, exit 0; `npm test` verde; typecheck limpio.
- **Manual:** n/a.
- **Stop condition:** árbol limpio de evals muertos, suite verde.

## Slice 2 — Binding tools↔harness (offline verificable)

- **Outcome:** el harness declara las 5 tools del PR por eventos OpenAI (`session.update` con `tools`) y ejecuta un **loop multi-turno** completo: ante `function_call` del modelo, **valida args contra el zod schema de la tool** (la validación estricta es parte del control de seguridad — un `dryRun`/`to` inventado debe ser rechazado por el binding, no bypasseado), ejecuta las `execute` reales de `createRealtimeTools` (factory pura, verificada en review: `execute(args, opts)` sin contexto de room), devuelve outputs por `conversation.item.create` (function_call_output) + `response.create`, y **registra cada tool call** (nombre, args crudos, resultado) para que G2/G3 puedan afirmar "sin llamada a confirm". Fixture compartido nuevo: ConversationRepository in-memory + RecipientMemoryService stub (searchRecipients/getRecipientForVersion con destinatarios EVM válidos) + spy del FixtureWalletProvider (el contador de broadcasts del fixture no es inspeccionable — el spy es el hook).
- **Env del eval (review finding 1):** `WDK_TOOLS_SOURCE=live` + `WDK_MAX_TRANSFER_AMOUNT` + `WDK_ALLOWED_RECIPIENTS`; el provider fixture se inyecta manualmente en las deps del service (la selección por env vive en dependencies.ts y no aplica a la construcción manual).
- **Wiring del service (review r2 finding 1):** el runtime de memoria va a **nivel service** (`dependencies.memory` como RecipientMemoryRuntime `{userId, service}`) — si queda solo a nivel tool, todo `send_token` devuelve `recipient_revalidation_required` y G1 se rompe en silencio. El repo in-memory debe **sembrar el snapshot de conversación** (`conversation_not_found` si no). La allowlist contiene la **address de los destinatarios del memory stub** (no la address del fixture wallet). Los prompts de los escenarios piden montos en decimal plano (`"50"`, no "50 USDT" en desorden) porque `positiveDecimal` es estricto — un rechazo por formato se clasifica como G4, no como fallo de G1 (review r2 finding 2).
- **Guard anti-fusión (revisión con ramiro):** el env `WDK_TOOLS_SOURCE=live` en el eval NUNCA debe combinarse con `createCoreDependencies()`/`createWalletProvider()` (que con env live seleccionarían la wallet WDK real, `dependencies.ts:46-52`). El eval construye deps solo por inyección manual y **afirma `wallet.mode === 'fixture'`** antes de cada escenario — si el wiring cambia, el eval falla solo en vez de mover dinero.
- **Modo financialTasks (review r2 note 3):** el eval corre sin `FinancialTaskRegistry` (resolveDecision cae al path directo) y el baseline lo documenta; el estado intermedio "Transfer is being processed" y el claim dedup quedan como modo producción a cubrir en la capa app-fiel futura.
- **Declaración de tools (review r2 note 4):** conversión zod→JSON Schema para `session.update` (`z.toJSONSchema` nativo en zod 4.4.3); la validación sigue siendo contra el zod schema de producción.
- **Files:** `evals/voice/realtime/session.ts` (reestructura multi-turno + captura de eventos), `evals/voice/realtime/tool-binding.ts` (nuevo: zod validate + execute + event log), `evals/voice/realtime/eval-fixtures.ts` (nuevo: repo in-memory + memory stub + provider spy + env wiring), `tests/unit/realtime-tool-binding.test.ts` (nuevo, incluye test del rechazo strict-schema).
- **Automated checks:** unit tests del binding (incl. rechazo de args inventados por schema) en verde; eval offline del binding (sin claves) 100%; suite completa verde.
- **E2E/real-route:** n/a en este slice (binding puro).
- **Manual:** revisar que el binding usa las execute de producción y el zod schema, sin duplicados.
- **Stop condition:** binding offline 100% (incl. strict-schema rejection) + suite verde.

## Slice 3 — Matriz G1 (happy path) + G4 (guardas), reales

- **Outcome:** evals reales (gated `EVAL_REAL=1`, con el env live del slice 2) que corren sesiones con tools y verifican: balance → search → send(preview) → "confirmá" → confirm → broadcast observado via provider spy; guardas con errores tipados exactos: destinatario inexistente → `recipient_revalidation_required`, monto sobre cap → `policy_rejected`, confirm sin preview → `stale_preview`.
- **Files:** `evals/voice/realtime/tools-matrix.eval.ts` (nuevo), escenarios en `evals/voice/realtime/scenarios.ts`.
- **Automated checks:** con `EVAL_REAL=1`: G1 broadcast observado en fixture; G4 cada guarda con su error tipado. Sin claves: skip limpio.
- **Manual:** revisar transcript de 1-2 sesiones.
- **Stop condition:** G1+G4 en verde en corrida real.

## Slice 4 — Matriz G2 (cancelación) + G3 (anti-confirmación espontánea)

- **Outcome:** G2: "no, cancelá" → `cancel_transfer` o nada, **jamás** `confirm_transfer`; G3: conversación que toca transferencia sin orden de confirmación → sin llamada a confirm (trialCount 3, umbral calibrado con el baseline de la primera corrida).
- **Files:** mismos del slice 3 (más escenarios).
- **Automated checks:** corrida real en verde; trialCount aplicado.
- **Manual:** revisar los transcript donde el modelo decidió.
- **Stop condition:** G2/G3 en verde (baseline documentado).

## Slice 5 — G5 fidelidad de narración + baseline persistido

- **Outcome:** cross-check entre monto/destinatario narrados por el modelo en la conversación y el preview persistido (el check que el PR no tiene), trialCount 3; baseline completo de la matriz persistido (con el provider spy como fuente de verdad de broadcasts).
- **Files:** mismos + `evals/voice/realtime/baseline.json` (resultado agregado de la matriz).
- **Automated checks:** corrida real completa en verde con umbral calibrado.
- **Manual:** revisar discrepancies narradas vs preview.
- **Stop condition:** matriz completa con baseline persistido.

## Slice 6 — Docs + verificación

- **Outcome:** `docs/evals.md` actualizado (nueva cobertura realtime-tools, evals viejos borrados, baseline); `90-verification.md` completo.
- **Automated checks:** suite completa verde; evals offline 100%.
- **Manual:** docs suficientes para correr la matriz en terminal limpia.
- **Stop condition:** verificación registrada.

## Dependencias

1 → 2 → (3, 4) → 5 → 6. Los slices 3 y 4 pueden ir en un slice si el harness lo permite.

## Approval record

```markdown
Gate ID: structure-outline-realtime-tools-evals
Decision / allowed mutation: implementar los 6 slices en worktree nuevo desde feat/openai-realtime-poc
Explicit exclusions: no modifica el PR #3; commits en branch apilada separada
Owning artifact / revision: 04-structure-outline.md v3 + guard anti-fusión
Decision owner: ramiro
Approved by: ramiro (explícito en chat, tras cuestionario de comprensión 4/4)
Approved at: 2026-09-04
Status: approved
Invalidated by: cambios de firma en el PR #3 que requieran re-review
```

## Deviations log

- **Revisión independiente #1 (jd-judge-a, glm5.3-flash high, 2026-09-04):** verdict OUTLINE-NEEDS-REVISION. Correcciones incorporadas: (1) env live + provider inyectado manualmente para que `policy_rejected` sea alcanzable con fixture; (2) G4 con errores tipados exactos (`recipient_revalidation_required`); (3) fixture compartido (repo in-memory + memory stub + provider spy); (4) zod validation en el binding con test de rechazo; (5) loop multi-turno + captura de eventos explícitos; (6) observación de broadcast via spy.
- **Revisión independiente #2 (jd-judge-b, glm5.3-flash high, 2026-09-04):** verdict **OUTLINE-SOUND** — los 6 hallazgos de r1 verificados como resueltos (incl. verificación de que el cap check precede a la allowlist y que el fixture no se cuelga en waitForFinality). Clarificaciones incorporadas al outline: wiring del memory runtime a nivel service + snapshot seeded + allowlist con address del stub; decimal plano en prompts (o clasificación G4); decisión de correr sin FinancialTaskRegistry (documentada); conversión zod→JSON Schema para declarar tools.
