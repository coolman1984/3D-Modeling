#!/usr/bin/env bash
# Linux / macOS launcher: ./start.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org and run this again."
  echo "محتاج تثبت Node.js الأول من https://nodejs.org"
  exit 1
fi
exec node scripts/start.mjs "$@"
