# NSSF Digital — Member Statement Dispatch

Internal NSSF Service Desk portal for validating member PDF statements against member numbers, applying password-protected PDF encryption, and securely dispatching statements to members via **Email (SMTP)** and **WhatsApp**.

Includes both a **Node.js / Express** backend (`server.ts` + `server/`) and a **standalone Go backend** (`go/cmd/server/`) with full API parity and optional frontend/proxy integration.

---

## Key Features

- **3-Step Service Desk Workflow** (`DispatchWorkspace`)
  - Channel selection (`Email`, `WhatsApp`, or `Both`) with keyboard shortcuts (`Ctrl+E`, `Ctrl+W`, `Ctrl+B`, `Ctrl+P`).
  - Drag-and-drop PDF parsing and strict member-number cross-validation before dispatch.
  - Pre-send verification summary & modal PDF preview (`StatementPreviewModal`).
  - Automatic PDF encryption (`id_card` or `id_and_nssf_last4` credential modes) and configurable attachment filename templating.
- **Focused Admin Views (No Navbar — Top-Left Ghost Back Navigation)**
  - **System Settings (`SettingsView`)**: Configure SMTP settings & connection testing, WhatsApp QR device pairing/unlinking, Go backend service delegation, message templates with live preview & placeholders, and channel/preview toggles.
  - **Compliance Audit Logs (`AuditLogsView`)**: Searchable and filterable ledger across Email, WhatsApp, and Dual Failures, with UTF-8 CSV (`.csv`) and formatted MS-Excel (`.xls`) export.
- **Full-Stack Go Service Integration (`go/cmd/server`)**
  - Feature-complete Go HTTP server implementing validation, PDF encryption, SMTP/WhatsApp dispatch, QR pairing, admin authentication (`PBKDF2-HMAC-SHA256` + HMAC-signed Bearer sessions), audit logs, and embedded `dist/*` SPA serving.
  - Can run standalone (`./release/nssf-statement-dispatch-linux`) or alongside Node.js with **Delegate Dispatch to Go Service** enabled in Settings.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Motion, Lucide React
- **Node.js Backend**: Express 4, Node 22 built-in `node:sqlite`, `node:crypto`, `node:net`/`node:tls`
- **Go Backend**: Zero-third-party-dependency Go (`go/cmd/server`) using Go stdlib (`net/http`, `crypto/*`, `net/smtp`, `os/exec` for `sqlite3` CLI with automatic JSON-state persistence fallback when `sqlite3` is absent)

---

## Environment Variables

Copy `.env.example` to `.env` if needed:

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP server port | `3000` (Node) / `8080` (Go) |
| `NSSF_ADMIN_PASSCODE` | Optional static admin passcode overriding stored SQLite admin user login | _(unset — uses SQLite admin setup)_ |
| `SESSION_SECRET` | Secret used to sign admin Bearer tokens (ephemeral random secret generated on startup if unset) | _(auto-generated)_ |
| `GO_SERVICE_URL` | Base URL for Go service delegation when enabled in Settings | `http://127.0.0.1:8080` |
| `NSSF_DB_PATH` | Optional SQLite database file path for the Go server | `nssf_dispatch.db` |

---

## Running in Development (Node.js + Vite)

```bash
npm install
npm run dev
```

The app runs on `http://localhost:3000`.

### Production Build (Node.js)

```bash
npm run build
npm start
```

### Type-Check

```bash
npm run lint
```

---

## Running & Building the Go Service

### 1. Run Go Service Alongside Node.js (Proxy Mode)

Build and embed the frontend assets for `go:embed dist/*`, then start the Go backend on port `8080`:

```bash
npm run build
rm -rf go/cmd/server/dist && cp -r dist go/cmd/server/dist
cd go
PORT=8080 go run ./cmd/server
```

Then open **Settings** in the web portal:
1. Check **Delegate Dispatch to Go Service**.
2. Set **Go Service Base URL** to `http://127.0.0.1:8080`.
3. Click **Test Go** and **Save System Configuration**.

Validation (`/api/validate`), PDF encryption & dispatch (`/api/dispatch`), and encrypted PDF downloads (`/api/download/:token`) will be delegated to the Go service.

### 2. Build Standalone Cross-Platform Binaries

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
| `GET /api/health` | Public | Server engine health (`node` or `go`) |
| `GET /api/system/runtime` | Optional Admin | Active engine & Go service reachability |
| `POST /api/system/test-go` | Admin | Probe configured Go service URL |
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
