package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"path"
	"regexp"
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

func countDigits(s string) int {
	n := 0
	for _, r := range s {
		if r >= '0' && r <= '9' {
			n++
		}
	}
	return n
}

var (
	emailRe    = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	usernameRe = regexp.MustCompile(`^[A-Za-z0-9._@-]{3,64}$`)
)

func main() {
	if err := InitDB(); err != nil {
		log.Fatalf("Database init failed: %v", err)
	}

	if startupCfg, err := GetRawSettings(); err == nil {
		InitWhatsApp(startupCfg)
	}

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"ok":               true,
			"engine":           "go",
			"runtime":          "go-net-http",
			"port":             port,
			"sqliteCliBackend": hasSQLiteCLI(),
		})
	})

	mux.HandleFunc("/api/system/runtime", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"ok":           true,
			"activeEngine": "go",
			"goEngineInfo": map[string]any{
				"engine":           "go",
				"sqliteCliBackend": hasSQLiteCLI(),
			},
		})
	})

	mux.HandleFunc("/api/validate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
		if err := r.ParseMultipartForm(15 << 20); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid multipart upload"})
			return
		}
		memberNo := strings.TrimSpace(r.FormValue("memberNo"))
		file, _, err := r.FormFile("statement")
		if err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please upload a member statement PDF."})
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
		r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
		if err := r.ParseMultipartForm(15 << 20); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid form upload"})
			return
		}

		memberNo := strings.TrimSpace(r.FormValue("memberNo"))
		channel := strings.TrimSpace(r.FormValue("channel"))
		if channel == "" {
			channel = "email"
		}
		if channel != "email" && channel != "whatsapp" && channel != "both" {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid dispatch channel selected."})
			return
		}

		email := strings.TrimSpace(r.FormValue("email"))
		whatsapp := strings.TrimSpace(r.FormValue("whatsapp"))

		file, header, err := r.FormFile("statement")
		if err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Statement PDF upload is required."})
			return
		}
		defer file.Close()
		rawPDF, _ := io.ReadAll(file)

		if (channel == "email" || channel == "both") && !emailRe.MatchString(email) {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please enter a valid member email address."})
			return
		}
		if (channel == "whatsapp" || channel == "both") && countDigits(whatsapp) < 9 {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please enter a valid member WhatsApp phone number."})
			return
		}

		cfg, _ := GetRawSettings()
		if (channel == "email" || channel == "both") && !cfg.EmailEnabled {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Email dispatch is disabled in System Settings."})
			return
		}
		if (channel == "whatsapp" || channel == "both") && !cfg.WhatsAppEnabled {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "WhatsApp dispatch is disabled in System Settings."})
			return
		}

		meta, err := ExtractAndValidatePDF(rawPDF, memberNo)
		if err != nil {
			_ = InsertAuditLog(defaultStr(memberNo, "UNSPECIFIED"), "UNVERIFIED", strings.ToUpper(channel), strings.Trim(email+" / "+whatsapp, " /"), header.Filename, "VALIDATION_FAILED", err.Error())
			writeJSON(w, 422, map[string]any{"ok": false, "error": err.Error()})
			return
		}

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
		subject, htmlBody, plainText, whatsappText, passwordGuide := BuildOfficialNSSFMessage(meta, renamedFile, cfg.PasswordMode, cfg.PortalURL, rawPassword, cfg.EmailSubjectTemplate, cfg.WhatsAppMessageTemplate)

		var delivered []string
		if channel == "email" || channel == "both" {
			if cfg.DeliveryMode == "live" {
				if err := SendEmailStatement(cfg, email, meta, renamedFile, encryptedPDF, rawPassword); err != nil {
					_ = InsertAuditLog(meta.MemberNo, meta.MemberName, "EMAIL", email, renamedFile, "FAILED", err.Error())
					writeJSON(w, 502, map[string]any{"ok": false, "error": "Email error: " + err.Error()})
					return
				}
				_ = InsertAuditLog(meta.MemberNo, meta.MemberName, "EMAIL", email, renamedFile, "SENT", "SMTP delivered via "+cfg.SMTPHost)
			} else {
				_ = InsertAuditLog(meta.MemberNo, meta.MemberName, "EMAIL", email, renamedFile, "DISPATCHED (PREVIEW)", "Encrypted PDF & official NSSF email packaged in preview mode")
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
				_ = InsertAuditLog(meta.MemberNo, meta.MemberName, "WHATSAPP", whatsapp, renamedFile, "SENT", "WhatsApp document dispatched via paired desk gateway")
			} else {
				_ = InsertAuditLog(meta.MemberNo, meta.MemberName, "WHATSAPP", whatsapp, renamedFile, "DISPATCHED (PREVIEW)", "Encrypted PDF & WhatsApp caption packaged in preview mode")
			}
			delivered = append(delivered, "WHATSAPP")
		}

		var destParts []string
		if email != "" {
			destParts = append(destParts, email)
		}
		if whatsapp != "" {
			destParts = append(destParts, whatsapp)
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
			"destination":      strings.Join(destParts, " · "),
			"timestamp":        time.Now().Format("02 Jan 2006 15:04:05"),
			"passwordGuide":    passwordGuide,
			"downloadUrl":      "/api/download/" + downloadToken,
			"emailPreview": map[string]string{
				"subject":      subject,
				"htmlBody":     htmlBody,
				"plainText":    plainText,
				"whatsappText": whatsappText,
			},
		})
	})

	mux.HandleFunc("/api/download/", func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.URL.Path, "/api/download/")
		pdfCacheMu.Lock()
		entry, ok := pdfCache[token]
		pdfCacheMu.Unlock()
		if !ok || entry.expiresAt.Before(time.Now()) {
			writeJSON(w, 404, map[string]any{"ok": false, "error": "Protected PDF link expired. Re-run dispatch to generate a new copy."})
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", entry.filename))
		_, _ = w.Write(entry.data)
	})

	// Admin Auth endpoints
	mux.HandleFunc("/api/auth/status", func(w http.ResponseWriter, r *http.Request) {
		envPasscode := strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE"))
		envConfigured := envPasscode != ""
		adminExists := envConfigured || HasAdminAccount()
		valid, username := VerifyAdminSessionToken(ExtractBearerToken(r))
		var userVal any = nil
		if valid && username != "" {
			userVal = username
		}
		writeJSON(w, 200, map[string]any{
			"adminExists":           adminExists,
			"authenticated":         valid,
			"username":              userVal,
			"envPasscodeConfigured": envConfigured,
		})
	})

	mux.HandleFunc("/api/auth/setup", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE")) != "" || HasAdminAccount() {
			writeJSON(w, 409, map[string]any{"ok": false, "error": "An administrator account is already configured. Please sign in."})
			return
		}
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid JSON body."})
			return
		}
		username := strings.TrimSpace(body.Username)
		if !usernameRe.MatchString(username) {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Admin username must be 3 to 64 characters (letters, numbers, ., _, @, -)."})
			return
		}
		if len(body.Password) < 8 || len(body.Password) > 128 {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Admin password must be between 8 and 128 characters."})
			return
		}
		created, err := CreateInitialAdmin(username, body.Password)
		if err != nil {
			writeJSON(w, 409, map[string]any{"ok": false, "error": "Administrator setup already completed. Please sign in."})
			return
		}
		token := CreateAdminSessionToken(created.Username)
		pub, _ := GetPublicSettings()
		writeJSON(w, 201, map[string]any{
			"ok":       true,
			"token":    token,
			"username": created.Username,
			"settings": pub,
		})
	})

	mux.HandleFunc("/api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ip := ClientIP(r)
		allowed, retryAfter := CheckLoginRateLimit(ip)
		if !allowed {
			writeJSON(w, 429, map[string]any{"ok": false, "error": fmt.Sprintf("Too many failed login attempts. Try again in %d seconds.", retryAfter)})
			return
		}
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid JSON body."})
			return
		}

		envPasscode := strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE"))
		if envPasscode != "" {
			if body.Password == "" || !VerifyTimingSafeString(body.Password, envPasscode) {
				RecordFailedLogin(ip)
				writeJSON(w, 401, map[string]any{"ok": false, "error": "Invalid administrator credentials."})
				return
			}
			ClearFailedLogins(ip)
			user := defaultStr(strings.TrimSpace(body.Username), "admin")
			token := CreateAdminSessionToken(user)
			pub, _ := GetPublicSettings()
			writeJSON(w, 200, map[string]any{"ok": true, "token": token, "username": user, "settings": pub})
			return
		}

		if !HasAdminAccount() {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "No administrator account exists yet. Complete initial admin setup first."})
			return
		}

		ok, matchedUser := VerifyStoredAdminCredentials(body.Username, body.Password)
		if !ok {
			RecordFailedLogin(ip)
			writeJSON(w, 401, map[string]any{"ok": false, "error": "Invalid username or password."})
			return
		}
		ClearFailedLogins(ip)
		token := CreateAdminSessionToken(matchedUser)
		pub, _ := GetPublicSettings()
		writeJSON(w, 200, map[string]any{"ok": true, "token": token, "username": matchedUser, "settings": pub})
	})

	mux.HandleFunc("/api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		RevokeAdminSessionToken(ExtractBearerToken(r))
		writeJSON(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			valid, _ := VerifyAdminSessionToken(ExtractBearerToken(r))
			if valid {
				cfg, _ := GetPublicSettings()
				writeJSON(w, 200, cfg)
			} else {
				writeJSON(w, 200, GetSafeWorkspaceSettings())
			}
			return
		}
		if r.Method == http.MethodPost {
			valid, _ := VerifyAdminSessionToken(ExtractBearerToken(r))
			if !valid {
				writeJSON(w, 401, map[string]any{"ok": false, "error": "Administrator authentication is required to access System Settings."})
				return
			}
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
			return
		}
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	})

	mux.HandleFunc("/api/settings/test-smtp", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, _ string) {
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
	}))

	mux.HandleFunc("/api/whatsapp/qr", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, _ string) {
		cfg, _ := GetRawSettings()
		refresh := r.URL.Query().Get("refresh") == "1" || r.URL.Query().Get("refresh") == "true"
		qrData := FetchWhatsAppQR(cfg, refresh)
		pub, _ := GetPublicSettings()
		writeJSON(w, 200, map[string]any{
			"paired":          qrData.Paired,
			"connected":       qrData.Connected,
			"bridgeReachable": qrData.BridgeReachable,
			"engine":          qrData.Engine,
			"sessionCode":     qrData.SessionCode,
			"qrSvg":           qrData.QRSvg,
			"deviceName":      qrData.DeviceName,
			"bridgeUrl":       qrData.BridgeURL,
			"pairedPhone":     qrData.PairedPhone,
			"pairedAt":        qrData.PairedAt,
			"error":           qrData.Error,
			"settings":        pub,
		})
	}))

	mux.HandleFunc("/api/whatsapp/status", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, _ string) {
		cfg, _ := GetRawSettings()
		qrData := FetchWhatsAppQR(cfg, false)
		pub, _ := GetPublicSettings()
		writeJSON(w, 200, map[string]any{
			"paired":          qrData.Paired,
			"connected":       qrData.Connected,
			"bridgeReachable": qrData.BridgeReachable,
			"engine":          qrData.Engine,
			"sessionCode":     qrData.SessionCode,
			"qrSvg":           qrData.QRSvg,
			"deviceName":      qrData.DeviceName,
			"bridgeUrl":       qrData.BridgeURL,
			"pairedPhone":     qrData.PairedPhone,
			"pairedAt":        qrData.PairedAt,
			"error":           qrData.Error,
			"settings":        pub,
		})
	}))

	mux.HandleFunc("/api/whatsapp/reconnect", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, _ string) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		cfg, _ := GetRawSettings()
		qrData := ReconnectWhatsApp(cfg)
		pub, _ := GetPublicSettings()
		writeJSON(w, 200, map[string]any{
			"ok":       true,
			"qrData":   qrData,
			"settings": pub,
		})
	}))

	mux.HandleFunc("/api/whatsapp/pair-confirm", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, _ string) {
		cfg, _ := GetRawSettings()
		var body struct {
			SessionCode string `json:"sessionCode"`
			Phone       string `json:"phone"`
			PairedPhone string `json:"pairedPhone"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		phone := defaultStr(strings.TrimSpace(body.Phone), strings.TrimSpace(body.PairedPhone))
		updated := ConfirmWhatsAppPairingInDB(cfg, strings.TrimSpace(body.SessionCode), phone)
		if updated == nil {
			writeJSON(w, 404, map[string]any{"ok": false, "error": "Active QR session not found or expired."})
			return
		}
		pub, _ := GetPublicSettings()
		writeJSON(w, 200, map[string]any{"ok": true, "qrData": updated, "settings": pub})
	}))

	mux.HandleFunc("/api/whatsapp/unlink", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, _ string) {
		cfg, _ := GetRawSettings()
		qrData := UnlinkWhatsAppSession(cfg)
		pub, _ := GetPublicSettings()
		writeJSON(w, 200, map[string]any{"ok": true, "qrData": qrData, "settings": pub})
	}))

	mux.HandleFunc("/api/audit", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, _ string) {
		logs, _ := GetAuditLogs()
		writeJSON(w, 200, logs)
	}))

	distFS, err := fs.Sub(embeddedFrontend, "dist")
	if err != nil {
		log.Fatalf("Embedded dist missing: %v", err)
	}
	fileServer := http.FileServer(http.FS(distFS))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		cleanPath := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if cleanPath == "" {
			cleanPath = "index.html"
		}
		if f, openErr := distFS.Open(cleanPath); openErr == nil {
			_ = f.Close()
			if ext := path.Ext(cleanPath); ext != "" {
				if ct := mime.TypeByExtension(ext); ct != "" {
					w.Header().Set("Content-Type", ct)
				}
			}
			fileServer.ServeHTTP(w, r)
			return
		}
		indexBytes, readErr := fs.ReadFile(distFS, "index.html")
		if readErr != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(indexBytes)
	})

	log.Printf("NSSF Digital Member Statement Dispatch (Go service) running on http://0.0.0.0:%s", port)
	log.Fatal(http.ListenAndServe("0.0.0.0:"+port, requestLoggerMiddleware(mux)))
}

type loggingResponseWriter struct {
	http.ResponseWriter
	statusCode   int
	wroteHeader  bool
	bytesWritten int64
}

func (lrw *loggingResponseWriter) WriteHeader(code int) {
	if lrw.wroteHeader {
		return
	}
	lrw.statusCode = code
	lrw.wroteHeader = true
	lrw.ResponseWriter.WriteHeader(code)
}

func (lrw *loggingResponseWriter) Write(b []byte) (int, error) {
	if !lrw.wroteHeader {
		lrw.WriteHeader(http.StatusOK)
	}
	n, err := lrw.ResponseWriter.Write(b)
	lrw.bytesWritten += int64(n)
	return n, err
}

func (lrw *loggingResponseWriter) Flush() {
	if flusher, ok := lrw.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (lrw *loggingResponseWriter) Unwrap() http.ResponseWriter {
	return lrw.ResponseWriter
}

func requestLoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		lrw := &loggingResponseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}

		next.ServeHTTP(lrw, r)

		duration := time.Since(start).Round(100 * time.Microsecond)
		target := r.URL.Path
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}

		ip := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0])
		if ip == "" {
			ip = ClientIP(r)
		}

		kind := "HTTP"
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/api" {
			kind = "API"
		}

		log.Printf("[%s] %s %s -> %d (%s, %dB) ip=%s", kind, r.Method, target, lrw.statusCode, duration, lrw.bytesWritten, ip)
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
