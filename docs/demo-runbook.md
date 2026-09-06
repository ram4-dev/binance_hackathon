# Recipient-memory demo runbook

This runbook records the safe RAG path from a natural-language recipient to a
WDK transfer preview. Start in fixture mode. The final live-wallet take is
optional and never needs to broadcast to prove recipient retrieval.

## Quick rehearsal

```bash
cp .env.example .env
npm ci
npx supabase start
npx supabase db reset
```

Set these values in `.env`:

```dotenv
RECIPIENT_MEMORY_ENABLED=true
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
DEMO_USER_ID=11111111-1111-4111-8111-111111111111
RECIPIENT_MEMORY_SEED_FILE=examples/recipient-memory.seed.json
WDK_TOOLS_SOURCE=fixture
```

Then prepare the database, local model, and API:

```bash
npx supabase db reset
npm run memory:prefetch
npm run db:seed
npm run dev
```

For a frontend textual E2E (LLM + WDK fixtures, no live broadcast), configure
and start the Nana wallet in another terminal. If `:3000` is taken, use
`PORT=3001` for the API and `VITE_API_URL=http://localhost:3001` below.

```bash
cp apps/nana-wallet/.env.example apps/nana-wallet/.env.local
# keep WDK_TOOLS_SOURCE=fixture and AGENT_RUNTIME=llm in the backend .env
# set VITE_AGENT_BACKEND=1 so the chat bypasses MSW and hits this API
cd apps/nana-wallet
npm install
npm run dev -- --host 0.0.0.0 --port 8083
```

Type a natural-language transfer request, then Confirm. With fixtures, expect
a fixture `transactionHash`, never a live broadcast. For a parser-only
rehearsal without a model provider, set `AGENT_RUNTIME=deterministic`.

The seed contains confirmed demo data only: one Lucas described as `mi nieto`
and the fact `Lucas is my grandson`. It is not a real address book.

## Session setup

```bash
CONVERSATION_ID=$(curl -s -X POST http://localhost:3000/v1/conversations | jq -r .conversationId)
echo "$CONVERSATION_ID"
```

Inspecting a session is safe for the screen recording: it can show selected ID,
version, descriptions, and write expiry, but must never show a staged address
or confirmation ID.

```bash
curl -s "http://localhost:3000/v1/conversations/$CONVERSATION_ID/state" | jq
```

## Demo sequence

### 1. Named and relationship retrieval

Send either prompt:

```bash
curl -s -X POST "http://localhost:3000/v1/conversations/$CONVERSATION_ID/turns" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Mandale plata a Lucas"}' | jq
```

```bash
curl -s -X POST "http://localhost:3000/v1/conversations/$CONVERSATION_ID/turns" \
  -H 'Content-Type: application/json' \
  -d '{"message":"Send money to my grandson"}' | jq
```

The agent first detects transfer intent. It searches current-user recipient data
or confirmed relationship facts, obtains exactly one ID/version, retrieves the
address internally, revalidates it, and returns a `confirmation_required`
preview. Retrieval itself never returns an address.

### 2. Approval boundary

Verify that the preview names the network, USD₮, amount, recipient, and fee.
Only then send the separate confirmation:

```bash
curl -s -X POST "http://localhost:3000/v1/conversations/$CONVERSATION_ID/turns" \
  -H 'Content-Type: application/json' \
  -d '{"message":"confirm"}' | jq
```

Fixture mode returns a fixture transaction hash. For a live take, use only a
dedicated limited-funds Sepolia wallet, let a human unlock it with a finite TTL,
and capture the post-transfer explorer evidence. Do not use a mainnet wallet.

### 3. Ambiguity and description qualification

For an ambiguity recording, seed two confirmed current-user records named
`Lucas`, with descriptions such as `mi nieto` and `el electricista`, then ask:

```text
Mandale plata a Lucas
```

Expected: `clarification_required`, candidates with descriptions, no selected
address, and no preview. Follow with a qualifier such as:

```text
Mandale plata a Lucas el electricista
```

The hybrid lexical + cosine ranking can resolve only when its score threshold
and margin are safe; otherwise it continues to ask for clarification.

### 4. Confirmed memory write

Ask the agent to remember a recipient or relationship in ordinary language.
It must call `stage_user_memory`, display the exact draft (including an address
only when one was supplied), and wait for an explicit confirmation. A bare
`confirm` persists only the active session's one-time, five-minute draft.
Rejected, expired, reused, or missing confirmations do not change the database.

