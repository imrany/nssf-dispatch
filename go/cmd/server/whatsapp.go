package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type WhatsAppQRResponse struct {
	Paired          bool   `json:"paired"`
	BridgeReachable bool   `json:"bridgeReachable"`
	SessionCode     string `json:"sessionCode"`
	QRSvg           string `json:"qrSvg"`
	DeviceName      string `json:"deviceName"`
}

func generateFallbackQRSvg(sessionCode string) string {
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 210" width="210" height="210">
		<rect width="210" height="210" fill="#ffffff"/>
		<rect x="14" y="14" width="49" height="49" fill="none" stroke="#052e16" stroke-width="7"/>
		<rect x="28" y="28" width="21" height="21" fill="#052e16"/>
		<rect x="147" y="14" width="49" height="49" fill="none" stroke="#052e16" stroke-width="7"/>
		<rect x="161" y="28" width="21" height="21" fill="#052e16"/>
		<rect x="14" y="147" width="49" height="49" fill="none" stroke="#052e16" stroke-width="7"/>
		<rect x="28" y="161" width="21" height="21" fill="#052e16"/>
		<rect x="84" y="84" width="42" height="42" fill="none" stroke="#006837" stroke-width="6"/>
		<text x="105" y="198" font-size="10" text-anchor="middle" fill="#052e16" font-family="monospace">%s</text>
	</svg>`, sessionCode)
}

func FetchWhatsAppQR(cfg AppSettings) WhatsAppQRResponse {
	sessionCode := "NSSF-WA-" + strings.ToUpper(randomHex(6))
	if parsed, err := url.Parse(cfg.WhatsAppBridgeURL); err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") {
		client := &http.Client{Timeout: 2 * time.Second}
		resp, err := client.Get(strings.TrimRight(cfg.WhatsAppBridgeURL, "/") + "/qr")
		if err == nil {
			defer resp.Body.Close()
			if resp.StatusCode == 200 {
				var bridgeResp struct {
					Paired bool   `json:"paired"`
					QRSvg  string `json:"qrSvg"`
				}
				if json.NewDecoder(resp.Body).Decode(&bridgeResp) == nil && bridgeResp.QRSvg != "" {
					return WhatsAppQRResponse{
						Paired:          bridgeResp.Paired || cfg.WhatsAppPaired,
						BridgeReachable: true,
						SessionCode:     sessionCode,
						QRSvg:           bridgeResp.QRSvg,
						DeviceName:      cfg.WhatsAppDeviceName,
					}
				}
			}
		}
	}

	return WhatsAppQRResponse{
		Paired:          cfg.WhatsAppPaired,
		BridgeReachable: false,
		SessionCode:     sessionCode,
		QRSvg:           generateFallbackQRSvg(sessionCode),
		DeviceName:      cfg.WhatsAppDeviceName,
	}
}

func SendWhatsAppStatement(cfg AppSettings, phone string, meta *StatementMeta, renamedFile string, encryptedPDF []byte, rawPassword string) error {
	if !cfg.WhatsAppEnabled {
		return fmt.Errorf("WhatsApp dispatch is currently disabled in system settings")
	}

	parsed, err := url.Parse(cfg.WhatsAppBridgeURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("invalid WhatsApp gateway URL")
	}

	_, _, plainText, _ := BuildOfficialNSSFMessage(meta, renamedFile, cfg.PasswordMode, cfg.PortalURL, rawPassword)
	payload, _ := json.Marshal(map[string]string{
		"phone":          phone,
		"filename":       renamedFile,
		"caption":        plainText,
		"documentBase64": base64.StdEncoding.EncodeToString(encryptedPDF),
	})

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(strings.TrimRight(cfg.WhatsAppBridgeURL, "/")+"/send-document", "application/json", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("WhatsApp gateway unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("WhatsApp dispatch failed with HTTP status %d", resp.StatusCode)
	}
	return nil
}
