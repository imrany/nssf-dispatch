package main

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

type AppSettings struct {
	SMTPHost           string `json:"smtpHost"`
	SMTPPort           string `json:"smtpPort"`
	SMTPSecurity       string `json:"smtpSecurity"`
	SMTPUser           string `json:"smtpUser"`
	SMTPPass           string `json:"smtpPass,omitempty"`
	HasSMTPPass        bool   `json:"hasSmtpPass"`
	ClearSMTPPass      bool   `json:"clearSmtpPass,omitempty"`
	SMTPFrom           string `json:"smtpFrom"`
	EmailEnabled       bool   `json:"emailEnabled"`
	WhatsAppEnabled    bool   `json:"whatsappEnabled"`
	DeliveryMode       string `json:"deliveryMode"`
	WhatsAppBridgeURL  string `json:"whatsappBridgeUrl"`
	WhatsAppPaired     bool   `json:"whatsappPaired"`
	WhatsAppDeviceName string `json:"whatsappDeviceName"`
	FilenameTemplate        string `json:"filenameTemplate"`
	PasswordMode            string `json:"passwordMode"`
	PortalURL               string `json:"portalUrl"`
	PreviewBeforeDispatch   bool   `json:"previewBeforeDispatch"`
	EmailSubjectTemplate    string `json:"emailSubjectTemplate"`
	WhatsAppMessageTemplate string `json:"whatsappMessageTemplate"`
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

const dbPath = "nssf_dispatch.db"

func runSQL(query string) (string, error) {
	cmd := exec.Command("sqlite3", "-json", dbPath, query)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("sqlite3 error: %v (%s)", err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func sqlLit(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func InitDB() error {
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
	INSERT OR IGNORE INTO settings (key, value) VALUES
		('smtpHost', 'smtp.nssfkenya.co.ke'),
		('smtpPort', '587'),
		('smtpSecurity', 'starttls'),
		('smtpUser', 'statements@nssfkenya.co.ke'),
		('smtpPass', ''),
		('smtpFrom', 'NSSF Kenya Member Services <statements@nssfkenya.co.ke>'),
		('emailEnabled', 'true'),
		('whatsappEnabled', 'true'),
		('deliveryMode', 'live'),
		('whatsappBridgeUrl', 'http://127.0.0.1:8095'),
		('whatsappPaired', 'false'),
		('whatsappDeviceName', 'NSSF Service Desk Terminal 01'),
		('filenameTemplate', 'NSSF_Statement_{memberNo}_{date}.pdf'),
		('passwordMode', 'id_card'),
		('portalUrl', 'https://nssfdigital.enssf.co.ke'),
		('previewBeforeDispatch', 'true'),
		('emailSubjectTemplate', ` + sqlLit(DefaultEmailSubjectTemplate) + `),
		('whatsappMessageTemplate', ` + sqlLit(DefaultWhatsAppMessageTemplate) + `);
	`
	_, err := runSQL(schema)
	return err
}

func GetRawSettings() (AppSettings, error) {
	raw, err := runSQL("SELECT key, value FROM settings;")
	if err != nil {
		return AppSettings{}, err
	}
	var rows []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &rows); err != nil {
			return AppSettings{}, err
		}
	}
	m := map[string]string{}
	for _, r := range rows {
		m[r.Key] = r.Value
	}
	return AppSettings{
		SMTPHost:           defaultStr(m["smtpHost"], "smtp.nssfkenya.co.ke"),
		SMTPPort:           defaultStr(m["smtpPort"], "587"),
		SMTPSecurity:       defaultStr(m["smtpSecurity"], "starttls"),
		SMTPUser:           m["smtpUser"],
		SMTPPass:           m["smtpPass"],
		HasSMTPPass:        m["smtpPass"] != "",
		SMTPFrom:           defaultStr(m["smtpFrom"], "NSSF Kenya Member Services <statements@nssfkenya.co.ke>"),
		EmailEnabled:       m["emailEnabled"] != "false",
		WhatsAppEnabled:    m["whatsappEnabled"] != "false",
		DeliveryMode:       defaultStr(m["deliveryMode"], "live"),
		WhatsAppBridgeURL:  defaultStr(m["whatsappBridgeUrl"], "http://127.0.0.1:8095"),
		WhatsAppPaired:     m["whatsappPaired"] == "true",
		WhatsAppDeviceName: defaultStr(m["whatsappDeviceName"], "NSSF Service Desk Terminal 01"),
		FilenameTemplate:      defaultStr(m["filenameTemplate"], "NSSF_Statement_{memberNo}_{date}.pdf"),
		PasswordMode:          defaultStr(m["passwordMode"], "id_card"),
		PortalURL:               defaultStr(m["portalUrl"], "https://nssfdigital.enssf.co.ke"),
		PreviewBeforeDispatch:   m["previewBeforeDispatch"] != "false",
		EmailSubjectTemplate:    defaultStr(m["emailSubjectTemplate"], DefaultEmailSubjectTemplate),
		WhatsAppMessageTemplate: defaultStr(m["whatsappMessageTemplate"], DefaultWhatsAppMessageTemplate),
	}, nil
}

func GetPublicSettings() (AppSettings, error) {
	s, err := GetRawSettings()
	if err != nil {
		return s, err
	}
	s.SMTPPass = ""
	return s, nil
}

func SaveSettings(input AppSettings) error {
	current, _ := GetRawSettings()
	nextPass := current.SMTPPass
	if input.ClearSMTPPass {
		nextPass = ""
	} else if input.SMTPPass != "" {
		nextPass = input.SMTPPass
	}

	pairs := map[string]string{
		"smtpHost":           strings.TrimSpace(input.SMTPHost),
		"smtpPort":           strings.TrimSpace(input.SMTPPort),
		"smtpSecurity":       defaultStr(input.SMTPSecurity, "starttls"),
		"smtpUser":           strings.TrimSpace(input.SMTPUser),
		"smtpPass":           nextPass,
		"smtpFrom":           strings.TrimSpace(input.SMTPFrom),
		"emailEnabled":       fmt.Sprintf("%v", input.EmailEnabled),
		"whatsappEnabled":    fmt.Sprintf("%v", input.WhatsAppEnabled),
		"deliveryMode":       defaultStr(input.DeliveryMode, "live"),
		"whatsappBridgeUrl":  strings.TrimSpace(input.WhatsAppBridgeURL),
		"whatsappPaired":     fmt.Sprintf("%v", input.WhatsAppPaired),
		"whatsappDeviceName": strings.TrimSpace(input.WhatsAppDeviceName),
		"filenameTemplate":      defaultStr(strings.TrimSpace(input.FilenameTemplate), "NSSF_Statement_{memberNo}_{date}.pdf"),
		"passwordMode":          defaultStr(input.PasswordMode, "id_card"),
		"portalUrl":               defaultStr(strings.TrimSpace(input.PortalURL), "https://nssfdigital.enssf.co.ke"),
		"previewBeforeDispatch":   fmt.Sprintf("%v", input.PreviewBeforeDispatch),
		"emailSubjectTemplate":    defaultStr(strings.TrimSpace(input.EmailSubjectTemplate), DefaultEmailSubjectTemplate),
		"whatsappMessageTemplate": defaultStr(strings.TrimSpace(input.WhatsAppMessageTemplate), DefaultWhatsAppMessageTemplate),
	}

	var sb strings.Builder
	for k, v := range pairs {
		fmt.Fprintf(&sb, "INSERT OR REPLACE INTO settings (key, value) VALUES (%s, %s);\n", sqlLit(k), sqlLit(v))
	}
	_, err := runSQL(sb.String())
	return err
}

func GetWhatsAppSession() (*WhatsAppSessionRecord, error) {
	raw, err := runSQL(`SELECT session_code AS sessionCode, qr_payload AS qrPayload, qr_svg AS qrSvg,
		paired, device_name AS deviceName, bridge_url AS bridgeUrl,
		bridge_reachable AS bridgeReachable, paired_phone AS pairedPhone,
		paired_at AS pairedAt, updated_at AS updatedAt
		FROM whatsapp_sessions WHERE id = 1;`)
	if err != nil || raw == "" {
		return nil, err
	}
	var rows []struct {
		SessionCode     string `json:"sessionCode"`
		QRPayload       string `json:"qrPayload"`
		QRSvg           string `json:"qrSvg"`
		Paired          int    `json:"paired"`
		DeviceName      string `json:"deviceName"`
		BridgeURL       string `json:"bridgeUrl"`
		BridgeReachable int    `json:"bridgeReachable"`
		PairedPhone     string `json:"pairedPhone"`
		PairedAt        string `json:"pairedAt"`
		UpdatedAt       string `json:"updatedAt"`
	}
	if err := json.Unmarshal([]byte(raw), &rows); err != nil || len(rows) == 0 {
		return nil, err
	}
	r := rows[0]
	return &WhatsAppSessionRecord{
		SessionCode:     r.SessionCode,
		QRPayload:       r.QRPayload,
		QRSvg:           r.QRSvg,
		Paired:          r.Paired == 1,
		DeviceName:      r.DeviceName,
		BridgeURL:       r.BridgeURL,
		BridgeReachable: r.BridgeReachable == 1,
		PairedPhone:     r.PairedPhone,
		PairedAt:        r.PairedAt,
		UpdatedAt:       r.UpdatedAt,
	}, nil
}

func SaveWhatsAppSession(s WhatsAppSessionRecord) (*WhatsAppSessionRecord, error) {
	pairedInt := 0
	if s.Paired {
		pairedInt = 1
	}
	reachInt := 0
	if s.BridgeReachable {
		reachInt = 1
	}
	q := fmt.Sprintf(`INSERT INTO whatsapp_sessions (
		id, session_code, qr_payload, qr_svg, paired, device_name,
		bridge_url, bridge_reachable, paired_phone, paired_at, updated_at
	) VALUES (1, %s, %s, %s, %d, %s, %s, %d, %s, %s, datetime('now', 'localtime'))
	ON CONFLICT(id) DO UPDATE SET
		session_code = excluded.session_code,
		qr_payload = excluded.qr_payload,
		qr_svg = excluded.qr_svg,
		paired = excluded.paired,
		device_name = excluded.device_name,
		bridge_url = excluded.bridge_url,
		bridge_reachable = excluded.bridge_reachable,
		paired_phone = excluded.paired_phone,
		paired_at = excluded.paired_at,
		updated_at = datetime('now', 'localtime');
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
	q := fmt.Sprintf(
		`INSERT INTO audit_logs (member_no, member_name, channel, destination, renamed_file, status, details)
		 VALUES (%s, %s, %s, %s, %s, %s, %s);`,
		sqlLit(memberNo), sqlLit(memberName), sqlLit(channel), sqlLit(dest), sqlLit(filename), sqlLit(status), sqlLit(details),
	)
	_, err := runSQL(q)
	return err
}

func GetAuditLogs() ([]AuditLog, error) {
	raw, err := runSQL(`SELECT id, timestamp, member_no AS memberNo, member_name AS memberName,
		channel, destination, renamed_file AS renamedFile, status, details
		FROM audit_logs ORDER BY id DESC LIMIT 150;`)
	if err != nil {
		return nil, err
	}
	var logs []AuditLog
	if raw != "" {
		_ = json.Unmarshal([]byte(raw), &logs)
	}
	return logs, nil
}
