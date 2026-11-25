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
	Error           string `json:"error,omitempty"`
}

// Pure Go ISO 18004 Byte-Mode QR Code Generator (ECC Level L, Versions 3 / 5 / 12)
// Supports payloads up to 367 bytes (including full WhatsApp Web Multi-Device pairing tokens).
type qrVersionSpec struct {
	version      int
	size         int
	lenBits      int
	eccPerBlock  int
	group1Blocks int
	group1Data   int
	group2Blocks int
	group2Data   int
	alignCenters []int
	versionBits  uint32
}

var qrVersionSpecs = []qrVersionSpec{
	{
		version:      3,
		size:         29,
		lenBits:      8,
		eccPerBlock:  15,
		group1Blocks: 1,
		group1Data:   55,
		group2Blocks: 0,
		group2Data:   0,
		alignCenters: []int{6, 22},
		versionBits:  0,
	},
	{
		version:      5,
		size:         37,
		lenBits:      8,
		eccPerBlock:  26,
		group1Blocks: 1,
		group1Data:   108,
		group2Blocks: 0,
		group2Data:   0,
		alignCenters: []int{6, 30},
		versionBits:  0,
	},
	{
		version:      12,
		size:         65,
		lenBits:      16,
		eccPerBlock:  24,
		group1Blocks: 2,
		group1Data:   92,
		group2Blocks: 2,
		group2Data:   93,
		alignCenters: []int{6, 32, 58},
		versionBits:  0x0C762,
	},
}

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

func selectQRSpec(byteLen int) qrVersionSpec {
	for _, spec := range qrVersionSpecs {
		totalData := spec.group1Blocks*spec.group1Data + spec.group2Blocks*spec.group2Data
		headerBytes := 2
		if spec.lenBits == 16 {
			headerBytes = 3
		}
		if byteLen <= totalData-headerBytes {
			return spec
		}
	}
	return qrVersionSpecs[len(qrVersionSpecs)-1]
}

