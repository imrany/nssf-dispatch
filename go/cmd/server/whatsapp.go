package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
	"rsc.io/qr"
)

type WhatsAppQRResponse struct {
	Paired          bool   `json:"paired"`
	Connected       bool   `json:"connected"`
	BridgeReachable bool   `json:"bridgeReachable"`
	Engine          string `json:"engine"`
	SessionCode     string `json:"sessionCode"`
	QRSvg           string `json:"qrSvg"`
	DeviceName      string `json:"deviceName"`
	BridgeURL       string `json:"bridgeUrl"`
	PairedPhone     string `json:"pairedPhone"`
	PairedAt        string `json:"pairedAt"`
	Error           string `json:"error,omitempty"`
}

type whatsAppManager struct {
	initMu    sync.Mutex
	mu        sync.Mutex
	container *sqlstore.Container
	client    *whatsmeow.Client

	sessionCode string
	qrPayload   string
	qrSvg       string
	paired      bool
	connected   bool
	pairedPhone string
	pairedAt    string
	deviceName  string
	lastError   string

	qrLoopActive bool
	qrCancel     context.CancelFunc
	firstQRCh    chan struct{}
}

var waManager = &whatsAppManager{}

func getWhatsAppDBPath() string {
	if p := strings.TrimSpace(os.Getenv("NSSF_WA_DB_PATH")); p != "" {
		return p
	}
	dir := getAppDataDir()
	if dir == "" || dir == "." {
		return "nssf_whatsapp.db"
	}
	return filepath.Join(dir, "nssf_whatsapp.db")
}

