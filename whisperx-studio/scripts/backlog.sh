#!/usr/bin/env bash
# Wrapper backlog portable (macOS/Linux). Équivalent logique de scripts/backlog.ps1.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/backlog.mjs" "$@"
