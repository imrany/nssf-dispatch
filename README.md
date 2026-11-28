<p align="center">
  <img src="public/assets/nssf-cl_d27cbb88.png" alt="NSSF — Growing You. For Good" height="72" />
</p>

# NSSF Digital — Member Statement Dispatch

Internal NSSF Service Desk portal for validating member PDF statements against member numbers, applying password-protected PDF encryption, and securely dispatching statements to members via **Email (SMTP)** and **WhatsApp**.

Powered exclusively by a **standalone zero-dependency Go backend** (`go/cmd/server/`) serving both `/api/*` endpoints and the embedded React frontend (`//go:embed dist/*`).

---

## Key Features

- **3-Step Service Desk Workflow** (`DispatchWorkspace`)
  - Channel selection (`Email`, `WhatsApp`, or `Both`) with keyboard shortcuts (`Ctrl+E`, `Ctrl+W`, `Ctrl+B`, `Ctrl+P`).
  - Drag-and-drop PDF parsing and strict member-number cross-validation before dispatch (fields lock while validating/submitting).
  - Pre-send verification summary & modal PDF preview (`StatementPreviewModal`) and animated dispatch confirmation (`DispatchSuccess`).
  - Automatic PDF encryption (`id_card` or `id_and_nssf_last4` credential modes) and configurable attachment filename templating.
- **Focused Admin Views (No Navbar — Top-Left Ghost Back Navigation)**
  - **System Settings (`SettingsView`)**: Configure SMTP settings & connection testing, WhatsApp gateway QR pairing/unlinking, message templates with live preview & placeholders, and channel/preview toggles.
  - **Compliance Audit Logs (`AuditLogsView`)**: Searchable and filterable ledger across Email, WhatsApp, and Dual Failures, with UTF-8 CSV (`.csv`) and formatted MS-Excel (`.xls`) export.
- **Standalone Go Backend (`go/cmd/server`)**
  - Feature-complete Go HTTP server implementing validation, PDF encryption, SMTP/WhatsApp dispatch, QR pairing, admin authentication (`PBKDF2-HMAC-SHA256` + HMAC-signed Bearer sessions), audit logs, and embedded `dist/*` SPA serving.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Motion, Lucide React
- **Go Backend**: Go (`go/cmd/server`) using `net/http`, `crypto/*`, `net/smtp`, `go.mau.fi/whatsmeow` (native WhatsApp Web Multi-Device client), `modernc.org/sqlite` (pure-Go `CGO_ENABLED=0` SQLite driver), `rsc.io/qr`, and `os/exec` `sqlite3` CLI with automatic JSON-state persistence fallback when `sqlite3` is absent

---

## Environment Variables

Copy `.env.example` to `.env` if needed:

| Variable | Description | Default |
|---|---|---|
| `PORT` | Go HTTP server port | `8080` (`3000` via `npm start`) |
| `NSSF_ADMIN_PASSCODE` | Optional static admin passcode overriding stored SQLite admin user login | _(unset — uses SQLite admin setup)_ |
| `SESSION_SECRET` | Secret used to sign admin Bearer tokens (ephemeral random secret generated on startup if unset) | _(auto-generated)_ |
| `GO_SERVICE_URL` | Go backend URL proxied by Vite `/api` during frontend development | `http://127.0.0.1:8080` |
| `NSSF_DB_PATH` | Optional SQLite database file path for the Go server | `nssf_dispatch.db` |
| `NSSF_WA_DB_PATH` | Optional SQLite database file path for `whatsmeow` device/session keys | `nssf_whatsapp.db` |
| `NSSF_UPDATE_REPO` | Optional GitHub `owner/repo` slug for automatic self-updates (auto-injected by CI builds) | _(from build ldflags)_ |
| `NSSF_AUTO_UPDATE` | Set to `false` or `0` to disable background automatic self-updates | `true` |

---

## Running in Development

### 1. Start the Go Backend

Build and embed the frontend assets first if `go/cmd/server/dist` is empty or outdated, resolve Go modules, then start the Go server:

```bash
npm install
npm run build
cd go && go mod tidy && PORT=8080 go run ./cmd/server
```

### 2. Optional: Frontend Hot-Dev with Vite Proxy

Run the Vite dev server on port `3000` (all `/api/*` requests proxy to `http://127.0.0.1:8080`):

```bash
npm run dev
```

### Type-Check

```bash
npm run lint
```

---

## Build & Package Cross-Platform Desktop Releases

From the repository root:

```bash
APP_VERSION=1.0.0 bash go/build.sh
```

