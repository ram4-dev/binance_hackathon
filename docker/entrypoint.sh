#!/bin/sh
set -e

# Single image, two entrypoints:
#   api    -> node dist/server.js          (default; the HTTP API)
#   worker -> node dist/livekit/worker.js start  (the LiveKit voice worker)
#
# The worker subcommand `start` mirrors package.json "livekit:start"; the
# @livekit/agents CLI reads the subcommand from argv and refuses to run without
# one. The worker fails closed at startup when required env vars are absent.

case "${1:-api}" in
  api)
    exec node dist/server.js
    ;;
  worker)
    exec node dist/livekit/worker.js start
    ;;
  *)
    echo "Unknown entrypoint: ${1} (expected 'api' or 'worker')" >&2
    exit 1
    ;;
esac
