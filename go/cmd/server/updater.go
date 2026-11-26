package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	autoUpdateInitialDelay = 12 * time.Second
	autoUpdateInterval     = 6 * time.Hour
	maxUpdateBinaryBytes   = 150 << 20 // 150 MiB safety cap
	maxChecksumFileBytes   = 1 << 20   // 1 MiB
)

var githubRepoSlugRe = regexp.MustCompile(`^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`)

type UpdateStatus struct {
	Enabled           bool   `json:"enabled"`
	Repo              string `json:"repo"`
	CurrentVersion    string `json:"currentVersion"`
	LatestVersion     string `json:"latestVersion"`
	UpdateAvailable   bool   `json:"updateAvailable"`
	State             string `json:"state"`
	Message           string `json:"message"`
	ReleaseURL        string `json:"releaseUrl,omitempty"`
	ReleaseNotes      string `json:"releaseNotes,omitempty"`
	AssetName         string `json:"assetName,omitempty"`
	LastCheckedAt     string `json:"lastCheckedAt,omitempty"`
	CanSelfUpdate     bool   `json:"canSelfUpdate"`
	SelfUpdateHint    string `json:"selfUpdateHint,omitempty"`
	RequiresElevation bool   `json:"requiresElevation,omitempty"`
	RestartScheduled  bool   `json:"restartScheduled,omitempty"`
}

type githubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

type githubReleasePayload struct {
	TagName    string               `json:"tag_name"`
	Name       string               `json:"name"`
	HTMLURL    string               `json:"html_url"`
	Body       string               `json:"body"`
	Draft      bool                 `json:"draft"`
	Prerelease bool                 `json:"prerelease"`
	Assets     []githubReleaseAsset `json:"assets"`
}

type updateManager struct {
	mu               sync.Mutex
	opMu             sync.Mutex
	status           UpdateStatus
	latestAssetURL   string
	latestChecksum   string
	shutdownServerFn func()
}

var appUpdater = &updateManager{
	status: UpdateStatus{
		CurrentVersion: appVersion,
		State:          "idle",
		Message:        "Update check pending.",
	},
}

func resolveConfiguredUpdateRepo() string {
	cfg, err := GetRawSettings()
	candidates := []string{}
	if err == nil {
		candidates = append(candidates, cfg.UpdateRepo)
	}
	candidates = append(candidates, os.Getenv("NSSF_UPDATE_REPO"), githubRepo)
	for _, c := range candidates {
		clean := normalizeRepoSlug(c)
		if githubRepoSlugRe.MatchString(clean) {
			return clean
		}
	}
	return ""
}

func normalizeRepoSlug(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "https://github.com/")
	s = strings.TrimPrefix(s, "http://github.com/")
	s = strings.TrimSuffix(s, ".git")
	s = strings.Trim(s, "/")
	return s
}

func isAutoUpdateEnabled() bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("NSSF_AUTO_UPDATE")), "false") ||
		strings.TrimSpace(os.Getenv("NSSF_AUTO_UPDATE")) == "0" {
		return false
	}
	cfg, err := GetRawSettings()
	if err != nil {
		return true
	}
	return cfg.AutoUpdateEnabled
}

func resolvePlatformAssetName() string {
	switch runtime.GOOS {
	case "windows":
		if runtime.GOARCH == "amd64" {
			return "NSSF-Statement-Dispatch-windows-amd64.exe"
		}
	case "linux":
		if runtime.GOARCH == "amd64" || runtime.GOARCH == "arm64" {
			return "nssf-statement-dispatch-linux-" + runtime.GOARCH
		}
	case "darwin":
		if runtime.GOARCH == "amd64" || runtime.GOARCH == "arm64" {
			return "nssf-statement-dispatch-darwin-" + runtime.GOARCH
		}
	}
	return ""
}

func resolveRunningExecutablePath() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, evalErr := filepath.EvalSymlinks(exe); evalErr == nil && resolved != "" {
		return resolved, nil
	}
	return exe, nil
}

