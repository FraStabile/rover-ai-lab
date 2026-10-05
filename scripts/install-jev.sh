#!/usr/bin/env bash
# Installs jevos (https://github.com/feder-cr/jev), a local Jev-compatible decision server,
# into .jev/ and configures Rover AI Lab to use it.
#
#   npm run jev:install                  # latest release, writes .env, runs a smoke test
#   bash scripts/install-jev.sh --tag jevos-v3 --no-env
#   bash scripts/install-jev.sh --dry-run
#
# Downloads ~650 MB (server ~25 MB + OpenVINO int8 model ~630 MB) and verifies SHA-256 checksums.
# Supported: macOS arm64, Linux x86_64. On Windows, follow the manual steps in the README.
set -euo pipefail

REPO="feder-cr/jev"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${JEV_HOME:-$ROOT/.jev}"
TAG="${JEV_TAG:-latest}"
PORT="${JEV_PORT:-8017}"
WRITE_ENV=1
SMOKE_TEST=1
DRY_RUN=0

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  cat <<EOF

Options:
  --tag <tag>     release to install (default: latest, e.g. jevos-v4)
  --dir <path>    install directory (default: $ROOT/.jev)
  --port <port>   port used by the smoke test (default: 8017)
  --no-env        do not touch .env
  --skip-test     do not start the server after installing
  --dry-run       resolve the release and check the download URLs only
  -h, --help      this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --dir) DEST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --no-env) WRITE_ENV=0; shift ;;
    --skip-test) SMOKE_TEST=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

step() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
fail() { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "'$1' is required but not installed."; }
need curl
need tar
need unzip

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else fail "neither shasum nor sha256sum found"; fi
}

# ---------------------------------------------------------------- platform
step "Detecting platform"
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS/$ARCH" in
  Darwin/arm64) SERVER_ASSET="jev-macos-arm64.tar.gz" ;;
  Linux/x86_64|Linux/amd64) SERVER_ASSET="jev-linux-x64.tar.gz" ;;
  Darwin/x86_64) fail "jevos ships macOS builds for Apple Silicon only (arm64). Build from source: https://github.com/$REPO#build-from-source" ;;
  MINGW*|MSYS*|CYGWIN*) fail "On Windows download jev-windows-x64.zip and the model from https://github.com/$REPO/releases (see README)." ;;
  *) fail "Unsupported platform $OS/$ARCH. Build from source: https://github.com/$REPO#build-from-source" ;;
esac
info "$OS $ARCH → $SERVER_ASSET"

# ---------------------------------------------------------------- release
step "Resolving release ($TAG)"
if [[ "$TAG" == "latest" ]]; then
  # github.com/<repo>/releases/latest redirects to /releases/tag/<tag> (no API rate limit).
  latest_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")" \
    || fail "could not reach github.com. Check the network or pass --tag jevos-v4."
  TAG="${latest_url##*/tag/}"
  [[ -n "$TAG" && "$TAG" != "$latest_url" ]] || fail "could not read the latest release tag; pass --tag jevos-v4"
fi
MODEL_ASSET="${TAG}-openvino-int8.zip"
BASE_URL="https://github.com/$REPO/releases/download/$TAG"
info "release: $TAG"
info "server:  $BASE_URL/$SERVER_ASSET"
info "model:   $BASE_URL/$MODEL_ASSET"

if [[ "$DRY_RUN" == 1 ]]; then
  step "Dry run: checking that the assets exist"
  for a in "$SERVER_ASSET" "$MODEL_ASSET" SHA256SUMS.txt; do
    code="$(curl -s -o /dev/null -w '%{http_code}' -I -L "$BASE_URL/$a")"
    info "$a → HTTP $code"
    [[ "$code" == 200 ]] || fail "$a not found in release $TAG"
  done
  info "Install directory would be: $DEST/$TAG"
  exit 0
fi

# ---------------------------------------------------------------- download
DL="$DEST/downloads/$TAG"
mkdir -p "$DL"
step "Downloading (resumable; ~650 MB the first time)"
for a in SHA256SUMS.txt "$SERVER_ASSET" "$MODEL_ASSET"; do
  info "$a"
  curl -fL --retry 3 --retry-delay 2 -C - --progress-bar -o "$DL/$a" "$BASE_URL/$a" \
    || fail "download of $a failed"
done

step "Verifying SHA-256 checksums"
for a in "$SERVER_ASSET" "$MODEL_ASSET"; do
  expected="$(awk -v f="$a" '{name=$2; sub(/^\*/, "", name); if (name == f) print $1}' "$DL/SHA256SUMS.txt")"
  [[ -n "$expected" ]] || fail "$a is not listed in SHA256SUMS.txt"
  actual="$(sha256 "$DL/$a")"
  if [[ "$actual" != "$expected" ]]; then
    rm -f "$DL/$a"
    fail "checksum mismatch for $a (file removed, run the script again)"
  fi
  info "$a OK"
