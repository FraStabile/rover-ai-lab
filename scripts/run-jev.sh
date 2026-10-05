#!/usr/bin/env bash
# Starts the local jevos server. If jevos is not installed on this machine yet, installs it
# first with scripts/install-jev.sh (one-time download of ~650 MB, checksums verified).
# Extra arguments go to `jev serve`, e.g. npm run jev -- --threads 8 --port 8017
# Set JEV_NO_AUTO_INSTALL=1 to fail instead of installing.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${JEV_HOME:-$ROOT/.jev}/current/jev"
if [[ ! -x "$BIN" ]]; then
  if [[ "${JEV_NO_AUTO_INSTALL:-0}" == 1 ]]; then
    echo "jevos is not installed. Run: npm run jev:install   (or use the stand-in: npm run mock-jev)" >&2
    exit 1
  fi
  echo "jevos is not installed on this machine: installing it now (scripts/install-jev.sh)..." >&2
  bash "$ROOT/scripts/install-jev.sh" --skip-test
fi
exec "$BIN" serve "$@"
