import crypto from 'node:crypto';
import {
  getWhatsAppSession,
  saveWhatsAppSession,
  type AppSettings,
} from './db.ts';
import type { StatementMeta } from './pdfEngine.ts';
import { buildOfficialNssfMessage } from './mailer.ts';

// Pure TypeScript ISO 18004 Byte-Mode QR Code Generator (Version 3: 29x29, ECC Level L)
// Zero third-party dependencies. Generates a genuinely scannable QR SVG matrix.
const QR_SIZE = 29;
const DATA_CODEWORDS = 55;
const ECC_CODEWORDS = 15;

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, eccCount: number): Uint8Array {
  const gen = rsGeneratorPoly(eccCount);
  const res = new Uint8Array(data.length + eccCount);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

function encodeQrMatrix(text: string): number[][] {
  const bytes = Buffer.from(text, 'utf8').subarray(0, DATA_CODEWORDS - 2);
  const bits: number[] = [];
  const pushBits = (val: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  // Mode: Byte (0100), Length (8 bits for V1-9)
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);
  pushBits(0, 4); // Terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const data = new Uint8Array(DATA_CODEWORDS);
  for (let i = 0; i < Math.floor(bits.length / 8); i++) {
    let val = 0;
    for (let b = 0; b < 8; b++) val = (val << 1) | bits[i * 8 + b];
    data[i] = val;
  }
  const padBytes = [0xec, 0x11];
  for (let i = Math.floor(bits.length / 8); i < DATA_CODEWORDS; i++) {
    data[i] = padBytes[(i - Math.floor(bits.length / 8)) % 2];
  }

  const ecc = rsEncode(data, ECC_CODEWORDS);
  const fullCodewords = new Uint8Array(DATA_CODEWORDS + ECC_CODEWORDS);
  fullCodewords.set(data);
  fullCodewords.set(ecc, DATA_CODEWORDS);

  const grid: number[][] = Array.from({ length: QR_SIZE }, () => Array(QR_SIZE).fill(-1));
  const reserved: boolean[][] = Array.from({ length: QR_SIZE }, () => Array(QR_SIZE).fill(false));

  const setFixed = (r: number, c: number, val: number) => {
    if (r >= 0 && r < QR_SIZE && c >= 0 && c < QR_SIZE) {
      grid[r][c] = val;
      reserved[r][c] = true;
    }
  };

  const placeFinder = (top: number, left: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        if (r === -1 || r === 7 || c === -1 || c === 7) {
          setFixed(top + r, left + c, 0);
        } else {
          const dark = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          setFixed(top + r, left + c, dark ? 1 : 0);
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, QR_SIZE - 7);
  placeFinder(QR_SIZE - 7, 0);

  // Version 3 alignment pattern at (22, 22)
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const dark = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
      setFixed(22 + r, 22 + c, dark ? 1 : 0);
    }
  }

  // Timing patterns
  for (let i = 8; i < QR_SIZE - 8; i++) {
    const val = i % 2 === 0 ? 1 : 0;
    if (!reserved[6][i]) setFixed(6, i, val);
    if (!reserved[i][6]) setFixed(i, 6, val);
  }

  // Dark module & reserve format info areas
  setFixed(QR_SIZE - 8, 8, 1);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = true;
    if (!reserved[i][8]) reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][QR_SIZE - 1 - i] = true;
    reserved[QR_SIZE - 1 - i][8] = true;
  }

  // Place data bits (zig-zag) with Mask 0 ((r + c) % 2 === 0)
  const allBits: number[] = [];
  for (const byte of fullCodewords) {
    for (let b = 7; b >= 0; b--) allBits.push((byte >> b) & 1);
  }
  let bitIdx = 0;
  let up = true;
  for (let col = QR_SIZE - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let rowStep = 0; rowStep < QR_SIZE; rowStep++) {
      const row = up ? QR_SIZE - 1 - rowStep : rowStep;
      for (const c of [col, col - 1]) {
        if (!reserved[row][c]) {
          const bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
          const masked = (row + c) % 2 === 0 ? bit ^ 1 : bit;
          grid[row][c] = masked;
        }
      }
    }
    up = !up;
  }

  // Format information for ECC L (01) + Mask 0 (000) -> 15-bit BCH + mask 0x5412 = 0x77C4 (111011111000100)
  const fmtBits = 0x77c4;
  for (let i = 0; i < 15; i++) {
    const bit = (fmtBits >> i) & 1;
    // Vertical
    if (i < 6) grid[i][8] = bit;
    else if (i < 8) grid[i + 1][8] = bit;
    else grid[QR_SIZE - 15 + i][8] = bit;
    // Horizontal
    if (i < 8) grid[8][QR_SIZE - 1 - i] = bit;
    else if (i < 9) grid[8][7] = bit;
    else grid[8][14 - i] = bit;
  }

  return grid;
}