This builds `dist/`, embeds the React SPA into `go/cmd/server/dist/`, compiles platform icons and publisher metadata (`NSSF Digital Statement Dispatcher` by `National Social Security Fund (NSSF) Kenya`), and outputs release artifacts into `go/release/`:
- **Windows (`amd64`)**:
  - `NSSF-Statement-Dispatch-windows-amd64.msi` (Windows Installer with app icon, Start Menu & Desktop shortcuts, and automatic `%AppData%\nssf-dispatch` cleanup on uninstall)
  - `NSSF-Statement-Dispatch-windows-amd64.exe` (embedded `.ico` icon & PE VersionInfo) + `.zip` (includes `Start-NSSF-Dispatch.bat`, `Install-Shortcut.ps1`, `Uninstall-NSSF-Dispatch.ps1`, and `SETUP.txt`)
- **macOS (`amd64` & `arm64`)**: `NSSF-Statement-Dispatch-macos-{amd64,arm64}.app.tar.gz` (`.app` bundle with `nssf.icns`, `Info.plist`, `install-macos.sh`, `uninstall-macos.sh`, and `SETUP.txt`) + raw binaries
- **Linux / Ubuntu (`amd64` & `arm64`)**:
  - `NSSF-Statement-Dispatch-linux-{amd64,arm64}.deb` (native Ubuntu/Debian installer registering `/usr/bin/nssf-statement-dispatch`, desktop entry, icons, `systemd --user` service, and clean user-data removal on `remove`/`purge`)
  - `NSSF-Statement-Dispatch-linux-{amd64,arm64}.tar.gz` (includes `install.sh`, `start.sh`, `uninstall.sh`, `nssf-dispatch.desktop`, `nssf-dispatch.png`, and `SETUP.txt`)
  - Raw binaries `nssf-statement-dispatch-linux-{amd64,arm64}` (also support `--install`, `--uninstall`, `--cleanup-data`, `--reset-admin`, `--update`, `--no-open`, and `--version`)
- **Checksums**: `SHA256SUMS.txt`

Running the standalone binary directly serves both the React SPA and all `/api/*` endpoints from a single executable (`PORT=8080` by default), stores SQLite databases and settings inside hidden OS user folders (`~/.config/nssf-dispatch` on Linux, `%AppData%\nssf-dispatch` on Windows, `~/Library/Application Support/nssf-dispatch` on macOS) removed upon uninstallation, and automatically opens `http://127.0.0.1:8080` in the default browser once started (pass `--no-open` or set `NSSF_NO_BROWSER=1` to run headless). On first launch, the portal displays **Setup Admin Account** until an administrator account and backup recovery key are created; Email and WhatsApp dispatch remain disabled until configured/paired in Settings, and non-NSSF PDFs are rejected on upload.

### Automated GitHub Releases (Tag Trigger or Manual Dispatch)

Pushing a version tag (`v*`) or running `.github/workflows/release.yml` via **Actions → Run workflow** automatically builds all cross-platform executables/desktop bundles (including `.msi`, `.deb`, `.app.tar.gz`, and `.exe`) and publishes them to **GitHub Releases**:

```bash
git tag v1.0.0
git push origin v1.0.0
```

---

## API Overview

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/health` | Public | Go server health check |
| `GET /api/system/runtime` | Public | Go runtime and persistence status |
| `GET /api/system/update/status` | Admin | Current version and automatic self-update state |
| `POST /api/system/update/check` | Admin | Query GitHub Releases for a newer verified version |
| `POST /api/system/update/apply` | Admin | Download, SHA-256 verify, swap binary, and restart |
| `GET /api/auth/status` | Public | Admin setup & session authentication status |
| `POST /api/auth/setup` | Public (first-run) | Create initial administrator account & recovery key |
| `POST /api/auth/login` | Public | Sign in and obtain Bearer session token |
| `POST /api/auth/forgot-password` | Public | Request SMTP password reset verification code |
| `POST /api/auth/reset-password` | Public | Reset password via Backup Recovery Key or Email Code |
| `POST /api/auth/change-credentials` | Admin | Update administrator username, recovery email, or password |
| `POST /api/auth/regenerate-recovery-key` | Admin | Rotate and generate a new Backup Recovery Key |
| `POST /api/auth/logout` | Public | Revoke active Bearer session token |
| `GET /api/settings` | Optional Admin | Public settings (redacted) or full admin settings |
| `POST /api/settings` | Admin | Persist system configuration |
| `POST /api/settings/test-smtp` | Admin | Test SMTP connectivity |
| `GET /api/whatsapp/qr` | Admin | Fetch/refresh WhatsApp pairing QR SVG |
| `GET /api/whatsapp/status` | Admin | Poll WhatsApp pairing session status |
| `POST /api/whatsapp/pair-confirm` | Admin | Confirm WhatsApp session pairing |
| `POST /api/whatsapp/unlink` | Admin | Remove paired WhatsApp device |
| `POST /api/verify-statement-file` | Public (post-setup) | Reject non-PDF or non-NSSF statement files immediately on upload |
| `POST /api/validate` | Public (post-setup) | Validate uploaded PDF against NSSF Member No |
| `POST /api/dispatch` | Public (post-setup) | Encrypt PDF & dispatch live via Email / WhatsApp |
| `GET /api/audit` | Admin | Fetch persistent compliance audit logs |