func canSelfUpdateExecutable() (bool, string) {
	if resolvePlatformAssetName() == "" {
		return false, fmt.Sprintf("Self-update asset mapping is unavailable for %s/%s.", runtime.GOOS, runtime.GOARCH)
	}
	exePath, err := resolveRunningExecutablePath()
	if err != nil {
		return false, "Unable to locate running executable path."
	}
	lower := strings.ToLower(exePath)
	if strings.Contains(lower, "go-build") || strings.Contains(lower, filepath.Join("tmp", "go-build")) {
		return false, "Running from a temporary 'go run' build; install a compiled release binary to apply self-updates."
	}
	return true, ""
}

func cleanupOldExecutableBackup() {
	exePath, err := resolveRunningExecutablePath()
	if err != nil || exePath == "" {
		return
	}
	oldPath := exePath + ".old"
	if _, statErr := os.Stat(oldPath); statErr == nil {
		_ = os.Remove(oldPath)
	}
}

func isAllowedGitHubURL(rawURL string) bool {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Scheme != "https" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host == "github.com" || host == "api.github.com" {
		return true
	}
	return strings.HasSuffix(host, ".githubusercontent.com")
}

func newGitHubHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 6 {
				return errors.New("too many redirects")
			}
			if !isAllowedGitHubURL(req.URL.String()) {
				return fmt.Errorf("blocked redirect to untrusted host: %s", req.URL.Hostname())
			}
			return nil
		},
	}
}

type semverParts struct {
	major int
	minor int
	patch int
	pre   string
	valid bool
}

func parseSemver(v string) semverParts {
	s := strings.TrimSpace(v)
	s = strings.TrimPrefix(strings.TrimPrefix(s, "v"), "V")
	if s == "" {
		return semverParts{}
	}
	if plusIdx := strings.IndexByte(s, '+'); plusIdx >= 0 {
		s = s[:plusIdx]
	}
	pre := ""
	if dashIdx := strings.IndexByte(s, '-'); dashIdx >= 0 {
		pre = s[dashIdx+1:]
		s = s[:dashIdx]
	}
	parts := strings.Split(s, ".")
	if len(parts) < 2 || len(parts) > 3 {
		return semverParts{}
	}
	maj, err1 := strconv.Atoi(parts[0])
	min, err2 := strconv.Atoi(parts[1])
	pat := 0
	var err3 error
	if len(parts) == 3 {
		pat, err3 = strconv.Atoi(parts[2])
	}
	if err1 != nil || err2 != nil || err3 != nil || maj < 0 || min < 0 || pat < 0 {
		return semverParts{}
	}
	return semverParts{major: maj, minor: min, patch: pat, pre: pre, valid: true}
}

func isNewerVersion(latest, current string) bool {
	lv := parseSemver(latest)
	cv := parseSemver(current)
	if !lv.valid {
		return false
	}
	if !cv.valid {
		return true
	}
	if lv.major != cv.major {
		return lv.major > cv.major
	}
	if lv.minor != cv.minor {
		return lv.minor > cv.minor
	}
	if lv.patch != cv.patch {
		return lv.patch > cv.patch
	}
	// Stable release supersedes a pre-release of the same core version.
	if cv.pre != "" && lv.pre == "" {
		return true
	}
	if cv.pre != "" && lv.pre != "" {
		return strings.Compare(lv.pre, cv.pre) > 0
	}
	return false
}

func parseSHA256Sums(content []byte, targetAsset string) (string, error) {
	lines := strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		sumHex := strings.ToLower(strings.TrimSpace(fields[0]))
		filePart := strings.TrimSpace(fields[1])
		filePart = strings.TrimPrefix(filePart, "*")
		filePart = strings.TrimPrefix(filePart, "./")
		if filePart == targetAsset {
			if len(sumHex) != 64 {
				return "", fmt.Errorf("invalid SHA-256 digest length for %s", targetAsset)
			}
			if _, err := hex.DecodeString(sumHex); err != nil {
				return "", fmt.Errorf("invalid SHA-256 hex digest for %s", targetAsset)
			}
			return sumHex, nil
		}
	}
	return "", fmt.Errorf("checksum entry for %s missing from SHA256SUMS.txt", targetAsset)
}

