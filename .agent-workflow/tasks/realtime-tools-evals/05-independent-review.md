# 05 — Independent review

Task: realtime-tools-evals. Outline revisión: `04-structure-outline.md` v3 (post 2 rondas).

## Round 1 — jd-judge-a (modelo nan/glm5.3-flash, reasoning high, contexto fresco)

- **Revisado:** outline v1 (6 slices, binding tools↔harness).
- **Veredicto:** OUTLINE-NEEDS-REVISION.
- **Hallazgos:** 1 critical-controlling (G4 `policy_rejected` inalcanzable con fixture: `validateWalletTransferPolicy` corta cuando `WDK_TOOLS_SOURCE != 'live'` — `src/wallet/agent-tools.ts:169`; el wiring de env no estaba en el outline), 3 minor (error tipado `recipient_revalidation_required` sin nombrar; deps del service incompletas para construirlo — repo + memory stub; zod validation bypasseable en el binding), 2 notes (loop multi-turno + captura de eventos; observación de broadcast vía spy — el contador del fixture es module-private sin getter), 1 note positiva de factibilidad (tool() es factory pura, execute(args,opts) sin contexto de room; resolveDecision funciona offline).
- **Disposición:** TODOS los hallazgos incorporados al outline v2 (revisión uno a uno contra el código por el propio judge r1).

## Round 2 — jd-judge-b (modelo nan/glm5.3-flash, reasoning high, contexto fresco, blind)

- **Revisado:** outline v2 (revisado).
- **Veredicto:** **OUTLINE-SOUND**.
- **Verificación de resolución:** los 6 hallazgos de r1 verificados resueltos con evidencia file:line (incluye: cap check precede allowlist; `waitForFinality` del fixture no se cuelga con env live; el spy es genuinamente necesario; `z.toJSONSchema` nativo disponible para declarar tools).
- **Hallazgos nuevos:** 2 minor de wiring/w robustez (memory runtime a nivel service + snapshot seeded + allowlist con address del stub; decimal plano en prompts o clasificación G4) y 2 notes (modo sin FinancialTaskRegistry documentado; conversión zod→JSON Schema) — **incorporados al outline v3** como aclaraciones de wiring, no blockers.

## Estado del gate

- Controlling findings: 0 (r1 critical resuelto y verificado por r2).
- Outline: **v3, sound**, esperando aprobación humana (Pi nunca otorga aprobación).

## Nota de procedimiento

Ambas rondas corrieron como subagentes jd-judge-a/jd-judge-b con modelo `nan/glm5.3-flash` reasoning high (coincide con el requerimiento de la skill). Sesiones: subtask_jd-judge-a_1788556423527_004e2b4d y subtask_jd-judge-b_1788556547994_31e23c8e (completadas, cleanup automático del runtime de subagentes).
