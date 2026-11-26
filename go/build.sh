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

  cat > "$WIN_STAGE/Start-NSSF-Dispatch.bat" << 'EOF'
@echo off
cd /d "%~dp0"
start "" "%~dp0NSSF-Statement-Dispatch-windows-amd64.exe"
EOF

  cat > "$WIN_STAGE/Install-Shortcut.ps1" << 'EOF'
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $dir "NSSF-Statement-Dispatch-windows-amd64.exe"
$ico = Join-Path $dir "nssf.ico"
$wsh = New-Object -ComObject WScript.Shell

foreach ($targetDir in @(
  [Environment]::GetFolderPath("Desktop"),
  (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs")
)) {
  if (Test-Path $targetDir) {
    $lnk = $wsh.CreateShortcut((Join-Path $targetDir "NSSF Digital Statement Dispatcher.lnk"))
    $lnk.TargetPath = $exe
    $lnk.WorkingDirectory = $dir
    $lnk.IconLocation = "$ico,0"
    $lnk.Description = "NSSF Digital Statement Dispatcher"
    $lnk.Save()
  }
}
Write-Host "Desktop and Start Menu shortcuts created."
EOF

  cat > "$WIN_STAGE/SETUP.txt" << 'EOF'
NSSF Digital Statement Dispatcher — Windows Setup
==================================================
1. Extract this ZIP folder to a permanent folder (e.g. C:\NSSF-Dispatch).
2. Double-click "NSSF-Statement-Dispatch-windows-amd64.exe" (or "Start-NSSF-Dispatch.bat").
   The portal automatically opens in your default browser at http://127.0.0.1:8080.
3. Optional: Right-click "Install-Shortcut.ps1" -> "Run with PowerShell" to add Desktop & Start Menu icons.
EOF

  (cd "$WIN_STAGE" && zip -q -r "$RELEASE_DIR/NSSF-Statement-Dispatch-windows-amd64.zip" .)
fi

# --- Linux / Ubuntu (amd64 & arm64) binaries + .tar.gz bundles + .deb installers ---
package_linux() {
  local arch="$1"
  local bin_name="nssf-statement-dispatch-linux-$arch"
  local bundle_name="NSSF-Statement-Dispatch-linux-$arch.tar.gz"
  local folder_name="NSSF-Statement-Dispatch-linux-$arch"
  local stage="$RELEASE_DIR/.stage/linux-$arch/$folder_name"

  GOOS=linux GOARCH="$arch" CGO_ENABLED=0 go build \
    -ldflags="$COMMON_LDFLAGS" \
    -o "$RELEASE_DIR/$bin_name" \
    ./cmd/server
  chmod 755 "$RELEASE_DIR/$bin_name"

  mkdir -p "$stage"
  cp "$RELEASE_DIR/$bin_name" "$stage/nssf-statement-dispatch"
  chmod 755 "$stage/nssf-statement-dispatch"
  cp "$GO_DIR/packaging/linux/nssf-dispatch.desktop" "$stage/"
  cp "$GO_DIR/packaging/linux/nssf-dispatch.png" "$stage/"

  cat > "$stage/start.sh" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chmod +x "$SCRIPT_DIR/nssf-statement-dispatch"
exec "$SCRIPT_DIR/nssf-statement-dispatch" "$@"
EOF
  chmod 755 "$stage/start.sh"

  cat > "$stage/install.sh" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/512x512/apps"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
TARGET_BIN="$BIN_DIR/nssf-statement-dispatch"
TARGET_ICON="$ICON_DIR/nssf-dispatch.png"

ENABLE_AUTOSTART=false
LAUNCH_NOW=true
for arg in "$@"; do
  case "$arg" in
    --autostart) ENABLE_AUTOSTART=true ;;
    --no-launch) LAUNCH_NOW=false ;;
  esac
done

mkdir -p "$BIN_DIR" "$APP_DIR" "$ICON_DIR"
install -m 755 "$SCRIPT_DIR/nssf-statement-dispatch" "$TARGET_BIN"
install -m 644 "$SCRIPT_DIR/nssf-dispatch.png" "$TARGET_ICON"

cat > "$APP_DIR/nssf-dispatch.desktop" << DESKTOP
[Desktop Entry]
Type=Application
Name=NSSF Digital Statement Dispatcher
GenericName=Member Statement Dispatch Portal
Comment=Validate, password-protect, and securely dispatch NSSF member statements
Exec=$TARGET_BIN
Icon=$TARGET_ICON
Terminal=false
Categories=Office;Finance;
StartupNotify=true
X-Publisher=National Social Security Fund (NSSF) Kenya
DESKTOP
chmod 755 "$APP_DIR/nssf-dispatch.desktop"

