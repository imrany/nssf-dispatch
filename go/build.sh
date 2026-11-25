#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO_DIR="$ROOT_DIR/go"

echo "[1/4] Building React TypeScript frontend..."
cd "$ROOT_DIR"
npm run build

echo "[2/4] Embedding frontend dist/ into go/cmd/server/dist..."
rm -rf "$GO_DIR/cmd/server/dist"
cp -r "$ROOT_DIR/dist" "$GO_DIR/cmd/server/dist"

echo "[3/4] Compiling Windows PE resource (Logo, App Name, Publisher)..."
if command -v x86_64-w64-mingw32-windres >/dev/null 2>&1; then
  x86_64-w64-mingw32-windres "$GO_DIR/packaging/windows/app.rc" -O coff -o "$GO_DIR/cmd/server/rsrc_windows_amd64.syso"
else
  echo "Warning: x86_64-w64-mingw32-windres not found; skipping .syso resource embedding."
fi

echo "[4/4] Building standalone zero-dependency Go binaries..."
cd "$GO_DIR"
mkdir -p release

GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build \
  -ldflags="-s -w -H=windowsgui" \
  -o release/NSSF-Statement-Dispatch.exe ./cmd/server

GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build \
  -ldflags="-s -w" \
  -o release/nssf-statement-dispatch-linux ./cmd/server

echo "Standalone binaries built in $GO_DIR/release/"