func fetchLatestGitHubRelease(ctx context.Context, repo string) (*githubReleasePayload, error) {
	if !githubRepoSlugRe.MatchString(repo) {
		return nil, fmt.Errorf("invalid GitHub repository format %q (expected owner/repo)", repo)
	}
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "NSSF-Statement-Dispatcher/"+appVersion)
	if tok := strings.TrimSpace(os.Getenv("GITHUB_TOKEN")); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}

	client := newGitHubHTTPClient(15 * time.Second)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to reach GitHub Releases API: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("no published GitHub release found for %s", repo)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API returned status %d", resp.StatusCode)
	}

	var release githubReleasePayload
	if err := json.Unmarshal(body, &release); err != nil {
		return nil, fmt.Errorf("invalid GitHub release metadata: %w", err)
	}
	return &release, nil
}

func fetchValidatedGitHubBytes(ctx context.Context, rawURL string, limit int64) ([]byte, error) {
	if !isAllowedGitHubURL(rawURL) {
		return nil, fmt.Errorf("blocked download URL outside GitHub release hosts")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "NSSF-Statement-Dispatcher/"+appVersion)
	client := newGitHubHTTPClient(20 * time.Second)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download failed with status %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, limit))
}

func GetUpdateStatusSnapshot() UpdateStatus {
	repo := resolveConfiguredUpdateRepo()
	enabled := isAutoUpdateEnabled()
	canSelf, hint := canSelfUpdateExecutable()

	appUpdater.mu.Lock()
	defer appUpdater.mu.Unlock()
	st := appUpdater.status
	st.Enabled = enabled
	st.Repo = repo
	st.CurrentVersion = appVersion
	st.CanSelfUpdate = canSelf
	st.SelfUpdateHint = hint
	if st.State == "idle" && repo == "" {
		st.State = "unconfigured"
		st.Message = "Set a GitHub repository (owner/repo) to enable automatic updates."
	}
	return st
}

func CheckForUpdates(ctx context.Context) UpdateStatus {
	appUpdater.opMu.Lock()
	defer appUpdater.opMu.Unlock()

	repo := resolveConfiguredUpdateRepo()
	enabled := isAutoUpdateEnabled()
	canSelf, hint := canSelfUpdateExecutable()
	assetName := resolvePlatformAssetName()
	nowStr := time.Now().Format("02 Jan 2006 15:04:05")

	if repo == "" {
		appUpdater.mu.Lock()
		appUpdater.status = UpdateStatus{
			Enabled:         enabled,
			Repo:            "",
			CurrentVersion:  appVersion,
			UpdateAvailable: false,
			State:           "unconfigured",
			Message:         "Configure a GitHub repository (owner/repo) in Settings to check for updates.",
			LastCheckedAt:   nowStr,
			CanSelfUpdate:   canSelf,
			SelfUpdateHint:  hint,
		}
		st := appUpdater.status
		appUpdater.mu.Unlock()
		return st
	}

	appUpdater.mu.Lock()
	appUpdater.status.State = "checking"
	appUpdater.status.Repo = repo
	appUpdater.status.Enabled = enabled
	appUpdater.status.Message = fmt.Sprintf("Checking %s for updates...", repo)
	appUpdater.mu.Unlock()

	release, err := fetchLatestGitHubRelease(ctx, repo)
	if err != nil {
		appUpdater.mu.Lock()
		appUpdater.status = UpdateStatus{
			Enabled:         enabled,
			Repo:            repo,
			CurrentVersion:  appVersion,
			LatestVersion:   appUpdater.status.LatestVersion,
			UpdateAvailable: false,
			State:           "error",
			Message:         err.Error(),
			LastCheckedAt:   nowStr,
			CanSelfUpdate:   canSelf,
			SelfUpdateHint:  hint,
		}
		st := appUpdater.status
		appUpdater.mu.Unlock()
		return st
	}

	latestClean := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(release.TagName), "v"), "V")
	if latestClean == "" {
		latestClean = strings.TrimSpace(release.Name)
	}

	var matchedAssetURL string
	var checksumURL string
	for _, a := range release.Assets {
		if a.Name == assetName {
			matchedAssetURL = a.BrowserDownloadURL
		}
		if a.Name == "SHA256SUMS.txt" {
			checksumURL = a.BrowserDownloadURL
		}
	}

	notes := strings.TrimSpace(release.Body)
	if len(notes) > 1200 {
		notes = notes[:1200] + "..."
	}

	newer := isNewerVersion(latestClean, appVersion)
	st := UpdateStatus{
		Enabled:         enabled,
		Repo:            repo,
		CurrentVersion:  appVersion,
		LatestVersion:   latestClean,
		UpdateAvailable: newer,
		ReleaseURL:      release.HTMLURL,
		ReleaseNotes:    notes,
		AssetName:       assetName,
		LastCheckedAt:   nowStr,
		CanSelfUpdate:   canSelf,
		SelfUpdateHint:  hint,
	}

	if newer {
		if matchedAssetURL == "" || checksumURL == "" {
			st.State = "error"
			st.Message = fmt.Sprintf("Release v%s is available, but asset %q or SHA256SUMS.txt is missing.", latestClean, assetName)
		} else {
			st.State = "available"
			st.Message = fmt.Sprintf("Version v%s is available (current: v%s).", latestClean, strings.TrimPrefix(appVersion, "v"))
		}
	} else {
		st.State = "up_to_date"
		st.Message = fmt.Sprintf("Running the latest version (v%s).", strings.TrimPrefix(appVersion, "v"))
	}

	appUpdater.mu.Lock()
	appUpdater.status = st
	appUpdater.latestAssetURL = matchedAssetURL
	appUpdater.latestChecksum = checksumURL
	appUpdater.mu.Unlock()

	return st
}