if [[ -d "${HOME}/Desktop" ]]; then
  cp "$APP_DIR/nssf-dispatch.desktop" "${HOME}/Desktop/nssf-dispatch.desktop"
  chmod 755 "${HOME}/Desktop/nssf-dispatch.desktop"
  if command -v gio >/dev/null 2>&1; then
    gio set "${HOME}/Desktop/nssf-dispatch.desktop" metadata::trusted true >/dev/null 2>&1 || true
  fi
fi

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "${HOME}/.local/share/icons/hicolor" >/dev/null 2>&1 || true

if [[ "$ENABLE_AUTOSTART" == "true" ]]; then
  mkdir -p "$SYSTEMD_USER_DIR"
  cat > "$SYSTEMD_USER_DIR/nssf-dispatch.service" << UNIT
[Unit]
Description=NSSF Digital Statement Dispatcher
After=network.target

[Service]
ExecStart=$TARGET_BIN --no-open
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    systemctl --user enable --now nssf-dispatch.service >/dev/null 2>&1 || true
    echo "Enabled systemd user background service: nssf-dispatch.service"
  fi
fi

echo "============================================================"
echo " Installed NSSF Digital Statement Dispatcher"
echo " Binary:   $TARGET_BIN"
echo " Launcher: $APP_DIR/nssf-dispatch.desktop"
echo " Icon:     $TARGET_ICON"
echo "============================================================"

if [[ "$LAUNCH_NOW" == "true" ]] && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
  nohup "$TARGET_BIN" >/dev/null 2>&1 &
  echo "Launched NSSF Digital Statement Dispatcher (opening browser)..."
