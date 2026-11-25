import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import pino from 'pino';
import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import {
  getWhatsAppSession,
  saveWhatsAppSession,
  type AppSettings,
} from './db.ts';
import type { StatementMeta } from './pdfEngine.ts';
import { buildOfficialNssfMessage } from './mailer.ts';

export interface WhatsAppQrResponse {
  paired: boolean;
  bridgeReachable: boolean;
  sessionCode: string;
  qrSvg: string;
  deviceName: string;
  bridgeUrl: string;
  pairedPhone: string;
  pairedAt: string;
  error?: string;
}

const AUTH_DIR = path.resolve(process.cwd(), 'whatsapp_auth');
const silentLogger = pino({ level: 'silent' });

let activeSocket: WASocket | null = null;
let socketBootPromise: Promise<void> | null = null;
let latestQrText = '';
let latestQrSvg = '';
let isSocketOpen = false;
let lastConnectionError = '';
let currentSessionCode = '';
let cachedWaVersion: [number, number, number] | null = null;
const qrOrOpenWaiters = new Set<() => void>();

function notifyWaiters(): void {
  for (const resolve of qrOrOpenWaiters) {
    resolve();
  }
  qrOrOpenWaiters.clear();
}

function waitForQrOrOpen(timeoutMs = 9000): Promise<void> {
  if (isSocketOpen || latestQrSvg || lastConnectionError) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      qrOrOpenWaiters.delete(done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    qrOrOpenWaiters.add(done);
  });
}

export async function generateQrSvg(payload: string): Promise<string> {
  if (!payload) return '';
  return QRCode.toString(payload, {
    type: 'svg',
    width: 210,
    margin: 4,
    errorCorrectionLevel: 'L',
    color: {
      dark: '#052e16',
      light: '#ffffff',
    },
  });
}

function validateBridgeUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('WhatsApp Gateway URL must use http or https.');
  }
  return parsed;
}

