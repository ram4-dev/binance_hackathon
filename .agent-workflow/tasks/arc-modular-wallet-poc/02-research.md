# Investigacion del codigo para migrar a Arc

Fecha: 2026-09-05. Inspeccion estatica de `arc-migration`; sin ejecucion de wallets ni modificacion de codigo de producto.

## Camino actual confirmado

1. `src/livekit/realtime-tools/create-realtime-tools.ts:218`: la tool de voz `send_token` recibe importe e identidad/version del destinatario, no una direccion arbitraria ni red/token. Llama a `service.previewTransfer`.
2. `src/conversations/service.ts:343`: resuelve el destinatario, aplica politica, solicita preview y persiste la transferencia pendiente.
3. `src/livekit/realtime-tools/create-realtime-tools.ts:292`: `confirm_transfer` obtiene el preview vigente y llama a `service.resolveDecision`.
4. `src/conversations/service.ts:411`: `runFinancialTransfer` revalida politica y destinatario, llama a `wallet.broadcastTransfer` y despues verifica finalidad.
5. `src/wallet/wdk-provider.ts:136`: el proveedor ejecuta `send_token` con `dryRun: false` mediante WDK/MCP y espera un hash de transaccion.

Conclusion: no hace falta reescribir la interpretacion de voz para investigar Arc. Si hay que extender el ciclo compartido para firma del usuario, no solo sustituir una clase.

## Dependencias concretas

| Area | Evidencia | Cambio propuesto |
| --- | --- | --- |
| Seleccion del proveedor | `src/runtime/dependencies.ts:46` solo elige WDK o fixture; `walletReads` tiene otro camino legado | Seleccion explicita de proveedor y entorno, coherente para lecturas y pagos. Mantener fixture por defecto |
| Cuenta y red globales | `src/agent/instructions.ts:7`, `src/api/wallet.ts:14` y rutas desde linea 164 | Cuenta modular asociada a identidad autenticada. No confiar en un walletId elegido libremente por el LLM o cliente |
| Interfaz de wallet | `src/wallet/provider.ts:15` y `:30` | Incorporar preparacion/autorizacion asincrona; no tratar una solicitud de firma como transaccion enviada |
| Finalidad y explorador | `src/wallet/provider.ts:22`, `src/wdk/transaction-receipt.ts:168`, `src/conversations/service.ts:479`, `src/conversations/state-projection.ts:74`, `src/conversations/postgres-repository.ts:96` | Generalizar representacion de red y explorador. Mantener el verificador WDK existente y crear uno especifico para operaciones modulares |
| Alias del activo | `src/agent/instructions.ts:28`, `src/wallet/agent-tools.ts:165`, `src/agent/definition.ts:77`, `src/agent/wallet-agent.ts:104` | No mapear silenciosamente un pedido de USDT a USDC al cambiar la configuracion. Rechazar o aclarar activos no soportados |
| Politicas | `src/agent/definition.ts:140`, `src/agent/wallet-agent.ts:163` | Desacoplar limites y allowlist del flag WDK live. Patrocinio de gas no equivale a politica de gasto |
| Contrato HTTP | `src/contracts/http.ts:68` y tipos espejo en `apps/nana-wallet/src/lib/api-types.ts` | Agregar datos de autorizacion, expiracion, patrocinio y estado de operacion; actualizar ambos lados deliberadamente |
| Persistencia | `src/conversations/types.ts:35`, repositorios de conversaciones | Persistir autorizacion pendiente y userOpHash, ademas del transactionHash; conservar claims e idempotencia |
| Frontend | `apps/nana-wallet/src/lib/api.ts:316`, estado de conversacion y confirmacion | Presentar solicitud de firma y continuar seguimiento tras recargar; no dar por enviado un pago al confirmar verbalmente |
| Fixtures | `src/wallet/fixture-provider.ts`, `src/agent/wdk-tools.fixture.ts`, `apps/nana-wallet/src/mocks/handlers.ts` | Agregar casos Arc coherentes sin borrar los casos Tether; no usar mocks como evidencia de conexion real |

## Que se conserva

- Conversacion, LiveKit, interpretacion, desambiguacion y memoria de destinatarios.
- Preview explicito, validacion de destinatario por version y reclamo atomico de transferencia.
- Separacion entre rechazo definitivo y resultado incierto.
- Backend y frontend separados por HTTP. No crear imports ni paquetes compartidos.
- Implementacion Tether preservada en su rama y tag. En Arc, WDK se retira al completar el reemplazo, no se transforma en una cuenta modular.

## Verificaciones requeridas antes de implementar y enviar

