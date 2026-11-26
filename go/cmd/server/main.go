package main

import (
	"bufio"
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Build-time application metadata (overridden via -ldflags during packaging).
var (
	appName      = "NSSF Digital Statement Dispatcher"
	appPublisher = "National Social Security Fund (NSSF) Kenya"
	appVersion   = "1.0.0"
	buildCommit  = "dev"
	buildDate    = "unknown"
)

//go:embed dist/*
var embeddedFrontend embed.FS

//go:embed nssf-dispatch.png
var embeddedIconPNG []byte

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

func isInitialSetupDone() bool {
	return strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE")) != "" || HasAdminAccount()
}

func runSelfInstall() {
	if runtime.GOOS != "linux" {
		fmt.Printf("Desktop self-installer is designed for Linux/Ubuntu. On %s, run the executable or installer package directly.\n", runtime.GOOS)
		return
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		log.Fatalf("Cannot determine home directory: %v", err)
	}
	exePath, err := os.Executable()
	if err != nil {
		log.Fatalf("Cannot locate running executable: %v", err)
	}
	if resolved, err := filepath.EvalSymlinks(exePath); err == nil {
		exePath = resolved
	}

	binDir := filepath.Join(home, ".local", "bin")
	appDir := filepath.Join(home, ".local", "share", "applications")
	iconDir := filepath.Join(home, ".local", "share", "icons", "hicolor", "512x512", "apps")
	for _, d := range []string{binDir, appDir, iconDir} {
		if err := os.MkdirAll(d, 0755); err != nil {
			log.Fatalf("Failed to create directory %s: %v", d, err)
		}
	}

	targetBin := filepath.Join(binDir, "nssf-statement-dispatch")
	if exePath != targetBin {
		data, err := os.ReadFile(exePath)
		if err != nil {
			log.Fatalf("Failed to read binary %s: %v", exePath, err)
		}
		if err := os.WriteFile(targetBin, data, 0755); err != nil {
			log.Fatalf("Failed to install binary to %s: %v", targetBin, err)
		}
	}
	_ = os.Chmod(targetBin, 0755)

	iconPath := filepath.Join(iconDir, "nssf-dispatch.png")
	if len(embeddedIconPNG) > 0 {
		if err := os.WriteFile(iconPath, embeddedIconPNG, 0644); err != nil {
			log.Fatalf("Failed to write icon %s: %v", iconPath, err)
		}
	}

	desktopContent := fmt.Sprintf(`[Desktop Entry]
Type=Application
Name=%s
GenericName=Member Statement Dispatch Portal
Comment=Validate, password-protect, and securely dispatch NSSF member statements
Exec=%s
Icon=%s
Terminal=false
Categories=Office;Finance;
StartupNotify=true
X-Publisher=%s
`, appName, targetBin, iconPath, appPublisher)

	desktopPath := filepath.Join(appDir, "nssf-dispatch.desktop")
	if err := os.WriteFile(desktopPath, []byte(desktopContent), 0755); err != nil {
		log.Fatalf("Failed to write desktop entry %s: %v", desktopPath, err)
	}

	// Also add a Desktop shortcut if ~/Desktop exists
	userDesktop := filepath.Join(home, "Desktop")
	if st, err := os.Stat(userDesktop); err == nil && st.IsDir() {
		shortcutPath := filepath.Join(userDesktop, "nssf-dispatch.desktop")
		_ = os.WriteFile(shortcutPath, []byte(desktopContent), 0755)
		if gio, err := exec.LookPath("gio"); err == nil {
			_ = exec.Command(gio, "set", shortcutPath, "metadata::trusted", "true").Run()
		}
	}

	if upd, err := exec.LookPath("update-desktop-database"); err == nil {
		_ = exec.Command(upd, appDir).Run()
	}
	if gtk, err := exec.LookPath("gtk-update-icon-cache"); err == nil {
		_ = exec.Command(gtk, "-f", "-t", filepath.Join(home, ".local", "share", "icons", "hicolor")).Run()
	}

	fmt.Printf("Installed %s:\n", appName)
	fmt.Printf("  Binary:   %s\n", targetBin)
	fmt.Printf("  Launcher: %s\n", desktopPath)
	fmt.Printf("  Icon:     %s\n", iconPath)
	fmt.Printf("  Data Dir: %s\n", getAppDataDir())
	fmt.Println("\nYou can now launch it from Ubuntu Applications or run: nssf-statement-dispatch")
}

func runSelfUninstall() {
	if runtime.GOOS == "linux" {
		if home, err := os.UserHomeDir(); err == nil && home != "" {
			_ = os.Remove(filepath.Join(home, ".local", "bin", "nssf-statement-dispatch"))
			_ = os.Remove(filepath.Join(home, ".local", "share", "applications", "nssf-dispatch.desktop"))
			_ = os.Remove(filepath.Join(home, ".local", "share", "icons", "hicolor", "512x512", "apps", "nssf-dispatch.png"))
			_ = os.Remove(filepath.Join(home, "Desktop", "nssf-dispatch.desktop"))
			if upd, err := exec.LookPath("update-desktop-database"); err == nil {
				_ = exec.Command(upd, filepath.Join(home, ".local", "share", "applications")).Run()
			}
		}
		fmt.Println("Removed user desktop launcher and binary from ~/.local/")
	}

	removedDirs, rmErr := CleanupUserDataDirs()
	for _, d := range removedDirs {
		fmt.Printf("Removed stored application data directory: %s\n", d)
	}
	if rmErr != nil {
		log.Printf("Warning: some application data files could not be removed: %v", rmErr)
	}
}

func openBrowser(url string) {
	var candidates []*exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		candidates = append(candidates, exec.Command("open", url))
	case "windows":
		candidates = append(candidates, exec.Command("rundll32", "url.dll,FileProtocolHandler", url))
	default:
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return
		}
		for _, bin := range []string{"xdg-open", "gio", "sensible-browser", "google-chrome", "chromium", "firefox"} {
			if p, err := exec.LookPath(bin); err == nil {
				if bin == "gio" {
					candidates = append(candidates, exec.Command(p, "open", url))
				} else {
					candidates = append(candidates, exec.Command(p, url))
				}
				break
			}
		}
	}
	for _, cmd := range candidates {
		cmd.Stdin = nil
		cmd.Stdout = nil
		cmd.Stderr = nil
		if err := cmd.Start(); err == nil {
			go func(c *exec.Cmd) { _ = c.Wait() }(cmd)
			return
		}
	}
}

