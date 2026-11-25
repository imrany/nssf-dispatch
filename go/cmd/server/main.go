package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

//go:embed dist/*
var embeddedFrontend embed.FS

type cachedPDF struct {
	filename  string
	data      []byte
	expiresAt time.Time
}

var (
	pdfCacheMu sync.Mutex
	pdfCache   = map[string]cachedPDF{}
)

func storeProtectedPDF(filename string, data []byte) string {
	pdfCacheMu.Lock()
	defer pdfCacheMu.Unlock()
	now := time.Now()
	for k, v := range pdfCache {
		if v.expiresAt.Before(now) {
			delete(pdfCache, k)
		}
	}
	token := randomHex(16)
	pdfCache[token] = cachedPDF{filename: filename, data: data, expiresAt: now.Add(30 * time.Minute)}
	return token
}

func buildRenamedFile(template, memberNo string) string {
	if strings.TrimSpace(template) == "" {
		template = "NSSF_Statement_{memberNo}_{date}.pdf"
	}
	out := strings.ReplaceAll(template, "{memberNo}", strings.TrimSpace(memberNo))
	out = strings.ReplaceAll(out, "{date}", time.Now().Format("20060102"))
	if !strings.HasSuffix(strings.ToLower(out), ".pdf") {
		out += ".pdf"
	}
	return out
}

