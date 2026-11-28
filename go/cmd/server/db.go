package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type AppSettings struct {
	SMTPHost                string `json:"smtpHost"`
	SMTPPort                string `json:"smtpPort"`
	SMTPSecurity            string `json:"smtpSecurity"`
	SMTPUser                string `json:"smtpUser"`
	SMTPPass                string `json:"smtpPass,omitempty"`
	HasSMTPPass             bool   `json:"hasSmtpPass"`
	ClearSMTPPass           bool   `json:"clearSmtpPass,omitempty"`
	SMTPFrom                string `json:"smtpFrom"`
	EmailEnabled            bool   `json:"emailEnabled"`
	EmailConfigured         bool   `json:"emailConfigured"`
	WhatsAppEnabled         bool   `json:"whatsappEnabled"`
	WhatsAppBridgeURL       string `json:"whatsappBridgeUrl"`
	WhatsAppPaired          bool   `json:"whatsappPaired"`
	WhatsAppDeviceName      string `json:"whatsappDeviceName"`
	FilenameTemplate        string `json:"filenameTemplate"`
	PasswordMode            string `json:"passwordMode"`
	PortalURL               string `json:"portalUrl"`
	PreviewBeforeDispatch   bool   `json:"previewBeforeDispatch"`
	EmailSubjectTemplate    string `json:"emailSubjectTemplate"`
	WhatsAppMessageTemplate string `json:"whatsappMessageTemplate"`
	AutoUpdateEnabled       bool   `json:"autoUpdateEnabled"`
	UpdateRepo              string `json:"updateRepo"`
}

const (
	DefaultEmailSubjectTemplate    = "Official NSSF Provisional Member Statement — {memberName} ({memberNo})"
	DefaultWhatsAppMessageTemplate = "*NATIONAL SOCIAL SECURITY FUND (NSSF) KENYA*\nHello {memberName},\n\nPlease find attached your official NSSF Provisional Member Statement ({renamedFile}) for {period}.\n\n*Member No:* {memberNo}\n*Total Fund Balance:* KES {totalAmount}\n\n*How to Open:*\nEnter {passwordGuide} when prompted for the PDF password.\n\nSelf-Service: USSD *303# or {portalUrl}"
)

type WhatsAppSessionRecord struct {
	SessionCode     string `json:"sessionCode"`
	QRPayload       string `json:"qrPayload"`
	QRSvg           string `json:"qrSvg"`
	Paired          bool   `json:"paired"`
	DeviceName      string `json:"deviceName"`
	BridgeURL       string `json:"bridgeUrl"`
	BridgeReachable bool   `json:"bridgeReachable"`
	PairedPhone     string `json:"pairedPhone"`
	PairedAt        string `json:"pairedAt"`
	UpdatedAt       string `json:"updatedAt"`
}

type AuditLog struct {
	ID          int    `json:"id"`
	Timestamp   string `json:"timestamp"`
	EventType   string `json:"eventType"`
	Actor       string `json:"actor"`
	SourceIP    string `json:"sourceIp"`
	MemberNo    string `json:"memberNo"`
	MemberName  string `json:"memberName"`
	Channel     string `json:"channel"`
	Destination string `json:"destination"`
	RenamedFile string `json:"renamedFile"`
	Status      string `json:"status"`
	Details     string `json:"details"`
}

type AuditEvent struct {
	EventType   string
	Actor       string
	SourceIP    string
	MemberNo    string
	MemberName  string
	Channel     string
	Destination string
	RenamedFile string
	Status      string
	Details     string
}