## Release checks

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e:wdk-mcp
```

Run `npx supabase db reset` once more after the test pass when a clean replay is
needed. The WDK MCP test is read-only: it discovers tools
and reads Sepolia/USD₮ metadata but never sends tokens.

## Failure expectations

    Database/model unavailability, no match, conflicting facts, stale versions,
    or an inactive recipient stop before preview. If a recipient changes after the
    preview, its ID/version revalidation clears both the selection and approval;
    the user must resolve it again. Explicit user-supplied addresses retain the
    existing transfer path and are not stored or embedded by recipient memory.

    ---

    ## Demo de voz — Binance / Agent OS

    Esta sección documenta la demo de voz de cuatro pasos del *Agent OS* de Binance.
    Usá el modo fixture (`BINANCE_TOOLS_SOURCE=fixture`) y, si no querés contactar
    un proveedor de modelo, `AGENT_RUNTIME=deterministic`.

    ### Preparación

    ```bash
    cp .env.example .env
    BINANCE_TOOLS_SOURCE=fixture AGENT_RUNTIME=deterministic npm run dev
    ```

    Levantá el worker de LiveKit (ver `docs/livekit-development-runbook.md`) y abrí
    la sala de voz. Cada paso se habla; la respuesta esperada es lo que el agente
    verbaliza y/o muestra en el transcript.

    ### Paso 1 — Cotización de mercado

    **Decís:** «¿Cómo está el BTC?»

    **Qué se muestra:** el agente llama a `get_market_quote` y lee la cotización
    (bid, ask, last) del activo.

    **Respuesta esperada:** «BTC está a $60.002,50.»

    ### Paso 2 — Compra confirmada de $50 de BNB

    **Decís:** «Comprá $50 de BNB.»

    **Qué se muestra:** el agente llama a `place_binance_order` en modo `dryRun` y
    devuelve un preview de venue Binance (símbolo, cantidad, valor, tipo de orden).
    La conversación queda esperando confirmación (`confirmation_required`).

    **Respuesta esperada:** «Preparé la compra de $50 de BNB. ¿Confirmás?»

    **Después confirmás por frase:** «Confirmo.»

    **Qué se muestra:** la confirmación enruta la ejecución por la vía Binance; la
    operación se ejecuta contra el transporte configurado (fixture en esta demo) y
    se limpia el preview pendiente.

    **Respuesta esperada:** resultado `status: sent` (fixture; sin broadcast real).

    ### Paso 3 — Transferencia fuera de la allowlist (RETAINED)

    **Decís:** «Mandale $5.000 a Marcos.»

    **Qué se muestra:** el agente llama a `binance_internal_transfer`. Como USDT no
    está en `BINANCE_ALLOWED_SYMBOLS`, la política produce un **hold** y la
    operación **no se ejecuta**; se mantiene (RETAINED) con un motivo claro.

    **Respuesta esperada:** `status: error` con código `binance_policy_hold`. El
    agente explica que USDT no está en la lista permitida.

    > **Checklist:** verificar que el código es `binance_policy_hold` y que la
    > operación jamás se reporta como «ejecutada».

    ### Paso 4 — Saldo post-trade

    **Decís:** «¿Cuánto tengo?»

    **Qué se muestra:** el agente llama a `get_binance_balance` y lee el saldo de
    los activos.

    **Respuesta esperada:** «Tenés 10000 USDT, 0.5 BTC, 2 ETH y 10 BNB.»

    ### Checklist de la demo

    - [ ] Paso 1: cotización leída y verbalizada.
    - [ ] Paso 2: preview de la orden y confirmación por frase.
    - [ ] Paso 2: la confirmación ejecuta la operación Binance (fixture).
    - [ ] Paso 3: la transferencia fuera de la allowlist se mantiene (RETAINED) con
      motivo oral y código `binance_policy_hold`.
        - [ ] Paso 4: saldo leído y verbalizado.
        - [ ] Ningún paso revela claves, seeds o credenciales.

    ---

    ## Conexión real al Agent OS (modo `mcp`)

    Esta sección documenta cómo conectar el canal Binance al Agent OS real en lugar de
    usar el fixture. **El primer paso es de solo lectura** (cotización y saldo); recién
    después, opcionalmente, una operación mínima con topes. Nunca se usan fondos de
    mainnet y nunca se commitea un token real.

    ### Preparación

    ```bash
    cp .env.example .env
    ```

        Configurá en `.env`:

        ```dotenv
        BINANCE_TOOLS_SOURCE=mcp
        # BINANCE_MCP_URL=https://agent.binance.com/mcp/agentic
        # BINANCE_MCP_TRANSPORT=http
        # Vía recomendada: inyectá el token del operador con el helper
        # BINANCE_MCP_TOKEN="$(scripts/binance-mcp-token.sh)"
        BINANCE_TESTNET_API_KEY=...
        BINANCE_TESTNET_API_SECRET=...
        # Si solo tenés el token OAuth (sin credenciales de testnet), desactivá el fallback
        # con BINANCE_MCP_DEGRADE=false para que un fallo de conexión se muestre directo.
        # BINANCE_MCP_DEGRADE=false
        ```

        El transporte `src/binance/mcp-remote-client.ts` (seleccionado cuando `BINANCE_MCP_TOKEN`
        está definido) habla el protocolo real del Agent OS: descubre las herramientas con
        `tool_search` (paginado por categoría) y las ejecuta con `tool_execute`. Las cinco
        herramientas del agente se mapean así:

        - `get_market_quote` → `spot.tickerPrice` (+ `spot.ticker24hr` para el cambio 24h).
        - `get_binance_balance` → `spot.getAccount`.
        - `place_binance_order` → `spot.newOrder` (con `quoteOrderQty` para un monto en USD).
        - `get_binance_history` → `spot.myTrades`.
        - `binance_internal_transfer` → herramienta de transferencia descubierta en las
          categorías `transfer` / `asset-management` / `capital`; si el scope concedido no la
          incluye, la capacidad devuelve un resultado «no disponible» claro (nunca un crash ni
          un éxito vacío silencioso).

        ### Flujo del operador (token)

        El endpoint real requiere autenticación. El helper `scripts/binance-mcp-token.sh` lee
        el token de acceso que Codex CLI cachea en el Keychain de macOS y lo imprime para
        sustitución de comandos, sin escribir secretos en disco:

        ```bash
        # Una sola vez: registrá y logueate en el servidor MCP de Binance con Codex CLI
        codex mcp add binance https://agent.binance.com/mcp/agentic
        codex mcp login binance

        # Después, en cada corrida:
        BINANCE_MCP_TOKEN="$(scripts/binance-mcp-token.sh)" BINANCE_TOOLS_SOURCE=mcp npm run dev
        ```

        ### Primer login (solo la primera vez)

        Si la app dice que falta autenticación, en lugar de degradar a testnet te muestra un
        error accionable. En la vía del proxy stdio (`mcp-remote`, sin token) el login es
        interactivo; corrélo en otra terminal y logueate en el navegador:

        ```bash
        npx mcp-remote https://agent.binance.com/mcp/agentic
        ```

        Cuando veas que el proxy queda escuchando (`Proxy established successfully`), volvé a
        arrancar la app. El token ya está cacheado y no hace falta volver a autenticar.

        > **Limitación del proxy:** la vía `mcp-remote` (sin `BINANCE_MCP_TOKEN`) no puede
        > completar el flujo OAuth contra Binance porque el servidor no implementa registro
        > dinámico de clientes (DCR). Si necesitás esa vía, requiere un servidor compatible
        > con DCR o el token inyectado con el helper de arriba.

    ### Paso A — Cotización (solo lectura)

    ```bash
    BINANCE_TOOLS_SOURCE=mcp AGENT_RUNTIME=deterministic npm run dev
    ```

    **Decís:** «¿Cómo está el BTC?»

    **Qué se muestra:** el agente llama a `get_market_quote`; el transporte la resuelve
    contra `spot.tickerPrice` + `spot.ticker24hr` y lee bid/ask/last del Agent OS real.

    **Respuesta esperada:** el precio real del BTC que devuelve el Agent OS. Si todavía
    no autenticaste, verás el error accionable, no una falla silenciosa a testnet.

    ### Paso B — Saldo (solo lectura)

    **Decís:** «¿Cuánto tengo?»

    **Qué se muestra:** el agente llama a `get_binance_balance`; el transporte la resuelve
    contra `spot.getAccount` y lee el saldo de la cuenta autorizada.

    **Respuesta esperada:** los saldos reales de tu cuenta (solo lectura; no se mueve
    nada).

    ### Paso C — Operación mínima opcional (con topes)

    Para probar la ejecución contra el Agent OS real con riesgo mínimo, usá un símbolo
    permitido y un volumen chico; el tope por orden (`BINANCE_MAX_ORDER_USD`) y el tope
    diario (`BINANCE_MAX_DAILY_USD`) siguen aplicando y todo movimiento de dinero pasa
    por el flujo preview → confirm/cancel.

    ```dotenv
    BINANCE_ALLOWED_SYMBOLS=BTC
    BINANCE_MAX_ORDER_USD=10
    BINANCE_MAX_DAILY_USD=10
    ```

    **Decís:** «Comprá $5 de BTC.»

    **Qué se muestra:** el agente muestra un preview de la orden y espera confirmación
    (`confirmation_required`). Al confirmar por frase («Confirmo»), la ejecución enruta
    por la vía `mcp` real; el transporte la resuelve contra `spot.newOrder`.

    > **Checklist de la conexión real:**
    > - [ ] El primer login abre el navegador y cachea el token en `~/.mcp-auth`.
    > - [ ] Paso A lee la cotización real (solo lectura).
    > - [ ] Paso B lee el saldo real (solo lectura).
    > - [ ] Paso C solo si se entendió el alcance; con topes chicos y confirmación explícita.
    > - [ ] Ningún paso muestra el token ni las credenciales de testnet.