func isPermissionError(err error) bool {
	if err == nil {
		return false
	}
	if os.IsPermission(err) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "permission denied") || strings.Contains(msg, "access is denied")
}

func ApplySelfUpdate(ctx context.Context, restartAfter bool) UpdateStatus {
	st := CheckForUpdates(ctx)
	if !st.UpdateAvailable {
		return st
	}

	appUpdater.opMu.Lock()
	defer appUpdater.opMu.Unlock()

	appUpdater.mu.Lock()
	assetURL := appUpdater.latestAssetURL
	checksumURL := appUpdater.latestChecksum
	assetName := appUpdater.status.AssetName
	latestVer := appUpdater.status.LatestVersion
	releaseURL := appUpdater.status.ReleaseURL
	appUpdater.mu.Unlock()

	if assetURL == "" || checksumURL == "" || assetName == "" {
		return setUpdateError("Release binary or SHA256SUMS.txt URL is unavailable.", false)
	}

	canSelf, hint := canSelfUpdateExecutable()
	if !canSelf {
		st.State = "error"
		st.CanSelfUpdate = false
		st.SelfUpdateHint = hint
		st.Message = hint
		appUpdater.mu.Lock()
		appUpdater.status = st
		appUpdater.mu.Unlock()
		return st
	}

	exePath, err := resolveRunningExecutablePath()
	if err != nil {
		return setUpdateError(fmt.Sprintf("Failed to resolve executable path: %v", err), false)
	}
	exeDir := filepath.Dir(exePath)

	appUpdater.mu.Lock()
	appUpdater.status.State = "downloading"
	appUpdater.status.Message = fmt.Sprintf("Downloading v%s and verifying SHA-256 checksum...", latestVer)
	appUpdater.mu.Unlock()

	checksumBytes, err := fetchValidatedGitHubBytes(ctx, checksumURL, maxChecksumFileBytes)
	if err != nil {
		return setUpdateError(fmt.Sprintf("Failed to download SHA256SUMS.txt: %v", err), false)
	}
	expectedSumHex, err := parseSHA256Sums(checksumBytes, assetName)
	if err != nil {
		return setUpdateError(err.Error(), false)
	}
	expectedSumBytes, _ := hex.DecodeString(expectedSumHex)

	if !isAllowedGitHubURL(assetURL) {
		return setUpdateError("Blocked update download URL outside GitHub release hosts.", false)
	}
	tmpFile, err := os.CreateTemp(exeDir, ".nssf-update-*")
	if err != nil {
		if isPermissionError(err) {
			msg := fmt.Sprintf("Permission denied writing to %s.", exeDir)
			if runtime.GOOS == "linux" {
				msg += " Run 'sudo nssf-statement-dispatch --update' or install the latest .deb package."
			} else if runtime.GOOS == "windows" {
				msg += " Run as Administrator or install the latest .msi release."
			}
			return setUpdateError(msg, true)
		}
		return setUpdateError(fmt.Sprintf("Failed to create staging file: %v", err), false)
	}
	tmpPath := tmpFile.Name()
	cleanupTmp := true
	defer func() {
		if cleanupTmp {
			_ = os.Remove(tmpPath)
		}
	}()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, assetURL, nil)
	if err != nil {
		_ = tmpFile.Close()
		return setUpdateError(err.Error(), false)
	}
	req.Header.Set("User-Agent", "NSSF-Statement-Dispatcher/"+appVersion)
	dlClient := newGitHubHTTPClient(4 * time.Minute)
	resp, err := dlClient.Do(req)
	if err != nil {
		_ = tmpFile.Close()
		return setUpdateError(fmt.Sprintf("Failed to download update binary: %v", err), false)
	}
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		_ = tmpFile.Close()
		return setUpdateError(fmt.Sprintf("Release binary download returned status %d", resp.StatusCode), false)
	}

	hasher := sha256.New()
	limited := io.LimitReader(resp.Body, maxUpdateBinaryBytes+1)
	written, copyErr := io.Copy(io.MultiWriter(tmpFile, hasher), limited)
	_ = resp.Body.Close()
	closeErr := tmpFile.Close()
	if copyErr != nil {
		return setUpdateError(fmt.Sprintf("Failed saving update binary: %v", copyErr), false)
	}
	if closeErr != nil {
		return setUpdateError(fmt.Sprintf("Failed finalizing staged binary: %v", closeErr), false)
	}
	if written > maxUpdateBinaryBytes || written < 1024 {
		return setUpdateError("Downloaded update binary failed size validation.", false)
	}

	actualSum := hasher.Sum(nil)
	if subtle.ConstantTimeCompare(actualSum, expectedSumBytes) != 1 {
		return setUpdateError("SHA-256 verification failed for downloaded binary; update aborted.", false)
	}

	if err := os.Chmod(tmpPath, 0755); err != nil {
		return setUpdateError(fmt.Sprintf("Failed marking staged binary executable: %v", err), isPermissionError(err))
	}

	appUpdater.mu.Lock()
	appUpdater.status.State = "applying"
	appUpdater.status.Message = fmt.Sprintf("Verified v%s checksum. Replacing executable...", latestVer)
	appUpdater.mu.Unlock()

	backupPath := exePath + ".old"
	_ = os.Remove(backupPath)

	if err := os.Rename(exePath, backupPath); err != nil {
		return setUpdateError(fmt.Sprintf("Failed preparing executable replacement: %v", err), isPermissionError(err))
	}
	if err := os.Rename(tmpPath, exePath); err != nil {
		// Roll back backup immediately on failure
		_ = os.Rename(backupPath, exePath)
		return setUpdateError(fmt.Sprintf("Failed installing new executable: %v", err), isPermissionError(err))
	}
	cleanupTmp = false
	if runtime.GOOS != "windows" {
		_ = os.Remove(backupPath)
	}

	log.Printf("[UPDATER] Self-updated %s from v%s to v%s (SHA-256 %s verified)", exePath, appVersion, latestVer, expectedSumHex[:12])

	appUpdater.mu.Lock()
	appUpdater.status = UpdateStatus{
		Enabled:          isAutoUpdateEnabled(),
		Repo:             resolveConfiguredUpdateRepo(),
		CurrentVersion:   appVersion,
		LatestVersion:    latestVer,
		UpdateAvailable:  false,
		State:            "restarting",
		Message:          fmt.Sprintf("Updated to v%s. Restarting application...", latestVer),
		ReleaseURL:       releaseURL,
		AssetName:        assetName,
		LastCheckedAt:    time.Now().Format("02 Jan 2006 15:04:05"),
		CanSelfUpdate:    true,
		RestartScheduled: restartAfter,
	}
	if !restartAfter {
		appUpdater.status.State = "up_to_date"
		appUpdater.status.Message = fmt.Sprintf("Installed v%s cleanly.", latestVer)
	}
	finalStatus := appUpdater.status
	shutdownFn := appUpdater.shutdownServerFn
	appUpdater.mu.Unlock()

	if restartAfter {
		go triggerSelfRestart(exePath, shutdownFn)
	}

	return finalStatus
}

