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
  deliveryMode: 'live' | 'preview';
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
  downloadUrl: string;
  emailPreview: {
    subject: string;
    htmlBody: string;
    plainText: string;
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
  whatsappEnabled: boolean;
  deliveryMode: 'live' | 'preview';
  whatsappBridgeUrl: string;
  whatsappPaired: boolean;
  whatsappDeviceName: string;
  filenameTemplate: string;
  passwordMode: 'id_card' | 'id_and_nssf_last4';
  portalUrl: string;
}

export interface WhatsAppQrData {
  paired: boolean;
  bridgeReachable: boolean;
  sessionCode: string;
  qrSvg: string;
  deviceName: string;
  bridgeUrl?: string;
  pairedPhone?: string;
  pairedAt?: string;
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
