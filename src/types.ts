export type ActiveTab = 'dispatch' | 'audit' | 'settings';

export type DispatchChannel = 'email' | 'whatsapp' | 'both';

export interface StatementMeta {
  memberNo: string;
  memberName: string;
  idCardNo: string;
  maskedIdCardNo?: string;
  dateOfBirth: string;
  dateRegistered: string;
  kraPin: string;
  employer: string;
  period: string;
  statementDate: string;
  standardAmount: string;
  voluntaryAmount: string;
  totalAmount: string;
}

export interface ValidationResponse {
  ok: boolean;
  meta?: StatementMeta;
  renamedFile?: string;
  error?: string;
}

export interface DispatchReceipt {
  ok: boolean;
  memberNo: string;
  memberName: string;
  period: string;
  standardAmount: string;
  voluntaryAmount: string;
  totalAmount: string;
  originalFilename: string;
  renamedFile: string;
  channel: string;
  destination: string;
  timestamp: string;
  passwordGuide: string;
  emailPreview: {
    subject: string;
    htmlBody: string;
    plainText: string;
    whatsappText?: string;
  };
}

export interface AppSettings {
  smtpHost: string;
  smtpPort: string;
  smtpSecurity: 'starttls' | 'tls' | 'none';
  smtpUser: string;
  smtpPass?: string;
  hasSmtpPass?: boolean;
  clearSmtpPass?: boolean;
  smtpFrom: string;
  emailEnabled: boolean;
  emailConfigured?: boolean;
  whatsappEnabled: boolean;
  whatsappBridgeUrl: string;
  whatsappPaired: boolean;
  whatsappDeviceName: string;
  filenameTemplate: string;
  passwordMode: 'id_card' | 'id_and_nssf_last4';
  portalUrl: string;
  previewBeforeDispatch: boolean;
  emailSubjectTemplate: string;
  whatsappMessageTemplate: string;
  autoUpdateEnabled: boolean;
  updateRepo: string;
}

export interface SystemRuntimeInfo {
  ok: boolean;
  version?: string;
  commit?: string;
  buildDate?: string;
  activeEngine: 'go';
  goEngineInfo?: {
    engine?: string;
    version?: string;
    commit?: string;
    buildDate?: string;
    os?: string;
    arch?: string;
    sqliteCliBackend?: boolean;
  };
}

export interface SystemUpdateStatus {
  enabled: boolean;
  repo: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  state:
    | 'idle'
    | 'checking'
    | 'up_to_date'
    | 'available'
    | 'downloading'
    | 'applying'
    | 'restarting'
    | 'error'
    | 'unconfigured';
  message: string;
  releaseUrl?: string;
  releaseNotes?: string;
  assetName?: string;
  lastCheckedAt?: string;
  canSelfUpdate: boolean;
  selfUpdateHint?: string;
  requiresElevation?: boolean;
  restartScheduled?: boolean;
}

export interface WhatsAppQrData {
  paired: boolean;
  connected?: boolean;
  bridgeReachable: boolean;
  engine?: string;
  sessionCode: string;
  qrSvg: string;
  deviceName: string;
  bridgeUrl?: string;
  pairedPhone?: string;
  pairedAt?: string;
  error?: string;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  eventType?: string;
  actor?: string;
  sourceIp?: string;
  memberNo: string;
  memberName: string;
  channel: string;
  destination: string;
  renamedFile: string;
  status: string;
  details: string;
}

export type PendingSettingsAction =
  | { type: 'route'; targetPath: string }
  | { type: 'refresh_settings' }
  | { type: 'browser_reload' }
  | { type: 'lock_settings' };

export interface AdminAuthStatus {
  adminExists: boolean;
  authenticated: boolean;
  username: string | null;
  envPasscodeConfigured: boolean;
  hasRecoveryEmail?: boolean;
  hasRecoveryKey?: boolean;
  smtpConfigured?: boolean;
  recoveryEmail?: string | null;
}