done

# ---------------------------------------------------------------- unpack
step "Installing into $DEST/$TAG"
TARGET="$DEST/$TAG"
rm -rf "$TARGET.tmp"
mkdir -p "$TARGET.tmp"
tar -xzf "$DL/$SERVER_ASSET" -C "$TARGET.tmp"
JEV_DIR="$(dirname "$(find "$TARGET.tmp" -maxdepth 3 -type f -name jev | head -n1)")"
[[ -f "$JEV_DIR/jev" ]] || fail "the archive does not contain the jev binary"
(cd "$JEV_DIR" && unzip -q -o "$DL/$MODEL_ASSET")
[[ -d "$JEV_DIR/model" ]] || fail "the model archive did not create a model/ folder"
chmod +x "$JEV_DIR/jev"
if [[ "$OS" == "Darwin" ]]; then xattr -dr com.apple.quarantine "$TARGET.tmp" 2>/dev/null || true; fi
rm -rf "$TARGET"
mv "$TARGET.tmp" "$TARGET"
JEV_DIR="${JEV_DIR/$TARGET.tmp/$TARGET}"
ln -sfn "$JEV_DIR" "$DEST/current"
info "binary: $DEST/current/jev"
info "model:  $DEST/current/model"

# ---------------------------------------------------------------- .env
set_env() {
  local key="$1" value="$2" file="$ROOT/.env" tmp
  tmp="$(mktemp)"
  if grep -qE "^#?[[:space:]]*$key=" "$file"; then
    awk -v k="$key" -v v="$value" 'BEGIN{done=0} $0 ~ "^#?[[:space:]]*"k"=" { if (!done) { print k"="v; done=1 }; next } { print }' "$file" > "$tmp"
  else
    cat "$file" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$file"
}

if [[ "$WRITE_ENV" == 1 ]]; then
  step "Configuring Rover AI Lab (.env)"
  [[ -f "$ROOT/.env" ]] || cp "$ROOT/.env.example" "$ROOT/.env"
  set_env AI_PROVIDER local-jev
  set_env JEV_ENABLED true
  set_env JEV_BASE_URL "http://127.0.0.1:$PORT"
  set_env JEV_MODEL jev-latest
  set_env JEV_PROTOCOL systemone
  set_env JEV_TIMEOUT 1000
  info "AI_PROVIDER=local-jev, JEV_PROTOCOL=systemone, JEV_BASE_URL=http://127.0.0.1:$PORT"
fi

# ---------------------------------------------------------------- smoke test
if [[ "$SMOKE_TEST" == 1 ]]; then
  step "Smoke test: starting jev on port $PORT"
  if curl -s -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    info "something already listens on port $PORT, skipping the test"
  else
    LOG="$DEST/smoke-test.log"
    "$DEST/current/jev" serve --port "$PORT" >"$LOG" 2>&1 &
    PID=$!
    trap 'kill $PID 2>/dev/null || true' EXIT
    ready=0
    for _ in $(seq 1 120); do
      if curl -s -m 2 "http://127.0.0.1:$PORT/health" | grep -q '"ready"'; then ready=1; break; fi
      kill -0 $PID 2>/dev/null || break
      sleep 1
    done
    [[ "$ready" == 1 ]] || fail "jev did not become ready in 120 s; see $LOG"
    auth=()
    [[ -n "${JEV_API_KEY:-}" ]] && auth=(-H "Authorization: Bearer $JEV_API_KEY")
    answer="$(curl -s -m 20 "http://127.0.0.1:$PORT/v1/systemone" -H 'Content-Type: application/json' ${auth[@]+"${auth[@]}"} -d '{
      "model": "jev-latest",
      "state": {"obstacles": {"front": 0.6, "frontLeft": 4.0, "frontRight": 0.9}, "target": {"distance": 12, "bearing": 5}},
      "questions": {"action": {"type": "choice",
        "instructions": "A rover must not drive into obstacles closer than 1 m. Which action should it take?",
        "criteria": {"FORWARD": "drive straight", "TURN_LEFT": "turn left", "TURN_RIGHT": "turn right", "STOP": "stand still"}}}}')"
    info "answer: $answer"
    echo "$answer" | grep -q '"choice"' || fail "unexpected answer from jev; see $LOG"
    kill $PID 2>/dev/null || true
    wait $PID 2>/dev/null || true
    trap - EXIT
    info "jev answered correctly"
  fi
fi

step "Done"
cat <<EOF
    Start jevos:            npm run jev
    Start the lab:          npm run dev            (or both at once: npm run dev:jev)
    Open:                   http://localhost:3000  → AUTO → RUN
EOF
