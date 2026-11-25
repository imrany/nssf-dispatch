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

// Pure Go ISO 18004 Byte-Mode QR Code Generator (Version 3: 29x29, ECC Level L)
const (
	qrSize          = 29
	qrDataCodewords = 55
	qrEccCodewords  = 15
)

var (
	gfExp [512]byte
	gfLog [256]int
)

func init() {
	x := 1
	for i := 0; i < 255; i++ {
		gfExp[i] = byte(x)
		gfLog[x] = i
		x <<= 1
		if (x & 0x100) != 0 {
			x ^= 0x11d
		}
	}
	for i := 255; i < 512; i++ {
		gfExp[i] = gfExp[i-255]
	}
}

func gfMul(a, b byte) byte {
	if a == 0 || b == 0 {
		return 0
	}
	return gfExp[gfLog[a]+gfLog[b]]
}

func rsGeneratorPoly(degree int) []byte {
	poly := []byte{1}
	for i := 0; i < degree; i++ {
		next := make([]byte, len(poly)+1)
		factor := gfExp[i]
		for j := 0; j < len(poly); j++ {
			next[j] ^= poly[j]
			next[j+1] ^= gfMul(poly[j], factor)
		}
		poly = next
	}
	return poly
}

func rsEncode(data []byte, eccCount int) []byte {
	gen := rsGeneratorPoly(eccCount)
	res := make([]byte, len(data)+eccCount)
	copy(res, data)
	for i := 0; i < len(data); i++ {
		coef := res[i]
		if coef != 0 {
			for j := 0; j < len(gen); j++ {
				res[i+j] ^= gfMul(gen[j], coef)
			}
		}
	}
	return res[len(data):]
}

func encodeQrMatrix(text string) [qrSize][qrSize]int {
	raw := []byte(text)
	if len(raw) > qrDataCodewords-2 {
		raw = raw[:qrDataCodewords-2]
	}
	var bits []int
	pushBits := func(val, count int) {
		for i := count - 1; i >= 0; i-- {
			bits = append(bits, (val>>i)&1)
		}
	}
	pushBits(0b0100, 4)
	pushBits(len(raw), 8)
	for _, b := range raw {
		pushBits(int(b), 8)
	}
	pushBits(0, 4)
	for len(bits)%8 != 0 {
		bits = append(bits, 0)
	}

	data := make([]byte, qrDataCodewords)
	nBytes := len(bits) / 8
	for i := 0; i < nBytes; i++ {
		val := 0
		for b := 0; b < 8; b++ {
			val = (val << 1) | bits[i*8+b]
		}
		data[i] = byte(val)
	}
	padBytes := []byte{0xec, 0x11}
	for i := nBytes; i < qrDataCodewords; i++ {
		data[i] = padBytes[(i-nBytes)%2]
	}

	ecc := rsEncode(data, qrEccCodewords)
	full := append(data, ecc...)

	var grid [qrSize][qrSize]int
	var reserved [qrSize][qrSize]bool
	for r := 0; r < qrSize; r++ {
		for c := 0; c < qrSize; c++ {
			grid[r][c] = -1
		}
	}
	setFixed := func(r, c, val int) {
		if r >= 0 && r < qrSize && c >= 0 && c < qrSize {
			grid[r][c] = val
			reserved[r][c] = true
		}
	}
	placeFinder := func(top, left int) {
		for r := -1; r <= 7; r++ {
			for c := -1; c <= 7; c++ {
				if r == -1 || r == 7 || c == -1 || c == 7 {
					setFixed(top+r, left+c, 0)
				} else {
					dark := r == 0 || r == 6 || c == 0 || c == 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
					if dark {
						setFixed(top+r, left+c, 1)
					} else {
						setFixed(top+r, left+c, 0)
					}
				}
			}
		}
	}
	placeFinder(0, 0)
	placeFinder(0, qrSize-7)
	placeFinder(qrSize-7, 0)

	for r := -2; r <= 2; r++ {
		for c := -2; c <= 2; c++ {
			if r == 2 || r == -2 || c == 2 || c == -2 || (r == 0 && c == 0) {
				setFixed(22+r, 22+c, 1)
			} else {
				setFixed(22+r, 22+c, 0)
			}
		}
	}
	for i := 8; i < qrSize-8; i++ {
		val := 0
		if i%2 == 0 {
			val = 1
		}
		if !reserved[6][i] {
			setFixed(6, i, val)
		}
		if !reserved[i][6] {
			setFixed(i, 6, val)
		}
	}
	setFixed(qrSize-8, 8, 1)
	for i := 0; i < 9; i++ {
		reserved[8][i] = true
		reserved[i][8] = true
	}
	for i := 0; i < 8; i++ {
		reserved[8][qrSize-1-i] = true
		reserved[qrSize-1-i][8] = true
	}

	var allBits []int
	for _, b := range full {
		for i := 7; i >= 0; i-- {
			allBits = append(allBits, int((b>>i)&1))
		}
	}
	bitIdx := 0
	up := true
	for col := qrSize - 1; col > 0; col -= 2 {
		if col == 6 {
			col--
		}
		for rowStep := 0; rowStep < qrSize; rowStep++ {
			row := rowStep
			if up {
				row = qrSize - 1 - rowStep
			}
			for _, c := range []int{col, col - 1} {
				if !reserved[row][c] {
					bit := 0
					if bitIdx < len(allBits) {
						bit = allBits[bitIdx]
						bitIdx++
					}
					if (row+c)%2 == 0 {
						bit ^= 1
					}
					grid[row][c] = bit
				}
			}
		}
		up = !up
	}

	const fmtBits = 0x77c4
	for i := 0; i < 15; i++ {
		bit := (fmtBits >> i) & 1
		if i < 6 {
			grid[i][8] = bit
		} else if i < 8 {
			grid[i+1][8] = bit
		} else {
			grid[qrSize-15+i][8] = bit
		}
		if i < 8 {
			grid[8][qrSize-1-i] = bit
		} else if i < 9 {
			grid[8][7] = bit
		} else {
			grid[8][14-i] = bit
		}
	}
	return grid
}