func main() {
	if err := InitDB(); err != nil {
		log.Fatalf("SQLite database init failed: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/api/validate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if err := r.ParseMultipartForm(15 << 20); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid multipart upload"})
			return
		}
		memberNo := strings.TrimSpace(r.FormValue("memberNo"))
		file, _, err := r.FormFile("statement")
		if err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Statement PDF is required"})
			return
		}
		defer file.Close()
		rawPDF, _ := io.ReadAll(file)

		meta, err := ExtractAndValidatePDF(rawPDF, memberNo)
		if err != nil {
			writeJSON(w, 422, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		cfg, _ := GetRawSettings()
		writeJSON(w, 200, map[string]any{
			"ok":          true,
			"meta":        meta,
			"renamedFile": buildRenamedFile(cfg.FilenameTemplate, meta.MemberNo),
		})
	})

	mux.HandleFunc("/api/dispatch", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if err := r.ParseMultipartForm(15 << 20); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid form upload"})
			return
		}

		memberNo := strings.TrimSpace(r.FormValue("memberNo"))
		channel := strings.TrimSpace(r.FormValue("channel"))
		email := strings.TrimSpace(r.FormValue("email"))
		whatsapp := strings.TrimSpace(r.FormValue("whatsapp"))

		file, header, err := r.FormFile("statement")
		if err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Statement PDF is required"})
			return
		}
		defer file.Close()
		rawPDF, _ := io.ReadAll(file)

		meta, err := ExtractAndValidatePDF(rawPDF, memberNo)
		if err != nil {
			_ = InsertAuditLog(memberNo, "UNVERIFIED", strings.ToUpper(channel), strings.Trim(email+" "+whatsapp, " "), header.Filename, "VALIDATION_FAILED", err.Error())
			writeJSON(w, 422, map[string]any{"ok": false, "error": err.Error()})
			return
		}

		cfg, _ := GetRawSettings()
		rawPassword := meta.IDCardNo
		if cfg.PasswordMode == "id_and_nssf_last4" && len(meta.MemberNo) >= 4 {
			rawPassword = meta.IDCardNo + meta.MemberNo[len(meta.MemberNo)-4:]
		}

		encryptedPDF, err := EncryptPDFWithPassword(rawPDF, rawPassword)
		if err != nil {
			writeJSON(w, 500, map[string]any{"ok": false, "error": "Failed to encrypt statement PDF"})
			return
		}

		renamedFile := buildRenamedFile(cfg.FilenameTemplate, meta.MemberNo)
		downloadToken := storeProtectedPDF(renamedFile, encryptedPDF)
		subject, htmlBody, plainText, passwordGuide := BuildOfficialNSSFMessage(meta, renamedFile, cfg.PasswordMode, cfg.PortalURL, rawPassword)

		var delivered []string
		if channel == "email" || channel == "both" {
			if cfg.DeliveryMode == "live" {
				if err := SendEmailStatement(cfg, email, meta, renamedFile, encryptedPDF, rawPassword); err != nil {
					_ = InsertAuditLog(meta.MemberNo, meta.MemberName, "EMAIL", email, renamedFile, "FAILED", err.Error())
					writeJSON(w, 502, map[string]any{"ok": false, "error": "Email error: " + err.Error()})
					return
				}
				_ = InsertAuditLog(meta.MemberNo, meta.MemberName, "EMAIL", email, renamedFile, "SENT", "Delivered via SMTP")
			} else {
				_ = InsertAuditLog(meta.MemberNo, meta.MemberName, "EMAIL", email, renamedFile, "DISPATCHED (PREVIEW)", "Packaged in preview mode")
			}
			delivered = append(delivered, "EMAIL")
		}

		if channel == "whatsapp" || channel == "both" {
			if cfg.DeliveryMode == "live" {
				if err := SendWhatsAppStatement(cfg, whatsapp, meta, renamedFile, encryptedPDF, rawPassword); err != nil {
					_ = InsertAuditLog(meta.MemberNo, meta.MemberName, "WHATSAPP", whatsapp, renamedFile, "FAILED", err.Error())
					writeJSON(w, 502, map[string]any{"ok": false, "error": "WhatsApp error: " + err.Error()})
					return
				}
				_ = InsertAuditLog(meta.MemberNo, meta.MemberName, "WHATSAPP", whatsapp, renamedFile, "SENT", "Delivered via WhatsApp gateway")
			} else {
				_ = InsertAuditLog(meta.MemberNo, meta.MemberName, "WHATSAPP", whatsapp, renamedFile, "DISPATCHED (PREVIEW)", "Packaged in preview mode")
			}
			delivered = append(delivered, "WHATSAPP")
		}

		writeJSON(w, 200, map[string]any{
			"ok":               true,
			"deliveryMode":     cfg.DeliveryMode,
			"memberNo":         meta.MemberNo,
			"memberName":       meta.MemberName,
			"period":           meta.Period,
			"standardAmount":   meta.StandardAmount,
			"voluntaryAmount":  meta.VoluntaryAmount,
			"totalAmount":      meta.TotalAmount,
			"originalFilename": header.Filename,
			"renamedFile":      renamedFile,
			"channel":          strings.Join(delivered, " & "),
			"destination":      strings.Trim(email+" "+whatsapp, " "),
			"timestamp":        time.Now().Format("02 Jan 2006 15:04:05"),
			"passwordGuide":    passwordGuide,
			"downloadUrl":      "/api/download/" + downloadToken,
			"emailPreview": map[string]string{
				"subject":   subject,
				"htmlBody":  htmlBody,
				"plainText": plainText,
			},
		})
	})

	mux.HandleFunc("/api/download/", func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.URL.Path, "/api/download/")
		pdfCacheMu.Lock()
		entry, ok := pdfCache[token]
		pdfCacheMu.Unlock()
		if !ok || entry.expiresAt.Before(time.Now()) {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", entry.filename))
		_, _ = w.Write(entry.data)
	})

	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			cfg, _ := GetPublicSettings()
			writeJSON(w, 200, cfg)
			return
		}
		if r.Method == http.MethodPost {
			var cfg AppSettings
			if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
				writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			if err := SaveSettings(cfg); err != nil {
				writeJSON(w, 500, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			updated, _ := GetPublicSettings()
			writeJSON(w, 200, map[string]any{"ok": true, "settings": updated})
		}
	})

	mux.HandleFunc("/api/settings/test-smtp", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		current, _ := GetRawSettings()
		var override AppSettings
		_ = json.NewDecoder(r.Body).Decode(&override)
		if override.SMTPHost != "" {
			current.SMTPHost = override.SMTPHost
		}
		if override.SMTPPort != "" {
			current.SMTPPort = override.SMTPPort
		}
		if override.SMTPSecurity != "" {
			current.SMTPSecurity = override.SMTPSecurity
		}
		if override.SMTPUser != "" {
			current.SMTPUser = override.SMTPUser
		}
		if override.SMTPPass != "" {
			current.SMTPPass = override.SMTPPass
		}
		if err := TestSMTPConnection(current); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "message": fmt.Sprintf("Authenticated successfully with %s:%s", current.SMTPHost, current.SMTPPort)})
	})

	mux.HandleFunc("/api/whatsapp/qr", func(w http.ResponseWriter, r *http.Request) {
		cfg, _ := GetRawSettings()
		writeJSON(w, 200, FetchWhatsAppQR(cfg))
	})

	mux.HandleFunc("/api/whatsapp/pair", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Paired bool `json:"paired"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		cfg, _ := GetRawSettings()
		cfg.WhatsAppPaired = body.Paired
		_ = SaveSettings(cfg)
		pub, _ := GetPublicSettings()
		writeJSON(w, 200, map[string]any{"ok": true, "paired": body.Paired, "settings": pub})
	})

	mux.HandleFunc("/api/audit", func(w http.ResponseWriter, r *http.Request) {
		logs, _ := GetAuditLogs()
		writeJSON(w, 200, logs)
	})

	distFS, err := fs.Sub(embeddedFrontend, "dist")
	if err != nil {
		log.Fatalf("Embedded dist missing: %v", err)
	}
	mux.Handle("/", http.FileServer(http.FS(distFS)))

	log.Println("NSSF Digital Member Statement Dispatch running on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
