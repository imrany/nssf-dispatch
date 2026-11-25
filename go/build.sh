#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO_DIR="$ROOT_DIR/go"
RELEASE_DIR="$GO_DIR/release"
DIST_EMBED_DIR="$GO_DIR/cmd/server/dist"
SYSO_PATH="$GO_DIR/cmd/server/rsrc_windows_amd64.syso"

APP_NAME="${APP_NAME:-NSSF Digital Statement Dispatcher}"
APP_PUBLISHER="${APP_PUBLISHER:-National Social Security Fund (NSSF) Kenya}"

RAW_VERSION="${APP_VERSION:-}"
if [[ -z "$RAW_VERSION" ]] && command -v git >/dev/null 2>&1 && git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  RAW_VERSION="$(git -C "$ROOT_DIR" describe --tags --abbrev=0 2>/dev/null || true)"
fi
RAW_VERSION="${RAW_VERSION#v}"
if [[ -z "$RAW_VERSION" ]]; then
  RAW_VERSION="1.0.0"
fi
APP_VERSION_CLEAN="$RAW_VERSION"

CORE_VER="${APP_VERSION_CLEAN%%-*}"
IFS='.' read -r VER_MAJOR VER_MINOR VER_PATCH _ <<< "$CORE_VER"
VER_MAJOR="${VER_MAJOR//[^0-9]/}"; VER_MAJOR="${VER_MAJOR:-1}"
VER_MINOR="${VER_MINOR//[^0-9]/}"; VER_MINOR="${VER_MINOR:-0}"
VER_PATCH="${VER_PATCH//[^0-9]/}"; VER_PATCH="${VER_PATCH:-0}"
APP_VER_CSV="${VER_MAJOR},${VER_MINOR},${VER_PATCH},0"
APP_VER_RAW="${VER_MAJOR}.${VER_MINOR}.${VER_PATCH}.0"

BUILD_COMMIT="dev"
if command -v git >/dev/null 2>&1 && git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  BUILD_COMMIT="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "dev")"
fi
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cleanup() {
  rm -f "$SYSO_PATH"
  rm -rf "$RELEASE_DIR/.stage"
}
trap cleanup EXIT

echo "============================================================"
echo " Building: $APP_NAME v$APP_VERSION_CLEAN"
echo " Publisher: $APP_PUBLISHER"
echo " Commit:    $BUILD_COMMIT ($BUILD_DATE)"
echo "============================================================"

echo "[1/5] Building React TypeScript frontend..."
cd "$ROOT_DIR"
npm run build

echo "[2/5] Embedding frontend dist/ into go/cmd/server/dist..."
rm -rf "$DIST_EMBED_DIR"
mkdir -p "$DIST_EMBED_DIR"
cp -R "$ROOT_DIR/dist/." "$DIST_EMBED_DIR/"
find "$DIST_EMBED_DIR" -maxdepth 2 \( -name '.*' -o -name '_*' \) -exec rm -rf {} +

echo "[3/5] Resolving Go dependencies and preparing release directory..."
cd "$GO_DIR"
go mod tidy
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR/.stage"

COMMON_LDFLAGS="-s -w -X 'main.appName=$APP_NAME' -X 'main.appPublisher=$APP_PUBLISHER' -X 'main.appVersion=$APP_VERSION_CLEAN' -X 'main.buildCommit=$BUILD_COMMIT' -X 'main.buildDate=$BUILD_DATE'"

echo "[4/5] Building standalone binaries and desktop app packages..."

# --- Windows amd64 (with embedded icon + PE VersionInfo) ---
if command -v x86_64-w64-mingw32-windres >/dev/null 2>&1; then
  x86_64-w64-mingw32-windres \
    --include-dir="$GO_DIR/packaging/windows" \
    -DAPP_VER_CSV="$APP_VER_CSV" \
    -DAPP_VER_RAW="$APP_VER_RAW" \
    "$GO_DIR/packaging/windows/app.rc" \
    -O coff \
    -o "$SYSO_PATH"
else
  echo "Warning: x86_64-w64-mingw32-windres not found; building Windows binary without embedded PE icon/versioninfo."
fi

GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build \
  -ldflags="$COMMON_LDFLAGS -H=windowsgui" \
  -o "$RELEASE_DIR/NSSF-Statement-Dispatch-windows-amd64.exe" \
  ./cmd/server