func setUpdateError(msg string, requiresElevation bool) UpdateStatus {
	log.Printf("[UPDATER] %s", msg)
	appUpdater.mu.Lock()
	defer appUpdater.mu.Unlock()
	appUpdater.status.State = "error"
	appUpdater.status.Message = msg
	appUpdater.status.RequiresElevation = requiresElevation
	appUpdater.status.RestartScheduled = false
	return appUpdater.status
}

func triggerSelfRestart(exePath string, shutdownFn func()) {
	time.Sleep(350 * time.Millisecond)

	args := buildRestartArgs(os.Args[1:])
	if shutdownFn != nil {
		shutdownFn()
	}
	ShutdownWhatsApp()
	time.Sleep(150 * time.Millisecond)

	cmd := exec.Command(exePath, args...)
	cmd.Stdin = nil
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		log.Printf("[UPDATER] Updated binary installed, but automatic restart failed: %v", err)
		return
	}
	log.Printf("[UPDATER] Spawned updated process (pid=%d); exiting old instance.", cmd.Process.Pid)
	os.Exit(0)
}

func buildRestartArgs(existing []string) []string {
	var out []string
	hasNoOpen := false
	hasWaitRestart := false
	for _, arg := range existing {
		switch arg {
		case "--update", "-update":
			continue
		case "--open", "-open", "--open=true", "-open=true":
			continue
		case "--no-open", "-no-open":
			hasNoOpen = true
			out = append(out, arg)
		case "--wait-restart", "-wait-restart":
			hasWaitRestart = true
			out = append(out, arg)
		default:
			out = append(out, arg)
		}
	}
	if !hasNoOpen {
		out = append(out, "--no-open")
	}
	if !hasWaitRestart {
		out = append(out, "--wait-restart")
	}
	return out
}