func waitForLocalServer(healthURL string, timeout time.Duration) bool {
	client := &http.Client{Timeout: 400 * time.Millisecond}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := client.Get(healthURL)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return true
			}
		}
		time.Sleep(60 * time.Millisecond)
	}
	return false
}

func isOwnInstanceRunning(port string) bool {
	client := &http.Client{Timeout: 600 * time.Millisecond}
	resp, err := client.Get("http://127.0.0.1:" + port + "/api/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var payload map[string]any
	if json.NewDecoder(resp.Body).Decode(&payload) != nil {
		return false
	}
	engine, _ := payload["engine"].(string)
	return engine == "go"
}

func runCLIAdminReset() {
	reader := bufio.NewReader(os.Stdin)
	fmt.Printf("=== %s — Local Administrator Recovery ===\n", appName)
	fmt.Printf("Data directory: %s\n", getAppDataDir())

	username := strings.TrimSpace(os.Getenv("NSSF_RESET_USER"))
	if username == "" {
		fmt.Print("New Administrator Username [admin]: ")
		line, _ := reader.ReadString('\n')
		username = strings.TrimSpace(line)
		if username == "" {
			username = "admin"
		}
	}
	if !usernameRe.MatchString(username) {
		log.Fatalf("Invalid username: must be 3 to 64 characters (letters, numbers, ., _, @, -).")
	}

	recoveryEmail := strings.TrimSpace(os.Getenv("NSSF_RESET_EMAIL"))
	if recoveryEmail == "" && os.Getenv("NSSF_RESET_PASS") == "" {
		fmt.Print("Recovery Email (optional, press Enter to skip): ")
		line, _ := reader.ReadString('\n')
		recoveryEmail = strings.TrimSpace(line)
	}
	if recoveryEmail != "" && !emailRe.MatchString(recoveryEmail) {
		log.Fatalf("Invalid recovery email address.")
	}

	password := os.Getenv("NSSF_RESET_PASS")
	if password == "" {
		fmt.Print("New Administrator Password (min 8 chars): ")
		line, _ := reader.ReadString('\n')
		password = strings.TrimRight(line, "\r\n")
	}
	if len(password) < 8 || len(password) > 128 {
		log.Fatalf("Invalid password: must be between 8 and 128 characters.")
	}

	acc, recKey, err := UpsertAdminFromCLI(username, password, recoveryEmail)
	if err != nil {
		log.Fatalf("Failed to update administrator account: %v", err)
	}
	RevokeAllAdminSessions()
	fmt.Printf("\nAdministrator account updated for username: %s\n", acc.Username)
	fmt.Printf("New Backup Recovery Key (save securely): %s\n", recKey)
}

func main() {
	showVersion := false
	showVersionShort := false
	openUI := true
	noOpenUI := false
	resetAdmin := false
	installApp := false
	uninstallApp := false
	cleanupData := false
	flag.BoolVar(&showVersion, "version", false, "Print application version and publisher metadata")
	flag.BoolVar(&showVersionShort, "v", false, "Print application version and publisher metadata")
	flag.BoolVar(&openUI, "open", true, "Open the portal in the default web browser after startup")
	flag.BoolVar(&noOpenUI, "no-open", false, "Do not automatically open the web browser on startup")
	flag.BoolVar(&resetAdmin, "reset-admin", false, "Reset the local administrator credentials via terminal prompt")
	flag.BoolVar(&installApp, "install", false, "Install desktop launcher, icon, and user binary (Linux/Ubuntu)")
	flag.BoolVar(&uninstallApp, "uninstall", false, "Remove user desktop launcher, binary, and stored user data")
	flag.BoolVar(&cleanupData, "cleanup-data", false, "Remove stored database and config files from user data folders")
	flag.Parse()

	if showVersion || showVersionShort {
		fmt.Printf("%s v%s\nPublisher: %s\nCommit: %s\nBuilt: %s\nTarget: %s/%s\n",
			appName, appVersion, appPublisher, buildCommit, buildDate, runtime.GOOS, runtime.GOARCH)
		return
	}

	if installApp {
		runSelfInstall()
		return
	}
	if uninstallApp {
		runSelfUninstall()
		return
	}
	if cleanupData {
		_, _ = CleanupUserDataDirs()
		return
	}

	if err := InitDB(); err != nil {
		log.Fatalf("Database init failed: %v", err)
	}

	if resetAdmin {
		runCLIAdminReset()
		return
	}

	if startupCfg, err := GetRawSettings(); err == nil {
		InitWhatsApp(startupCfg)
	}

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}

	shouldAutoOpen := openUI && !noOpenUI && os.Getenv("NSSF_NO_BROWSER") != "1"

	mux := http.NewServeMux()

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"ok":               true,
			"name":             appName,
			"publisher":        appPublisher,
			"version":          appVersion,
			"commit":           buildCommit,
			"buildDate":        buildDate,
			"engine":           "go",
			"runtime":          "go-net-http",
			"port":             port,
			"sqliteCliBackend": hasSQLiteCLI(),
		})
	})

	mux.HandleFunc("/api/system/runtime", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"ok":           true,
			"name":         appName,
			"publisher":    appPublisher,
			"version":      appVersion,
			"commit":       buildCommit,
			"buildDate":    buildDate,
			"activeEngine": "go",
			"goEngineInfo": map[string]any{
				"engine":           "go",
				"version":          appVersion,
				"publisher":        appPublisher,
				"sqliteCliBackend": hasSQLiteCLI(),
			},
		})
	})

	mux.HandleFunc("/api/verify-statement-file", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !isInitialSetupDone() {
			writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": "Initial administrator setup is required before using the Service Desk."})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
		if err := r.ParseMultipartForm(15 << 20); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid multipart upload"})
			return
		}
		file, _, err := r.FormFile("statement")
		if err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please upload a member statement PDF."})
			return
		}
		defer file.Close()
		rawPDF, _ := io.ReadAll(file)
		if err := VerifyNSSFStatementFile(rawPDF); err != nil {
			writeJSON(w, 422, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	})

	mux.HandleFunc("/api/validate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !isInitialSetupDone() {
			writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": "Initial administrator setup is required before using the Service Desk."})
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
		if !isInitialSetupDone() {
			writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": "Initial administrator setup is required before using the Service Desk."})
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
		if (channel == "email" || channel == "both") && !cfg.EmailConfigured {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Email (SMTP) is not set up yet. Configure SMTP host, username, and password in System Settings first."})
			return
		}
		if (channel == "whatsapp" || channel == "both") && !cfg.WhatsAppEnabled {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "WhatsApp dispatch is disabled in System Settings."})
			return
		}
		if (channel == "whatsapp" || channel == "both") && !cfg.WhatsAppPaired {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "WhatsApp is not set up yet. Pair a WhatsApp device via QR code in System Settings first."})
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
		acc, _ := GetAdminAccount()
		adminExists := envConfigured || acc != nil
		valid, username := VerifyAdminSessionToken(ExtractBearerToken(r))
		var userVal any = nil
		var recoveryEmailVal any = nil
		if valid && username != "" {
			userVal = username
			if acc != nil {
				recoveryEmailVal = acc.RecoveryEmail
			}
		}
		cfg, _ := GetRawSettings()
		smtpConfigured := strings.TrimSpace(cfg.SMTPHost) != "" && strings.TrimSpace(cfg.SMTPUser) != "" && strings.TrimSpace(cfg.SMTPPass) != ""
		writeJSON(w, 200, map[string]any{
			"adminExists":           adminExists,
			"authenticated":         valid,
			"username":              userVal,
			"envPasscodeConfigured": envConfigured,
			"hasRecoveryEmail":      acc != nil && strings.TrimSpace(acc.RecoveryEmail) != "",
			"hasRecoveryKey":        acc != nil && strings.TrimSpace(acc.RecoveryHash) != "",
			"smtpConfigured":        smtpConfigured,
			"recoveryEmail":         recoveryEmailVal,
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
			Username      string `json:"username"`
			Password      string `json:"password"`
			RecoveryEmail string `json:"recoveryEmail"`
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
		recoveryEmail := strings.TrimSpace(body.RecoveryEmail)
		if recoveryEmail != "" && !emailRe.MatchString(recoveryEmail) {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please enter a valid recovery email address."})
			return
		}
		if len(body.Password) < 8 || len(body.Password) > 128 {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Admin password must be between 8 and 128 characters."})
			return
		}
		created, recoveryKey, err := CreateInitialAdmin(username, body.Password, recoveryEmail)
		if err != nil {
			writeJSON(w, 409, map[string]any{"ok": false, "error": "Administrator setup already completed. Please sign in."})
			return
		}
		token := CreateAdminSessionToken(created.Username)
		pub, _ := GetPublicSettings()
		writeJSON(w, 201, map[string]any{
			"ok":            true,
			"token":         token,
			"username":      created.Username,
			"recoveryEmail": created.RecoveryEmail,
			"recoveryKey":   recoveryKey,
			"settings":      pub,
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
		acc, _ := GetAdminAccount()
		recEmail := ""
		if acc != nil {
			recEmail = acc.RecoveryEmail
		}
		writeJSON(w, 200, map[string]any{
			"ok":            true,
			"token":         token,
			"username":      matchedUser,
			"recoveryEmail": recEmail,
			"settings":      pub,
		})
	})

	mux.HandleFunc("/api/auth/forgot-password", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE")) != "" {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Server passcode is managed via NSSF_ADMIN_PASSCODE environment variable."})
			return
		}
		ip := ClientIP(r)
		allowed, retryAfter := CheckLoginRateLimit(ip)
		if !allowed {
			writeJSON(w, 429, map[string]any{"ok": false, "error": fmt.Sprintf("Too many recovery requests. Try again in %d seconds.", retryAfter)})
			return
		}
		var body struct {
			Username      string `json:"username"`
			RecoveryEmail string `json:"recoveryEmail"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid JSON body."})
			return
		}
		username := strings.TrimSpace(body.Username)
		recoveryEmail := strings.TrimSpace(body.RecoveryEmail)
		if username == "" || !emailRe.MatchString(recoveryEmail) {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please enter both your administrator username and recovery email address."})
			return
		}

		acc, _ := GetAdminAccount()
		cfg, _ := GetRawSettings()
		genericMsg := "If the administrator username and recovery email match our records and SMTP is configured, a password reset code has been sent."

		if acc != nil &&
			strings.EqualFold(acc.Username, username) &&
			acc.RecoveryEmail != "" &&
			strings.EqualFold(acc.RecoveryEmail, recoveryEmail) &&
			strings.TrimSpace(cfg.SMTPHost) != "" &&
			strings.TrimSpace(cfg.SMTPUser) != "" {
			code, cooldownSec, ok := CreatePasswordResetCode()
			if !ok {
				writeJSON(w, 429, map[string]any{"ok": false, "error": fmt.Sprintf("Please wait %d seconds before requesting another reset code.", cooldownSec)})
				return
			}
			subject := fmt.Sprintf("%s — Administrator Password Reset Code", appName)
			emailBody := fmt.Sprintf(
				"NSSF Digital Statement Dispatch — Administrator Password Reset\n\n"+
					"A password reset was requested for administrator account: %s\n\n"+
					"Verification Code: %s\n"+
					"This code expires in 15 minutes and can only be used once.\n\n"+
					"If you did not request this reset, ignore this message and review local workstation access.",
				acc.Username, code,
			)
			if err := SendPlainTextEmail(cfg, acc.RecoveryEmail, subject, emailBody); err != nil {
				log.Printf("[AUTH] Failed to send admin reset email: %v", err)
				writeJSON(w, 502, map[string]any{"ok": false, "error": "Failed to deliver verification code via SMTP. Use your Backup Recovery Key instead."})
				return
			}
		}

		writeJSON(w, 200, map[string]any{"ok": true, "message": genericMsg})
	})

	mux.HandleFunc("/api/auth/reset-password", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE")) != "" {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Server passcode is managed via NSSF_ADMIN_PASSCODE environment variable."})
			return
		}
		ip := ClientIP(r)
		allowed, retryAfter := CheckLoginRateLimit(ip)
		if !allowed {
			writeJSON(w, 429, map[string]any{"ok": false, "error": fmt.Sprintf("Too many failed attempts. Try again in %d seconds.", retryAfter)})
			return
		}
		var body struct {
			Method      string `json:"method"`
			Username    string `json:"username"`
			Code        string `json:"code"`
			RecoveryKey string `json:"recoveryKey"`
			NewPassword string `json:"newPassword"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid JSON body."})
			return
		}
		username := strings.TrimSpace(body.Username)
		if !usernameRe.MatchString(username) {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please enter a valid administrator username."})
			return
		}
		if len(body.NewPassword) < 8 || len(body.NewPassword) > 128 {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "New password must be between 8 and 128 characters."})
			return
		}
		acc, _ := GetAdminAccount()
		if acc == nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "No administrator account exists yet."})
			return
		}

		method := strings.TrimSpace(body.Method)
		if method == "email_code" {
			if !strings.EqualFold(acc.Username, username) {
				RecordFailedLogin(ip)
				writeJSON(w, 401, map[string]any{"ok": false, "error": "Invalid username or verification code."})
				return
			}
			ok, msg := VerifyAndConsumePasswordResetCode(body.Code)
			if !ok {
				RecordFailedLogin(ip)
				writeJSON(w, 401, map[string]any{"ok": false, "error": msg})
				return
			}
		} else if method == "recovery_key" {
			if !VerifyAdminRecoveryKey(username, body.RecoveryKey) {
				RecordFailedLogin(ip)
				writeJSON(w, 401, map[string]any{"ok": false, "error": "Invalid administrator username or backup recovery key."})
				return
			}
		} else {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid password reset method."})
			return
		}

		if err := UpdateAdminPassword(body.NewPassword); err != nil {
			writeJSON(w, 500, map[string]any{"ok": false, "error": "Failed to update administrator password."})
			return
		}
		ClearFailedLogins(ip)
		RevokeAllAdminSessions()
		writeJSON(w, 200, map[string]any{
			"ok":      true,
			"message": "Administrator password updated. Sign in with your new password.",
		})
	})

	mux.HandleFunc("/api/auth/change-credentials", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, currentUser string) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE")) != "" {
			writeJSON(w, 409, map[string]any{"ok": false, "error": "Credentials are controlled by the NSSF_ADMIN_PASSCODE environment variable."})
			return
		}
		var body struct {
			CurrentPassword string `json:"currentPassword"`
			NewUsername     string `json:"newUsername"`
			RecoveryEmail   string `json:"recoveryEmail"`
			NewPassword     string `json:"newPassword"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid JSON body."})
			return
		}
		acc, _ := GetAdminAccount()
		if acc == nil {
			writeJSON(w, 404, map[string]any{"ok": false, "error": "Administrator account not found."})
			return
		}
		if body.CurrentPassword == "" || !VerifyPasswordHash(body.CurrentPassword, acc.PasswordHash, acc.PasswordSalt) {
			writeJSON(w, 401, map[string]any{"ok": false, "error": "Current password is incorrect."})
			return
		}
		newUser := strings.TrimSpace(body.NewUsername)
		if newUser == "" {
			newUser = acc.Username
		}
		if !usernameRe.MatchString(newUser) {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Username must be 3 to 64 characters (letters, numbers, ., _, @, -)."})
			return
		}
		recEmail := strings.TrimSpace(body.RecoveryEmail)
		if recEmail != "" && !emailRe.MatchString(recEmail) {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please enter a valid recovery email address."})
			return
		}
		if body.NewPassword != "" && (len(body.NewPassword) < 8 || len(body.NewPassword) > 128) {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "New password must be between 8 and 128 characters."})
			return
		}

		updated, err := UpdateAdminCredentials(newUser, recEmail, body.NewPassword)
		if err != nil {
			writeJSON(w, 500, map[string]any{"ok": false, "error": "Failed to update administrator credentials."})
			return
		}
		RevokeAllAdminSessions()
		newToken := CreateAdminSessionToken(updated.Username)
		writeJSON(w, 200, map[string]any{
			"ok":            true,
			"token":         newToken,
			"username":      updated.Username,
			"recoveryEmail": updated.RecoveryEmail,
			"message":       "Administrator credentials updated successfully.",
		})
	}))

	mux.HandleFunc("/api/auth/regenerate-recovery-key", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, _ string) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE")) != "" {
			writeJSON(w, 409, map[string]any{"ok": false, "error": "Recovery key is unavailable while NSSF_ADMIN_PASSCODE is active."})
			return
		}
		var body struct {
			CurrentPassword string `json:"currentPassword"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid JSON body."})
			return
		}
		acc, _ := GetAdminAccount()
		if acc == nil || body.CurrentPassword == "" || !VerifyPasswordHash(body.CurrentPassword, acc.PasswordHash, acc.PasswordSalt) {
			writeJSON(w, 401, map[string]any{"ok": false, "error": "Current password is incorrect."})
			return
		}
		recKey, err := RegenerateAdminRecoveryKey()
		if err != nil {
			writeJSON(w, 500, map[string]any{"ok": false, "error": "Failed to regenerate backup recovery key."})
			return
		}
		writeJSON(w, 200, map[string]any{
			"ok":          true,
			"recoveryKey": recKey,
		})
	}))

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

	ln, err := net.Listen("tcp", "0.0.0.0:"+port)
	if err != nil {
		if isOwnInstanceRunning(port) {
			targetURL := "http://127.0.0.1:" + port
			log.Printf("%s is already running on %s — opening browser.", appName, targetURL)
			if shouldAutoOpen {
				openBrowser(targetURL)
			}
			return
		}
		log.Fatalf("Failed to bind port %s: %v", port, err)
	}

	targetURL := "http://127.0.0.1:" + port
	log.Printf("%s v%s (%s) listening on %s (data: %s)", appName, appVersion, appPublisher, targetURL, getAppDataDir())
	if shouldAutoOpen {
		go func() {
			waitForLocalServer(targetURL+"/api/health", 2*time.Second)
			openBrowser(targetURL)
		}()
	}

	log.Fatal(http.Serve(ln, requestLoggerMiddleware(mux)))
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