rm -f "$SYSO_PATH"

if command -v zip >/dev/null 2>&1; then
  WIN_STAGE="$RELEASE_DIR/.stage/windows-amd64"
  mkdir -p "$WIN_STAGE"
  cp "$RELEASE_DIR/NSSF-Statement-Dispatch-windows-amd64.exe" "$WIN_STAGE/"
  cp "$GO_DIR/packaging/windows/nssf.ico" "$WIN_STAGE/"
  (cd "$WIN_STAGE" && zip -q -r "$RELEASE_DIR/NSSF-Statement-Dispatch-windows-amd64.zip" .)
fi

# --- Linux (amd64 & arm64) binaries + desktop bundles ---
package_linux() {
  local arch="$1"
  local bin_name="nssf-statement-dispatch-linux-$arch"
  local bundle_name="NSSF-Statement-Dispatch-linux-$arch.tar.gz"
  local stage="$RELEASE_DIR/.stage/linux-$arch"

  GOOS=linux GOARCH="$arch" CGO_ENABLED=0 go build \
    -ldflags="$COMMON_LDFLAGS" \
    -o "$RELEASE_DIR/$bin_name" \
    ./cmd/server

  mkdir -p "$stage"
  cp "$RELEASE_DIR/$bin_name" "$stage/nssf-statement-dispatch"
  chmod +x "$stage/nssf-statement-dispatch"
  cp "$GO_DIR/packaging/linux/nssf-dispatch.desktop" "$stage/"
  cp "$GO_DIR/packaging/linux/nssf-dispatch.png" "$stage/"

  cat > "$stage/install.sh" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/512x512/apps"

mkdir -p "$BIN_DIR" "$APP_DIR" "$ICON_DIR"
install -m 755 "$SCRIPT_DIR/nssf-statement-dispatch" "$BIN_DIR/nssf-statement-dispatch"
install -m 644 "$SCRIPT_DIR/nssf-dispatch.png" "$ICON_DIR/nssf-dispatch.png"
install -m 644 "$SCRIPT_DIR/nssf-dispatch.desktop" "$APP_DIR/nssf-dispatch.desktop"
sed -i "s|^Exec=.*|Exec=$BIN_DIR/nssf-statement-dispatch --open|" "$APP_DIR/nssf-dispatch.desktop" || true

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APP_DIR" || true
echo "Installed NSSF Digital Statement Dispatcher to $BIN_DIR/nssf-statement-dispatch"
EOF
  chmod +x "$stage/install.sh"
  tar -czf "$RELEASE_DIR/$bundle_name" -C "$stage" .
}

package_linux amd64
package_linux arm64

# --- macOS (amd64 & arm64) binaries + .app bundles ---
package_macos() {
  local arch="$1"
  local bin_name="nssf-statement-dispatch-darwin-$arch"
  local bundle_tar="NSSF-Statement-Dispatch-macos-$arch.app.tar.gz"
  local stage="$RELEASE_DIR/.stage/macos-$arch"
  local app_dir="$stage/$APP_NAME.app"

  GOOS=darwin GOARCH="$arch" CGO_ENABLED=0 go build \
    -ldflags="$COMMON_LDFLAGS" \
    -o "$RELEASE_DIR/$bin_name" \
    ./cmd/server

  mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
  cp "$RELEASE_DIR/$bin_name" "$app_dir/Contents/MacOS/nssf-statement-dispatch-darwin"
  chmod +x "$app_dir/Contents/MacOS/nssf-statement-dispatch-darwin"
  cp "$GO_DIR/packaging/macos/nssf.icns" "$app_dir/Contents/Resources/nssf.icns"
  sed "s|<string>1\.0\.0</string>|<string>${APP_VERSION_CLEAN}</string>|g" \
    "$GO_DIR/packaging/macos/Info.plist" > "$app_dir/Contents/Info.plist"

  tar -czf "$RELEASE_DIR/$bundle_tar" -C "$stage" "$APP_NAME.app"
}

package_macos amd64
package_macos arm64

echo "[5/5] Generating SHA256SUMS.txt..."
rm -rf "$RELEASE_DIR/.stage"
(
  cd "$RELEASE_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum * > SHA256SUMS.txt
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 * > SHA256SUMS.txt
  fi
)

echo "Release artifacts generated in $RELEASE_DIR:"
ls -lh "$RELEASE_DIR"
