#!/usr/bin/env bash
# Starts the local jevos server installed by scripts/install-jev.sh.
# Extra arguments go to `jev serve`, e.g. npm run jev -- --threads 8 --port 8017
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${JEV_HOME:-$ROOT/.jev}/current/jev"
if [[ ! -x "$BIN" ]]; then
  echo "jevos is not installed. Run: npm run jev:install   (or use the stand-in: npm run mock-jev)" >&2
  exit 1
fi
exec "$BIN" serve "$@"