elif [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Run directly with: $TARGET_BIN"
fi
EOF
  chmod 755 "$stage/install.sh"

  cat > "$stage/uninstall.sh" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now nssf-dispatch.service >/dev/null 2>&1 || true
fi
rm -f "${HOME}/.config/systemd/user/nssf-dispatch.service"
rm -f "${HOME}/.local/bin/nssf-statement-dispatch"
rm -f "${HOME}/.local/share/applications/nssf-dispatch.desktop"
rm -f "${HOME}/Desktop/nssf-dispatch.desktop"
rm -f "${HOME}/.local/share/icons/hicolor/512x512/apps/nssf-dispatch.png"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "${HOME}/.local/share/applications" >/dev/null 2>&1 || true
echo "Uninstalled NSSF Digital Statement Dispatcher."
EOF
  chmod 755 "$stage/uninstall.sh"

  cat > "$stage/SETUP.txt" << 'EOF'
NSSF Digital Statement Dispatcher — Linux / Ubuntu Setup
=========================================================
Option A (Install Desktop Icon & Menu Entry):
  ./install.sh
  (Optional background service on login: ./install.sh --autostart)

Option B (Run Immediately Without Installing):
  ./start.sh

Option C (Using the Standalone Raw Binary):
  chmod +x nssf-statement-dispatch-linux-amd64
  ./nssf-statement-dispatch-linux-amd64 --install   # sets up Ubuntu launcher & icon
  ./nssf-statement-dispatch-linux-amd64             # starts server & opens browser

Administrator Recovery (Local Terminal):
  nssf-statement-dispatch --reset-admin
EOF

  tar -czf "$RELEASE_DIR/$bundle_name" -C "$RELEASE_DIR/.stage/linux-$arch" "$folder_name"

  # Build native Ubuntu/Debian .deb package when dpkg-deb is available
  if command -v dpkg-deb >/dev/null 2>&1; then
    local deb_arch="$arch"
    local deb_ver="${APP_VERSION_CLEAN//_/-}"
    # Debian versions must start with a digit
    if [[ ! "$deb_ver" =~ ^[0-9] ]]; then
      deb_ver="1.0.0"
    fi
    local deb_root="$RELEASE_DIR/.stage/deb-$arch"
    local deb_name="NSSF-Statement-Dispatch-linux-$arch.deb"

    mkdir -p "$deb_root/DEBIAN" \
      "$deb_root/usr/bin" \
      "$deb_root/usr/share/applications" \
      "$deb_root/usr/share/icons/hicolor/512x512/apps" \
      "$deb_root/usr/share/pixmaps" \
      "$deb_root/usr/lib/systemd/user"

    install -m 755 "$RELEASE_DIR/$bin_name" "$deb_root/usr/bin/nssf-statement-dispatch"
    install -m 644 "$GO_DIR/packaging/linux/nssf-dispatch.png" "$deb_root/usr/share/icons/hicolor/512x512/apps/nssf-dispatch.png"
    install -m 644 "$GO_DIR/packaging/linux/nssf-dispatch.png" "$deb_root/usr/share/pixmaps/nssf-dispatch.png"

    cat > "$deb_root/usr/share/applications/nssf-dispatch.desktop" << DESKTOP
[Desktop Entry]
Type=Application
Name=NSSF Digital Statement Dispatcher
GenericName=Member Statement Dispatch Portal
Comment=Validate, password-protect, and securely dispatch NSSF member statements
Exec=/usr/bin/nssf-statement-dispatch
Icon=nssf-dispatch
Terminal=false
Categories=Office;Finance;
StartupNotify=true
X-Publisher=National Social Security Fund (NSSF) Kenya
DESKTOP
    chmod 644 "$deb_root/usr/share/applications/nssf-dispatch.desktop"

    cat > "$deb_root/usr/lib/systemd/user/nssf-dispatch.service" << UNIT
[Unit]
Description=NSSF Digital Statement Dispatcher
After=network.target

[Service]
ExecStart=/usr/bin/nssf-statement-dispatch --no-open
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
UNIT
    chmod 644 "$deb_root/usr/lib/systemd/user/nssf-dispatch.service"

    cat > "$deb_root/DEBIAN/control" << CONTROL
Package: nssf-statement-dispatch
Version: ${deb_ver}
Section: utils
Priority: optional
Architecture: ${deb_arch}
Maintainer: ${APP_PUBLISHER}
Description: ${APP_NAME}
 Internal NSSF Service Desk portal for validating, password-protecting,
 and dispatching member statements via Email (SMTP) and WhatsApp.
CONTROL

    cat > "$deb_root/DEBIAN/postinst" << 'POSTINST'
#!/usr/bin/env bash
set -e
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t /usr/share/icons/hicolor >/dev/null 2>&1 || true
exit 0
POSTINST
    chmod 755 "$deb_root/DEBIAN/postinst"

    cat > "$deb_root/DEBIAN/prerm" << 'PRERM'
#!/usr/bin/env bash
set -e
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
exit 0
PRERM
    chmod 755 "$deb_root/DEBIAN/prerm"

    dpkg-deb --root-owner-group --build "$deb_root" "$RELEASE_DIR/$deb_name" >/dev/null
  else
    echo "Warning: dpkg-deb not found; skipping .deb package creation for $arch."
  fi
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
  chmod 755 "$RELEASE_DIR/$bin_name"

  mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
  cp "$RELEASE_DIR/$bin_name" "$app_dir/Contents/MacOS/nssf-statement-dispatch-darwin"
  chmod 755 "$app_dir/Contents/MacOS/nssf-statement-dispatch-darwin"
  cp "$GO_DIR/packaging/macos/nssf.icns" "$app_dir/Contents/Resources/nssf.icns"
  sed "s|<string>1\.0\.0</string>|<string>${APP_VERSION_CLEAN}</string>|g" \
    "$GO_DIR/packaging/macos/Info.plist" > "$app_dir/Contents/Info.plist"

  cat > "$stage/install-macos.sh" << EOF
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
APP_SRC="\$SCRIPT_DIR/${APP_NAME}.app"
TARGET_DIR="/Applications"
if [[ ! -w "\$TARGET_DIR" ]]; then
  TARGET_DIR="\${HOME}/Applications"
  mkdir -p "\$TARGET_DIR"
fi
rm -rf "\$TARGET_DIR/${APP_NAME}.app"
cp -R "\$APP_SRC" "\$TARGET_DIR/${APP_NAME}.app"
xattr -dr com.apple.quarantine "\$TARGET_DIR/${APP_NAME}.app" >/dev/null 2>&1 || true
open "\$TARGET_DIR/${APP_NAME}.app"
EOF
  chmod 755 "$stage/install-macos.sh"

  cat > "$stage/SETUP.txt" << EOF
NSSF Digital Statement Dispatcher — macOS Setup
================================================
1. Run ./install-macos.sh in Terminal (installs to Applications, clears Gatekeeper quarantine, and launches), OR
2. Drag "${APP_NAME}.app" into /Applications, right-click -> Open on first launch.
EOF

  tar -czf "$RELEASE_DIR/$bundle_tar" -C "$stage" "$APP_NAME.app" "install-macos.sh" "SETUP.txt"
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
