#!/usr/bin/env bash
# Prints the Binance Agent OS OAuth access token cached by Codex CLI in the
# macOS Keychain. Used to feed BINANCE_MCP_TOKEN without storing secrets on
# disk. Prints nothing but the token (for command substitution).
set -euo pipefail

ACCOUNT="binance-mcp-server|691e3e435ca03f0e"
SERVICE="Codex MCP Credentials"

RAW="$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w)"
# Codex stores a JSON blob with access/refresh tokens; if so, extract access_token.
if python3 - "$RAW" <<'PY' 2>/dev/null
import json, sys
data = json.loads(sys.argv[1])
tok = data.get("access_token") or (data.get("token_response") or {}).get("access_token") or (data.get("tokens") or {}).get("access_token")
if not tok:
    sys.exit(1)
print(tok)
PY
then
  exit 0
fi
# Fallback: the item is the raw token itself.
printf '%s' "$RAW"
