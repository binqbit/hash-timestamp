#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for bin in "$HOME/.cargo/bin" "$ROOT_DIR/node_modules/.bin"; do
  if [[ -d "$bin" ]]; then
    export PATH="$bin:$PATH"
  fi
done

# Keep an already-selected Solana CLI/toolchain authoritative. Use the legacy
# installer path only as a fallback so it cannot shadow a newer system CLI.
SOLANA_FALLBACK_BIN="$HOME/.local/share/solana/install/active_release/bin"
if [[ -d "$SOLANA_FALLBACK_BIN" ]]; then
  export PATH="$PATH:$SOLANA_FALLBACK_BIN"
fi

export ANCHOR_PROVIDER_URL="${ANCHOR_PROVIDER_URL:-http://127.0.0.1:8899}"
export ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
export CARGO_TARGET_DIR="$ROOT_DIR/target"

EXPECTED_ANCHOR_VERSION="0.31.1"
ANCHOR_BIN="${ANCHOR_BIN:-anchor}"

print_usage() {
  cat <<'EOF'
Usage:
  ./scripts/test.sh --build-only   # build; no validator or deployment
  ./scripts/test.sh               # full local test run
  ./scripts/test.sh --quick        # fast run (skip-build + skip-deploy + skip-local-validator)
  ./scripts/test.sh <anchor args>  # pass-through args to `anchor test`

Cargo args after -- are supported; test runs enable debug-logs automatically.

Environment:
  ANCHOR_PROVIDER_URL - default: http://127.0.0.1:8899
  ANCHOR_WALLET       - default: ~/.config/solana/id.json
  ANCHOR_BIN          - Anchor CLI executable; must be version 0.31.1 (default: anchor)
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  print_usage
  exit 0
fi

MODE=test
if [[ "${1:-}" == "--build-only" ]]; then
  MODE=build
  shift
elif [[ "${1:-}" == "--quick" ]]; then
  MODE=quick
  shift
fi

ANCHOR_ARGS=()
CARGO_ARGS=()
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --help|-h)
      print_usage
      exit 0
      ;;
    --)
      shift
      CARGO_ARGS=("$@")
      break
      ;;
    *)
      ANCHOR_ARGS+=("$1")
      shift
      ;;
  esac
done
BUILD_FEATURES=()
if [[ "$MODE" != build ]]; then
  BUILD_FEATURES=(--features debug-logs)
fi

NEEDS_BUILD=true
if [[ "$MODE" == quick ]]; then
  NEEDS_BUILD=false
fi
for token in "${ANCHOR_ARGS[@]}"; do
  if [[ "$token" == "--skip-build" ]]; then
    NEEDS_BUILD=false
  fi
done

if [[ "$MODE" != build && "$MODE" != quick ]]; then
  skip_validator=false
  skip_deploy=false
  for token in "${ANCHOR_ARGS[@]}"; do
    [[ "$token" != --skip-local-validator ]] || skip_validator=true
    [[ "$token" != --skip-deploy ]] || skip_deploy=true
  done
  if [[ "$skip_validator" == true && "$skip_deploy" == false ]]; then
    echo "A manually managed validator must already load the program; use --quick or also --skip-deploy." >&2
    exit 1
  fi
fi

if ! command -v "$ANCHOR_BIN" >/dev/null; then
  echo "Anchor CLI executable '$ANCHOR_BIN' is not found." >&2
  echo "Install Anchor CLI $EXPECTED_ANCHOR_VERSION or set ANCHOR_BIN to its executable path." >&2
  exit 1
fi

if ! ANCHOR_VERSION_OUTPUT="$("$ANCHOR_BIN" --version 2>&1)"; then
  echo "Failed to read the Anchor CLI version from '$ANCHOR_BIN': $ANCHOR_VERSION_OUTPUT" >&2
  exit 1
fi
read -r _ ANCHOR_VERSION _ <<< "$ANCHOR_VERSION_OUTPUT"
if [[ "$ANCHOR_VERSION" != "$EXPECTED_ANCHOR_VERSION" ]]; then
  echo "Anchor CLI $EXPECTED_ANCHOR_VERSION is required, but '$ANCHOR_BIN --version' returned: $ANCHOR_VERSION_OUTPUT" >&2
  echo "Activate Anchor $EXPECTED_ANCHOR_VERSION (for example with AVM), or set ANCHOR_BIN to the matching executable." >&2
  exit 1
