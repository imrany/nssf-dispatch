import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export interface AppSettings {
  smtpHost: string;
  smtpPort: string;
  smtpSecurity: 'starttls' | 'tls' | 'none';
  smtpUser: string;
  smtpPass: string;
  hasSmtpPass?: boolean;
  smtpFrom: string;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  deliveryMode: 'live' | 'preview';
  whatsappBridgeUrl: string;
  whatsappPaired: boolean;
  whatsappDeviceName: string;
  filenameTemplate: string;
  passwordMode: 'id_card' | 'id_and_nssf_last4';
  portalUrl: string;
}

export interface WhatsAppSessionRecord {
  sessionCode: string;
  qrPayload: string;
  qrSvg: string;
  paired: boolean;
  deviceName: string;
  bridgeUrl: string;
  bridgeReachable: boolean;
  pairedPhone: string;
  pairedAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  memberNo: string;
  memberName: string;
  channel: string;
  destination: string;
  renamedFile: string;
  status: string;
  details: string;
}

const DB_PATH = path.resolve(process.cwd(), 'nssf_dispatch.db');
const db = new DatabaseSync(DB_PATH);

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      session_code TEXT NOT NULL,
      qr_payload TEXT NOT NULL,
      qr_svg TEXT NOT NULL,
      paired INTEGER NOT NULL DEFAULT 0,
      device_name TEXT NOT NULL DEFAULT 'NSSF Service Desk Terminal 01',
      bridge_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:8095',
      bridge_reachable INTEGER NOT NULL DEFAULT 0,
      paired_phone TEXT NOT NULL DEFAULT '',
      paired_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      member_no TEXT NOT NULL,
      member_name TEXT NOT NULL,
      channel TEXT NOT NULL,
      destination TEXT NOT NULL,
      renamed_file TEXT NOT NULL,
      status TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT ''
    );
  `);

  const defaults: Record<string, string> = {
    smtpHost: 'smtp.nssfkenya.co.ke',
    smtpPort: '587',
    smtpSecurity: 'starttls',
    smtpUser: 'statements@nssfkenya.co.ke',
    smtpPass: '',
    smtpFrom: 'NSSF Kenya Member Services <statements@nssfkenya.co.ke>',
    emailEnabled: 'true',
    whatsappEnabled: 'true',
    deliveryMode: 'preview',
    whatsappBridgeUrl: 'http://127.0.0.1:8095',
    whatsappPaired: 'false',
    whatsappDeviceName: 'NSSF Service Desk Terminal 01',
    filenameTemplate: 'NSSF_Statement_{memberNo}_{date}.pdf',
    passwordMode: 'id_card',
    portalUrl: 'https://nssfdigital.enssf.co.ke',
  };

  const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    insertDefault.run(k, v);
  }
}

export function getRawSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const waSession = getWhatsAppSession();
  const isPaired = waSession ? waSession.paired : map.whatsappPaired === 'true';

  return {
    smtpHost: map.smtpHost || 'smtp.nssfkenya.co.ke',
    smtpPort: map.smtpPort || '587',
    smtpSecurity: (map.smtpSecurity as AppSettings['smtpSecurity']) || 'starttls',
    smtpUser: map.smtpUser || '',
    smtpPass: map.smtpPass || '',
    smtpFrom: map.smtpFrom || 'NSSF Kenya Member Services <statements@nssfkenya.co.ke>',
    emailEnabled: map.emailEnabled !== 'false',
    whatsappEnabled: map.whatsappEnabled !== 'false',
    deliveryMode: map.deliveryMode === 'live' ? 'live' : 'preview',
    whatsappBridgeUrl: map.whatsappBridgeUrl || 'http://127.0.0.1:8095',
    whatsappPaired: isPaired,
    whatsappDeviceName: map.whatsappDeviceName || 'NSSF Service Desk Terminal 01',
    filenameTemplate: map.filenameTemplate || 'NSSF_Statement_{memberNo}_{date}.pdf',
    passwordMode: map.passwordMode === 'id_and_nssf_last4' ? 'id_and_nssf_last4' : 'id_card',
    portalUrl: map.portalUrl || 'https://nssfdigital.enssf.co.ke',
  };
}

export function getPublicSettings(): Omit<AppSettings, 'smtpPass'> & { hasSmtpPass: boolean } {
  const raw = getRawSettings();
  const { smtpPass, ...rest } = raw;
  return {
    ...rest,
    hasSmtpPass: smtpPass.length > 0,
  };
}

export function saveSettings(input: Partial<AppSettings> & { clearSmtpPass?: boolean }): void {
  const current = getRawSettings();
  const nextPass = input.clearSmtpPass
    ? ''
    : typeof input.smtpPass === 'string' && input.smtpPass.length > 0
      ? input.smtpPass
      : current.smtpPass;

  const nextPaired = input.whatsappPaired ?? current.whatsappPaired;
  const nextBridgeUrl = (input.whatsappBridgeUrl ?? current.whatsappBridgeUrl).trim();
  const nextDeviceName = (input.whatsappDeviceName ?? current.whatsappDeviceName).trim();

  const entries: Array<[string, string]> = [
    ['smtpHost', (input.smtpHost ?? current.smtpHost).trim()],
    ['smtpPort', String(input.smtpPort ?? current.smtpPort).trim()],
    ['smtpSecurity', input.smtpSecurity ?? current.smtpSecurity],
    ['smtpUser', (input.smtpUser ?? current.smtpUser).trim()],
    ['smtpPass', nextPass],
    ['smtpFrom', (input.smtpFrom ?? current.smtpFrom).trim()],
    ['emailEnabled', String(input.emailEnabled ?? current.emailEnabled)],
    ['whatsappEnabled', String(input.whatsappEnabled ?? current.whatsappEnabled)],
    ['deliveryMode', input.deliveryMode ?? current.deliveryMode],
    ['whatsappBridgeUrl', nextBridgeUrl],
    ['whatsappPaired', String(nextPaired)],
    ['whatsappDeviceName', nextDeviceName],
    ['filenameTemplate', (input.filenameTemplate ?? current.filenameTemplate).trim()],
    ['passwordMode', input.passwordMode ?? current.passwordMode],
    ['portalUrl', (input.portalUrl ?? current.portalUrl).trim()],
  ];

  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of entries) {
    upsert.run(k, v);
  }

  // Keep WhatsApp session table metadata synced in SQLite
  const existingSession = getWhatsAppSession();
  if (existingSession) {
    db.prepare(
      `UPDATE whatsapp_sessions
       SET device_name = ?, bridge_url = ?, paired = ?, updated_at = datetime('now', 'localtime')
       WHERE id = 1`
    ).run(nextDeviceName, nextBridgeUrl, nextPaired ? 1 : 0);
  }
}

export function getWhatsAppSession(): WhatsAppSessionRecord | null {
  const row = db
    .prepare(
      `SELECT session_code AS sessionCode, qr_payload AS qrPayload, qr_svg AS qrSvg,
              paired, device_name AS deviceName, bridge_url AS bridgeUrl,
              bridge_reachable AS bridgeReachable, paired_phone AS pairedPhone,
              paired_at AS pairedAt, updated_at AS updatedAt
       FROM whatsapp_sessions WHERE id = 1`
    )
    .get() as
    | {
        sessionCode: string;
        qrPayload: string;
        qrSvg: string;
        paired: number;
        deviceName: string;
        bridgeUrl: string;
        bridgeReachable: number;
        pairedPhone: string;
        pairedAt: string;
        updatedAt: string;
      }
    | undefined;

  if (!row) return null;
  return {
    ...row,
    paired: row.paired === 1,
    bridgeReachable: row.bridgeReachable === 1,
  };
}

export function saveWhatsAppSession(session: Omit<WhatsAppSessionRecord, 'updatedAt'>): WhatsAppSessionRecord {
  db.prepare(
    `INSERT INTO whatsapp_sessions (
       id, session_code, qr_payload, qr_svg, paired, device_name,
       bridge_url, bridge_reachable, paired_phone, paired_at, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
     ON CONFLICT(id) DO UPDATE SET
       session_code = excluded.session_code,
       qr_payload = excluded.qr_payload,
       qr_svg = excluded.qr_svg,
       paired = excluded.paired,
       device_name = excluded.device_name,
       bridge_url = excluded.bridge_url,
       bridge_reachable = excluded.bridge_reachable,
       paired_phone = excluded.paired_phone,
       paired_at = excluded.paired_at,
       updated_at = datetime('now', 'localtime')`
  ).run(
    session.sessionCode,
    session.qrPayload,
    session.qrSvg,
    session.paired ? 1 : 0,
    session.deviceName,
    session.bridgeUrl,
    session.bridgeReachable ? 1 : 0,
    session.pairedPhone,
    session.pairedAt
  );

  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'whatsappPaired',
    String(session.paired)
  );

  return getWhatsAppSession()!;
}

export function insertAuditLog(entry: Omit<AuditLog, 'id' | 'timestamp'>): void {
  db.prepare(
    `INSERT INTO audit_logs (member_no, member_name, channel, destination, renamed_file, status, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.memberNo,
    entry.memberName,
    entry.channel,
    entry.destination,
    entry.renamedFile,
    entry.status,
    entry.details
  );
}

export function getAuditLogs(limit = 100): AuditLog[] {
  return db
    .prepare(
      `SELECT id, timestamp, member_no AS memberNo, member_name AS memberName,
              channel, destination, renamed_file AS renamedFile, status, details
       FROM audit_logs ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as unknown as AuditLog[];
}
