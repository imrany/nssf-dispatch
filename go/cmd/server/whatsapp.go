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
	BridgeURL       string `json:"bridgeUrl"`
	PairedPhone     string `json:"pairedPhone"`
	PairedAt        string `json:"pairedAt"`
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

func FetchWhatsAppQR(cfg AppSettings, forceRefresh bool) WhatsAppQRResponse {
	existing, _ := GetWhatsAppSession()
	baseCode := "NSSF-WA-" + strings.ToUpper(randomHex(6))
	if !forceRefresh && existing != nil && existing.SessionCode != "" {
		baseCode = existing.SessionCode
	}

	if parsed, err := url.Parse(cfg.WhatsAppBridgeURL); err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") {
		client := &http.Client{Timeout: 2 * time.Second}
		suffix := "/qr"
		if forceRefresh {
			suffix = "/qr?refresh=1"
		}
		resp, err := client.Get(strings.TrimRight(cfg.WhatsAppBridgeURL, "/") + suffix)
		if err == nil {
			defer resp.Body.Close()
			if resp.StatusCode == 200 {
				var bridgeResp struct {
					Paired      bool   `json:"paired"`
					QRSvg       string `json:"qrSvg"`
					QRText      string `json:"qrText"`
					SessionCode string `json:"sessionCode"`
					Phone       string `json:"phone"`
					PairedPhone string `json:"pairedPhone"`
				}
				if json.NewDecoder(resp.Body).Decode(&bridgeResp) == nil {
					code := defaultStr(bridgeResp.SessionCode, baseCode)
					svg := defaultStr(bridgeResp.QRSvg, generateFallbackQRSvg(code))
					payload := defaultStr(bridgeResp.QRText, "nssf://wa-link/"+code)
					phone := defaultStr(bridgeResp.PairedPhone, bridgeResp.Phone)
					pairedAt := ""
					if bridgeResp.Paired {
						if existing != nil && existing.PairedAt != "" {
							pairedAt = existing.PairedAt
						} else {
							pairedAt = time.Now().Format("2006-01-02 15:04:05")
						}
					}
					saved, _ := SaveWhatsAppSession(WhatsAppSessionRecord{
						SessionCode:     code,
						QRPayload:       payload,
						QRSvg:           svg,
						Paired:          bridgeResp.Paired,
						DeviceName:      cfg.WhatsAppDeviceName,
						BridgeURL:       cfg.WhatsAppBridgeURL,
						BridgeReachable: true,
						PairedPhone:     phone,
						PairedAt:        pairedAt,
					})
					if saved != nil {
						return WhatsAppQRResponse{
							Paired:          saved.Paired,
							BridgeReachable: saved.BridgeReachable,
							SessionCode:     saved.SessionCode,
							QRSvg:           saved.QRSvg,
							DeviceName:      saved.DeviceName,
							BridgeURL:       saved.BridgeURL,
							PairedPhone:     saved.PairedPhone,
							PairedAt:        saved.PairedAt,
						}
					}
				}
			}
		}
	}

	if !forceRefresh && existing != nil {
		return WhatsAppQRResponse{
			Paired:          existing.Paired,
			BridgeReachable: false,
			SessionCode:     existing.SessionCode,
			QRSvg:           existing.QRSvg,
			DeviceName:      cfg.WhatsAppDeviceName,
			BridgeURL:       cfg.WhatsAppBridgeURL,
			PairedPhone:     existing.PairedPhone,
			PairedAt:        existing.PairedAt,
		}
	}

	payload := "https://nssfdigital.enssf.co.ke/wa-pair?s=" + baseCode
	svg := generateFallbackQRSvg(baseCode)
	_, _ = SaveWhatsAppSession(WhatsAppSessionRecord{
		SessionCode:     baseCode,
		QRPayload:       payload,
		QRSvg:           svg,
		Paired:          false,
		DeviceName:      cfg.WhatsAppDeviceName,
		BridgeURL:       cfg.WhatsAppBridgeURL,
		BridgeReachable: false,
	})

	return WhatsAppQRResponse{
		Paired:          false,
		BridgeReachable: false,
		SessionCode:     baseCode,
		QRSvg:           svg,
		DeviceName:      cfg.WhatsAppDeviceName,
		BridgeURL:       cfg.WhatsAppBridgeURL,
	}
}

func UnlinkWhatsAppSession(cfg AppSettings) WhatsAppQRResponse {
	if parsed, err := url.Parse(cfg.WhatsAppBridgeURL); err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") {
		client := &http.Client{Timeout: 1500 * time.Millisecond}
		_, _ = client.Post(strings.TrimRight(cfg.WhatsAppBridgeURL, "/")+"/logout", "application/json", nil)
	}
	nextCode := "NSSF-WA-" + strings.ToUpper(randomHex(6))
	payload := "https://nssfdigital.enssf.co.ke/wa-pair?s=" + nextCode
	svg := generateFallbackQRSvg(nextCode)
	_, _ = SaveWhatsAppSession(WhatsAppSessionRecord{
		SessionCode:     nextCode,
		QRPayload:       payload,
		QRSvg:           svg,
		Paired:          false,
		DeviceName:      cfg.WhatsAppDeviceName,
		BridgeURL:       cfg.WhatsAppBridgeURL,
		BridgeReachable: false,
	})
	return WhatsAppQRResponse{
		Paired:          false,
		BridgeReachable: false,
		SessionCode:     nextCode,
		QRSvg:           svg,
		DeviceName:      cfg.WhatsAppDeviceName,
		BridgeURL:       cfg.WhatsAppBridgeURL,
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

	_, _, _, whatsappText, _ := BuildOfficialNSSFMessage(meta, renamedFile, cfg.PasswordMode, cfg.PortalURL, rawPassword, cfg.EmailSubjectTemplate, cfg.WhatsAppMessageTemplate)
	payload, _ := json.Marshal(map[string]string{
		"phone":          phone,
		"filename":       renamedFile,
		"caption":        whatsappText,
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
