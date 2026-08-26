#!/usr/bin/env bash
# Extract each contract's on-chain interface (its `#[contracttype]` structs and
# enums, plus every function signature) straight from the built WASM, and
# write it to contracts/specs/<name>.json.
#
# This is the *source of truth* the TypeScript and Python type generators
# (see ../scripts/generate-contract-types.ts) read from — not the Rust source
# directly, and not hand-maintained SDK types. Reading it from the compiled
# WASM rather than parsing lib.rs means the spec matches exactly what a
# deployed contract exposes, `#[contracttype]` macro expansion included.
#
# Usage:
#   ./generate-specs.sh          # rebuild WASM, regenerate contracts/specs/*.json
#   ./generate-specs.sh --check  # fail if the committed specs are stale
#
# Requires `cargo` (with the wasm32v1-none target) and the `stellar` CLI.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# Every contract whose structs the SDKs decode (see packages/core/src/index.ts
# and python/src/stellaragent/agent.py). Contracts with no SDK-facing struct
# (circuit_breaker, price_oracle, amm_swap) are deliberately left out — add a
# contract here the day an SDK starts decoding one of its structs.
CONTRACTS=(agent_wallet_factory payment_channel escrow rate_limiter)

CHECK=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK=1
fi

echo "Building contracts: ${CONTRACTS[*]}" >&2
package_args=()
for name in "${CONTRACTS[@]}"; do
  package_args+=(-p "$name")
done
cargo build --release --target wasm32v1-none "${package_args[@]}" >&2

OUT_DIR="specs"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

stale=()
for name in "${CONTRACTS[@]}"; do
  wasm="target/wasm32v1-none/release/${name}.wasm"
  if [[ ! -f "$wasm" ]]; then
    echo "error: $wasm was not produced by the build above" >&2
    exit 1
  fi

  fresh="$WORK_DIR/${name}.json"
  stellar contract info interface --wasm "$wasm" --output json-formatted > "$fresh"
  printf '\n' >> "$fresh"

  if [[ "$CHECK" -eq 1 ]]; then
    committed="$OUT_DIR/${name}.json"
    if [[ ! -f "$committed" ]] || ! diff -q "$committed" "$fresh" > /dev/null; then
      stale+=("$name")
    fi
  else
    mkdir -p "$OUT_DIR"
    cp "$fresh" "$OUT_DIR/${name}.json"
    echo "Wrote $OUT_DIR/${name}.json" >&2
  fi
done

if [[ "$CHECK" -eq 1 ]]; then
  if [[ "${#stale[@]}" -gt 0 ]]; then
    echo "error: contracts/specs is out of date for: ${stale[*]}" >&2
    echo "       A contract's #[contracttype] struct or function signature changed." >&2
    echo "       Run: cd contracts && ./generate-specs.sh" >&2
    echo "       Then run: pnpm contract-types:generate" >&2
    echo "       and update the TS/Python decoders for whatever changed." >&2
    exit 1
  fi
  echo "contracts/specs/*.json are up to date." >&2
fi