function createFreshSessionCode(): string {
  return `NSSF-WA-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function nowFormatted(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function extractPhoneFromJid(jid?: string | null): string {
  if (!jid) return '';
  return jid.split('@')[0]?.split(':')[0]?.replace(/[^\d+]/g, '') || '';
}

function hasSavedBaileysCreds(): boolean {
  return fs.existsSync(path.join(AUTH_DIR, 'creds.json'));
}

function clearSavedBaileysCreds(): void {
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });
}

function closeActiveSocket(): void {
  if (activeSocket) {
    try {
      activeSocket.ev.removeAllListeners('connection.update');
      activeSocket.ev.removeAllListeners('creds.update');
      activeSocket.end(undefined);
    } catch {
      // Ignore socket close error
    }
    activeSocket = null;
  }
}

async function getWaVersion(): Promise<[number, number, number]> {
  if (cachedWaVersion) return cachedWaVersion;
  try {
    const res = await Promise.race([
      fetchLatestBaileysVersion(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('WA version lookup timeout')), 3500)
      ),
    ]);
    cachedWaVersion = res.version;
    return cachedWaVersion;
  } catch {
    return [2, 3000, 1027934701];
  }
}

function normalizeWhatsAppJid(phone: string): string {
  let digits = phone.replace(/[^\d]/g, '');
  if (!digits) {
    throw new Error('Please enter a valid member WhatsApp phone number.');
  }
  if (digits.startsWith('0') && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  }
  if (digits.length < 9) {
    throw new Error('Please enter a valid member WhatsApp phone number (e.g. 254712345678).');
  }
  return `${digits}@s.whatsapp.net`;
}

async function startBaileysSession(cfg: AppSettings, resetAuth = false): Promise<void> {
  if (socketBootPromise) {
    await socketBootPromise;
    if (!resetAuth) return;
  }

  socketBootPromise = (async () => {
    try {
      if (resetAuth) {
        closeActiveSocket();
        clearSavedBaileysCreds();
        latestQrText = '';
        latestQrSvg = '';
        isSocketOpen = false;
        currentSessionCode = createFreshSessionCode();
      } else if (activeSocket && (isSocketOpen || latestQrSvg)) {
        return;
      }

      lastConnectionError = '';
      if (!currentSessionCode) {
        const existing = getWhatsAppSession();
        currentSessionCode = existing?.sessionCode || createFreshSessionCode();
      }

      fs.mkdirSync(AUTH_DIR, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const version = await getWaVersion();

      closeActiveSocket();
      const sock = makeWASocket({
        version,
        auth: state,
        logger: silentLogger,
        browser: Browsers.ubuntu(cfg.whatsappDeviceName || 'NSSF Statement Dispatch'),
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 15000,
      });
      activeSocket = sock;

      sock.ev.on('creds.update', () => {
        saveCreds().catch(() => undefined);
      });

      sock.ev.on('connection.update', async (update) => {
        if (activeSocket !== sock) return;

        if (update.qr) {
          try {
            const svg = await generateQrSvg(update.qr);
            latestQrText = update.qr;
            latestQrSvg = svg;
            isSocketOpen = false;
            lastConnectionError = '';
            if (!currentSessionCode) {
              currentSessionCode = createFreshSessionCode();
            }
            saveWhatsAppSession({
              sessionCode: currentSessionCode,
              qrPayload: update.qr,
              qrSvg: svg,
              paired: false,
              deviceName: cfg.whatsappDeviceName,
              bridgeUrl: cfg.whatsappBridgeUrl,
              bridgeReachable: true,
              pairedPhone: '',
              pairedAt: '',
            });
          } catch (err) {
            lastConnectionError =
              err instanceof Error ? err.message : 'Failed to render WhatsApp QR SVG.';
          } finally {
            notifyWaiters();
          }
        }

        if (update.connection === 'open') {
          isSocketOpen = true;
          latestQrText = '';
          latestQrSvg = '';
          lastConnectionError = '';
          const linkedPhone = extractPhoneFromJid(sock.user?.id);
          const existing = getWhatsAppSession();
          const code = currentSessionCode || existing?.sessionCode || createFreshSessionCode();
          currentSessionCode = code;

          saveWhatsAppSession({
            sessionCode: code,
            qrPayload: '',
            qrSvg: '',
            paired: true,
            deviceName: cfg.whatsappDeviceName,
            bridgeUrl: cfg.whatsappBridgeUrl,
            bridgeReachable: true,
            pairedPhone: linkedPhone || existing?.pairedPhone || '',
            pairedAt: existing?.pairedAt || nowFormatted(),
          });
          notifyWaiters();
        }

        if (update.connection === 'close') {
          const statusCode = (
            update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
          )?.output?.statusCode;
          const errMessage =
            update.lastDisconnect?.error instanceof Error
              ? update.lastDisconnect.error.message
              : 'WhatsApp Web connection closed.';

          isSocketOpen = false;
          activeSocket = null;

          if (statusCode === DisconnectReason.restartRequired) {
            // WhatsApp always requires an immediate reconnect right after QR pairing completes
            void startBaileysSession(cfg, false);
            return;
          }

          if (statusCode === DisconnectReason.loggedOut) {
            clearSavedBaileysCreds();
            latestQrText = '';
            latestQrSvg = '';
            lastConnectionError = 'WhatsApp device was logged out. Refresh QR to link again.';
            currentSessionCode = createFreshSessionCode();
            saveWhatsAppSession({
              sessionCode: currentSessionCode,
              qrPayload: '',
              qrSvg: '',
              paired: false,
              deviceName: cfg.whatsappDeviceName,
              bridgeUrl: cfg.whatsappBridgeUrl,
              bridgeReachable: false,
              pairedPhone: '',
              pairedAt: '',
            });
            notifyWaiters();
            return;
          }

          lastConnectionError = errMessage;
          notifyWaiters();
        }
      });
    } catch (err) {
      lastConnectionError =
        err instanceof Error ? err.message : 'Unable to connect to WhatsApp Web.';
      activeSocket = null;
      isSocketOpen = false;
      notifyWaiters();
    } finally {
      socketBootPromise = null;
    }
  })();

  await socketBootPromise;
}

export function resumePairedWhatsAppIfPresent(cfg: AppSettings): void {
  const existing = getWhatsAppSession();
  if (existing?.paired && hasSavedBaileysCreds() && !activeSocket) {
    void startBaileysSession(cfg, false);
  }
}

export async function fetchWhatsAppQr(
  cfg: AppSettings,
  forceRefresh = false
): Promise<WhatsAppQrResponse> {
  const existing = getWhatsAppSession();
  const baseSessionCode =
    !forceRefresh && existing?.sessionCode ? existing.sessionCode : createFreshSessionCode();

  // 1. Check if a custom external WhatsApp Gateway sidecar is running on cfg.whatsappBridgeUrl
  try {
    const bridgeUrl = validateBridgeUrl(cfg.whatsappBridgeUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const resp = await fetch(
      `${bridgeUrl.origin}/qr${forceRefresh ? '?refresh=1' : ''}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (resp.ok) {
      const data = (await resp.json()) as {
        paired?: boolean;
        qrSvg?: string;
        qrText?: string;
        sessionCode?: string;
        phone?: string;
        pairedPhone?: string;
      };
      const sessionCode = data.sessionCode || baseSessionCode;
      const qrPayload = data.qrText || '';
      const qrSvg = data.qrSvg || (qrPayload ? await generateQrSvg(qrPayload) : '');
      const isPaired = Boolean(data.paired);
      const pairedPhone = data.pairedPhone || data.phone || existing?.pairedPhone || '';
      const pairedAt = isPaired ? existing?.pairedAt || nowFormatted() : '';

      const saved = saveWhatsAppSession({
        sessionCode,
        qrPayload,
        qrSvg,
        paired: isPaired,
        deviceName: cfg.whatsappDeviceName,
        bridgeUrl: cfg.whatsappBridgeUrl,
        bridgeReachable: true,
        pairedPhone,
        pairedAt,
      });

      return {
        paired: saved.paired,
        bridgeReachable: saved.bridgeReachable,
        sessionCode: saved.sessionCode,
        qrSvg: saved.qrSvg,
        deviceName: saved.deviceName,
        bridgeUrl: saved.bridgeUrl,
        pairedPhone: saved.pairedPhone,
        pairedAt: saved.pairedAt,
      };
    }
  } catch {
    // External HTTP sidecar not running; use built-in Baileys WhatsApp Web Multi-Device client
  }

  // Clear any legacy placeholder QR rows stored from earlier versions
  if (existing?.qrPayload?.startsWith('https://nssfdigital.enssf.co.ke/wa-pair')) {
    saveWhatsAppSession({
      sessionCode: baseSessionCode,
      qrPayload: '',
      qrSvg: '',
      paired: false,
      deviceName: cfg.whatsappDeviceName,
      bridgeUrl: cfg.whatsappBridgeUrl,
      bridgeReachable: false,
      pairedPhone: '',
      pairedAt: '',
    });
  }

  // If DB says paired and saved credentials exist, ensure socket stays connected
  if (!forceRefresh && existing?.paired && hasSavedBaileysCreds()) {
    if (!activeSocket && !isSocketOpen) {
      void startBaileysSession(cfg, false);
    }
    return {
      paired: true,
      bridgeReachable: true,
      sessionCode: existing.sessionCode,
      qrSvg: '',
      deviceName: cfg.whatsappDeviceName,
      bridgeUrl: cfg.whatsappBridgeUrl,
      pairedPhone: existing.pairedPhone,
      pairedAt: existing.pairedAt,
    };
  }

  // Start or refresh built-in Baileys WhatsApp Web socket to get a real WhatsApp QR code
  if (forceRefresh || !activeSocket || (!isSocketOpen && !latestQrSvg)) {
    await startBaileysSession(cfg, forceRefresh || !hasSavedBaileysCreds());
    await waitForQrOrOpen(9000);
  }

  const latestDb = getWhatsAppSession();
  if (isSocketOpen || latestDb?.paired) {
    return {
      paired: true,
      bridgeReachable: true,
      sessionCode: latestDb?.sessionCode || currentSessionCode || baseSessionCode,
      qrSvg: '',
      deviceName: cfg.whatsappDeviceName,
      bridgeUrl: cfg.whatsappBridgeUrl,
      pairedPhone: latestDb?.pairedPhone || extractPhoneFromJid(activeSocket?.user?.id),
      pairedAt: latestDb?.pairedAt || nowFormatted(),
    };
  }

  if (latestQrSvg) {
    return {
      paired: false,
      bridgeReachable: true,
      sessionCode: currentSessionCode || latestDb?.sessionCode || baseSessionCode,
      qrSvg: latestQrSvg,
      deviceName: cfg.whatsappDeviceName,
      bridgeUrl: cfg.whatsappBridgeUrl,
      pairedPhone: '',
      pairedAt: '',
    };
  }

  return {
    paired: false,
    bridgeReachable: false,
    sessionCode: currentSessionCode || baseSessionCode,
    qrSvg: '',
    deviceName: cfg.whatsappDeviceName,
    bridgeUrl: cfg.whatsappBridgeUrl,
    pairedPhone: '',
    pairedAt: '',
    error:
      lastConnectionError ||
      'Unable to reach WhatsApp Web to obtain a pairing QR code. Check internet access or click Refresh QR.',
  };
}

