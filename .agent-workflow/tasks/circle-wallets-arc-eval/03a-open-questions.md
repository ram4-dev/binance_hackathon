# 03a — Open questions (controlling inventory)

Every controlling question for the design. Resolved one at a time, in order.
Plain-language presentation to the user; exact technical detail lives in
`02-research.md`.

| # | Question | Options | Recommendation | Rationale | Status |
| --- | ---------- | --------- | ---------------- | ----------- | -------- |
| OQ1 | ¿Scope de la red en el provider: solo Arc testnet, o Arc + Sepolia? | a) Solo `ARC-TESTNET` b) Arc + Sepolia c) Arc + infra parametrizable | (b) Arc + Sepolia | El tipo `FinalityOutcome.network` ya está casado a `'sepolia'`; abrirlo a una unión de dos redes cubre el hackathon sin sobre-diseñar. | **resolved → (a) Solo Arc testnet.** El tipo queda casado a Arc; si después se necesita Sepolia, se reabre. |
| OQ2 | ¿Modo de custodia con Circle? | a) Developer-controlled (entity secret en el server) b) User-controlled (PIN/OTP del usuario) | (a) Developer-controlled | La wallet del agente ya es self-custody server-side hoy con WDK; el modelo equivalente es developer-controlled. User-controlled cambia el flujo de confirmación entero. | **resolved → (a) Developer-controlled.** Entity secret server-side, equivalente directo del modelo actual WDK. |
| OQ3 | ¿Cómo se selecciona el provider nuevo? | a) Extender `WDK_TOOLS_SOURCE` con valor `circle` b) Variable nueva `WALLET_PROVIDER` = circle/wdk/fixture c) Hardcode de prueba | (a) Extender `WDK_TOOLS_SOURCE` | Reusa el gate existente y los tests de selección; una variable nueva obliga a redefinir la matriz fixture/live en dependencies.ts y docs. | **resolved → (a) Extender `WDK_TOOLS_SOURCE`** con valor `circle` además de `fixture`/`live`. |
| OQ4 | ¿Via de integración técnica? | a) SDK oficial `@circle-fin/developer-controlled-wallets` b) REST puro con fetch + cifrado de entity secret c) Arc App Kit adapter | (a) SDK oficial | El SDK ya encapsula el ciphertext del entity secret, polling, y tiene idempotencyKey en createTransaction. REST puro re-implementa cripto innecesaria. App Kit es para el frontend. | **resolved → (a) SDK oficial `@circle-fin/developer-controlled-wallets`.** |
| OQ5 | ¿Cómo mapea el balance USDC de Arc al display (18 vs 6 decimales)? | a) Normalizar a 6 decimales en el provider b) Exponer ambos y normalizar en el front c) Usar solo ERC-20 (6 dec) | (a) Normalizar a 6 en el provider | El boundary `WalletBalance.balance` es un string único ya formateado hoy; normalizar en el provider mantiene el contrato HTTP estable y evita duplicar la regla en el front. | open |
| OQ6 | ¿Token en preview/transfer: cómo nombra Arc USDC vs alias USDT del repo? | a) Reportar `USDC` nativo tal cual b) Mantener alias `USDT` c) Alias configurable | (a) Reportar USDC tal cual | En Arc el token nativo ES USDC; mentir en el nombre rompe la trazabilidad del preview. El alias USDT quedó como default de WDK en Sepolia y no aplica a Arc. | open |
| OQ7 | ¿Finalidad: polling de `getTransaction` o webhooks? | a) Polling b) Webhooks c) Ambos | (a) Polling | El patrón existente (`transaction-receipt.ts`) ya es polling; webhooks exigen endpoint público HTTPS que el backend local no tiene. El spike mantiene polling. | open |
| OQ8 | ¿Alcance del spike de validación (si el design se aprueba)? | a) Provider completo pasando el contract test b) Solo health + balance + preview c) Provider completo + e2e gated | (a) Provider completo + contract test, e2e en follow-up | El contract test es la prueba mínima suficiente; e2e contra ARC-TESTNET requiere credenciales y faucet, natural como paso siguiente separado. | open |

| OQ9 | ¿Modelo multiusuario: cómo obtiene cada usuario dirección propia? | a) Un walletset por usuario (dirección única) b) Un walletset único con wallets por usuario (dirección compartida) c) Single-user para el demo | (a) Un walletset por usuario | En EVM las wallets del mismo set comparten dirección (unified addressing); un set único haría que todos los usuarios comparten balance. `userId`/`refId` trazan cada wallet. | **resolved → (a) Un walletset por usuario.** Dirección única por usuario; alta de usuario = crear walletset + wallet en `ARC-TESTNET`. |

## Deferred (no controlling)

- Pricing/quotas de Circle testnet — se verifica en el spike con cuenta real.
- Gap preexistente del backend de payment-intents en el front (RQ5) — change aparte.
- CCTP in (puentes hacia Arc) — fuera del alcance del provider.
