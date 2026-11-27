package main

import (
	"bufio"
	"context"
	"embed"
	"encoding/json"
	"errors"
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
	"time"
)

// Build-time application metadata (overridden via -ldflags during packaging).
var (
	appName      = "NSSF Digital Statement Dispatcher"
	appPublisher = "National Social Security Fund (NSSF) Kenya"
	appVersion   = "1.0.0"
	buildCommit  = "dev"
	buildDate    = "unknown"
	githubRepo   = ""
)

//go:embed dist/*
var embeddedFrontend embed.FS

//go:embed nssf-dispatch.png
var embeddedIconPNG []byte

//go:embed nssf-logo.png
var embeddedLogoPNG []byte

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
	runUpdate := false
	waitRestart := false
	flag.BoolVar(&showVersion, "version", false, "Print application version and publisher metadata")
	flag.BoolVar(&showVersionShort, "v", false, "Print application version and publisher metadata")
	flag.BoolVar(&openUI, "open", true, "Open the portal in the default web browser after startup")
	flag.BoolVar(&noOpenUI, "no-open", false, "Do not automatically open the web browser on startup")
	flag.BoolVar(&resetAdmin, "reset-admin", false, "Reset the local administrator credentials via terminal prompt")
	flag.BoolVar(&installApp, "install", false, "Install desktop launcher, icon, and user binary (Linux/Ubuntu)")
	flag.BoolVar(&uninstallApp, "uninstall", false, "Remove user desktop launcher, binary, and stored user data")
	flag.BoolVar(&cleanupData, "cleanup-data", false, "Remove stored database and config files from user data folders")
	flag.BoolVar(&runUpdate, "update", false, "Check GitHub Releases and self-update to the latest version")
	flag.BoolVar(&waitRestart, "wait-restart", false, "Wait briefly for previous instance port release after self-update")
	flag.Parse()

	cleanupOldExecutableBackup()

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

	LogSystemAudit("SYSTEM", "System", "", "SYSTEM", appName, "", "SYSTEM_STARTED", fmt.Sprintf("Application service started (v%s)", strings.TrimPrefix(appVersion, "v")))

	if runUpdate {
		RunCLIUpdate()
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
				"commit":           buildCommit,
				"buildDate":        buildDate,
				"os":               runtime.GOOS,
				"arch":             runtime.GOARCH,
				"publisher":        appPublisher,
				"sqliteCliBackend": hasSQLiteCLI(),
			},
		})
	})

	mux.HandleFunc("/api/system/update/status", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, _ string) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		writeJSON(w, 200, GetUpdateStatusSnapshot())
	}))

	mux.HandleFunc("/api/system/update/check", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, actor string) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		defer cancel()
		st := CheckForUpdates(ctx)
		ip := RealClientIP(r)
		if st.State == "error" {
			LogSystemAudit("SYSTEM", actor, ip, "UPDATES", st.Repo, "", "UPDATE_CHECK_FAILED", st.Message)
		} else if st.UpdateAvailable {
			LogSystemAudit("SYSTEM", actor, ip, "UPDATES", st.Repo, st.AssetName, "UPDATE_AVAILABLE", st.Message)
		} else {
			LogSystemAudit("SYSTEM", actor, ip, "UPDATES", st.Repo, "", "UPDATE_CHECKED", st.Message)
		}
		writeJSON(w, 200, st)
	}))

	mux.HandleFunc("/api/system/update/apply", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, _ string) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		st := ApplySelfUpdate(ctx, true)
		if st.State == "error" {
			statusCode := http.StatusBadGateway
			if st.RequiresElevation {
				statusCode = http.StatusForbidden
			}
			writeJSON(w, statusCode, map[string]any{
				"ok":                false,
				"error":             st.Message,
				"status":            st,
				"requiresElevation": st.RequiresElevation,
			})
			return
		}
		writeJSON(w, 200, map[string]any{
			"ok":     true,
			"status": st,
		})
	}))

	mux.HandleFunc("/api/verify-statement-file", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ip := RealClientIP(r)
		if !isInitialSetupDone() {
			msg := "Initial administrator setup is required before using the Service Desk."
			LogSystemAudit("DISPATCH", "Service Desk", ip, "VALIDATION", "", "", "VERIFY_FAILED", msg)
			writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": msg})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
		if err := r.ParseMultipartForm(15 << 20); err != nil {
			LogSystemAudit("DISPATCH", "Service Desk", ip, "VALIDATION", "", "", "VERIFY_FAILED", "Invalid multipart upload during file check")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid multipart upload"})
			return
		}
		file, header, err := r.FormFile("statement")
		if err != nil {
			LogSystemAudit("DISPATCH", "Service Desk", ip, "VALIDATION", "", "", "VERIFY_FAILED", "Statement file check attempted without a PDF upload")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please upload a member statement PDF."})
			return
		}
		defer file.Close()
		rawPDF, readErr := io.ReadAll(file)
		if readErr != nil {
			LogSystemAudit("DISPATCH", "Service Desk", ip, "VALIDATION", "", header.Filename, "VERIFY_FAILED", "Failed to read uploaded PDF: "+readErr.Error())
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Failed to read uploaded statement PDF."})
			return
		}
		if err := VerifyNSSFStatementFile(rawPDF); err != nil {
			LogSystemAudit("DISPATCH", "Service Desk", ip, "VALIDATION", "", header.Filename, "VERIFY_FAILED", err.Error())
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
		ip := RealClientIP(r)
		if !isInitialSetupDone() {
			msg := "Initial administrator setup is required before using the Service Desk."
			LogSystemAudit("DISPATCH", "Service Desk", ip, "VALIDATION", "", "", "VALIDATION_FAILED", msg)
			writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": msg})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
		if err := r.ParseMultipartForm(15 << 20); err != nil {
			LogSystemAudit("DISPATCH", "Service Desk", ip, "VALIDATION", "", "", "VALIDATION_FAILED", "Invalid multipart upload during statement validation")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid multipart upload"})
			return
		}
		memberNo := strings.TrimSpace(r.FormValue("memberNo"))
		file, header, err := r.FormFile("statement")
		if err != nil {
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     "VALIDATION",
				Status:      "VALIDATION_FAILED",
				Details:     "Validation attempted without uploading a statement PDF",
			})
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please upload a member statement PDF."})
			return
		}
		defer file.Close()
		rawPDF, readErr := io.ReadAll(file)
		if readErr != nil {
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     "VALIDATION",
				RenamedFile: header.Filename,
				Status:      "VALIDATION_FAILED",
				Details:     "Failed to read uploaded statement PDF: " + readErr.Error(),
			})
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Failed to read uploaded statement PDF."})
			return
		}

		meta, err := ExtractAndValidatePDF(rawPDF, memberNo)
		if err != nil {
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     "VALIDATION",
				RenamedFile: header.Filename,
				Status:      "VALIDATION_FAILED",
				Details:     err.Error(),
			})
			writeJSON(w, 422, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		cfg, _ := GetRawSettings()
		renamed := buildRenamedFile(cfg.FilenameTemplate, meta.MemberNo)
		_ = InsertAuditEvent(AuditEvent{
			EventType:   "DISPATCH",
			Actor:       "Service Desk",
			SourceIP:    ip,
			MemberNo:    meta.MemberNo,
			MemberName:  meta.MemberName,
			Channel:     "VALIDATION",
			RenamedFile: renamed,
			Status:      "VALIDATED",
			Details:     fmt.Sprintf("Statement verified and matched (Source: %s, Period: %s)", header.Filename, meta.Period),
		})
		writeJSON(w, 200, map[string]any{
			"ok":          true,
			"meta":        meta,
			"renamedFile": renamed,
		})
	})

	mux.HandleFunc("/api/dispatch", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ip := RealClientIP(r)
		if !isInitialSetupDone() {
			msg := "Initial administrator setup is required before using the Service Desk."
			LogSystemAudit("DISPATCH", "Service Desk", ip, "DISPATCH", "", "", "FAILED", msg)
			writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": msg})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
		if err := r.ParseMultipartForm(15 << 20); err != nil {
			LogSystemAudit("DISPATCH", "Service Desk", ip, "DISPATCH", "", "", "FAILED", "Invalid form upload during dispatch: "+err.Error())
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid form upload"})
			return
		}

		memberNo := strings.TrimSpace(r.FormValue("memberNo"))
		channel := strings.TrimSpace(r.FormValue("channel"))
		if channel == "" {
			channel = "email"
		}
		email := strings.TrimSpace(r.FormValue("email"))
		whatsapp := strings.TrimSpace(r.FormValue("whatsapp"))
		destSummary := strings.Trim(email+" / "+whatsapp, " /")

		if channel != "email" && channel != "whatsapp" && channel != "both" {
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     strings.ToUpper(channel),
				Destination: destSummary,
				Status:      "FAILED",
				Details:     "Invalid dispatch channel selected: " + channel,
			})
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid dispatch channel selected."})
			return
		}

		file, header, err := r.FormFile("statement")
		if err != nil {
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     strings.ToUpper(channel),
				Destination: destSummary,
				Status:      "FAILED",
				Details:     "Statement PDF upload is required for dispatch",
			})
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Statement PDF upload is required."})
			return
		}
		defer file.Close()
		rawPDF, readErr := io.ReadAll(file)
		if readErr != nil {
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     strings.ToUpper(channel),
				Destination: destSummary,
				RenamedFile: header.Filename,
				Status:      "FAILED",
				Details:     "Failed to read uploaded statement PDF: " + readErr.Error(),
			})
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Failed to read uploaded statement PDF: " + readErr.Error()})
			return
		}

		if (channel == "email" || channel == "both") && !emailRe.MatchString(email) {
			msg := "Please enter a valid member email address."
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     "EMAIL",
				Destination: email,
				RenamedFile: header.Filename,
				Status:      "VALIDATION_FAILED",
				Details:     msg,
			})
			writeJSON(w, 400, map[string]any{"ok": false, "error": msg})
			return
		}
		if (channel == "whatsapp" || channel == "both") && countDigits(whatsapp) < 9 {
			msg := "Please enter a valid member WhatsApp phone number."
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     "WHATSAPP",
				Destination: whatsapp,
				RenamedFile: header.Filename,
				Status:      "VALIDATION_FAILED",
				Details:     msg,
			})
			writeJSON(w, 400, map[string]any{"ok": false, "error": msg})
			return
		}

		cfg, cfgErr := GetRawSettings()
		if cfgErr != nil {
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     strings.ToUpper(channel),
				Destination: destSummary,
				RenamedFile: header.Filename,
				Status:      "ERROR",
				Details:     "Failed to load dispatch settings: " + cfgErr.Error(),
			})
			writeJSON(w, 500, map[string]any{"ok": false, "error": "Failed to load dispatch settings: " + cfgErr.Error()})
			return
		}
		if (channel == "email" || channel == "both") && !cfg.EmailEnabled {
			msg := "Email dispatch is disabled in System Settings."
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     "EMAIL",
				Destination: email,
				RenamedFile: header.Filename,
				Status:      "FAILED",
				Details:     msg,
			})
			writeJSON(w, 400, map[string]any{"ok": false, "error": msg})
			return
		}
		if (channel == "email" || channel == "both") && !cfg.EmailConfigured {
			msg := "Email (SMTP) is not set up yet. Configure SMTP host, username, and password in System Settings first."
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     "EMAIL",
				Destination: email,
				RenamedFile: header.Filename,
				Status:      "FAILED",
				Details:     msg,
			})
			writeJSON(w, 400, map[string]any{"ok": false, "error": msg})
			return
		}
		if (channel == "whatsapp" || channel == "both") && !cfg.WhatsAppEnabled {
			msg := "WhatsApp dispatch is disabled in System Settings."
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     "WHATSAPP",
				Destination: whatsapp,
				RenamedFile: header.Filename,
				Status:      "FAILED",
				Details:     msg,
			})
			writeJSON(w, 400, map[string]any{"ok": false, "error": msg})
			return
		}
		if (channel == "whatsapp" || channel == "both") && !cfg.WhatsAppPaired {
			msg := "WhatsApp is not set up yet. Pair a WhatsApp device via QR code in System Settings first."
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     "WHATSAPP",
				Destination: whatsapp,
				RenamedFile: header.Filename,
				Status:      "FAILED",
				Details:     msg,
			})
			writeJSON(w, 400, map[string]any{"ok": false, "error": msg})
			return
		}

		meta, err := ExtractAndValidatePDF(rawPDF, memberNo)
		if err != nil {
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    defaultStr(memberNo, "UNSPECIFIED"),
				MemberName:  "UNVERIFIED",
				Channel:     strings.ToUpper(channel),
				Destination: destSummary,
				RenamedFile: header.Filename,
				Status:      "VALIDATION_FAILED",
				Details:     err.Error(),
			})
			writeJSON(w, 422, map[string]any{"ok": false, "error": err.Error()})
			return
		}

		rawPassword := meta.IDCardNo
		if cfg.PasswordMode == "id_and_nssf_last4" && len(meta.MemberNo) >= 4 {
			rawPassword = meta.IDCardNo + meta.MemberNo[len(meta.MemberNo)-4:]
		}

		renamedFile := buildRenamedFile(cfg.FilenameTemplate, meta.MemberNo)
		encryptedPDF, err := EncryptPDFWithPassword(rawPDF, rawPassword)
		if err != nil {
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    meta.MemberNo,
				MemberName:  meta.MemberName,
				Channel:     strings.ToUpper(channel),
				Destination: destSummary,
				RenamedFile: renamedFile,
				Status:      "ENCRYPTION_FAILED",
				Details:     "Failed to encrypt statement PDF: " + err.Error(),
			})
			writeJSON(w, 500, map[string]any{"ok": false, "error": "Failed to encrypt statement PDF: " + err.Error()})
			return
		}

		subject, htmlBody, plainText, whatsappText, passwordGuide := BuildOfficialNSSFMessage(meta, renamedFile, cfg.PasswordMode, cfg.PortalURL, rawPassword, cfg.EmailSubjectTemplate, cfg.WhatsAppMessageTemplate)

		var delivered []string
		if channel == "email" || channel == "both" {
			if err := SendEmailStatement(cfg, email, meta, renamedFile, encryptedPDF, rawPassword); err != nil {
				_ = InsertAuditEvent(AuditEvent{
					EventType:   "DISPATCH",
					Actor:       "Service Desk",
					SourceIP:    ip,
					MemberNo:    meta.MemberNo,
					MemberName:  meta.MemberName,
					Channel:     "EMAIL",
					Destination: email,
					RenamedFile: renamedFile,
					Status:      "FAILED",
					Details:     err.Error(),
				})
				writeJSON(w, 502, map[string]any{"ok": false, "error": "Email error: " + err.Error()})
				return
			}
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    meta.MemberNo,
				MemberName:  meta.MemberName,
				Channel:     "EMAIL",
				Destination: email,
				RenamedFile: renamedFile,
				Status:      "SENT",
				Details:     "Encrypted statement emailed via " + cfg.SMTPHost,
			})
			delivered = append(delivered, "EMAIL")
		}

		if channel == "whatsapp" || channel == "both" {
			if err := SendWhatsAppStatement(cfg, whatsapp, meta, renamedFile, encryptedPDF, rawPassword); err != nil {
				_ = InsertAuditEvent(AuditEvent{
					EventType:   "DISPATCH",
					Actor:       "Service Desk",
					SourceIP:    ip,
					MemberNo:    meta.MemberNo,
					MemberName:  meta.MemberName,
					Channel:     "WHATSAPP",
					Destination: whatsapp,
					RenamedFile: renamedFile,
					Status:      "FAILED",
					Details:     err.Error(),
				})
				errPrefix := "WhatsApp error: "
				if len(delivered) > 0 {
					errPrefix = "Email was delivered, but WhatsApp error: "
				}
				writeJSON(w, 502, map[string]any{"ok": false, "error": errPrefix + err.Error()})
				return
			}
			_ = InsertAuditEvent(AuditEvent{
				EventType:   "DISPATCH",
				Actor:       "Service Desk",
				SourceIP:    ip,
				MemberNo:    meta.MemberNo,
				MemberName:  meta.MemberName,
				Channel:     "WHATSAPP",
				Destination: whatsapp,
				RenamedFile: renamedFile,
				Status:      "SENT",
				Details:     "Encrypted statement dispatched via paired WhatsApp device",
			})
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
			"emailPreview": map[string]string{
				"subject":      subject,
				"htmlBody":     htmlBody,
				"plainText":    plainText,
				"whatsappText": whatsappText,
			},
		})
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
		ip := RealClientIP(r)
		if strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE")) != "" || HasAdminAccount() {
			LogSystemAudit("AUTH", "Anonymous", ip, "ADMIN_SETUP", ip, "", "SETUP_FAILED", "Attempted initial setup while an administrator account already exists")
			writeJSON(w, 409, map[string]any{"ok": false, "error": "An administrator account is already configured. Please sign in."})
			return
		}
		var body struct {
			Username      string `json:"username"`
			Password      string `json:"password"`
			RecoveryEmail string `json:"recoveryEmail"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			LogSystemAudit("AUTH", "Anonymous", ip, "ADMIN_SETUP", ip, "", "SETUP_FAILED", "Invalid JSON body during initial setup")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid JSON body."})
			return
		}
		username := strings.TrimSpace(body.Username)
		if !usernameRe.MatchString(username) {
			LogSystemAudit("AUTH", defaultStr(username, "Anonymous"), ip, "ADMIN_SETUP", ip, "", "SETUP_FAILED", "Invalid administrator username format during setup")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Admin username must be 3 to 64 characters (letters, numbers, ., _, @, -)."})
			return
		}
		recoveryEmail := strings.TrimSpace(body.RecoveryEmail)
		if recoveryEmail != "" && !emailRe.MatchString(recoveryEmail) {
			LogSystemAudit("AUTH", username, ip, "ADMIN_SETUP", recoveryEmail, "", "SETUP_FAILED", "Invalid recovery email format during setup")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please enter a valid recovery email address."})
			return
		}
		if len(body.Password) < 8 || len(body.Password) > 128 {
			LogSystemAudit("AUTH", username, ip, "ADMIN_SETUP", ip, "", "SETUP_FAILED", "Password did not meet length policy (8-128 chars) during setup")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Admin password must be between 8 and 128 characters."})
			return
		}
		created, recoveryKey, err := CreateInitialAdmin(username, body.Password, recoveryEmail)
		if err != nil {
			LogSystemAudit("AUTH", username, ip, "ADMIN_SETUP", ip, "", "SETUP_FAILED", "Administrator setup conflict: "+err.Error())
			writeJSON(w, 409, map[string]any{"ok": false, "error": "Administrator setup already completed. Please sign in."})
			return
		}
		token := CreateAdminSessionToken(created.Username)
		pub, _ := GetPublicSettings()
		LogSystemAudit("AUTH", created.Username, ip, "ADMIN_SETUP", defaultStr(created.RecoveryEmail, ip), "", "ADMIN_CREATED", "Initial administrator account created and signed in")
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
		rateIP := ClientIP(r)
		auditIP := RealClientIP(r)
		allowed, retryAfter := CheckLoginRateLimit(rateIP)
		if !allowed {
			LogSystemAudit("AUTH", "Unknown", auditIP, "LOGIN", auditIP, "", "LOGIN_BLOCKED", fmt.Sprintf("Login temporarily blocked after too many failed attempts (retry in %ds)", retryAfter))
			writeJSON(w, 429, map[string]any{"ok": false, "error": fmt.Sprintf("Too many failed login attempts. Try again in %d seconds.", retryAfter)})
			return
		}
		var body struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			LogSystemAudit("AUTH", "Unknown", auditIP, "LOGIN", auditIP, "", "LOGIN_FAILED", "Invalid JSON payload on login attempt")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid JSON body."})
			return
		}
		attemptedUser := defaultStr(strings.TrimSpace(body.Username), "unknown")

		envPasscode := strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE"))
		if envPasscode != "" {
			if body.Password == "" || !VerifyTimingSafeString(body.Password, envPasscode) {
				RecordFailedLogin(rateIP)
				LogSystemAudit("AUTH", attemptedUser, auditIP, "LOGIN", auditIP, "", "LOGIN_FAILED", fmt.Sprintf("Failed administrator sign-in attempt for %q (invalid passcode)", attemptedUser))
				writeJSON(w, 401, map[string]any{"ok": false, "error": "Invalid administrator credentials."})
				return
			}
			ClearFailedLogins(rateIP)
			user := defaultStr(strings.TrimSpace(body.Username), "admin")
			token := CreateAdminSessionToken(user)
			pub, _ := GetPublicSettings()
			LogSystemAudit("AUTH", user, auditIP, "LOGIN", auditIP, "", "LOGIN_SUCCESS", fmt.Sprintf("Administrator %q signed in", user))
			writeJSON(w, 200, map[string]any{"ok": true, "token": token, "username": user, "settings": pub})
			return
		}

		if !HasAdminAccount() {
			LogSystemAudit("AUTH", attemptedUser, auditIP, "LOGIN", auditIP, "", "LOGIN_FAILED", "Sign-in attempted before initial administrator setup was completed")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "No administrator account exists yet. Complete initial admin setup first."})
			return
		}

		ok, matchedUser := VerifyStoredAdminCredentials(body.Username, body.Password)
		if !ok {
			RecordFailedLogin(rateIP)
			LogSystemAudit("AUTH", attemptedUser, auditIP, "LOGIN", auditIP, "", "LOGIN_FAILED", fmt.Sprintf("Failed administrator sign-in attempt for username %q (invalid username or password)", attemptedUser))
			writeJSON(w, 401, map[string]any{"ok": false, "error": "Invalid username or password."})
			return
		}
		ClearFailedLogins(rateIP)
		token := CreateAdminSessionToken(matchedUser)
		pub, _ := GetPublicSettings()
		acc, _ := GetAdminAccount()
		recEmail := ""
		if acc != nil {
			recEmail = acc.RecoveryEmail
		}
		LogSystemAudit("AUTH", matchedUser, auditIP, "LOGIN", auditIP, "", "LOGIN_SUCCESS", fmt.Sprintf("Administrator %q signed in", matchedUser))
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
		rateIP := ClientIP(r)
		auditIP := RealClientIP(r)
		if strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE")) != "" {
			LogSystemAudit("AUTH", "Anonymous", auditIP, "RECOVERY", auditIP, "", "RESET_REQUEST_FAILED", "Password recovery unavailable while managed passcode override is active")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Server passcode is managed via NSSF_ADMIN_PASSCODE environment variable."})
			return
		}
		allowed, retryAfter := CheckLoginRateLimit(rateIP)
		if !allowed {
			LogSystemAudit("AUTH", "Anonymous", auditIP, "RECOVERY", auditIP, "", "RESET_REQUEST_FAILED", fmt.Sprintf("Password recovery rate-limited (retry in %ds)", retryAfter))
			writeJSON(w, 429, map[string]any{"ok": false, "error": fmt.Sprintf("Too many recovery requests. Try again in %d seconds.", retryAfter)})
			return
		}
		var body struct {
			Username      string `json:"username"`
			RecoveryEmail string `json:"recoveryEmail"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			LogSystemAudit("AUTH", "Anonymous", auditIP, "RECOVERY", auditIP, "", "RESET_REQUEST_FAILED", "Invalid JSON body on password recovery request")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid JSON body."})
			return
		}
		username := strings.TrimSpace(body.Username)
		recoveryEmail := strings.TrimSpace(body.RecoveryEmail)
		if username == "" || !emailRe.MatchString(recoveryEmail) {
			LogSystemAudit("AUTH", defaultStr(username, "Anonymous"), auditIP, "RECOVERY", recoveryEmail, "", "RESET_REQUEST_FAILED", "Password recovery requested with missing username or invalid email")
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
				LogSystemAudit("AUTH", username, auditIP, "RECOVERY", recoveryEmail, "", "RESET_REQUEST_FAILED", fmt.Sprintf("Reset code request throttled (%ds cooldown remaining)", cooldownSec))
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
				LogSystemAudit("AUTH", acc.Username, auditIP, "RECOVERY", acc.RecoveryEmail, "", "RESET_EMAIL_FAILED", "Failed to send password reset email: "+err.Error())
				writeJSON(w, 502, map[string]any{"ok": false, "error": "Failed to deliver verification code via SMTP. Use your Backup Recovery Key instead."})
				return
			}
			LogSystemAudit("AUTH", acc.Username, auditIP, "RECOVERY", acc.RecoveryEmail, "", "RESET_CODE_SENT", "Password reset verification code emailed to administrator recovery address")
		} else {
			LogSystemAudit("AUTH", username, auditIP, "RECOVERY", recoveryEmail, "", "RESET_REQUEST_FAILED", "Password reset requested with unmatched username/recovery email or unconfigured SMTP")
		}

		writeJSON(w, 200, map[string]any{"ok": true, "message": genericMsg})
	})

	mux.HandleFunc("/api/auth/reset-password", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		rateIP := ClientIP(r)
		auditIP := RealClientIP(r)
		if strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE")) != "" {
			LogSystemAudit("AUTH", "Anonymous", auditIP, "RECOVERY", auditIP, "", "PASSWORD_RESET_FAILED", "Password reset blocked while managed passcode override is active")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Server passcode is managed via NSSF_ADMIN_PASSCODE environment variable."})
			return
		}
		allowed, retryAfter := CheckLoginRateLimit(rateIP)
		if !allowed {
			LogSystemAudit("AUTH", "Anonymous", auditIP, "RECOVERY", auditIP, "", "PASSWORD_RESET_FAILED", fmt.Sprintf("Password reset rate-limited (retry in %ds)", retryAfter))
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
			LogSystemAudit("AUTH", "Anonymous", auditIP, "RECOVERY", auditIP, "", "PASSWORD_RESET_FAILED", "Invalid JSON payload on password reset")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid JSON body."})
			return
		}
		username := strings.TrimSpace(body.Username)
		if !usernameRe.MatchString(username) {
			LogSystemAudit("AUTH", defaultStr(username, "Anonymous"), auditIP, "RECOVERY", auditIP, "", "PASSWORD_RESET_FAILED", "Password reset rejected due to invalid username format")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please enter a valid administrator username."})
			return
		}
		if len(body.NewPassword) < 8 || len(body.NewPassword) > 128 {
			LogSystemAudit("AUTH", username, auditIP, "RECOVERY", auditIP, "", "PASSWORD_RESET_FAILED", "Password reset rejected: new password outside 8-128 character range")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "New password must be between 8 and 128 characters."})
			return
		}
		acc, _ := GetAdminAccount()
		if acc == nil {
			LogSystemAudit("AUTH", username, auditIP, "RECOVERY", auditIP, "", "PASSWORD_RESET_FAILED", "Password reset attempted when no administrator account exists")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "No administrator account exists yet."})
			return
		}

		method := strings.TrimSpace(body.Method)
		methodLabel := "email verification code"
		if method == "email_code" {
			if !strings.EqualFold(acc.Username, username) {
				RecordFailedLogin(rateIP)
				LogSystemAudit("AUTH", username, auditIP, "RECOVERY", auditIP, "", "PASSWORD_RESET_FAILED", fmt.Sprintf("Email-code password reset failed for unknown username %q", username))
				writeJSON(w, 401, map[string]any{"ok": false, "error": "Invalid username or verification code."})
				return
			}
			ok, msg := VerifyAndConsumePasswordResetCode(body.Code)
			if !ok {
				RecordFailedLogin(rateIP)
				LogSystemAudit("AUTH", username, auditIP, "RECOVERY", auditIP, "", "PASSWORD_RESET_FAILED", "Email verification code rejected: "+msg)
				writeJSON(w, 401, map[string]any{"ok": false, "error": msg})
				return
			}
		} else if method == "recovery_key" {
			methodLabel = "backup recovery key"
			if !VerifyAdminRecoveryKey(username, body.RecoveryKey) {
				RecordFailedLogin(rateIP)
				LogSystemAudit("AUTH", username, auditIP, "RECOVERY", auditIP, "", "PASSWORD_RESET_FAILED", fmt.Sprintf("Backup recovery key rejected for username %q", username))
				writeJSON(w, 401, map[string]any{"ok": false, "error": "Invalid administrator username or backup recovery key."})
				return
			}
		} else {
			LogSystemAudit("AUTH", username, auditIP, "RECOVERY", auditIP, "", "PASSWORD_RESET_FAILED", "Unsupported password reset method: "+method)
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid password reset method."})
			return
		}

		if err := UpdateAdminPassword(body.NewPassword); err != nil {
			LogSystemAudit("AUTH", username, auditIP, "RECOVERY", auditIP, "", "ERROR", "Failed saving updated administrator password: "+err.Error())
			writeJSON(w, 500, map[string]any{"ok": false, "error": "Failed to update administrator password."})
			return
		}
		ClearFailedLogins(rateIP)
		RevokeAllAdminSessions()
		LogSystemAudit("AUTH", acc.Username, auditIP, "RECOVERY", auditIP, "", "PASSWORD_RESET", fmt.Sprintf("Administrator password reset via %s; all active sessions revoked", methodLabel))
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
		ip := RealClientIP(r)
		if strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE")) != "" {
			LogSystemAudit("AUTH", currentUser, ip, "SECURITY", ip, "", "CREDENTIALS_UPDATE_FAILED", "Credential update blocked while managed passcode override is active")
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
			LogSystemAudit("AUTH", currentUser, ip, "SECURITY", ip, "", "CREDENTIALS_UPDATE_FAILED", "Invalid JSON body when updating credentials")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid JSON body."})
			return
		}
		acc, _ := GetAdminAccount()
		if acc == nil {
			LogSystemAudit("AUTH", currentUser, ip, "SECURITY", ip, "", "CREDENTIALS_UPDATE_FAILED", "Administrator account not found")
			writeJSON(w, 404, map[string]any{"ok": false, "error": "Administrator account not found."})
			return
		}
		if body.CurrentPassword == "" || !VerifyPasswordHash(body.CurrentPassword, acc.PasswordHash, acc.PasswordSalt) {
			LogSystemAudit("AUTH", currentUser, ip, "SECURITY", ip, "", "CREDENTIALS_UPDATE_FAILED", "Rejected credential change: current password was incorrect")
			writeJSON(w, 401, map[string]any{"ok": false, "error": "Current password is incorrect."})
			return
		}
		newUser := strings.TrimSpace(body.NewUsername)
		if newUser == "" {
			newUser = acc.Username
		}
		if !usernameRe.MatchString(newUser) {
			LogSystemAudit("AUTH", currentUser, ip, "SECURITY", ip, "", "CREDENTIALS_UPDATE_FAILED", "Rejected credential change: invalid username format")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Username must be 3 to 64 characters (letters, numbers, ., _, @, -)."})
			return
		}
		recEmail := strings.TrimSpace(body.RecoveryEmail)
		if recEmail != "" && !emailRe.MatchString(recEmail) {
			LogSystemAudit("AUTH", currentUser, ip, "SECURITY", recEmail, "", "CREDENTIALS_UPDATE_FAILED", "Rejected credential change: invalid recovery email")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Please enter a valid recovery email address."})
			return
		}
		if body.NewPassword != "" && (len(body.NewPassword) < 8 || len(body.NewPassword) > 128) {
			LogSystemAudit("AUTH", currentUser, ip, "SECURITY", ip, "", "CREDENTIALS_UPDATE_FAILED", "Rejected credential change: new password outside 8-128 character range")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "New password must be between 8 and 128 characters."})
			return
		}

		updated, err := UpdateAdminCredentials(newUser, recEmail, body.NewPassword)
		if err != nil {
			LogSystemAudit("AUTH", currentUser, ip, "SECURITY", ip, "", "ERROR", "Failed to save updated administrator credentials: "+err.Error())
			writeJSON(w, 500, map[string]any{"ok": false, "error": "Failed to update administrator credentials."})
			return
		}
		var changedParts []string
		if !strings.EqualFold(acc.Username, updated.Username) {
			changedParts = append(changedParts, fmt.Sprintf("username (%s -> %s)", acc.Username, updated.Username))
		}
		if acc.RecoveryEmail != updated.RecoveryEmail {
			changedParts = append(changedParts, "recovery email")
		}
		if body.NewPassword != "" {
			changedParts = append(changedParts, "password")
		}
		if len(changedParts) == 0 {
			changedParts = append(changedParts, "account profile confirmed")
		}
		RevokeAllAdminSessions()
		newToken := CreateAdminSessionToken(updated.Username)
		LogSystemAudit("AUTH", updated.Username, ip, "SECURITY", defaultStr(updated.RecoveryEmail, ip), "", "CREDENTIALS_UPDATED", "Updated administrator "+strings.Join(changedParts, ", "))
		writeJSON(w, 200, map[string]any{
			"ok":            true,
			"token":         newToken,
			"username":      updated.Username,
			"recoveryEmail": updated.RecoveryEmail,
			"message":       "Administrator credentials updated successfully.",
		})
	}))

	mux.HandleFunc("/api/auth/regenerate-recovery-key", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, actor string) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ip := RealClientIP(r)
		if strings.TrimSpace(os.Getenv("NSSF_ADMIN_PASSCODE")) != "" {
			LogSystemAudit("AUTH", actor, ip, "SECURITY", ip, "", "RECOVERY_KEY_FAILED", "Recovery key regeneration unavailable while managed passcode override is active")
			writeJSON(w, 409, map[string]any{"ok": false, "error": "Recovery key is unavailable while NSSF_ADMIN_PASSCODE is active."})
			return
		}
		var body struct {
			CurrentPassword string `json:"currentPassword"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			LogSystemAudit("AUTH", actor, ip, "SECURITY", ip, "", "RECOVERY_KEY_FAILED", "Invalid JSON body during recovery key regeneration")
			writeJSON(w, 400, map[string]any{"ok": false, "error": "Invalid JSON body."})
			return
		}
		acc, _ := GetAdminAccount()
		if acc == nil || body.CurrentPassword == "" || !VerifyPasswordHash(body.CurrentPassword, acc.PasswordHash, acc.PasswordSalt) {
			LogSystemAudit("AUTH", actor, ip, "SECURITY", ip, "", "RECOVERY_KEY_FAILED", "Rejected recovery key regeneration: incorrect current password")
			writeJSON(w, 401, map[string]any{"ok": false, "error": "Current password is incorrect."})
			return
		}
		recKey, err := RegenerateAdminRecoveryKey()
		if err != nil {
			LogSystemAudit("AUTH", actor, ip, "SECURITY", ip, "", "ERROR", "Failed regenerating backup recovery key: "+err.Error())
			writeJSON(w, 500, map[string]any{"ok": false, "error": "Failed to regenerate backup recovery key."})
			return
		}
		LogSystemAudit("AUTH", actor, ip, "SECURITY", ip, "", "RECOVERY_KEY_REGENERATED", "Generated a new administrator backup recovery key")
		writeJSON(w, 200, map[string]any{
			"ok":          true,
			"recoveryKey": recKey,
		})
	}))

	mux.HandleFunc("/api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		revoked, username := RevokeAdminSessionToken(ExtractBearerToken(r))
		if revoked {
			ip := RealClientIP(r)
			LogSystemAudit("AUTH", defaultStr(username, "Admin"), ip, "LOGIN", ip, "", "LOGOUT", "Administrator signed out / locked System Settings")
		}
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
			ip := RealClientIP(r)
			valid, actor := VerifyAdminSessionToken(ExtractBearerToken(r))
			if !valid {
				LogSystemAudit("AUTH", "Anonymous", ip, "SECURITY", "POST /api/settings", "", "UNAUTHORIZED", "Blocked unauthenticated attempt to modify System Settings")
				writeJSON(w, 401, map[string]any{"ok": false, "error": "Administrator authentication is required to access System Settings."})
				return
			}
			var cfg AppSettings
			if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
				LogSystemAudit("SETTINGS", actor, ip, "SETTINGS", ip, "", "SETTINGS_UPDATE_FAILED", "Invalid JSON settings payload: "+err.Error())
				writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			prevCfg, _ := GetRawSettings()
			if err := SaveSettings(cfg); err != nil {
				statusCode := 500
				if strings.Contains(err.Error(), "update repository") {
					statusCode = 400
				}
				LogSystemAudit("SETTINGS", actor, ip, "SETTINGS", ip, "", "SETTINGS_UPDATE_FAILED", "Failed saving settings: "+err.Error())
				writeJSON(w, statusCode, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			updatedRaw, _ := GetRawSettings()
			diffSummary := summarizeSettingsDiff(prevCfg, updatedRaw, cfg.ClearSMTPPass, cfg.SMTPPass != "")
			LogSystemAudit("SETTINGS", actor, ip, "SETTINGS", "System Configuration", "", "SETTINGS_UPDATED", diffSummary)
			updated, _ := GetPublicSettings()
			writeJSON(w, 200, map[string]any{"ok": true, "settings": updated})
			return
		}
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	})

	mux.HandleFunc("/api/settings/test-smtp", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, actor string) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ip := RealClientIP(r)
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
		target := strings.TrimSpace(current.SMTPHost) + ":" + strings.TrimSpace(current.SMTPPort)
		if err := TestSMTPConnection(current); err != nil {
			LogSystemAudit("SETTINGS", actor, ip, "EMAIL", target, "", "SMTP_TEST_FAILED", err.Error())
			writeJSON(w, 400, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		LogSystemAudit("SETTINGS", actor, ip, "EMAIL", target, "", "SMTP_TEST_OK", fmt.Sprintf("SMTP handshake & authentication succeeded with %s", target))
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

	mux.HandleFunc("/api/whatsapp/reconnect", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, actor string) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ip := RealClientIP(r)
		cfg, _ := GetRawSettings()
		qrData := ReconnectWhatsApp(cfg)
		if qrData.Error != "" {
			LogSystemAudit("WHATSAPP", actor, ip, "WHATSAPP", qrData.DeviceName, "", "WHATSAPP_ERROR", qrData.Error)
		} else if qrData.Connected {
			LogSystemAudit("WHATSAPP", actor, ip, "WHATSAPP", defaultStr("+"+strings.TrimPrefix(qrData.PairedPhone, "+"), qrData.DeviceName), "", "WHATSAPP_RECONNECTED", "WhatsApp gateway session reconnected")
		}
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

	mux.HandleFunc("/api/whatsapp/unlink", RequireAdminAuth(func(w http.ResponseWriter, r *http.Request, actor string) {
		ip := RealClientIP(r)
		cfg, _ := GetRawSettings()
		qrData := UnlinkWhatsAppSession(cfg)
		LogSystemAudit("WHATSAPP", actor, ip, "WHATSAPP", "WhatsApp Gateway", cfg.WhatsAppDeviceName, "WHATSAPP_UNLINKED", "WhatsApp gateway device unlinked by administrator")
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

	var ln net.Listener
	var listenErr error
	maxBindAttempts := 1
	if waitRestart {
		maxBindAttempts = 25
	}
	for attempt := 0; attempt < maxBindAttempts; attempt++ {
		ln, listenErr = net.Listen("tcp", "0.0.0.0:"+port)
		if listenErr == nil {
			break
		}
		if waitRestart && attempt < maxBindAttempts-1 {
			time.Sleep(150 * time.Millisecond)
		}
	}
	if listenErr != nil {
		if isOwnInstanceRunning(port) {
			targetURL := "http://127.0.0.1:" + port
			log.Printf("%s is already running on %s — opening browser.", appName, targetURL)
			if shouldAutoOpen {
				openBrowser(targetURL)
			}
			return
		}
		log.Fatalf("Failed to bind port %s: %v", port, listenErr)
	}

	httpServer := &http.Server{Handler: requestLoggerMiddleware(mux)}
	StartAutoUpdateLoop(func() {
		_ = ln.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(ctx)
	})

	targetURL := "http://127.0.0.1:" + port
	log.Printf("%s v%s (%s) listening on %s (data: %s)", appName, appVersion, appPublisher, targetURL, getAppDataDir())
	if shouldAutoOpen {
		go func() {
			waitForLocalServer(targetURL+"/api/health", 2*time.Second)
			openBrowser(targetURL)
		}()
	}

	if err := httpServer.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) && !errors.Is(err, net.ErrClosed) {
		log.Fatal(err)
	}
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

func summarizeSettingsDiff(prev, next AppSettings, clearedPass, updatedPass bool) string {
	var changes []string
	if prev.SMTPHost != next.SMTPHost || prev.SMTPPort != next.SMTPPort || prev.SMTPSecurity != next.SMTPSecurity || prev.SMTPUser != next.SMTPUser || prev.SMTPFrom != next.SMTPFrom {
		changes = append(changes, "SMTP configuration")
	}
	if clearedPass {
		changes = append(changes, "SMTP password cleared")
	} else if updatedPass {
		changes = append(changes, "SMTP password updated")
	}
	if prev.EmailEnabled != next.EmailEnabled {
		if next.EmailEnabled {
			changes = append(changes, "Email channel enabled")
		} else {
			changes = append(changes, "Email channel disabled")
		}
	}
	if prev.WhatsAppEnabled != next.WhatsAppEnabled {
		if next.WhatsAppEnabled {
			changes = append(changes, "WhatsApp channel enabled")
		} else {
			changes = append(changes, "WhatsApp channel disabled")
		}
	}
	if prev.WhatsAppDeviceName != next.WhatsAppDeviceName {
		changes = append(changes, "WhatsApp terminal name")
	}
	if prev.FilenameTemplate != next.FilenameTemplate || prev.PasswordMode != next.PasswordMode || prev.PortalURL != next.PortalURL {
		changes = append(changes, "Document & security defaults")
	}
	if prev.PreviewBeforeDispatch != next.PreviewBeforeDispatch {
		if next.PreviewBeforeDispatch {
			changes = append(changes, "Pre-dispatch confirmation enabled")
		} else {
			changes = append(changes, "Pre-dispatch confirmation disabled")
		}
	}
	if prev.EmailSubjectTemplate != next.EmailSubjectTemplate || prev.WhatsAppMessageTemplate != next.WhatsAppMessageTemplate {
		changes = append(changes, "Message templates")
	}
	if prev.AutoUpdateEnabled != next.AutoUpdateEnabled {
		if next.AutoUpdateEnabled {
			changes = append(changes, "Automatic updates enabled")
		} else {
			changes = append(changes, "Automatic updates disabled")
		}
	}
	if prev.UpdateRepo != next.UpdateRepo {
		changes = append(changes, "Update repository")
	}
	if len(changes) == 0 {
		return "Saved system configuration"
	}
	return "Updated: " + strings.Join(changes, ", ")
}

func requestLoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		lrw := &loggingResponseWriter{
			ResponseWriter: w,
			statusCode:     http.StatusOK,
		}

		ip := RealClientIP(r)
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("[ERROR] Panic handling %s %s: %v", r.Method, r.URL.Path, rec)
				LogSystemAudit("SYSTEM", "System", ip, "SYSTEM", r.Method+" "+r.URL.Path, "", "SYSTEM_ERROR", fmt.Sprintf("Unexpected server error: %v", rec))
				if !lrw.wroteHeader {
					writeJSON(lrw, http.StatusInternalServerError, map[string]any{
						"ok":    false,
						"error": "An unexpected internal server error occurred.",
					})
				}
			}
		}()

		next.ServeHTTP(lrw, r)

		duration := time.Since(start).Round(100 * time.Microsecond)
		target := r.URL.Path
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
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
