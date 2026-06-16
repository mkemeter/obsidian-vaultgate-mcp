#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$OSTYPE" == "darwin"* ]]; then
  bash "$SCRIPT_DIR/launchd/install.sh"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  bash "$SCRIPT_DIR/systemd/install.sh"
else
  echo "Unsupported platform: $OSTYPE"
  echo "See README.md for manual setup instructions."
  exit 1
fi