export function confirmWhatsAppPairingInDb(
  cfg: AppSettings,
  sessionCode: string,
  pairedPhone = ''
): WhatsAppQrResponse | null {
  const existing = getWhatsAppSession();
  if (!existing) return null;
  if (sessionCode && existing.sessionCode !== sessionCode) return null;

  const saved = saveWhatsAppSession({
    sessionCode: existing.sessionCode,
    qrPayload: existing.qrPayload,
    qrSvg: existing.qrSvg,
    paired: true,
    deviceName: cfg.whatsappDeviceName,
    bridgeUrl: cfg.whatsappBridgeUrl,
    bridgeReachable: existing.bridgeReachable,
    pairedPhone: pairedPhone || existing.pairedPhone,
    pairedAt: existing.pairedAt || nowFormatted(),
  });

  return {
    paired: saved.paired,
    bridgeReachable: saved.bridgeReachable,
    sessionCode: saved.sessionCode,
    qrSvg: saved.qrSvg,
    deviceName: saved.deviceName,
    bridgeUrl: saved.bridgeUrl,
    pairedPhone: saved.pairedPhone,
    pairedAt: saved.pairedAt,
  };
}

export async function unlinkWhatsAppSession(cfg: AppSettings): Promise<WhatsAppQrResponse> {
  try {
    const bridgeUrl = validateBridgeUrl(cfg.whatsappBridgeUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    await fetch(`${bridgeUrl.origin}/logout`, {
      method: 'POST',
      signal: controller.signal,
    }).catch(() => undefined);
    clearTimeout(timer);
  } catch {
    // Ignore unreachable external bridge during unlink
  }

  if (activeSocket) {
    try {
      await activeSocket.logout();
    } catch {
      // Ignore logout failure if socket already disconnected
    }
  }
  closeActiveSocket();
  clearSavedBaileysCreds();
  latestQrText = '';
  latestQrSvg = '';
  isSocketOpen = false;
  lastConnectionError = '';
  currentSessionCode = createFreshSessionCode();

  saveWhatsAppSession({
    sessionCode: currentSessionCode,
    qrPayload: '',
    qrSvg: '',
    paired: false,
    deviceName: cfg.whatsappDeviceName,
    bridgeUrl: cfg.whatsappBridgeUrl,
    bridgeReachable: false,
    pairedPhone: '',
    pairedAt: '',
  });

  await startBaileysSession(cfg, true);
  await waitForQrOrOpen(9000);

  return {
    paired: false,
    bridgeReachable: Boolean(latestQrSvg),
    sessionCode: currentSessionCode,
    qrSvg: latestQrSvg,
    deviceName: cfg.whatsappDeviceName,
    bridgeUrl: cfg.whatsappBridgeUrl,
    pairedPhone: '',
    pairedAt: '',
    error: latestQrSvg ? undefined : lastConnectionError || undefined,
  };
}

export async function sendWhatsAppStatement(
  cfg: AppSettings,
  phone: string,
  meta: StatementMeta,
  renamedFile: string,
  encryptedPdf: Buffer,
  rawPassword: string
): Promise<void> {
  if (!cfg.whatsappEnabled) {
    throw new Error('WhatsApp dispatch is currently disabled in System Settings.');
  }

  const normalizedPhone = phone.replace(/[^\d+]/g, '');
  if (!normalizedPhone || normalizedPhone.length < 9) {
    throw new Error('Please enter a valid member WhatsApp phone number (e.g. 254712345678).');
  }

  const { whatsappText } = buildOfficialNssfMessage(
    meta,
    renamedFile,
    cfg.passwordMode,
    cfg.portalUrl,
    rawPassword,
    {
      emailSubjectTemplate: cfg.emailSubjectTemplate,
      whatsappMessageTemplate: cfg.whatsappMessageTemplate,
    }
  );

  // 1. Try external HTTP Gateway if running
  try {
    const bridgeUrl = validateBridgeUrl(cfg.whatsappBridgeUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const resp = await fetch(`${bridgeUrl.origin}/send-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          phone: normalizedPhone,
          filename: renamedFile,
          caption: whatsappText,
          documentBase64: encryptedPdf.toString('base64'),
        }),
      });
      if (resp.ok) {
        return;
      }
      const bodyText = await resp.text().catch(() => '');
      throw new Error(`WhatsApp gateway returned HTTP ${resp.status}${bodyText ? `: ${bodyText}` : ''}`);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // If connection refused / unreachable, fall through to native Baileys session if paired
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('WhatsApp gateway returned HTTP')) {
      throw err;
    }
  }

  // 2. Send via native paired Baileys WhatsApp Web session
  if (!isSocketOpen && hasSavedBaileysCreds()) {
    await startBaileysSession(cfg, false);
    await waitForQrOrOpen(10000);
  }

  if (!activeSocket || !isSocketOpen) {
    throw new Error(
      'WhatsApp device is not linked yet. Open System Settings -> WhatsApp QR Setup and scan the QR code with WhatsApp Linked Devices.'
    );
  }

  const jid = normalizeWhatsAppJid(normalizedPhone);
  await activeSocket.sendMessage(jid, {
    document: encryptedPdf,
    mimetype: 'application/pdf',
    fileName: renamedFile,
    caption: whatsappText,
  });
}
