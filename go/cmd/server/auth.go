package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	sessionTTL        = 8 * time.Hour
	maxLoginAttempts  = 10
	loginWindow       = 15 * time.Minute
	resetCodeTTL      = 15 * time.Minute
	resetMaxAttempts  = 5
	resetCooldown     = 45 * time.Second
	pbkdf2Iterations  = 100000
	pbkdf2KeyLen      = 32
)

var sessionSecret = func() []byte {
	if s := strings.TrimSpace(os.Getenv("SESSION_SECRET")); s != "" {
		return []byte(s)
	}
	buf := make([]byte, 32)
	_, _ = rand.Read(buf)
	return buf
}()

type sessionEntry struct {
	username  string
	expiresAt time.Time
}

type loginAttemptRecord struct {
	count   int
	resetAt time.Time
}

type passwordResetChallenge struct {
	codeHash  string
	codeSalt  string
	expiresAt time.Time
	attempts  int
	sentAt    time.Time
}

var (
	authMu         sync.Mutex
	activeSessions = map[string]sessionEntry{}
	loginAttempts  = map[string]loginAttemptRecord{}
	activeReset    *passwordResetChallenge
)

// Pure Go stdlib PBKDF2-HMAC-SHA256 (RFC 2898 / 8018) with zero external packages.
func pbkdf2SHA256(password, salt []byte, iter, keyLen int) []byte {
	prf := func(key, data []byte) []byte {
		mac := hmac.New(sha256.New, key)
		mac.Write(data)
		return mac.Sum(nil)
	}
	numBlocks := (keyLen + sha256.Size - 1) / sha256.Size
	var dk []byte
	for block := 1; block <= numBlocks; block++ {
		uInput := make([]byte, len(salt)+4)
		copy(uInput, salt)
		uInput[len(salt)] = byte(block >> 24)
		uInput[len(salt)+1] = byte(block >> 16)
		uInput[len(salt)+2] = byte(block >> 8)
		uInput[len(salt)+3] = byte(block)

		u := prf(password, uInput)
		t := make([]byte, len(u))
		copy(t, u)
		for i := 2; i <= iter; i++ {
			u = prf(password, u)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:keyLen]
}

func HashPasswordWithSalt(password string) (hashHex string, saltHex string) {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	derived := pbkdf2SHA256([]byte(password), salt, pbkdf2Iterations, pbkdf2KeyLen)
	return hex.EncodeToString(derived), hex.EncodeToString(salt)
}

func VerifyPasswordHash(password, expectedHashHex, saltHex string) bool {
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return false
	}
	expected, err := hex.DecodeString(expectedHashHex)
	if err != nil {
		return false
	}
	derived := pbkdf2SHA256([]byte(password), salt, pbkdf2Iterations, len(expected))
	if len(derived) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare(derived, expected) == 1
}

func VerifyTimingSafeString(input, expected string) bool {
	a := sha256.Sum256([]byte(input))
	b := sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

func CreateAdminSessionToken(username string) string {
	authMu.Lock()
	defer authMu.Unlock()

	now := time.Now()
	for k, v := range activeSessions {
		if !v.expiresAt.After(now) {
			delete(activeSessions, k)
		}
	}

	jti := randomHex(18)
	exp := now.Add(sessionTTL)
	activeSessions[jti] = sessionEntry{username: username, expiresAt: exp}

	payloadJSON, _ := json.Marshal(map[string]any{
		"sub": username,
		"jti": jti,
		"exp": exp.UnixMilli(),
	})
	payloadB64 := base64.RawURLEncoding.EncodeToString(payloadJSON)
	mac := hmac.New(sha256.New, sessionSecret)
	mac.Write([]byte(payloadB64))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return payloadB64 + "." + sig
}

func VerifyAdminSessionToken(token string) (bool, string) {
	if token == "" {
		return false, ""
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return false, ""
	}
	payloadB64, providedSig := parts[0], parts[1]
	mac := hmac.New(sha256.New, sessionSecret)
	mac.Write([]byte(payloadB64))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(providedSig), []byte(expectedSig)) != 1 {
		return false, ""
	}

	rawPayload, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return false, ""
	}
	var parsed struct {
		Sub string `json:"sub"`
		Jti string `json:"jti"`
		Exp int64  `json:"exp"`
	}
	if json.Unmarshal(rawPayload, &parsed) != nil || parsed.Jti == "" {
		return false, ""
	}
	if time.UnixMilli(parsed.Exp).Before(time.Now()) {
		authMu.Lock()
		delete(activeSessions, parsed.Jti)
		authMu.Unlock()
		return false, ""
	}

	authMu.Lock()
	entry, ok := activeSessions[parsed.Jti]
	if !ok || !entry.expiresAt.After(time.Now()) {
		delete(activeSessions, parsed.Jti)
		authMu.Unlock()
		return false, ""
	}
	authMu.Unlock()
	return true, entry.username
}

