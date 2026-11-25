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
    whatsappPaired: map.whatsappPaired === 'true',
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
    ['whatsappBridgeUrl', (input.whatsappBridgeUrl ?? current.whatsappBridgeUrl).trim()],
    ['whatsappPaired', String(input.whatsappPaired ?? current.whatsappPaired)],
    ['whatsappDeviceName', (input.whatsappDeviceName ?? current.whatsappDeviceName).trim()],
    ['filenameTemplate', (input.filenameTemplate ?? current.filenameTemplate).trim()],
    ['passwordMode', input.passwordMode ?? current.passwordMode],
    ['portalUrl', (input.portalUrl ?? current.portalUrl).trim()],
  ];

  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of entries) {
    upsert.run(k, v);
  }
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