func encodeQrMatrix(text string) ([][]int, int) {
	raw := []byte(text)
	spec := selectQRSpec(len(raw))
	totalData := spec.group1Blocks*spec.group1Data + spec.group2Blocks*spec.group2Data
	headerBytes := 2
	if spec.lenBits == 16 {
		headerBytes = 3
	}
	if len(raw) > totalData-headerBytes {
		raw = raw[:totalData-headerBytes]
	}

	var bits []int
	pushBits := func(val, count int) {
		for i := count - 1; i >= 0; i-- {
			bits = append(bits, (val>>i)&1)
		}
	}
	pushBits(0b0100, 4)
	pushBits(len(raw), spec.lenBits)
	for _, b := range raw {
		pushBits(int(b), 8)
	}
	for i := 0; i < 4 && len(bits) < totalData*8; i++ {
		bits = append(bits, 0)
	}
	for len(bits)%8 != 0 {
		bits = append(bits, 0)
	}

	data := make([]byte, totalData)
	nBytes := len(bits) / 8
	for i := 0; i < nBytes && i < totalData; i++ {
		val := 0
		for b := 0; b < 8; b++ {
			val = (val << 1) | bits[i*8+b]
		}
		data[i] = byte(val)
	}
	padBytes := []byte{0xec, 0x11}
	for i := nBytes; i < totalData; i++ {
		data[i] = padBytes[(i-nBytes)%2]
	}

	// Split into RS blocks & interleave per ISO 18004
	var dataBlocks [][]byte
	var eccBlocks [][]byte
	offset := 0
	for i := 0; i < spec.group1Blocks; i++ {
		blk := data[offset : offset+spec.group1Data]
		offset += spec.group1Data
		dataBlocks = append(dataBlocks, blk)
		eccBlocks = append(eccBlocks, rsEncode(blk, spec.eccPerBlock))
	}
	for i := 0; i < spec.group2Blocks; i++ {
		blk := data[offset : offset+spec.group2Data]
		offset += spec.group2Data
		dataBlocks = append(dataBlocks, blk)
		eccBlocks = append(eccBlocks, rsEncode(blk, spec.eccPerBlock))
	}

	maxDataLen := spec.group1Data
	if spec.group2Data > maxDataLen {
		maxDataLen = spec.group2Data
	}
	var full []byte
	for i := 0; i < maxDataLen; i++ {
		for _, blk := range dataBlocks {
			if i < len(blk) {
				full = append(full, blk[i])
			}
		}
	}
	for i := 0; i < spec.eccPerBlock; i++ {
		for _, blk := range eccBlocks {
			full = append(full, blk[i])
		}
	}

	sz := spec.size
	grid := make([][]int, sz)
	reserved := make([][]bool, sz)
	for r := 0; r < sz; r++ {
		grid[r] = make([]int, sz)
		reserved[r] = make([]bool, sz)
		for c := 0; c < sz; c++ {
			grid[r][c] = -1
		}
	}

	setFixed := func(r, c, val int) {
		if r >= 0 && r < sz && c >= 0 && c < sz {
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
	placeFinder(0, sz-7)
	placeFinder(sz-7, 0)

	// Alignment patterns
	for _, rCenter := range spec.alignCenters {
		for _, cCenter := range spec.alignCenters {
			if (rCenter == 6 && cCenter == 6) ||
				(rCenter == 6 && cCenter == sz-7) ||
				(rCenter == sz-7 && cCenter == 6) {
				continue
			}
			for r := -2; r <= 2; r++ {
				for c := -2; c <= 2; c++ {
					if r == 2 || r == -2 || c == 2 || c == -2 || (r == 0 && c == 0) {
						setFixed(rCenter+r, cCenter+c, 1)
					} else {
						setFixed(rCenter+r, cCenter+c, 0)
					}
				}
			}
		}
	}

	// Timing patterns
	for i := 8; i < sz-8; i++ {
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

	// Dark module + Format info reservation
	setFixed(sz-8, 8, 1)
	for i := 0; i < 9; i++ {
		if !reserved[8][i] {
			reserved[8][i] = true
		}
		if !reserved[i][8] {
			reserved[i][8] = true
		}
	}
	for i := 0; i < 8; i++ {
		reserved[8][sz-1-i] = true
		reserved[sz-1-i][8] = true
	}

	// Version information bits for Version >= 7
	if spec.version >= 7 && spec.versionBits != 0 {
		for i := 0; i < 18; i++ {
			bit := int((spec.versionBits >> i) & 1)
			r := i / 3
			c := sz - 11 + (i % 3)
			setFixed(r, c, bit)
			setFixed(c, r, bit)
		}
	}

	var allBits []int
	for _, b := range full {
		for i := 7; i >= 0; i-- {
			allBits = append(allBits, int((b>>i)&1))
		}
	}
	bitIdx := 0
	up := true
	for col := sz - 1; col > 0; col -= 2 {
		if col == 6 {
			col--
		}
		for rowStep := 0; rowStep < sz; rowStep++ {
			row := rowStep
			if up {
				row = sz - 1 - rowStep
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
			grid[sz-15+i][8] = bit
		}
		if i < 8 {
			grid[8][sz-1-i] = bit
		} else if i < 9 {
			grid[8][7] = bit
		} else {
			grid[8][14-i] = bit
		}
	}
	return grid, sz
}

func GenerateQRSvg(payload string) string {
	if strings.TrimSpace(payload) == "" {
		return ""
	}
	matrix, sz := encodeQrMatrix(payload)
	const quiet = 4
	total := sz + quiet*2
	var rects strings.Builder
	for r := 0; r < sz; r++ {
		for c := 0; c < sz; c++ {
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
					payload := strings.TrimSpace(bridgeResp.QRText)
					svg := strings.TrimSpace(bridgeResp.QRSvg)
					if svg == "" && payload != "" {
						svg = GenerateQRSvg(payload)
					}
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

	if existing != nil && existing.Paired {
		return WhatsAppQRResponse{
			Paired:          true,
			BridgeReachable: false,
			SessionCode:     existing.SessionCode,
			QRSvg:           "",
			DeviceName:      cfg.WhatsAppDeviceName,
			BridgeURL:       cfg.WhatsAppBridgeURL,
			PairedPhone:     existing.PairedPhone,
			PairedAt:        existing.PairedAt,
		}
	}

	return WhatsAppQRResponse{
		Paired:          false,
		BridgeReachable: false,
		SessionCode:     baseCode,
		QRSvg:           "",
		DeviceName:      cfg.WhatsAppDeviceName,
		BridgeURL:       cfg.WhatsAppBridgeURL,
		Error: fmt.Sprintf(
			"No WhatsApp Web gateway reachable at %s. Start a WhatsApp gateway sidecar at that URL to generate a live pairing QR code.",
			defaultStr(cfg.WhatsAppBridgeURL, "http://127.0.0.1:8095"),
		),
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
	_, _ = SaveWhatsAppSession(WhatsAppSessionRecord{
		SessionCode:     nextCode,
		QRPayload:       "",
		QRSvg:           "",
		Paired:          false,
		DeviceName:      cfg.WhatsAppDeviceName,
		BridgeURL:       cfg.WhatsAppBridgeURL,
		BridgeReachable: false,
	})
	return FetchWhatsAppQR(cfg, true)
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
