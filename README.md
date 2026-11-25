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

## Build Standalone Cross-Platform Binaries

From the repository root:

```bash
bash go/build.sh
```

This builds `dist/`, embeds the frontend assets into `go/cmd/server/dist/`, and outputs zero-dependency binaries into `go/release/`:
- `go/release/NSSF-Statement-Dispatch.exe` (Windows)
- `go/release/nssf-statement-dispatch-linux` (Linux)

Running the standalone binary directly serves both the React SPA and all `/api/*` endpoints from a single executable (`PORT=8080` by default).

---

## API Overview

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/health` | Public | Go server health check |
| `GET /api/system/runtime` | Public | Go runtime and persistence status |
| `GET /api/auth/status` | Public | Admin setup & session authentication status |
| `POST /api/auth/setup` | Public (first-run) | Create initial administrator account |
| `POST /api/auth/login` | Public | Sign in and obtain Bearer session token |
| `POST /api/auth/logout` | Public | Revoke active Bearer session token |
| `GET /api/settings` | Optional Admin | Public settings (redacted) or full admin settings |
| `POST /api/settings` | Admin | Persist system configuration |
| `POST /api/settings/test-smtp` | Admin | Test SMTP connectivity |
| `GET /api/whatsapp/qr` | Admin | Fetch/refresh WhatsApp pairing QR SVG |
| `GET /api/whatsapp/status` | Admin | Poll WhatsApp pairing session status |
| `POST /api/whatsapp/pair-confirm` | Admin | Confirm WhatsApp session pairing |
| `POST /api/whatsapp/unlink` | Admin | Remove paired WhatsApp device |
| `POST /api/validate` | Public | Validate uploaded PDF against NSSF Member No |
| `POST /api/dispatch` | Public | Encrypt PDF & dispatch via Email / WhatsApp |
| `GET /api/download/:token` | Public | Download freshly encrypted statement PDF |
| `GET /api/audit` | Admin | Fetch persistent compliance audit logs |