func GenerateQRSvg(payload string) string {
	matrix := encodeQrMatrix(payload)
	const quiet = 2
	total := qrSize + quiet*2
	var rects strings.Builder
	for r := 0; r < qrSize; r++ {
		for c := 0; c < qrSize; c++ {
			if matrix[r][c] == 1 {
				fmt.Fprintf(&rects, `<rect x="%d" y="%d" width="1" height="1" fill="#052e16"/>`, c+quiet, r+quiet)
			}
		}
	}
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="210" height="210" shape-rendering="crispEdges"><rect width="%d" height="%d" fill="#ffffff"/>%s</svg>`, total, total, total, total, rects.String())
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
					payload := defaultStr(bridgeResp.QRText, "nssf://wa-link/"+code)
					svg := defaultStr(bridgeResp.QRSvg, GenerateQRSvg(payload))
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
		saved, _ := SaveWhatsAppSession(WhatsAppSessionRecord{
			SessionCode:     existing.SessionCode,
			QRPayload:       existing.QRPayload,
			QRSvg:           existing.QRSvg,
			Paired:          existing.Paired,
			DeviceName:      cfg.WhatsAppDeviceName,
			BridgeURL:       cfg.WhatsAppBridgeURL,
			BridgeReachable: false,
			PairedPhone:     existing.PairedPhone,
			PairedAt:        existing.PairedAt,
		})
		if saved != nil {
			return WhatsAppQRResponse{
				Paired:          saved.Paired,
				BridgeReachable: false,
				SessionCode:     saved.SessionCode,
				QRSvg:           saved.QRSvg,
				DeviceName:      saved.DeviceName,
				BridgeURL:       saved.BridgeURL,
				PairedPhone:     saved.PairedPhone,
				PairedAt:        saved.PairedAt,
			}
		}
	}

	payload := "https://nssfdigital.enssf.co.ke/wa-pair?s=" + baseCode
	svg := GenerateQRSvg(payload)
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

func ConfirmWhatsAppPairingInDB(cfg AppSettings, sessionCode, pairedPhone string) *WhatsAppQRResponse {
	existing, _ := GetWhatsAppSession()
	if existing == nil {
		return nil
	}
	if sessionCode != "" && existing.SessionCode != sessionCode {
		return nil
	}
	phone := pairedPhone
	if phone == "" {
		phone = existing.PairedPhone
	}
	pairedAt := existing.PairedAt
	if pairedAt == "" {
		pairedAt = time.Now().Format("2006-01-02 15:04:05")
	}
	saved, _ := SaveWhatsAppSession(WhatsAppSessionRecord{
		SessionCode:     existing.SessionCode,
		QRPayload:       existing.QRPayload,
		QRSvg:           existing.QRSvg,
		Paired:          true,
		DeviceName:      cfg.WhatsAppDeviceName,
		BridgeURL:       cfg.WhatsAppBridgeURL,
		BridgeReachable: existing.BridgeReachable,
		PairedPhone:     phone,
		PairedAt:        pairedAt,
	})
	if saved == nil {
		return nil
	}
	return &WhatsAppQRResponse{
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

func UnlinkWhatsAppSession(cfg AppSettings) WhatsAppQRResponse {
	if parsed, err := url.Parse(cfg.WhatsAppBridgeURL); err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") {
		client := &http.Client{Timeout: 1500 * time.Millisecond}
		_, _ = client.Post(strings.TrimRight(cfg.WhatsAppBridgeURL, "/")+"/logout", "application/json", nil)
	}
	nextCode := "NSSF-WA-" + strings.ToUpper(randomHex(6))
	payload := "https://nssfdigital.enssf.co.ke/wa-pair?s=" + nextCode
	svg := GenerateQRSvg(payload)
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