- Version concreta del SDK Circle y contratos compatibles en Arc Testnet.
- Modelo de asociacion usuario/cuenta, prueba de control y recuperacion de sesion. Las rutas actuales de wallet consultan la cuenta configurada, no una seleccion por usuario.
- Client Key, dominio de passkeys y patrocinio: definir provisionamiento sin acceder a secretos en esta investigacion.
- Decidir donde se construye, verifica y envia la UserOperation. El callback del frontend no sera evidencia suficiente de pago confirmado.
- Persistencia y reanudacion ante cierre del navegador entre firma, envio y recibo.
- Precision USDC, historial sin duplicados, costos y cobertura de transferencias nativas/ ERC-20 en las reglas de proteccion.
- SDK web en Capacitor frente a puente nativo: pendiente de prueba en dispositivo.

## Cobertura existente para ampliar

`tests/unit/wallet-provider-contract.test.ts`, `tests/unit/conversation-service.test.ts`, `tests/unit/realtime-tools.test.ts`, `tests/integration/conversation-preview-claim-race.test.ts` y `tests/integration/api-conversation-resolution.test.ts`.

No se ejecutaron suites: este cambio solo agrega planificacion y el worktree no tiene `node_modules` ni en backend ni en frontend. La inspeccion no demuestra compatibilidad operativa con Circle ni Arc.

## Hallazgos de la ampliacion al resto de la app

- `src/auth/identity.ts:9` y `src/server.ts:69`: las conversaciones HTTP usan `DemoIdentityProvider`. Mandar un bearer desde el cliente no implica que esa ruta autentique un usuario real. No presentar esta base como multiusuario lista.
- `apps/nana-wallet/src/lib/api.ts:199` usa `/v1/wallet/summary` y `/v1/wallet/movements` con envelope `{ok,data}`. `src/api/wallet.ts:164` registra address, balance e history con respuestas directas. No hay equivalencia automatica entre ambas APIs.
- `apps/nana-wallet/src/client.tsx:5` inicia MSW en desarrollo; `mocks/handlers.ts:407` y `:409` siempre mockean summary y movements. El passthrough de agente desde linea 547 no desactiva esos mocks.
- `apps/nana-wallet/src/routes/mi-plata.tsx`: muestra pesos, dolares y plazo fijo. Circle/Arc no convierte esas pantallas bancarias simuladas en productos reales. Adaptar la pantalla a saldo USDC y movimientos, sin inventar conversion ARS, CBU o inversiones.
- `src/agent/wallet-agent.ts:477` conserva una llamada directa a `getWdkTools` en confirmacion; `:546` conserva fallback WDK cuando falta proveedor. Auditar todos los consumidores antes de eliminarlo, aunque el servicio comun capture el camino principal.
- `src/memory/types.ts:7`: los destinatarios tienen una direccion sin chainId. No reutilizar contactos Sepolia como destinatarios Arc sin validar red y control de la cuenta.
- `supabase/migrations/20260901000100_conversations.sql:35`: intentos de pago tienen estados restringidos por SQL e indice unico parcial de intentos activos. Agregar autorizacion pendiente exige actualizar ambos, no solo tipos TypeScript.
- En las migraciones revisadas no hay registro de cuentas modulares por usuario ni entidad dedicada a UserOperations.
- `src/db/migrate.ts:7` toma `src/db/migrations` por defecto, mientras CI aplica `supabase/migrations`. Resolver esa diferencia para que las nuevas migraciones se ejecuten igual en desarrollo y CI.
- `apps/nana-wallet/src/features/agent/voice/select-voice-client.ts`: el cliente nativo usa voz grabada y web usa live. Probar ambos caminos, no asumir equivalencia por compartir interfaz visual.
- `package.json`: dependencias Tether directas y permiso de script del CLI. MCP se importa desde `src/wdk/mcp-client.ts`. `tar-stream` se usa en los evals de voz: no retirarlo por asociarlo superficialmente con WDK.
- `scripts/nani-e2e.sh`: configura y valida entorno WDK, lee `.env` y puede obtener secretos. No se ejecuto. Requiere un runbook nuevo para la app Arc.
- `compose.yaml`: nombre de base `wdk_agent`, puerto host 5432 y volumen de Postgres. Una rama/worktree no aisla automaticamente servicios, bases remotas ni credenciales. No conectar pruebas Arc a la base usada por la demo Tether.
- `openspec/config.yaml` sigue describiendo un proyecto backend-only WDK. Su contexto debe actualizarse dentro de la migracion para representar el alcance confirmado por Marcos.

## Evidencia de preservacion

Lectura local de refs: `tether-wdk-stable` y el commit de `wdk-demo-v1` apuntan a `745e58eab3b3492eefcfc5088f089b15c5ea0d79`. No se hizo fetch, commit ni push durante este analisis.