export function generateQrSvg(payload: string): string {
  const matrix = encodeQrMatrix(payload);
  const quiet = 2;
  const total = QR_SIZE + quiet * 2;
  const rects: string[] = [];

  for (let r = 0; r < QR_SIZE; r++) {
    for (let c = 0; c < QR_SIZE; c++) {
      if (matrix[r][c] === 1) {
        rects.push(`<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1" fill="#052e16"/>`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="210" height="210" shape-rendering="crispEdges">
    <rect width="${total}" height="${total}" fill="#ffffff"/>
    ${rects.join('')}
  </svg>`;
}

export interface WhatsAppQrResponse {
  paired: boolean;
  bridgeReachable: boolean;
  sessionCode: string;
  qrSvg: string;
  deviceName: string;
  bridgeUrl: string;
  pairedPhone: string;
  pairedAt: string;
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

export async function fetchWhatsAppQr(
  cfg: AppSettings,
  forceRefresh = false
): Promise<WhatsAppQrResponse> {
  const existing = getWhatsAppSession();
  const baseSessionCode =
    !forceRefresh && existing?.sessionCode ? existing.sessionCode : createFreshSessionCode();

  try {
    const bridgeUrl = validateBridgeUrl(cfg.whatsappBridgeUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
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
      const qrPayload = data.qrText || `nssf://wa-link/${sessionCode}`;
      const qrSvg = data.qrSvg || generateQrSvg(qrPayload);
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
    // Bridge sidecar not running locally; read/persist SQLite QR session state
  }

  if (!forceRefresh && existing) {
    const saved = saveWhatsAppSession({
      sessionCode: existing.sessionCode,
      qrPayload: existing.qrPayload,
      qrSvg: existing.qrSvg,
      paired: existing.paired,
      deviceName: cfg.whatsappDeviceName,
      bridgeUrl: cfg.whatsappBridgeUrl,
      bridgeReachable: false,
      pairedPhone: existing.pairedPhone,
      pairedAt: existing.pairedAt,
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

  const qrPayload = `https://nssfdigital.enssf.co.ke/wa-pair?s=${baseSessionCode}`;
  const saved = saveWhatsAppSession({
    sessionCode: baseSessionCode,
    qrPayload,
    qrSvg: generateQrSvg(qrPayload),
    paired: false,
    deviceName: cfg.whatsappDeviceName,
    bridgeUrl: cfg.whatsappBridgeUrl,
    bridgeReachable: false,
    pairedPhone: '',
    pairedAt: '',
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
    // Ignore unreachable bridge during local unlink
  }

  const nextCode = createFreshSessionCode();
  const nextPayload = `https://nssfdigital.enssf.co.ke/wa-pair?s=${nextCode}`;
  const saved = saveWhatsAppSession({
    sessionCode: nextCode,
    qrPayload: nextPayload,
    qrSvg: generateQrSvg(nextPayload),
    paired: false,
    deviceName: cfg.whatsappDeviceName,
    bridgeUrl: cfg.whatsappBridgeUrl,
    bridgeReachable: false,
    pairedPhone: '',
    pairedAt: '',
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
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '');
      throw new Error(`WhatsApp gateway returned HTTP ${resp.status}${bodyText ? `: ${bodyText}` : ''}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`WhatsApp Gateway unreachable at ${bridgeUrl.origin}: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}