// GenerateQRSvg encodes any WhatsApp Web Multi-Device QR payload into a crisp SVG using rsc.io/qr.
func GenerateQRSvg(payload string) string {
	if strings.TrimSpace(payload) == "" {
		return ""
	}
	code, err := qr.Encode(payload, qr.L)
	if err != nil {
		return ""
	}
	sz := code.Size
	const quiet = 4
	total := sz + quiet*2
	var pathBuf strings.Builder
	for y := 0; y < sz; y++ {
		for x := 0; x < sz; x++ {
			if code.Black(x, y) {
				fmt.Fprintf(&pathBuf, "M%d,%dh1v1h-1z", x+quiet, y+quiet)
			}
		}
	}
	return fmt.Sprintf(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="210" height="210" shape-rendering="crispEdges"><rect width="%d" height="%d" fill="#ffffff"/><path fill="#052e16" d="%s"/></svg>`,
		total, total, total, total, pathBuf.String(),
	)
}

func InitWhatsApp(cfg AppSettings) {
	if err := waManager.ensureInitialized(cfg); err != nil {
		log.Printf("[WHATSAPP] Initialization deferred: %v", err)
	}
}

func ShutdownWhatsApp() {
	waManager.mu.Lock()
	cancel := waManager.qrCancel
	client := waManager.client
	waManager.qrCancel = nil
	waManager.qrLoopActive = false
	waManager.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if client != nil {
		client.Disconnect()
	}
}

func (m *whatsAppManager) ensureInitialized(cfg AppSettings) error {
	m.initMu.Lock()
	defer m.initMu.Unlock()

	deviceLabel := defaultStr(strings.TrimSpace(cfg.WhatsAppDeviceName), "NSSF Service Desk")
	store.DeviceProps.Os = proto.String(deviceLabel)

	m.mu.Lock()
	if m.container != nil && m.client != nil {
		m.deviceName = deviceLabel
		m.mu.Unlock()
		return nil
	}
	m.mu.Unlock()

	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)", getWhatsAppDBPath())
	dbLog := waLog.Stdout("WhatsAppDB", "WARN", true)
	container, err := sqlstore.New(context.Background(), "sqlite", dsn, dbLog)
	if err != nil {
		return fmt.Errorf("failed to open whatsmeow SQLite store: %w", err)
	}

	deviceStore, err := container.GetFirstDevice(context.Background())
	if err != nil {
		return fmt.Errorf("failed to load whatsmeow device store: %w", err)
	}

	client := m.newClientWithHandlers(deviceStore, deviceLabel)

	existing, _ := GetWhatsAppSession()
	sessionCode := "NSSF-WA-" + strings.ToUpper(randomHex(6))
	pairedAt := ""
	if existing != nil {
		if existing.SessionCode != "" {
			sessionCode = existing.SessionCode
		}
		pairedAt = existing.PairedAt
	}

	isPaired := deviceStore.ID != nil
	pairedPhone := ""
	if isPaired {
		pairedPhone = deviceStore.ID.User
		if pairedAt == "" {
			pairedAt = time.Now().Format("2006-01-02 15:04:05")
		}
	}

	m.mu.Lock()
	m.container = container
	m.client = client
	m.sessionCode = sessionCode
	m.deviceName = deviceLabel
	m.paired = isPaired
	m.pairedPhone = pairedPhone
	m.pairedAt = pairedAt
	m.lastError = ""
	m.mu.Unlock()

	if isPaired {
		_, _ = SaveWhatsAppSession(WhatsAppSessionRecord{
			SessionCode:     sessionCode,
			Paired:          true,
			DeviceName:      deviceLabel,
			BridgeURL:       "whatsmeow://native",
			BridgeReachable: true,
			PairedPhone:     pairedPhone,
			PairedAt:        pairedAt,
		})
		go func() {
			if err := client.Connect(); err != nil {
				log.Printf("[WHATSAPP] Auto-connect failed: %v", err)
				m.mu.Lock()
				m.lastError = err.Error()
				m.mu.Unlock()
			}
		}()
	} else {
		_, _ = SaveWhatsAppSession(WhatsAppSessionRecord{
			SessionCode:     sessionCode,
			Paired:          false,
			DeviceName:      deviceLabel,
			BridgeURL:       "whatsmeow://native",
			BridgeReachable: false,
		})
	}

	return nil
}

func (m *whatsAppManager) newClientWithHandlers(deviceStore *store.Device, deviceLabel string) *whatsmeow.Client {
	store.DeviceProps.Os = proto.String(deviceLabel)
	clientLog := waLog.Stdout("WhatsApp", "INFO", true)
	client := whatsmeow.NewClient(deviceStore, clientLog)
	client.AddEventHandler(func(rawEvt any) {
		switch evt := rawEvt.(type) {
		case *events.PairSuccess:
			m.handlePaired(evt.ID.User)
		case *events.Connected:
			phone := ""
			if client.Store != nil && client.Store.ID != nil {
				phone = client.Store.ID.User
			}
			m.handleConnected(phone)
		case *events.Disconnected:
			m.mu.Lock()
			m.connected = false
			m.mu.Unlock()
			log.Printf("[WHATSAPP] Disconnected from WhatsApp Web")
		case *events.LoggedOut:
			m.handleLoggedOut(fmt.Sprintf("WhatsApp device unlinked from phone (%v)", evt.Reason))
		}
	})
	return client
}

func (m *whatsAppManager) handlePaired(phone string) {
	m.mu.Lock()
	m.paired = true
	if phone != "" {
		m.pairedPhone = phone
	}
	if m.pairedAt == "" {
		m.pairedAt = time.Now().Format("2006-01-02 15:04:05")
	}
	m.qrPayload = ""
	m.qrSvg = ""
	m.lastError = ""
	m.qrLoopActive = false
	if m.firstQRCh != nil {
		close(m.firstQRCh)
		m.firstQRCh = nil
	}
	rec := WhatsAppSessionRecord{
		SessionCode:     m.sessionCode,
		Paired:          true,
		DeviceName:      m.deviceName,
		BridgeURL:       "whatsmeow://native",
		BridgeReachable: true,
		PairedPhone:     m.pairedPhone,
		PairedAt:        m.pairedAt,
	}
	m.mu.Unlock()

	_, _ = SaveWhatsAppSession(rec)
	log.Printf("[WHATSAPP] Paired device +%s (%s)", rec.PairedPhone, rec.DeviceName)
}

func (m *whatsAppManager) handleConnected(phone string) {
	m.mu.Lock()
	m.connected = true
	m.lastError = ""
	if phone != "" {
		m.paired = true
		m.pairedPhone = phone
		if m.pairedAt == "" {
			m.pairedAt = time.Now().Format("2006-01-02 15:04:05")
		}
	}
	isPaired := m.paired
	rec := WhatsAppSessionRecord{
		SessionCode:     m.sessionCode,
		Paired:          m.paired,
		DeviceName:      m.deviceName,
		BridgeURL:       "whatsmeow://native",
		BridgeReachable: true,
		PairedPhone:     m.pairedPhone,
		PairedAt:        m.pairedAt,
	}
	m.mu.Unlock()

	if isPaired {
		_, _ = SaveWhatsAppSession(rec)
	}
	log.Printf("[WHATSAPP] Connected to WhatsApp Web (paired=%v, phone=+%s)", isPaired, rec.PairedPhone)
}

func (m *whatsAppManager) handleLoggedOut(reason string) {
	m.mu.Lock()
	if m.qrCancel != nil {
		m.qrCancel()
		m.qrCancel = nil
	}
	m.connected = false
	m.paired = false
	m.pairedPhone = ""
	m.pairedAt = ""
	m.qrPayload = ""
	m.qrSvg = ""
	m.qrLoopActive = false
	m.lastError = reason
	m.sessionCode = "NSSF-WA-" + strings.ToUpper(randomHex(6))
	container := m.container
	oldClient := m.client
	deviceLabel := defaultStr(m.deviceName, "NSSF Service Desk")
	rec := WhatsAppSessionRecord{
		SessionCode:     m.sessionCode,
		Paired:          false,
		DeviceName:      deviceLabel,
		BridgeURL:       "whatsmeow://native",
		BridgeReachable: false,
	}
	m.mu.Unlock()

	if oldClient != nil {
		oldClient.Disconnect()
		if container != nil && oldClient.Store != nil && oldClient.Store.ID != nil {
			delCtx, cancelDel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = container.DeleteDevice(delCtx, oldClient.Store)
			cancelDel()
		}
	}
	if container != nil {
		if freshStore, err := container.GetFirstDevice(context.Background()); err == nil {
			freshClient := m.newClientWithHandlers(freshStore, deviceLabel)
			m.mu.Lock()
			m.client = freshClient
			m.mu.Unlock()
		}
	}
	_, _ = SaveWhatsAppSession(rec)
	log.Printf("[WHATSAPP] %s", reason)
}

func (m *whatsAppManager) snapshot(cfg AppSettings) WhatsAppQRResponse {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.client != nil {
		m.connected = m.client.IsConnected()
		if m.client.Store != nil && m.client.Store.ID != nil {
			m.paired = true
			if m.pairedPhone == "" {
				m.pairedPhone = m.client.Store.ID.User
			}
		}
	}
	return WhatsAppQRResponse{
		Paired:          m.paired,
		Connected:       m.connected,
		BridgeReachable: m.connected || m.qrSvg != "" || m.paired,
		Engine:          "whatsmeow",
		SessionCode:     m.sessionCode,
		QRSvg:           m.qrSvg,
		DeviceName:      defaultStr(strings.TrimSpace(cfg.WhatsAppDeviceName), m.deviceName),
		BridgeURL:       "whatsmeow://native",
		PairedPhone:     m.pairedPhone,
		PairedAt:        m.pairedAt,
		Error:           m.lastError,
	}
}

func FetchWhatsAppQR(cfg AppSettings, forceRefresh bool) WhatsAppQRResponse {
	if err := waManager.ensureInitialized(cfg); err != nil {
		return WhatsAppQRResponse{
			Paired:          false,
			Connected:       false,
			BridgeReachable: false,
			Engine:          "whatsmeow",
			SessionCode:     "NSSF-WA-" + strings.ToUpper(randomHex(6)),
			DeviceName:      defaultStr(strings.TrimSpace(cfg.WhatsAppDeviceName), "NSSF Service Desk"),
			BridgeURL:       "whatsmeow://native",
			Error:           err.Error(),
		}
	}

	waManager.mu.Lock()
	client := waManager.client
	container := waManager.container
	alreadyPaired := client != nil && client.Store != nil && client.Store.ID != nil
	qrLoopActive := waManager.qrLoopActive
	hasQR := waManager.qrSvg != ""
	waManager.mu.Unlock()

	if alreadyPaired {
		if !client.IsConnected() {
			go func() {
				if err := client.Connect(); err != nil {
					waManager.mu.Lock()
					waManager.lastError = err.Error()
					waManager.mu.Unlock()
				}
			}()
		}
		return waManager.snapshot(cfg)
	}

	if !forceRefresh && qrLoopActive && hasQR {
		return waManager.snapshot(cfg)
	}

	// Start or restart QR pairing flow
	waManager.mu.Lock()
	if waManager.qrCancel != nil {
		waManager.qrCancel()
		waManager.qrCancel = nil
	}
	oldClient := waManager.client
	deviceLabel := defaultStr(strings.TrimSpace(cfg.WhatsAppDeviceName), "NSSF Service Desk")
	waManager.deviceName = deviceLabel
	waManager.qrPayload = ""
	waManager.qrSvg = ""
	waManager.lastError = ""
	waManager.sessionCode = "NSSF-WA-" + strings.ToUpper(randomHex(6))
	waManager.qrLoopActive = true
	readyCh := make(chan struct{})
	waManager.firstQRCh = readyCh
	waManager.mu.Unlock()

	if oldClient != nil {
		oldClient.Disconnect()
	}

	deviceStore, err := container.GetFirstDevice(context.Background())
	if err != nil {
		waManager.mu.Lock()
		waManager.qrLoopActive = false
		waManager.lastError = fmt.Sprintf("Failed to prepare WhatsApp device store: %v", err)
		if waManager.firstQRCh == readyCh {
			close(readyCh)
			waManager.firstQRCh = nil
		}
		waManager.mu.Unlock()
		return waManager.snapshot(cfg)
	}

	freshClient := waManager.newClientWithHandlers(deviceStore, deviceLabel)
	qrCtx, qrCancel := context.WithCancel(context.Background())

	waManager.mu.Lock()
	waManager.client = freshClient
	waManager.qrCancel = qrCancel
	waManager.mu.Unlock()

	qrChan, err := freshClient.GetQRChannel(qrCtx)
	if err != nil {
		qrCancel()
		waManager.mu.Lock()
		waManager.qrLoopActive = false
		waManager.lastError = fmt.Sprintf("Failed to open WhatsApp QR channel: %v", err)
		if waManager.firstQRCh == readyCh {
			close(readyCh)
			waManager.firstQRCh = nil
		}
		waManager.mu.Unlock()
		return waManager.snapshot(cfg)
	}

	if err := freshClient.Connect(); err != nil {
		qrCancel()
		waManager.mu.Lock()
		waManager.qrLoopActive = false
		waManager.lastError = fmt.Sprintf("WhatsApp Web connection failed: %v", err)
		if waManager.firstQRCh == readyCh {
			close(readyCh)
			waManager.firstQRCh = nil
		}
		waManager.mu.Unlock()
		return waManager.snapshot(cfg)
	}

	go func(c *whatsmeow.Client, ch <-chan whatsmeow.QRChannelItem, firstCh chan struct{}, label string) {
		signalReady := func() {
			waManager.mu.Lock()
			if waManager.firstQRCh == firstCh {
				close(firstCh)
				waManager.firstQRCh = nil
			}
			waManager.mu.Unlock()
		}

		for evt := range ch {
			switch evt.Event {
			case "code":
				svg := GenerateQRSvg(evt.Code)
				waManager.mu.Lock()
				waManager.qrPayload = evt.Code
				waManager.qrSvg = svg
				waManager.lastError = ""
				code := waManager.sessionCode
				waManager.mu.Unlock()

				_, _ = SaveWhatsAppSession(WhatsAppSessionRecord{
					SessionCode:     code,
					QRPayload:       evt.Code,
					QRSvg:           svg,
					Paired:          false,
					DeviceName:      label,
					BridgeURL:       "whatsmeow://native",
					BridgeReachable: true,
				})
				signalReady()
				log.Printf("[WHATSAPP] Generated fresh whatsmeow QR code (session=%s)", code)

			case "success":
				phone := ""
				if c.Store != nil && c.Store.ID != nil {
					phone = c.Store.ID.User
				}
				waManager.handlePaired(phone)
				return

			case "timeout":
				waManager.mu.Lock()
				waManager.qrLoopActive = false
				waManager.qrPayload = ""
				waManager.qrSvg = ""
				if !waManager.paired {
					waManager.lastError = "WhatsApp QR code timed out before scanning. Click Refresh QR to generate a new code."
				}
				waManager.mu.Unlock()
				signalReady()
				return

			default:
				waManager.mu.Lock()
				waManager.qrLoopActive = false
				if evt.Error != nil {
					waManager.lastError = fmt.Sprintf("WhatsApp pairing error: %v", evt.Error)
				} else if evt.Event != "" && !waManager.paired {
					waManager.lastError = fmt.Sprintf("WhatsApp pairing ended: %s", evt.Event)
				}
				waManager.mu.Unlock()
				signalReady()
			}
		}

		waManager.mu.Lock()
		waManager.qrLoopActive = false
		waManager.mu.Unlock()
		signalReady()
	}(freshClient, qrChan, readyCh, deviceLabel)

	select {
	case <-readyCh:
	case <-time.After(6 * time.Second):
	}

	return waManager.snapshot(cfg)
}

func ReconnectWhatsApp(cfg AppSettings) WhatsAppQRResponse {
	if err := waManager.ensureInitialized(cfg); err != nil {
		return FetchWhatsAppQR(cfg, false)
	}

	waManager.mu.Lock()
	client := waManager.client
	paired := client != nil && client.Store != nil && client.Store.ID != nil
	waManager.mu.Unlock()

	if !paired {
		return FetchWhatsAppQR(cfg, false)
	}

	if !client.IsConnected() {
		if err := client.Connect(); err != nil {
			waManager.mu.Lock()
			waManager.lastError = fmt.Sprintf("Reconnect failed: %v", err)
			waManager.mu.Unlock()
		} else {
			client.WaitForConnection(5 * time.Second)
		}
	}
	return waManager.snapshot(cfg)
}

func ConfirmWhatsAppPairingInDB(cfg AppSettings, sessionCode, pairedPhone string) *WhatsAppQRResponse {
	snap := waManager.snapshot(cfg)
	return &snap
}

func UnlinkWhatsAppSession(cfg AppSettings) WhatsAppQRResponse {
	_ = waManager.ensureInitialized(cfg)

	waManager.mu.Lock()
	if waManager.qrCancel != nil {
		waManager.qrCancel()
		waManager.qrCancel = nil
	}
	client := waManager.client
	container := waManager.container
	deviceLabel := defaultStr(strings.TrimSpace(cfg.WhatsAppDeviceName), "NSSF Service Desk")
	waManager.paired = false
	waManager.connected = false
	waManager.pairedPhone = ""
	waManager.pairedAt = ""
	waManager.qrPayload = ""
	waManager.qrSvg = ""
	waManager.qrLoopActive = false
	waManager.lastError = ""
	waManager.sessionCode = "NSSF-WA-" + strings.ToUpper(randomHex(6))
	nextCode := waManager.sessionCode
	waManager.mu.Unlock()

	if client != nil {
		if client.Store != nil && client.Store.ID != nil {
			logoutCtx, cancelLogout := context.WithTimeout(context.Background(), 8*time.Second)
			if err := client.Logout(logoutCtx); err != nil {
				log.Printf("[WHATSAPP] Server logout returned %v; clearing local device store", err)
			}
			cancelLogout()
		}
		client.Disconnect()
		if container != nil && client.Store != nil && client.Store.ID != nil {
			delCtx, cancelDel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = container.DeleteDevice(delCtx, client.Store)
			cancelDel()
		}
	}

	if container != nil {
		if freshStore, err := container.GetFirstDevice(context.Background()); err == nil {
			freshClient := waManager.newClientWithHandlers(freshStore, deviceLabel)
			waManager.mu.Lock()
			waManager.client = freshClient
			waManager.mu.Unlock()
		}
	}

	_, _ = SaveWhatsAppSession(WhatsAppSessionRecord{
		SessionCode:     nextCode,
		QRPayload:       "",
		QRSvg:           "",
		Paired:          false,
		DeviceName:      deviceLabel,
		BridgeURL:       "whatsmeow://native",
		BridgeReachable: false,
	})

	return FetchWhatsAppQR(cfg, true)
}

func normalizeWhatsAppPhone(raw string) (string, error) {
	var b strings.Builder
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	digits := b.String()
	if strings.HasPrefix(digits, "00") && len(digits) > 4 {
		digits = digits[2:]
	}
	if len(digits) == 10 && strings.HasPrefix(digits, "0") {
		digits = "254" + digits[1:]
	} else if len(digits) == 9 && (strings.HasPrefix(digits, "7") || strings.HasPrefix(digits, "1")) {
		digits = "254" + digits
	}
	if len(digits) < 10 || len(digits) > 15 {
		return "", fmt.Errorf("invalid WhatsApp phone number format")
	}
	return digits, nil
}

func SendWhatsAppStatement(cfg AppSettings, phone string, meta *StatementMeta, renamedFile string, encryptedPDF []byte, rawPassword string) error {
	if !cfg.WhatsAppEnabled {
		return fmt.Errorf("WhatsApp dispatch is currently disabled in system settings")
	}

	if err := waManager.ensureInitialized(cfg); err != nil {
		return fmt.Errorf("WhatsApp client unavailable: %w", err)
	}

	waManager.mu.Lock()
	client := waManager.client
	waManager.mu.Unlock()

	if client == nil || client.Store == nil || client.Store.ID == nil {
		return fmt.Errorf("WhatsApp desk device is not paired. Open Settings -> WhatsApp QR Setup and scan the QR code first")
	}

	if !client.IsConnected() {
		if err := client.Connect(); err != nil {
			return fmt.Errorf("WhatsApp connection error: %w", err)
		}
		if !client.WaitForConnection(10 * time.Second) {
			return fmt.Errorf("WhatsApp Web client timed out connecting; check server connectivity or re-pair in Settings")
		}
	}

	digits, err := normalizeWhatsAppPhone(phone)
	if err != nil {
		return err
	}

	targetJID := types.NewJID(digits, types.DefaultUserServer)
	checkCtx, cancelCheck := context.WithTimeout(context.Background(), 10*time.Second)
	checkRes, checkErr := client.IsOnWhatsApp(checkCtx, []string{"+" + digits})
	cancelCheck()
	if checkErr == nil && len(checkRes) > 0 {
		if !checkRes[0].IsIn {
			return fmt.Errorf("number +%s is not registered on WhatsApp", digits)
		}
		if checkRes[0].JID.User != "" {
			targetJID = checkRes[0].JID
		}
	}

	_, _, _, whatsappText, _ := BuildOfficialNSSFMessage(
		meta,
		renamedFile,
		cfg.PasswordMode,
		cfg.PortalURL,
		rawPassword,
		cfg.EmailSubjectTemplate,
		cfg.WhatsAppMessageTemplate,
	)

	uploadCtx, cancelUpload := context.WithTimeout(context.Background(), 30*time.Second)
	uploaded, err := client.Upload(uploadCtx, encryptedPDF, whatsmeow.MediaDocument)
	cancelUpload()
	if err != nil {
		return fmt.Errorf("WhatsApp media upload failed: %w", err)
	}

	docMsg := &waE2E.DocumentMessage{
		URL:           proto.String(uploaded.URL),
		DirectPath:    proto.String(uploaded.DirectPath),
		MediaKey:      uploaded.MediaKey,
		Mimetype:      proto.String("application/pdf"),
		FileEncSHA256: uploaded.FileEncSHA256,
		FileSHA256:    uploaded.FileSHA256,
		FileLength:    proto.Uint64(uploaded.FileLength),
		FileName:      proto.String(renamedFile),
		Title:         proto.String(renamedFile),
		Caption:       proto.String(whatsappText),
	}

	sendCtx, cancelSend := context.WithTimeout(context.Background(), 20*time.Second)
	resp, err := client.SendMessage(sendCtx, targetJID, &waE2E.Message{
		DocumentMessage: docMsg,
	})
	cancelSend()
	if err != nil {
		return fmt.Errorf("WhatsApp message send failed: %w", err)
	}

	log.Printf("[WHATSAPP] Dispatched %s to +%s (msgID=%s)", renamedFile, targetJID.User, resp.ID)
	return nil
}