func StartAutoUpdateLoop(shutdownFn func()) {
	appUpdater.mu.Lock()
	appUpdater.shutdownServerFn = shutdownFn
	appUpdater.mu.Unlock()

	go func() {
		runCycle := func() {
			if !isAutoUpdateEnabled() || resolveConfiguredUpdateRepo() == "" {
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			st := CheckForUpdates(ctx)
			if st.UpdateAvailable && st.CanSelfUpdate {
				log.Printf("[UPDATER] New release v%s detected (current v%s). Starting automatic update...", st.LatestVersion, appVersion)
				ApplySelfUpdate(ctx, true)
			}
		}

		timer := time.NewTimer(autoUpdateInitialDelay)
		defer timer.Stop()
		<-timer.C
		runCycle()

		ticker := time.NewTicker(autoUpdateInterval)
		defer ticker.Stop()
		for range ticker.C {
			runCycle()
		}
	}()
}

func RunCLIUpdate() {
	fmt.Printf("=== %s — Self-Update Check ===\n", appName)
	fmt.Printf("Current Version: v%s (%s/%s)\n", strings.TrimPrefix(appVersion, "v"), runtime.GOOS, runtime.GOARCH)
	repo := resolveConfiguredUpdateRepo()
	if repo == "" {
		fmt.Println("No update repository configured. Set NSSF_UPDATE_REPO=owner/repo or configure it in System Settings.")
		return
	}
	fmt.Printf("Repository:      %s\n", repo)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	st := CheckForUpdates(ctx)
	fmt.Println(st.Message)
	if !st.UpdateAvailable {
		return
	}
	res := ApplySelfUpdate(ctx, false)
	if res.State == "error" {
		fmt.Printf("Update failed: %s\n", res.Message)
		os.Exit(1)
	}
	fmt.Printf("Successfully updated to v%s. Launch the application to run the new version.\n", res.LatestVersion)
}
