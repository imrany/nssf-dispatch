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
	FilenameTemplate   string `json:"filenameTemplate"`
	PasswordMode       string `json:"passwordMode"`
	PortalURL          string `json:"portalUrl"`
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
		('portalUrl', 'https://nssfdigital.enssf.co.ke');
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
		FilenameTemplate:   defaultStr(m["filenameTemplate"], "NSSF_Statement_{memberNo}_{date}.pdf"),
		PasswordMode:       defaultStr(m["passwordMode"], "id_card"),
		PortalURL:          defaultStr(m["portalUrl"], "https://nssfdigital.enssf.co.ke"),
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
		"filenameTemplate":   defaultStr(strings.TrimSpace(input.FilenameTemplate), "NSSF_Statement_{memberNo}_{date}.pdf"),
		"passwordMode":       defaultStr(input.PasswordMode, "id_card"),
		"portalUrl":          defaultStr(strings.TrimSpace(input.PortalURL), "https://nssfdigital.enssf.co.ke"),
	}

	var sb strings.Builder
	for k, v := range pairs {
		fmt.Fprintf(&sb, "INSERT OR REPLACE INTO settings (key, value) VALUES (%s, %s);\n", sqlLit(k), sqlLit(v))
	}
	_, err := runSQL(sb.String())
	return err
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