func RevokeAdminSessionToken(token string) (bool, string) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return false, ""
	}
	rawPayload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false, ""
	}
	var parsed struct {
		Jti string `json:"jti"`
		Sub string `json:"sub"`
	}
	if json.Unmarshal(rawPayload, &parsed) == nil && parsed.Jti != "" {
		authMu.Lock()
		entry, ok := activeSessions[parsed.Jti]
		delete(activeSessions, parsed.Jti)
		authMu.Unlock()
		if ok {
			return true, defaultStr(entry.username, parsed.Sub)
		}
	}
	return false, ""
}

func RevokeAllAdminSessions() {
	authMu.Lock()
	defer authMu.Unlock()
	activeSessions = map[string]sessionEntry{}
}

const recoveryAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func randomCodeString(length int) string {
	buf := make([]byte, length)
	_, _ = rand.Read(buf)
	out := make([]byte, length)
	for i := 0; i < length; i++ {
		out[i] = recoveryAlphabet[int(buf[i])%len(recoveryAlphabet)]
	}
	return string(out)
}

func GenerateRecoveryKey() string {
	raw := randomCodeString(16)
	return fmt.Sprintf("NSSF-%s-%s-%s-%s", raw[0:4], raw[4:8], raw[8:12], raw[12:16])
}

func NormalizeRecoveryKey(raw string) string {
	s := strings.ToUpper(strings.TrimSpace(raw))
	s = strings.ReplaceAll(s, "-", "")
	s = strings.ReplaceAll(s, " ", "")
	return s
}

func CreatePasswordResetCode() (string, int, bool) {
	authMu.Lock()
	defer authMu.Unlock()
	now := time.Now()
	if activeReset != nil && activeReset.sentAt.Add(resetCooldown).After(now) {
		rem := int(activeReset.sentAt.Add(resetCooldown).Sub(now).Seconds())
		if rem < 1 {
			rem = 1
		}
		return "", rem, false
	}
	code := randomCodeString(8)
	formatted := code[0:4] + "-" + code[4:8]
	h, s := HashPasswordWithSalt(code)
	activeReset = &passwordResetChallenge{
		codeHash:  h,
		codeSalt:  s,
		expiresAt: now.Add(resetCodeTTL),
		attempts:  0,
		sentAt:    now,
	}
	return formatted, 0, true
}

func VerifyAndConsumePasswordResetCode(input string) (bool, string) {
	norm := strings.ToUpper(strings.TrimSpace(input))
	norm = strings.ReplaceAll(norm, "-", "")
	norm = strings.ReplaceAll(norm, " ", "")
	if len(norm) < 6 {
		return false, "Invalid or expired verification code."
	}

	authMu.Lock()
	defer authMu.Unlock()
	if activeReset == nil || time.Now().After(activeReset.expiresAt) {
		activeReset = nil
		return false, "Verification code has expired. Please request a new code."
	}
	if activeReset.attempts >= resetMaxAttempts {
		activeReset = nil
		return false, "Too many invalid verification attempts. Please request a new code."
	}

	if !VerifyPasswordHash(norm, activeReset.codeHash, activeReset.codeSalt) {
		activeReset.attempts++
		if activeReset.attempts >= resetMaxAttempts {
			activeReset = nil
			return false, "Too many invalid verification attempts. Please request a new code."
		}
		return false, "Invalid verification code."
	}

	activeReset = nil
	return true, ""
}

func ExtractBearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
}

func RequireAdminAuth(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ok, username := VerifyAdminSessionToken(ExtractBearerToken(r))
		if !ok {
			LogSystemAudit("AUTH", "Anonymous", RealClientIP(r), "SECURITY", r.Method+" "+r.URL.Path, "", "UNAUTHORIZED", "Blocked unauthenticated access attempt to protected route "+r.URL.Path)
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"ok":    false,
				"error": "Administrator authentication is required to access System Settings.",
			})
			return
		}
		next(w, r, username)
	}
}

func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	if r.RemoteAddr != "" {
		return r.RemoteAddr
	}
	return "unknown"
}

func RealClientIP(r *http.Request) string {
	if xff := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); xff != "" {
		return xff
	}
	if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
		return xri
	}
	return ClientIP(r)
}

func CheckLoginRateLimit(ip string) (bool, int) {
	authMu.Lock()
	defer authMu.Unlock()
	rec, ok := loginAttempts[ip]
	now := time.Now()
	if !ok || !rec.resetAt.After(now) {
		return true, 0
	}
	if rec.count >= maxLoginAttempts {
		sec := int(rec.resetAt.Sub(now).Seconds())
		if sec < 1 {
			sec = 1
		}
		return false, sec
	}
	return true, 0
}

func RecordFailedLogin(ip string) {
	authMu.Lock()
	defer authMu.Unlock()
	now := time.Now()
	rec, ok := loginAttempts[ip]
	if !ok || !rec.resetAt.After(now) {
		loginAttempts[ip] = loginAttemptRecord{count: 1, resetAt: now.Add(loginWindow)}
	} else {
		rec.count++
		loginAttempts[ip] = rec
	}
}

func ClearFailedLogins(ip string) {
	authMu.Lock()
	defer authMu.Unlock()
	delete(loginAttempts, ip)
}
