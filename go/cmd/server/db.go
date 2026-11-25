package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
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
	WhatsAppEnabled         bool   `json:"whatsappEnabled"`
	DeliveryMode            string `json:"deliveryMode"`
	WhatsAppBridgeURL       string `json:"whatsappBridgeUrl"`
	WhatsAppPaired          bool   `json:"whatsappPaired"`
	WhatsAppDeviceName      string `json:"whatsappDeviceName"`
	FilenameTemplate        string `json:"filenameTemplate"`
	PasswordMode            string `json:"passwordMode"`
	PortalURL               string `json:"portalUrl"`
	PreviewBeforeDispatch   bool   `json:"previewBeforeDispatch"`
	EmailSubjectTemplate    string `json:"emailSubjectTemplate"`
	WhatsAppMessageTemplate string `json:"whatsappMessageTemplate"`
	GoServiceEnabled        bool   `json:"goServiceEnabled"`
	GoServiceURL            string `json:"goServiceUrl"`
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
	MemberNo    string `json:"memberNo"`
	MemberName  string `json:"memberName"`
	Channel     string `json:"channel"`
	Destination string `json:"destination"`
	RenamedFile string `json:"renamedFile"`
	Status      string `json:"status"`
	Details     string `json:"details"`
}

type AdminAccount struct {
	Username     string `json:"username"`
	PasswordHash string `json:"passwordHash"`
	PasswordSalt string `json:"passwordSalt"`
	CreatedAt    string `json:"createdAt"`
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

func getDBPath() string {
	if p := strings.TrimSpace(os.Getenv("NSSF_DB_PATH")); p != "" {
		return p
	}
	return "nssf_dispatch.db"
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
	goURL := strings.TrimSpace(os.Getenv("GO_SERVICE_URL"))
	if goURL == "" {
		goURL = "http://127.0.0.1:8080"
	}
	return map[string]string{
		"smtpHost":                "smtp.nssfkenya.co.ke",
		"smtpPort":                "587",
		"smtpSecurity":            "starttls",
		"smtpUser":                "statements@nssfkenya.co.ke",
		"smtpPass":                "",
		"smtpFrom":                "NSSF Kenya Member Services <statements@nssfkenya.co.ke>",
		"emailEnabled":            "true",
		"whatsappEnabled":         "true",
		"deliveryMode":            "preview",
		"whatsappBridgeUrl":       "http://127.0.0.1:8095",
		"whatsappPaired":          "false",
		"whatsappDeviceName":      "NSSF Service Desk Terminal 01",
		"filenameTemplate":        "NSSF_Statement_{memberNo}_{date}.pdf",
		"passwordMode":            "id_card",
		"portalUrl":               "https://nssfdigital.enssf.co.ke",
		"previewBeforeDispatch":   "true",
		"emailSubjectTemplate":    DefaultEmailSubjectTemplate,
		"whatsappMessageTemplate": DefaultWhatsAppMessageTemplate,
		"goServiceEnabled":        "false",
		"goServiceUrl":            goURL,
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
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
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
		username TEXT NOT NULL,
		password_hash TEXT NOT NULL,
		password_salt TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
	);
	CREATE TABLE IF NOT EXISTS audit_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
		member_no TEXT NOT NULL,
		member_name TEXT NOT NULL,
		channel TEXT NOT NULL,
		destination TEXT NOT NULL,
		renamed_file TEXT NOT NULL,
		status TEXT NOT NULL,
		details TEXT NOT NULL DEFAULT ''
	);
	INSERT OR IGNORE INTO settings (key, value) VALUES ` + strings.Join(inserts, ",\n") + `;`

	_, err := runSQL(schema)
	return err
}

func settingsFromMap(m map[string]string, pairedOverride *bool) AppSettings {
	isPaired := m["whatsappPaired"] == "true"
	if pairedOverride != nil {
		isPaired = *pairedOverride
	}
	goURL := strings.TrimSpace(os.Getenv("GO_SERVICE_URL"))
	if goURL == "" {
		goURL = "http://127.0.0.1:8080"
	}
	return AppSettings{
		SMTPHost:                defaultStr(m["smtpHost"], "smtp.nssfkenya.co.ke"),
		SMTPPort:                defaultStr(m["smtpPort"], "587"),
		SMTPSecurity:            defaultStr(m["smtpSecurity"], "starttls"),
		SMTPUser:                m["smtpUser"],
		SMTPPass:                m["smtpPass"],
		HasSMTPPass:             m["smtpPass"] != "",
		SMTPFrom:                defaultStr(m["smtpFrom"], "NSSF Kenya Member Services <statements@nssfkenya.co.ke>"),
		EmailEnabled:            m["emailEnabled"] != "false",
		WhatsAppEnabled:         m["whatsappEnabled"] != "false",
		DeliveryMode:            defaultStr(m["deliveryMode"], "preview"),
		WhatsAppBridgeURL:       defaultStr(m["whatsappBridgeUrl"], "http://127.0.0.1:8095"),
		WhatsAppPaired:          isPaired,
		WhatsAppDeviceName:      defaultStr(m["whatsappDeviceName"], "NSSF Service Desk Terminal 01"),
		FilenameTemplate:        defaultStr(m["filenameTemplate"], "NSSF_Statement_{memberNo}_{date}.pdf"),
		PasswordMode:            defaultStr(m["passwordMode"], "id_card"),
		PortalURL:               defaultStr(m["portalUrl"], "https://nssfdigital.enssf.co.ke"),
		PreviewBeforeDispatch:   m["previewBeforeDispatch"] != "false",
		EmailSubjectTemplate:    defaultStr(m["emailSubjectTemplate"], DefaultEmailSubjectTemplate),
		WhatsAppMessageTemplate: defaultStr(m["whatsappMessageTemplate"], DefaultWhatsAppMessageTemplate),
		GoServiceEnabled:        m["goServiceEnabled"] == "true",
		GoServiceURL:            defaultStr(m["goServiceUrl"], goURL),
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
		WhatsAppEnabled:         raw.WhatsAppEnabled,
		DeliveryMode:            defaultStr(raw.DeliveryMode, "preview"),
		WhatsAppBridgeURL:       "",
		WhatsAppPaired:          raw.WhatsAppPaired,
		WhatsAppDeviceName:      "",
		FilenameTemplate:        defaultStr(raw.FilenameTemplate, "NSSF_Statement_{memberNo}_{date}.pdf"),
		PasswordMode:            defaultStr(raw.PasswordMode, "id_card"),
		PortalURL:               defaultStr(raw.PortalURL, "https://nssfdigital.enssf.co.ke"),
		PreviewBeforeDispatch:   raw.PreviewBeforeDispatch,
		EmailSubjectTemplate:    "",
		WhatsAppMessageTemplate: "",
		GoServiceEnabled:        raw.GoServiceEnabled,
		GoServiceURL:            "",
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

	nextGoURL := defaultStr(strings.TrimSpace(input.GoServiceURL), current.GoServiceURL)
	if nextGoURL == "" {
		nextGoURL = "http://127.0.0.1:8080"
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
		"deliveryMode":            defaultStr(input.DeliveryMode, "preview"),
		"whatsappBridgeUrl":       strings.TrimSpace(input.WhatsAppBridgeURL),
		"whatsappPaired":          fmt.Sprintf("%v", input.WhatsAppPaired),
		"whatsappDeviceName":      strings.TrimSpace(input.WhatsAppDeviceName),
		"filenameTemplate":        defaultStr(strings.TrimSpace(input.FilenameTemplate), "NSSF_Statement_{memberNo}_{date}.pdf"),
		"passwordMode":            defaultStr(input.PasswordMode, "id_card"),
		"portalUrl":               defaultStr(strings.TrimSpace(input.PortalURL), "https://nssfdigital.enssf.co.ke"),
		"previewBeforeDispatch":   fmt.Sprintf("%v", input.PreviewBeforeDispatch),
		"emailSubjectTemplate":    defaultStr(strings.TrimSpace(input.EmailSubjectTemplate), DefaultEmailSubjectTemplate),
		"whatsappMessageTemplate": defaultStr(strings.TrimSpace(input.WhatsAppMessageTemplate), DefaultWhatsAppMessageTemplate),
		"goServiceEnabled":        fmt.Sprintf("%v", input.GoServiceEnabled),
		"goServiceUrl":            nextGoURL,
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

func InsertAuditLog(memberNo, memberName, channel, dest, filename, status, details string) error {
	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		entry := AuditLog{
			ID:          fallbackState.NextAuditID,
			Timestamp:   time.Now().Format("2006-01-02 15:04:05"),
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
		if len(fallbackState.AuditLogs) > 300 {
			fallbackState.AuditLogs = fallbackState.AuditLogs[:300]
		}
		return saveFallbackLocked()
	}

	q := fmt.Sprintf(
		`INSERT INTO audit_logs (member_no, member_name, channel, destination, renamed_file, status, details)
		 VALUES (%s, %s, %s, %s, %s, %s, %s);`,
		sqlLit(memberNo), sqlLit(memberName), sqlLit(channel), sqlLit(dest), sqlLit(filename), sqlLit(status), sqlLit(details),
	)
	_, err := runSQL(q)
	return err
}

func GetAuditLogs() ([]AuditLog, error) {
	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		out := make([]AuditLog, 0, len(fallbackState.AuditLogs))
		limit := len(fallbackState.AuditLogs)
		if limit > 150 {
			limit = 150
		}
		out = append(out, fallbackState.AuditLogs[:limit]...)
		return out, nil
	}

	raw, err := runSQL(`SELECT id, hex(COALESCE(timestamp, '')), hex(COALESCE(member_no, '')), hex(COALESCE(member_name, '')),
		hex(COALESCE(channel, '')), hex(COALESCE(destination, '')), hex(COALESCE(renamed_file, '')),
		hex(COALESCE(status, '')), hex(COALESCE(details, ''))
		FROM audit_logs ORDER BY id DESC LIMIT 150;`)
	if err != nil {
		return []AuditLog{}, err
	}
	rows := splitPipeRows(raw, 9)
	logs := make([]AuditLog, 0, len(rows))
	for _, cols := range rows {
		idVal, _ := strconv.Atoi(strings.TrimSpace(cols[0]))
		logs = append(logs, AuditLog{
			ID:          idVal,
			Timestamp:   decodeHexField(cols[1]),
			MemberNo:    decodeHexField(cols[2]),
			MemberName:  decodeHexField(cols[3]),
			Channel:     decodeHexField(cols[4]),
			Destination: decodeHexField(cols[5]),
			RenamedFile: decodeHexField(cols[6]),
			Status:      decodeHexField(cols[7]),
			Details:     decodeHexField(cols[8]),
		})
	}
	return logs, nil
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
		return &cp, nil
	}

	raw, err := runSQL(`SELECT hex(COALESCE(username, '')), hex(COALESCE(password_hash, '')), hex(COALESCE(password_salt, '')), hex(COALESCE(created_at, '')) FROM admin_users WHERE id = 1;`)
	if err != nil || raw == "" {
		return nil, err
	}
	rows := splitPipeRows(raw, 4)
	if len(rows) == 0 {
		return nil, nil
	}
	cols := rows[0]
	return &AdminAccount{
		Username:     decodeHexField(cols[0]),
		PasswordHash: decodeHexField(cols[1]),
		PasswordSalt: decodeHexField(cols[2]),
		CreatedAt:    decodeHexField(cols[3]),
	}, nil
}

func HasAdminAccount() bool {
	acc, _ := GetAdminAccount()
	return acc != nil
}

func CreateInitialAdmin(username, password string) (*AdminAccount, error) {
	cleanUser := strings.TrimSpace(username)
	hashHex, saltHex := HashPasswordWithSalt(password)
	nowStr := time.Now().Format("2006-01-02 15:04:05")

	if !hasSQLiteCLI() {
		dbMu.Lock()
		defer dbMu.Unlock()
		loadFallbackLocked()
		if fallbackState.Admin != nil {
			return nil, fmt.Errorf("administrator account already exists")
		}
		fallbackState.Admin = &AdminAccount{
			Username:     cleanUser,
			PasswordHash: hashHex,
			PasswordSalt: saltHex,
			CreatedAt:    nowStr,
		}
		if err := saveFallbackLocked(); err != nil {
			return nil, err
		}
		cp := *fallbackState.Admin
		return &cp, nil
	}

	q := fmt.Sprintf(`INSERT INTO admin_users (id, username, password_hash, password_salt) VALUES (1, %s, %s, %s);`,
		sqlLit(cleanUser), sqlLit(hashHex), sqlLit(saltHex))
	if _, err := runSQL(q); err != nil {
		return nil, err
	}
	return GetAdminAccount()
}

func VerifyStoredAdminCredentials(username, password string) (bool, string) {
	acc, _ := GetAdminAccount()
	if acc == nil {
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