fi

if [[ "$NEEDS_BUILD" == true ]]; then
  if ! command -v rustup >/dev/null; then
    echo "rustup is required to resolve Cargo toolchain selectors such as '+nightly'." >&2
    exit 1
  fi

  if ! command -v cargo >/dev/null; then
    echo "cargo is required to build the program." >&2
    exit 1
  fi

  HASH_TIMESTAMP_REAL_CARGO="$(command -v cargo)"
  export HASH_TIMESTAMP_REAL_CARGO

  WRAPPER_DIR="$(mktemp -d)"
  trap 'rm -rf "$WRAPPER_DIR"' EXIT
  mkdir -p "$WRAPPER_DIR"

  cat > "$WRAPPER_DIR/cargo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == +* ]]; then
  toolchain="${1#+}"
  shift
  exec rustup run "$toolchain" cargo "$@"
fi

exec "$HASH_TIMESTAMP_REAL_CARGO" "$@"
EOF
  chmod +x "$WRAPPER_DIR/cargo"

  export PATH="$WRAPPER_DIR:$PATH"
fi

build_program() {
  run_anchor clean
  run_anchor build "$@" -- "${BUILD_FEATURES[@]}" "${CARGO_ARGS[@]}"
}

check_build_artifacts() {
  node "$ROOT_DIR/scripts/check-idl.cjs"
  if [[ ! -f "$ROOT_DIR/target/deploy/hash_timestamp.so" ]]; then
    echo "Program artifact is missing; run yarn build before skipping the build." >&2
    exit 1
  fi
}

ensure_expected_release_path() {
  local release_path="$ROOT_DIR/target/sbpf-solana-solana/release"
  local expected_parent="$ROOT_DIR/target/sbpf-solana-solana"

  mkdir -p "$expected_parent"

  if [[ -L "$release_path" || -f "$release_path" ]]; then
    rm -rf "$release_path"
  fi
  if [[ -d "$release_path" ]]; then
    return
  fi

  mkdir -p "$release_path"
}

run_anchor() {
  ensure_expected_release_path
  "$ANCHOR_BIN" "$@"
}

dedupe_anchor_args() {
  DEDUPED_ANCHOR_ARGS=()
  local has_skip_build=false
  local has_skip_deploy=false
  local has_skip_validator=false

  for token in "$@"; do
    case "$token" in
      --skip-build)
        if [[ "$has_skip_build" == false ]]; then
          DEDUPED_ANCHOR_ARGS+=("$token")
          has_skip_build=true
        fi
        ;;
      --skip-deploy)
        if [[ "$has_skip_deploy" == false ]]; then
          DEDUPED_ANCHOR_ARGS+=("$token")
          has_skip_deploy=true
        fi
        ;;
      --skip-local-validator)
        if [[ "$has_skip_validator" == false ]]; then
          DEDUPED_ANCHOR_ARGS+=("$token")
          has_skip_validator=true
        fi
        ;;
      *)
        DEDUPED_ANCHOR_ARGS+=("$token")
        ;;
    esac
  done

  if [[ "$has_skip_build" == false ]]; then
    DEDUPED_ANCHOR_ARGS+=(--skip-build)
  fi
  if [[ "$has_skip_deploy" == false ]]; then
    DEDUPED_ANCHOR_ARGS+=(--skip-deploy)
  fi
  if [[ "$has_skip_validator" == false ]]; then
    DEDUPED_ANCHOR_ARGS+=(--skip-local-validator)
  fi
}

if [[ "$MODE" == build ]]; then
  build_program "${ANCHOR_ARGS[@]}"
  check_build_artifacts
elif [[ "$MODE" == quick ]]; then
  check_build_artifacts
  dedupe_anchor_args "${ANCHOR_ARGS[@]}"
  run_anchor test "${DEDUPED_ANCHOR_ARGS[@]}" -- "${BUILD_FEATURES[@]}" "${CARGO_ARGS[@]}"
else
  if [[ "$NEEDS_BUILD" == true ]]; then
    build_program
    ANCHOR_ARGS+=(--skip-build)
  fi
  check_build_artifacts
  run_anchor test "${ANCHOR_ARGS[@]}" -- "${BUILD_FEATURES[@]}" "${CARGO_ARGS[@]}"
fi
