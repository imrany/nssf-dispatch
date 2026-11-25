package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
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

var (
	authMu         sync.Mutex
	activeSessions = map[string]sessionEntry{}
	loginAttempts  = map[string]loginAttemptRecord{}
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

func RevokeAdminSessionToken(token string) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return
	}
	rawPayload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return
	}
	var parsed struct {
		Jti string `json:"jti"`
	}
	if json.Unmarshal(rawPayload, &parsed) == nil && parsed.Jti != "" {
		authMu.Lock()
		delete(activeSessions, parsed.Jti)
		authMu.Unlock()
	}
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