type AdminAccount struct {
	AuthMode      string `json:"authMode"`
	Username      string `json:"username"`
	PasswordHash  string `json:"passwordHash"`
	PasswordSalt  string `json:"passwordSalt"`
	PasscodeHash  string `json:"passcodeHash"`
	PasscodeSalt  string `json:"passcodeSalt"`
	RecoveryEmail string `json:"recoveryEmail"`
	RecoveryHash  string `json:"recoveryHash"`
	RecoverySalt  string `json:"recoverySalt"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

type SecurityPolicy struct {
	SessionTTLMinutes int `json:"sessionTtlMinutes"`
	MaxLoginAttempts  int `json:"maxLoginAttempts"`
	LockoutMinutes    int `json:"lockoutMinutes"`
	IdleLockMinutes   int `json:"idleLockMinutes"`
}

type jsonFallbackState struct {
	Settings    map[string]string      `json:"settings"`
	WhatsApp    *WhatsAppSessionRecord `json:"whatsapp,omitempty"`
	Admin       *AdminAccount          `json:"admin,omitempty"`
	AuditLogs   []AuditLog             `json:"auditLogs"`
	NextAuditID int                    `json:"nextAuditId"`
}

var (
	dbMu          sync.Mutex
	sqlCLIMu      sync.Mutex
	useSQLiteCLI  bool
	sqliteChecked bool
	fallbackState jsonFallbackState
)

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func isDevSourceCheckout() bool {
	if os.Getenv("NSSF_DEV_LOCAL_DB") == "1" {
		return true
	}
	if fileExists("go.mod") && fileExists(filepath.Join("cmd", "server", "main.go")) {
		return true
	}
	if fileExists("package.json") && fileExists(filepath.Join("go", "go.mod")) {
		return true
	}
	return false
}

// getAppDataDir resolves a hidden, user-scoped directory for SQLite databases and config.
// Inside a local dev checkout it uses the current directory;
// when launched as an installed binary or desktop app, it stores data inside hidden OS user folders.
func getAppDataDir() string {
	if p := strings.TrimSpace(os.Getenv("NSSF_DATA_DIR")); p != "" {
		_ = os.MkdirAll(p, 0700)
		return p
	}
	if isDevSourceCheckout() {
		return "."
	}
	if cfgDir, err := os.UserConfigDir(); err == nil && cfgDir != "" {
		appDir := filepath.Join(cfgDir, "nssf-dispatch")
		if mkErr := os.MkdirAll(appDir, 0700); mkErr == nil {
			return appDir
		}
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		appDir := filepath.Join(home, ".nssf-dispatch")
		if mkErr := os.MkdirAll(appDir, 0700); mkErr == nil {
			return appDir
		}
	}
	return "."
}

// GetUserDataDirsForCleanup returns all hidden user data directories created by installed runs.
func GetUserDataDirsForCleanup() []string {
	seen := map[string]bool{}
	var dirs []string
	add := func(p string) {
		p = strings.TrimSpace(p)
		if p == "" || p == "." || p == "/" {
			return
		}
		clean := filepath.Clean(p)
		if clean == "." || clean == "/" {
			return
		}
		if !seen[clean] {
			seen[clean] = true
			dirs = append(dirs, clean)
		}
	}

	if p := strings.TrimSpace(os.Getenv("NSSF_DATA_DIR")); p != "" {
		add(p)
	}
	if cfgDir, err := os.UserConfigDir(); err == nil && cfgDir != "" {
		add(filepath.Join(cfgDir, "nssf-dispatch"))
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		add(filepath.Join(home, ".config", "nssf-dispatch"))
		add(filepath.Join(home, ".local", "share", "nssf-dispatch"))
		add(filepath.Join(home, ".nssf-dispatch"))
	}
	if runtime.GOOS == "windows" {
		if ad := strings.TrimSpace(os.Getenv("APPDATA")); ad != "" {
			add(filepath.Join(ad, "nssf-dispatch"))
		}
		if lad := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); lad != "" {
			add(filepath.Join(lad, "nssf-dispatch"))
		}
	}
	return dirs
}

// CleanupUserDataDirs removes stored SQLite DBs, WhatsApp device store, and config from user folders.
func CleanupUserDataDirs() ([]string, error) {
	var removed []string
	var firstErr error
	for _, dir := range GetUserDataDirsForCleanup() {
		if _, err := os.Stat(dir); err == nil {
			if rmErr := os.RemoveAll(dir); rmErr != nil {
				if firstErr == nil {
					firstErr = rmErr
				}
			} else {
				removed = append(removed, dir)
			}
		}
	}
	return removed, firstErr
}

func getDBPath() string {
	if p := strings.TrimSpace(os.Getenv("NSSF_DB_PATH")); p != "" {
		_ = os.MkdirAll(filepath.Dir(p), 0700)
		return p
	}
	dir := getAppDataDir()
	if dir == "." {
		return "nssf_dispatch.db"
	}
	return filepath.Join(dir, "nssf_dispatch.db")
}

func getFallbackJSONPath() string {
	return getDBPath() + ".state.json"
}

func hasSQLiteCLI() bool {
	if !sqliteChecked {
		_, err := exec.LookPath("sqlite3")
		useSQLiteCLI = err == nil
		sqliteChecked = true
	}
	return useSQLiteCLI
}

func defaultSettingsMap() map[string]string {
	return map[string]string{
		"smtpHost":                "smtp.nssfkenya.co.ke",
		"smtpPort":                "587",
		"smtpSecurity":            "starttls",
		"smtpUser":                "statements@nssfkenya.co.ke",
		"smtpPass":                "",
		"smtpFrom":                "NSSF Kenya Member Services <statements@nssfkenya.co.ke>",
		"emailEnabled":            "true",
		"whatsappEnabled":         "true",
		"whatsappBridgeUrl":       "http://127.0.0.1:8095",
		"whatsappPaired":          "false",
		"whatsappDeviceName":      "NSSF Service Desk Terminal 01",
		"filenameTemplate":        "NSSF_Statement_{memberNo}_{date}.pdf",
		"passwordMode":            "id_card",
		"portalUrl":               "https://nssfdigital.enssf.co.ke",
		"previewBeforeDispatch":   "true",
		"emailSubjectTemplate":    DefaultEmailSubjectTemplate,
		"whatsappMessageTemplate": DefaultWhatsAppMessageTemplate,
		"autoUpdateEnabled":         "true",
		"updateRepo":                "",
		"securitySessionTtlMinutes": "480",
		"securityMaxLoginAttempts":  "10",
		"securityLockoutMinutes":    "15",
		"securityIdleLockMinutes":   "0",
	}
}

func loadFallbackLocked() {
	if fallbackState.Settings == nil {
		fallbackState.Settings = map[string]string{}
	}
	data, err := os.ReadFile(getFallbackJSONPath())
	if err == nil && len(data) > 0 {
		_ = json.Unmarshal(data, &fallbackState)
	}
	if fallbackState.Settings == nil {
		fallbackState.Settings = map[string]string{}
	}
	for k, v := range defaultSettingsMap() {
		if _, exists := fallbackState.Settings[k]; !exists {
			fallbackState.Settings[k] = v
		}
	}
	if fallbackState.AuditLogs == nil {
		fallbackState.AuditLogs = []AuditLog{}
	}
	if fallbackState.NextAuditID <= 0 {
		fallbackState.NextAuditID = len(fallbackState.AuditLogs) + 1
	}
}

func saveFallbackLocked() error {
	raw, err := json.MarshalIndent(fallbackState, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(getFallbackJSONPath(), raw, 0600)
}

func runSQL(query string) (string, error) {
	sqlCLIMu.Lock()
	defer sqlCLIMu.Unlock()

	cmd := exec.Command("sqlite3", "-batch", "-noheader", "-separator", "|", "-cmd", ".timeout 5000", getDBPath())
	cmd.Stdin = strings.NewReader(query)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("sqlite3 error: %v (%s)", err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(strings.ReplaceAll(string(out), "\r\n", "\n")), nil
}

func decodeHexField(s string) string {
	b, err := hex.DecodeString(strings.TrimSpace(s))
	if err != nil {
		return s
	}
	return string(b)
}

func splitPipeRows(raw string, expectedCols int) [][]string {
	if raw == "" {
		return nil
	}
	lines := strings.Split(raw, "\n")
	rows := make([][]string, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		cols := strings.Split(line, "|")
		if len(cols) >= expectedCols {
			rows = append(rows, cols)
		}
	}
	return rows
}

func sqlLit(s string) string {
	clean := strings.ReplaceAll(s, "\x00", "")
	return "'" + strings.ReplaceAll(clean, "'", "''") + "'"
}

func InitDB() error {
	dbMu.Lock()
	defer dbMu.Unlock()

	if !hasSQLiteCLI() {
		loadFallbackLocked()
		return saveFallbackLocked()
	}

	defs := defaultSettingsMap()
	var inserts []string
	for k, v := range defs {
		inserts = append(inserts, fmt.Sprintf("(%s, %s)", sqlLit(k), sqlLit(v)))
	}

	schema := `
	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS whatsapp_sessions (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		session_code TEXT NOT NULL,
		qr_payload TEXT NOT NULL,
		qr_svg TEXT NOT NULL,
		paired INTEGER NOT NULL DEFAULT 0,
		device_name TEXT NOT NULL DEFAULT 'NSSF Service Desk Terminal 01',
		bridge_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:8095',
		bridge_reachable INTEGER NOT NULL DEFAULT 0,
		paired_phone TEXT NOT NULL DEFAULT '',
		paired_at TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
	);
	CREATE TABLE IF NOT EXISTS admin_users (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		auth_mode TEXT NOT NULL DEFAULT 'password',
		username TEXT NOT NULL,
		password_hash TEXT NOT NULL DEFAULT '',
		password_salt TEXT NOT NULL DEFAULT '',
		passcode_hash TEXT NOT NULL DEFAULT '',
		passcode_salt TEXT NOT NULL DEFAULT '',
		recovery_email TEXT NOT NULL DEFAULT '',
		recovery_hash TEXT NOT NULL DEFAULT '',
		recovery_salt TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
	);
	CREATE TABLE IF NOT EXISTS audit_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
		event_type TEXT NOT NULL DEFAULT 'DISPATCH',
		actor TEXT NOT NULL DEFAULT 'Service Desk',
		source_ip TEXT NOT NULL DEFAULT '',
		member_no TEXT NOT NULL,
		member_name TEXT NOT NULL,
		channel TEXT NOT NULL,
		destination TEXT NOT NULL,
		renamed_file TEXT NOT NULL,
		status TEXT NOT NULL,
		details TEXT NOT NULL DEFAULT ''
	);
	INSERT OR IGNORE INTO settings (key, value) VALUES ` + strings.Join(inserts, ",\n") + `;`

	if _, err := runSQL(schema); err != nil {
		return err
	}

	// Migrate pre-existing admin_users tables smoothly without dropping accounts.
	colsRaw, err := runSQL("SELECT name FROM pragma_table_info('admin_users');")
	if err == nil {
		existing := map[string]bool{}
		for _, line := range strings.Split(colsRaw, "\n") {
			name := strings.TrimSpace(line)
			if name != "" {
				existing[name] = true
			}
		}
		migrations := []struct {
			col string
			ddl string
		}{
			{"auth_mode", "ALTER TABLE admin_users ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'password';"},
			{"passcode_hash", "ALTER TABLE admin_users ADD COLUMN passcode_hash TEXT NOT NULL DEFAULT '';"},
			{"passcode_salt", "ALTER TABLE admin_users ADD COLUMN passcode_salt TEXT NOT NULL DEFAULT '';"},
			{"recovery_email", "ALTER TABLE admin_users ADD COLUMN recovery_email TEXT NOT NULL DEFAULT '';"},
			{"recovery_hash", "ALTER TABLE admin_users ADD COLUMN recovery_hash TEXT NOT NULL DEFAULT '';"},
			{"recovery_salt", "ALTER TABLE admin_users ADD COLUMN recovery_salt TEXT NOT NULL DEFAULT '';"},
			{"updated_at", "ALTER TABLE admin_users ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';"},
		}
		for _, m := range migrations {
			if !existing[m.col] {
				if _, migErr := runSQL(m.ddl); migErr != nil {
					return migErr
				}
			}
		}
	}

	// Migrate pre-existing audit_logs tables smoothly without dropping compliance records.
	auditColsRaw, auditColsErr := runSQL("SELECT name FROM pragma_table_info('audit_logs');")
	if auditColsErr == nil {
		existingAudit := map[string]bool{}
		for _, line := range strings.Split(auditColsRaw, "\n") {
			name := strings.TrimSpace(line)
			if name != "" {
				existingAudit[name] = true
			}
		}
		auditMigrations := []struct {
			col string
			ddl string
		}{
			{"event_type", "ALTER TABLE audit_logs ADD COLUMN event_type TEXT NOT NULL DEFAULT 'DISPATCH';"},
			{"actor", "ALTER TABLE audit_logs ADD COLUMN actor TEXT NOT NULL DEFAULT 'Service Desk';"},
			{"source_ip", "ALTER TABLE audit_logs ADD COLUMN source_ip TEXT NOT NULL DEFAULT '';"},
		}
		for _, m := range auditMigrations {
			if !existingAudit[m.col] {
				if _, migErr := runSQL(m.ddl); migErr != nil {
					return migErr
				}
			}
		}
	}
	return nil
}

func settingsFromMap(m map[string]string, pairedOverride *bool) AppSettings {
	isPaired := m["whatsappPaired"] == "true"
	if pairedOverride != nil {
		isPaired = *pairedOverride
	}
	smtpHost := defaultStr(m["smtpHost"], "smtp.nssfkenya.co.ke")
	smtpPort := defaultStr(m["smtpPort"], "587")
	smtpUser := m["smtpUser"]
	smtpPass := m["smtpPass"]
	emailConfigured := strings.TrimSpace(smtpHost) != "" &&
		strings.TrimSpace(smtpPort) != "" &&
		strings.TrimSpace(smtpUser) != "" &&
		strings.TrimSpace(smtpPass) != ""

	return AppSettings{
		SMTPHost:                smtpHost,
		SMTPPort:                smtpPort,
		SMTPSecurity:            defaultStr(m["smtpSecurity"], "starttls"),
		SMTPUser:                smtpUser,
		SMTPPass:                smtpPass,
		HasSMTPPass:             smtpPass != "",
		SMTPFrom:                defaultStr(m["smtpFrom"], "NSSF Kenya Member Services <statements@nssfkenya.co.ke>"),
		EmailEnabled:            m["emailEnabled"] != "false",
		EmailConfigured:         emailConfigured,
		WhatsAppEnabled:         m["whatsappEnabled"] != "false",
		WhatsAppBridgeURL:       defaultStr(m["whatsappBridgeUrl"], "http://127.0.0.1:8095"),
		WhatsAppPaired:          isPaired,
		WhatsAppDeviceName:      defaultStr(m["whatsappDeviceName"], "NSSF Service Desk Terminal 01"),
		FilenameTemplate:        defaultStr(m["filenameTemplate"], "NSSF_Statement_{memberNo}_{date}.pdf"),
		PasswordMode:            defaultStr(m["passwordMode"], "id_card"),
		PortalURL:               defaultStr(m["portalUrl"], "https://nssfdigital.enssf.co.ke"),
		PreviewBeforeDispatch:   m["previewBeforeDispatch"] != "false",
		EmailSubjectTemplate:    defaultStr(m["emailSubjectTemplate"], DefaultEmailSubjectTemplate),
		WhatsAppMessageTemplate: defaultStr(m["whatsappMessageTemplate"], DefaultWhatsAppMessageTemplate),
		AutoUpdateEnabled:       m["autoUpdateEnabled"] != "false",
		UpdateRepo:              defaultStr(strings.TrimSpace(m["updateRepo"]), defaultStr(strings.TrimSpace(os.Getenv("NSSF_UPDATE_REPO")), githubRepo)),
	}
}

func GetRawSettings() (AppSettings, error) {
	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		var pairedOverride *bool
		if fallbackState.WhatsApp != nil {
			p := fallbackState.WhatsApp.Paired
			pairedOverride = &p
		}
		return settingsFromMap(fallbackState.Settings, pairedOverride), nil
	}

	raw, err := runSQL("SELECT hex(COALESCE(key, '')), hex(COALESCE(value, '')) FROM settings;")
	if err != nil {
		return AppSettings{}, err
	}
	m := map[string]string{}
	for _, cols := range splitPipeRows(raw, 2) {
		k := decodeHexField(cols[0])
		v := decodeHexField(cols[1])
		m[k] = v
	}
	var pairedOverride *bool
	if sess, _ := GetWhatsAppSession(); sess != nil {
		p := sess.Paired
		pairedOverride = &p
	}
	return settingsFromMap(m, pairedOverride), nil
}

func GetPublicSettings() (AppSettings, error) {
	s, err := GetRawSettings()
	if err != nil {
		return s, err
	}
	s.SMTPPass = ""
	return s, nil
}

func GetSafeWorkspaceSettings() AppSettings {
	raw, _ := GetRawSettings()
	return AppSettings{
		SMTPHost:                "",
		SMTPPort:                "587",
		SMTPSecurity:            "starttls",
		SMTPUser:                "",
		HasSMTPPass:             false,
		SMTPFrom:                "",
		EmailEnabled:            raw.EmailEnabled,
		EmailConfigured:         raw.EmailConfigured,
		WhatsAppEnabled:         raw.WhatsAppEnabled,
		WhatsAppBridgeURL:       "",
		WhatsAppPaired:          raw.WhatsAppPaired,
		WhatsAppDeviceName:      "",
		FilenameTemplate:        defaultStr(raw.FilenameTemplate, "NSSF_Statement_{memberNo}_{date}.pdf"),
		PasswordMode:            defaultStr(raw.PasswordMode, "id_card"),
		PortalURL:               defaultStr(raw.PortalURL, "https://nssfdigital.enssf.co.ke"),
		PreviewBeforeDispatch:   raw.PreviewBeforeDispatch,
		EmailSubjectTemplate:    "",
		WhatsAppMessageTemplate: "",
		AutoUpdateEnabled:       raw.AutoUpdateEnabled,
		UpdateRepo:              "",
	}
}

func SaveSettings(input AppSettings) error {
	current, _ := GetRawSettings()
	nextPass := current.SMTPPass
	if input.ClearSMTPPass {
		nextPass = ""
	} else if input.SMTPPass != "" {
		nextPass = input.SMTPPass
	}

	cleanUpdateRepo := normalizeRepoSlug(input.UpdateRepo)
	if cleanUpdateRepo != "" && !githubRepoSlugRe.MatchString(cleanUpdateRepo) {
		return fmt.Errorf("update repository must be in GitHub 'owner/repo' format")
	}

	pairs := map[string]string{
		"smtpHost":                strings.TrimSpace(input.SMTPHost),
		"smtpPort":                strings.TrimSpace(input.SMTPPort),
		"smtpSecurity":            defaultStr(input.SMTPSecurity, "starttls"),
		"smtpUser":                strings.TrimSpace(input.SMTPUser),
		"smtpPass":                nextPass,
		"smtpFrom":                strings.TrimSpace(input.SMTPFrom),
		"emailEnabled":            fmt.Sprintf("%v", input.EmailEnabled),
		"whatsappEnabled":         fmt.Sprintf("%v", input.WhatsAppEnabled),
		"whatsappBridgeUrl":       defaultStr(strings.TrimSpace(input.WhatsAppBridgeURL), "whatsmeow://native"),
		"whatsappPaired":          fmt.Sprintf("%v", current.WhatsAppPaired),
		"whatsappDeviceName":      strings.TrimSpace(input.WhatsAppDeviceName),
		"filenameTemplate":        defaultStr(strings.TrimSpace(input.FilenameTemplate), "NSSF_Statement_{memberNo}_{date}.pdf"),
		"passwordMode":            defaultStr(input.PasswordMode, "id_card"),
		"portalUrl":               defaultStr(strings.TrimSpace(input.PortalURL), "https://nssfdigital.enssf.co.ke"),
		"previewBeforeDispatch":   fmt.Sprintf("%v", input.PreviewBeforeDispatch),
		"emailSubjectTemplate":    defaultStr(strings.TrimSpace(input.EmailSubjectTemplate), DefaultEmailSubjectTemplate),
		"whatsappMessageTemplate": defaultStr(strings.TrimSpace(input.WhatsAppMessageTemplate), DefaultWhatsAppMessageTemplate),
		"autoUpdateEnabled":       fmt.Sprintf("%v", input.AutoUpdateEnabled),
		"updateRepo":              cleanUpdateRepo,
	}

	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		for k, v := range pairs {
			fallbackState.Settings[k] = v
		}
		if fallbackState.WhatsApp != nil {
			fallbackState.WhatsApp.DeviceName = pairs["whatsappDeviceName"]
			fallbackState.WhatsApp.BridgeURL = pairs["whatsappBridgeUrl"]
			fallbackState.WhatsApp.Paired = input.WhatsAppPaired
			fallbackState.WhatsApp.UpdatedAt = time.Now().Format("2006-01-02 15:04:05")
		}
		return saveFallbackLocked()
	}

	var sb strings.Builder
	for k, v := range pairs {
		fmt.Fprintf(&sb, "INSERT OR REPLACE INTO settings (key, value) VALUES (%s, %s);\n", sqlLit(k), sqlLit(v))
	}
	pairedInt := 0
	if input.WhatsAppPaired {
		pairedInt = 1
	}
	fmt.Fprintf(&sb, "UPDATE whatsapp_sessions SET device_name = %s, bridge_url = %s, paired = %d, updated_at = datetime('now', 'localtime') WHERE id = 1;\n",
		sqlLit(pairs["whatsappDeviceName"]), sqlLit(pairs["whatsappBridgeUrl"]), pairedInt)
	_, err := runSQL(sb.String())
	return err
}

func GetWhatsAppSession() (*WhatsAppSessionRecord, error) {
	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		if fallbackState.WhatsApp == nil {
			return nil, nil
		}
		cp := *fallbackState.WhatsApp
		return &cp, nil
	}

	raw, err := runSQL(`SELECT hex(COALESCE(session_code, '')), hex(COALESCE(qr_payload, '')), hex(COALESCE(qr_svg, '')),
		paired, hex(COALESCE(device_name, '')), hex(COALESCE(bridge_url, '')),
		bridge_reachable, hex(COALESCE(paired_phone, '')), hex(COALESCE(paired_at, '')), hex(COALESCE(updated_at, ''))
		FROM whatsapp_sessions WHERE id = 1;`)
	if err != nil || raw == "" {
		return nil, err
	}
	rows := splitPipeRows(raw, 10)
	if len(rows) == 0 {
		return nil, nil
	}
	cols := rows[0]
	pairedInt, _ := strconv.Atoi(strings.TrimSpace(cols[3]))
	reachInt, _ := strconv.Atoi(strings.TrimSpace(cols[6]))
	return &WhatsAppSessionRecord{
		SessionCode:     decodeHexField(cols[0]),
		QRPayload:       decodeHexField(cols[1]),
		QRSvg:           decodeHexField(cols[2]),
		Paired:          pairedInt == 1,
		DeviceName:      decodeHexField(cols[4]),
		BridgeURL:       decodeHexField(cols[5]),
		BridgeReachable: reachInt == 1,
		PairedPhone:     decodeHexField(cols[7]),
		PairedAt:        decodeHexField(cols[8]),
		UpdatedAt:       decodeHexField(cols[9]),
	}, nil
}

func SaveWhatsAppSession(s WhatsAppSessionRecord) (*WhatsAppSessionRecord, error) {
	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		s.UpdatedAt = time.Now().Format("2006-01-02 15:04:05")
		cp := s
		fallbackState.WhatsApp = &cp
		fallbackState.Settings["whatsappPaired"] = fmt.Sprintf("%v", s.Paired)
		if err := saveFallbackLocked(); err != nil {
			return nil, err
		}
		return &cp, nil
	}

	pairedInt := 0
	if s.Paired {
		pairedInt = 1
	}
	reachInt := 0
	if s.BridgeReachable {
		reachInt = 1
	}
	q := fmt.Sprintf(`INSERT OR REPLACE INTO whatsapp_sessions (
		id, session_code, qr_payload, qr_svg, paired, device_name,
		bridge_url, bridge_reachable, paired_phone, paired_at, updated_at
	) VALUES (1, %s, %s, %s, %d, %s, %s, %d, %s, %s, datetime('now', 'localtime'));
	INSERT OR REPLACE INTO settings (key, value) VALUES ('whatsappPaired', %s);`,
		sqlLit(s.SessionCode), sqlLit(s.QRPayload), sqlLit(s.QRSvg), pairedInt,
		sqlLit(s.DeviceName), sqlLit(s.BridgeURL), reachInt,
		sqlLit(s.PairedPhone), sqlLit(s.PairedAt), sqlLit(fmt.Sprintf("%v", s.Paired)),
	)
	if _, err := runSQL(q); err != nil {
		return nil, err
	}
	return GetWhatsAppSession()
}

func truncateAuditText(s string, maxRunes int) string {
	clean := strings.TrimSpace(strings.ReplaceAll(s, "\x00", ""))
	if maxRunes <= 0 {
		return clean
	}
	runes := []rune(clean)
	if len(runes) <= maxRunes {
		return clean
	}
	return string(runes[:maxRunes-3]) + "..."
}

func InsertAuditEvent(evt AuditEvent) error {
	eventType := defaultStr(strings.ToUpper(strings.TrimSpace(evt.EventType)), "DISPATCH")
	actor := truncateAuditText(defaultStr(strings.TrimSpace(evt.Actor), "Service Desk"), 120)
	sourceIP := truncateAuditText(evt.SourceIP, 120)
	memberNo := truncateAuditText(evt.MemberNo, 120)
	memberName := truncateAuditText(evt.MemberName, 160)
	channel := truncateAuditText(strings.ToUpper(strings.TrimSpace(evt.Channel)), 60)
	dest := truncateAuditText(evt.Destination, 240)
	filename := truncateAuditText(evt.RenamedFile, 240)
	status := truncateAuditText(strings.ToUpper(strings.TrimSpace(evt.Status)), 80)
	details := truncateAuditText(evt.Details, 1000)

	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		entry := AuditLog{
			ID:          fallbackState.NextAuditID,
			Timestamp:   time.Now().Format("2006-01-02 15:04:05"),
			EventType:   eventType,
			Actor:       actor,
			SourceIP:    sourceIP,
			MemberNo:    memberNo,
			MemberName:  memberName,
			Channel:     channel,
			Destination: dest,
			RenamedFile: filename,
			Status:      status,
			Details:     details,
		}
		fallbackState.NextAuditID++
		fallbackState.AuditLogs = append([]AuditLog{entry}, fallbackState.AuditLogs...)
		if len(fallbackState.AuditLogs) > 1000 {
			fallbackState.AuditLogs = fallbackState.AuditLogs[:1000]
		}
		return saveFallbackLocked()
	}

	q := fmt.Sprintf(
		`INSERT INTO audit_logs (event_type, actor, source_ip, member_no, member_name, channel, destination, renamed_file, status, details)
		 VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);`,
		sqlLit(eventType), sqlLit(actor), sqlLit(sourceIP),
		sqlLit(memberNo), sqlLit(memberName), sqlLit(channel), sqlLit(dest), sqlLit(filename), sqlLit(status), sqlLit(details),
	)
	_, err := runSQL(q)
	return err
}

func InsertAuditLog(memberNo, memberName, channel, dest, filename, status, details string) error {
	return InsertAuditEvent(AuditEvent{
		EventType:   "DISPATCH",
		Actor:       "Service Desk",
		MemberNo:    memberNo,
		MemberName:  memberName,
		Channel:     channel,
		Destination: dest,
		RenamedFile: filename,
		Status:      status,
		Details:     details,
	})
}

func LogSystemAudit(eventType, actor, sourceIP, channel, target, resource, status, details string) {
	if err := InsertAuditEvent(AuditEvent{
		EventType:   eventType,
		Actor:       actor,
		SourceIP:    sourceIP,
		Channel:     channel,
		Destination: target,
		RenamedFile: resource,
		Status:      status,
		Details:     details,
	}); err != nil {
		log.Printf("[AUDIT] Failed to persist audit record (%s/%s): %v", eventType, status, err)
	}
}

func GetAuditLogs() ([]AuditLog, error) {
	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		limit := len(fallbackState.AuditLogs)
		if limit > 500 {
			limit = 500
		}
		out := make([]AuditLog, 0, limit)
		for _, entry := range fallbackState.AuditLogs[:limit] {
			if entry.EventType == "" {
				entry.EventType = "DISPATCH"
			}
			if entry.Actor == "" {
				entry.Actor = "Service Desk"
			}
			out = append(out, entry)
		}
		return out, nil
	}

	raw, err := runSQL(`SELECT id, hex(COALESCE(timestamp, '')), hex(COALESCE(NULLIF(event_type, ''), 'DISPATCH')),
		hex(COALESCE(NULLIF(actor, ''), 'Service Desk')), hex(COALESCE(source_ip, '')),
		hex(COALESCE(member_no, '')), hex(COALESCE(member_name, '')),
		hex(COALESCE(channel, '')), hex(COALESCE(destination, '')), hex(COALESCE(renamed_file, '')),
		hex(COALESCE(status, '')), hex(COALESCE(details, ''))
		FROM audit_logs ORDER BY id DESC LIMIT 500;`)
	if err != nil {
		return []AuditLog{}, err
	}
	rows := splitPipeRows(raw, 12)
	logs := make([]AuditLog, 0, len(rows))
	for _, cols := range rows {
		idVal, _ := strconv.Atoi(strings.TrimSpace(cols[0]))
		logs = append(logs, AuditLog{
			ID:          idVal,
			Timestamp:   decodeHexField(cols[1]),
			EventType:   decodeHexField(cols[2]),
			Actor:       decodeHexField(cols[3]),
			SourceIP:    decodeHexField(cols[4]),
			MemberNo:    decodeHexField(cols[5]),
			MemberName:  decodeHexField(cols[6]),
			Channel:     decodeHexField(cols[7]),
			Destination: decodeHexField(cols[8]),
			RenamedFile: decodeHexField(cols[9]),
			Status:      decodeHexField(cols[10]),
			Details:     decodeHexField(cols[11]),
		})
	}
	return logs, nil
}

func normalizeAuthMode(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), "passcode") {
		return "passcode"
	}
	return "password"
}

func GetAdminAccount() (*AdminAccount, error) {
	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		if fallbackState.Admin == nil {
			return nil, nil
		}
		cp := *fallbackState.Admin
		cp.AuthMode = normalizeAuthMode(cp.AuthMode)
		return &cp, nil
	}

	raw, err := runSQL(`SELECT hex(COALESCE(NULLIF(auth_mode, ''), 'password')), hex(COALESCE(username, '')),
		hex(COALESCE(password_hash, '')), hex(COALESCE(password_salt, '')),
		hex(COALESCE(passcode_hash, '')), hex(COALESCE(passcode_salt, '')),
		hex(COALESCE(recovery_email, '')), hex(COALESCE(recovery_hash, '')), hex(COALESCE(recovery_salt, '')),
		hex(COALESCE(created_at, '')), hex(COALESCE(updated_at, '')) FROM admin_users WHERE id = 1;`)
	if err != nil || raw == "" {
		return nil, err
	}
	rows := splitPipeRows(raw, 11)
	if len(rows) == 0 {
		return nil, nil
	}
	cols := rows[0]
	return &AdminAccount{
		AuthMode:      normalizeAuthMode(decodeHexField(cols[0])),
		Username:      decodeHexField(cols[1]),
		PasswordHash:  decodeHexField(cols[2]),
		PasswordSalt:  decodeHexField(cols[3]),
		PasscodeHash:  decodeHexField(cols[4]),
		PasscodeSalt:  decodeHexField(cols[5]),
		RecoveryEmail: decodeHexField(cols[6]),
		RecoveryHash:  decodeHexField(cols[7]),
		RecoverySalt:  decodeHexField(cols[8]),
		CreatedAt:     decodeHexField(cols[9]),
		UpdatedAt:     decodeHexField(cols[10]),
	}, nil
}

func HasAdminAccount() bool {
	acc, _ := GetAdminAccount()
	return acc != nil
}

func CreateInitialAdmin(authMode, username, password, passcode, recoveryEmail string) (*AdminAccount, string, error) {
	mode := normalizeAuthMode(authMode)
	cleanUser := strings.TrimSpace(username)
	if mode == "passcode" && cleanUser == "" {
		cleanUser = "admin"
	}
	cleanEmail := strings.TrimSpace(recoveryEmail)

	var passHash, passSalt, codeHash, codeSalt string
	if mode == "passcode" {
		codeHash, codeSalt = HashPasswordWithSalt(passcode)
	} else {
		passHash, passSalt = HashPasswordWithSalt(password)
	}

	recoveryKey := GenerateRecoveryKey()
	recHash, recSalt := HashPasswordWithSalt(NormalizeRecoveryKey(recoveryKey))
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		if fallbackState.Admin != nil {
			return nil, "", fmt.Errorf("administrator account already exists")
		}
		fallbackState.Admin = &AdminAccount{
			AuthMode:      mode,
			Username:      cleanUser,
			PasswordHash:  passHash,
			PasswordSalt:  passSalt,
			PasscodeHash:  codeHash,
			PasscodeSalt:  codeSalt,
			RecoveryEmail: cleanEmail,
			RecoveryHash:  recHash,
			RecoverySalt:  recSalt,
			CreatedAt:     nowStr,
			UpdatedAt:     nowStr,
		}
		if err := saveFallbackLocked(); err != nil {
			return nil, "", err
		}
		cp := *fallbackState.Admin
		return &cp, recoveryKey, nil
	}

	q := fmt.Sprintf(`INSERT INTO admin_users (id, auth_mode, username, password_hash, password_salt, passcode_hash, passcode_salt, recovery_email, recovery_hash, recovery_salt, updated_at)
		VALUES (1, %s, %s, %s, %s, %s, %s, %s, %s, %s, datetime('now', 'localtime'));`,
		sqlLit(mode), sqlLit(cleanUser), sqlLit(passHash), sqlLit(passSalt), sqlLit(codeHash), sqlLit(codeSalt), sqlLit(cleanEmail), sqlLit(recHash), sqlLit(recSalt))
	if _, err := runSQL(q); err != nil {
		return nil, "", err
	}
	acc, err := GetAdminAccount()
	return acc, recoveryKey, err
}

func UpsertAdminFromCLI(username, password, recoveryEmail string) (*AdminAccount, string, error) {
	cleanUser := strings.TrimSpace(username)
	cleanEmail := strings.TrimSpace(recoveryEmail)
	hashHex, saltHex := HashPasswordWithSalt(password)
	recoveryKey := GenerateRecoveryKey()
	recHash, recSalt := HashPasswordWithSalt(NormalizeRecoveryKey(recoveryKey))
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		createdAt := nowStr
		if fallbackState.Admin != nil && fallbackState.Admin.CreatedAt != "" {
			createdAt = fallbackState.Admin.CreatedAt
		}
		fallbackState.Admin = &AdminAccount{
			AuthMode:      "password",
			Username:      cleanUser,
			PasswordHash:  hashHex,
			PasswordSalt:  saltHex,
			PasscodeHash:  "",
			PasscodeSalt:  "",
			RecoveryEmail: cleanEmail,
			RecoveryHash:  recHash,
			RecoverySalt:  recSalt,
			CreatedAt:     createdAt,
			UpdatedAt:     nowStr,
		}
		if err := saveFallbackLocked(); err != nil {
			return nil, "", err
		}
		cp := *fallbackState.Admin
		return &cp, recoveryKey, nil
	}

	q := fmt.Sprintf(`INSERT OR REPLACE INTO admin_users (id, auth_mode, username, password_hash, password_salt, passcode_hash, passcode_salt, recovery_email, recovery_hash, recovery_salt, updated_at)
		VALUES (1, 'password', %s, %s, %s, '', '', %s, %s, %s, datetime('now', 'localtime'));`,
		sqlLit(cleanUser), sqlLit(hashHex), sqlLit(saltHex), sqlLit(cleanEmail), sqlLit(recHash), sqlLit(recSalt))
	if _, err := runSQL(q); err != nil {
		return nil, "", err
	}
	acc, err := GetAdminAccount()
	return acc, recoveryKey, err
}

func UpdateAdminCredentials(authMode, newUsername, recoveryEmail, newPassword, newPasscode string) (*AdminAccount, error) {
	mode := normalizeAuthMode(authMode)
	cleanUser := strings.TrimSpace(newUsername)
	cleanEmail := strings.TrimSpace(recoveryEmail)
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		if fallbackState.Admin == nil {
			return nil, fmt.Errorf("administrator account not found")
		}
		if cleanUser != "" {
			fallbackState.Admin.Username = cleanUser
		} else if fallbackState.Admin.Username == "" {
			fallbackState.Admin.Username = "admin"
		}
		fallbackState.Admin.AuthMode = mode
		fallbackState.Admin.RecoveryEmail = cleanEmail
		fallbackState.Admin.UpdatedAt = nowStr

		if mode == "passcode" {
			// Exclusive: clear password credentials when passcode mode is selected
			fallbackState.Admin.PasswordHash = ""
			fallbackState.Admin.PasswordSalt = ""
			if newPasscode != "" {
				h, s := HashPasswordWithSalt(newPasscode)
				fallbackState.Admin.PasscodeHash = h
				fallbackState.Admin.PasscodeSalt = s
			}
		} else {
			// Exclusive: clear passcode credentials when username & password mode is selected
			fallbackState.Admin.PasscodeHash = ""
			fallbackState.Admin.PasscodeSalt = ""
			if newPassword != "" {
				h, s := HashPasswordWithSalt(newPassword)
				fallbackState.Admin.PasswordHash = h
				fallbackState.Admin.PasswordSalt = s
			}
		}
		if err := saveFallbackLocked(); err != nil {
			return nil, err
		}
		cp := *fallbackState.Admin
		return &cp, nil
	}

	acc, err := GetAdminAccount()
	if err != nil || acc == nil {
		return nil, fmt.Errorf("administrator account not found")
	}
	if cleanUser == "" {
		cleanUser = defaultStr(acc.Username, "admin")
	}

	passHash := acc.PasswordHash
	passSalt := acc.PasswordSalt
	codeHash := acc.PasscodeHash
	codeSalt := acc.PasscodeSalt

	if mode == "passcode" {
		passHash = ""
		passSalt = ""
		if newPasscode != "" {
			codeHash, codeSalt = HashPasswordWithSalt(newPasscode)
		}
	} else {
		codeHash = ""
		codeSalt = ""
		if newPassword != "" {
			passHash, passSalt = HashPasswordWithSalt(newPassword)
		}
	}

	q := fmt.Sprintf(`UPDATE admin_users SET auth_mode = %s, username = %s, recovery_email = %s, password_hash = %s, password_salt = %s, passcode_hash = %s, passcode_salt = %s, updated_at = datetime('now', 'localtime') WHERE id = 1;`,
		sqlLit(mode), sqlLit(cleanUser), sqlLit(cleanEmail), sqlLit(passHash), sqlLit(passSalt), sqlLit(codeHash), sqlLit(codeSalt))
	if _, err := runSQL(q); err != nil {
		return nil, err
	}
	return GetAdminAccount()
}

func UpdateAdminPassword(newPassword string) error {
	h, s := HashPasswordWithSalt(newPassword)
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		if fallbackState.Admin == nil {
			return fmt.Errorf("administrator account not found")
		}
		fallbackState.Admin.AuthMode = "password"
		fallbackState.Admin.PasswordHash = h
		fallbackState.Admin.PasswordSalt = s
		fallbackState.Admin.PasscodeHash = ""
		fallbackState.Admin.PasscodeSalt = ""
		fallbackState.Admin.UpdatedAt = nowStr
		return saveFallbackLocked()
	}

	q := fmt.Sprintf(`UPDATE admin_users SET auth_mode = 'password', password_hash = %s, password_salt = %s, passcode_hash = '', passcode_salt = '', updated_at = datetime('now', 'localtime') WHERE id = 1;`,
		sqlLit(h), sqlLit(s))
	_, err := runSQL(q)
	return err
}

func UpdateAdminPasscode(newPasscode string) error {
	h, s := HashPasswordWithSalt(newPasscode)
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		if fallbackState.Admin == nil {
			return fmt.Errorf("administrator account not found")
		}
		fallbackState.Admin.AuthMode = "passcode"
		fallbackState.Admin.PasscodeHash = h
		fallbackState.Admin.PasscodeSalt = s
		fallbackState.Admin.PasswordHash = ""
		fallbackState.Admin.PasswordSalt = ""
		fallbackState.Admin.UpdatedAt = nowStr
		return saveFallbackLocked()
	}

	q := fmt.Sprintf(`UPDATE admin_users SET auth_mode = 'passcode', passcode_hash = %s, passcode_salt = %s, password_hash = '', password_salt = '', updated_at = datetime('now', 'localtime') WHERE id = 1;`,
		sqlLit(h), sqlLit(s))
	_, err := runSQL(q)
	return err
}

func RegenerateAdminRecoveryKey() (string, error) {
	recoveryKey := GenerateRecoveryKey()
	recHash, recSalt := HashPasswordWithSalt(NormalizeRecoveryKey(recoveryKey))
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		if fallbackState.Admin == nil {
			return "", fmt.Errorf("administrator account not found")
		}
		fallbackState.Admin.RecoveryHash = recHash
		fallbackState.Admin.RecoverySalt = recSalt
		fallbackState.Admin.UpdatedAt = nowStr
		if err := saveFallbackLocked(); err != nil {
			return "", err
		}
		return recoveryKey, nil
	}

	q := fmt.Sprintf(`UPDATE admin_users SET recovery_hash = %s, recovery_salt = %s, updated_at = datetime('now', 'localtime') WHERE id = 1;`,
		sqlLit(recHash), sqlLit(recSalt))
	if _, err := runSQL(q); err != nil {
		return "", err
	}
	return recoveryKey, nil
}

func VerifyStoredAdminCredentials(username, password string) (bool, string) {
	acc, _ := GetAdminAccount()
	if acc == nil || normalizeAuthMode(acc.AuthMode) != "password" || acc.PasswordHash == "" || acc.PasswordSalt == "" {
		return false, ""
	}
	if !strings.EqualFold(strings.TrimSpace(acc.Username), strings.TrimSpace(username)) {
		return false, ""
	}
	if !VerifyPasswordHash(password, acc.PasswordHash, acc.PasswordSalt) {
		return false, ""
	}
	return true, acc.Username
}

func VerifyStoredAdminPasscode(passcode string) (bool, string) {
	acc, _ := GetAdminAccount()
	if acc == nil || normalizeAuthMode(acc.AuthMode) != "passcode" || acc.PasscodeHash == "" || acc.PasscodeSalt == "" {
		return false, ""
	}
	if passcode == "" || !VerifyPasswordHash(passcode, acc.PasscodeHash, acc.PasscodeSalt) {
		return false, ""
	}
	return true, defaultStr(acc.Username, "admin")
}

func VerifyAdminRecoveryKey(username, recoveryKey string) bool {
	acc, _ := GetAdminAccount()
	if acc == nil || acc.RecoveryHash == "" || acc.RecoverySalt == "" {
		return false
	}
	if normalizeAuthMode(acc.AuthMode) != "passcode" && !strings.EqualFold(strings.TrimSpace(acc.Username), strings.TrimSpace(username)) {
		return false
	}
	norm := NormalizeRecoveryKey(recoveryKey)
	if len(norm) < 12 {
		return false
	}
	return VerifyPasswordHash(norm, acc.RecoveryHash, acc.RecoverySalt)
}

func clampInt(v, minVal, maxVal, fallback int) int {
	if v < minVal || v > maxVal {
		return fallback
	}
	return v
}

func GetSecurityPolicy() SecurityPolicy {
	policy := SecurityPolicy{
		SessionTTLMinutes: 480,
		MaxLoginAttempts:  10,
		LockoutMinutes:    15,
		IdleLockMinutes:   0,
	}

	readMap := func(m map[string]string) {
		if v, err := strconv.Atoi(strings.TrimSpace(m["securitySessionTtlMinutes"])); err == nil {
			policy.SessionTTLMinutes = clampInt(v, 15, 1440, 480)
		}
		if v, err := strconv.Atoi(strings.TrimSpace(m["securityMaxLoginAttempts"])); err == nil {
			policy.MaxLoginAttempts = clampInt(v, 3, 25, 10)
		}
		if v, err := strconv.Atoi(strings.TrimSpace(m["securityLockoutMinutes"])); err == nil {
			policy.LockoutMinutes = clampInt(v, 1, 120, 15)
		}
		if v, err := strconv.Atoi(strings.TrimSpace(m["securityIdleLockMinutes"])); err == nil {
			if v == 0 {
				policy.IdleLockMinutes = 0
			} else {
				policy.IdleLockMinutes = clampInt(v, 5, 120, 0)
			}
		}
	}

	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		readMap(fallbackState.Settings)
		return policy
	}

	raw, err := runSQL(`SELECT hex(COALESCE(key, '')), hex(COALESCE(value, '')) FROM settings WHERE key IN ('securitySessionTtlMinutes', 'securityMaxLoginAttempts', 'securityLockoutMinutes', 'securityIdleLockMinutes');`)
	if err != nil {
		return policy
	}
	m := map[string]string{}
	for _, cols := range splitPipeRows(raw, 2) {
		m[decodeHexField(cols[0])] = decodeHexField(cols[1])
	}
	readMap(m)
	return policy
}

func SaveSecurityPolicy(input SecurityPolicy) (SecurityPolicy, error) {
	idleVal := 0
	if input.IdleLockMinutes > 0 {
		idleVal = clampInt(input.IdleLockMinutes, 5, 120, 15)
	}
	normalized := SecurityPolicy{
		SessionTTLMinutes: clampInt(input.SessionTTLMinutes, 15, 1440, 480),
		MaxLoginAttempts:  clampInt(input.MaxLoginAttempts, 3, 25, 10),
		LockoutMinutes:    clampInt(input.LockoutMinutes, 1, 120, 15),
		IdleLockMinutes:   idleVal,
	}

	pairs := map[string]string{
		"securitySessionTtlMinutes": strconv.Itoa(normalized.SessionTTLMinutes),
		"securityMaxLoginAttempts":  strconv.Itoa(normalized.MaxLoginAttempts),
		"securityLockoutMinutes":    strconv.Itoa(normalized.LockoutMinutes),
		"securityIdleLockMinutes":   strconv.Itoa(normalized.IdleLockMinutes),
	}

	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		for k, v := range pairs {
			fallbackState.Settings[k] = v
		}
		if err := saveFallbackLocked(); err != nil {
			return SecurityPolicy{}, err
		}
		return normalized, nil
	}

	var sb strings.Builder
	for k, v := range pairs {
		fmt.Fprintf(&sb, "INSERT OR REPLACE INTO settings (key, value) VALUES (%s, %s);\n", sqlLit(k), sqlLit(v))
	}
	if _, err := runSQL(sb.String()); err != nil {
		return SecurityPolicy{}, err
	}
	return normalized, nil
}

func GetRecentSecurityAuditLogs(limit int) []AuditLog {
	if limit <= 0 {
		limit = 8
	}
	all, err := GetAuditLogs()
	if err != nil {
		return []AuditLog{}
	}
	out := make([]AuditLog, 0, limit)
	for _, entry := range all {
		if strings.EqualFold(entry.EventType, "AUTH") || strings.EqualFold(entry.Channel, "SECURITY") || strings.EqualFold(entry.Channel, "RECOVERY") || strings.EqualFold(entry.Channel, "LOGIN") {
			out = append(out, entry)
			if len(out) >= limit {
				break
			}
		}
	}
	return out
}
