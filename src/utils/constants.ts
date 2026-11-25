import type { AppSettings } from '../types';

export const APP_NAME = 'NSSF DIGITAL STATEMENT DISPATCH';
export const APP_PUBLISHER = 'National Social Security Fund (NSSF) Kenya';
export const APP_TAGLINE = 'Growing You. For Good';
export const APP_OFFICE_LOCATION = 'Social Security House, Bishops Road, Nairobi';
export const APP_USSD_CODE = '*303#';
export const DEFAULT_PORTAL_URL = 'https://nssfdigital.enssf.co.ke';

export const ROUTES = {
  ROOT: '/',
  STATEMENTS: '/statements',
  SETTINGS: '/settings',
  AUDIT: '/audit',
} as const;

export const SMOOTH_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const DEFAULT_EMAIL_SUBJECT_TEMPLATE =
  'Official NSSF Member Statement — {memberName} ({memberNo})';

export const DEFAULT_WHATSAPP_MESSAGE_TEMPLATE = `*NATIONAL SOCIAL SECURITY FUND (NSSF) KENYA*
Hello {memberName},

Please find attached your official NSSF Member Statement ({renamedFile}) for {period}.

*Member No:* {memberNo}
*Total Fund Balance:* KES {totalAmount}

*How to Open:*
Enter {passwordGuide} when prompted for the PDF password.

Self-Service: USSD *303# or {portalUrl}`;

export const DEFAULT_SETTINGS: AppSettings = {
  smtpHost: 'smtp.nssfkenya.co.ke',
  smtpPort: '587',
  smtpSecurity: 'starttls',
  smtpUser: 'statements@nssfkenya.co.ke',
  hasSmtpPass: false,
  smtpFrom: 'NSSF Kenya Member Services <statements@nssfkenya.co.ke>',
  emailEnabled: true,
  whatsappEnabled: true,
  deliveryMode: 'preview',
  whatsappBridgeUrl: 'whatsmeow://native',
  whatsappPaired: false,
  whatsappDeviceName: 'NSSF Service Desk Terminal 01',
  filenameTemplate: 'NSSF_Statement_{memberNo}_{date}.pdf',
  passwordMode: 'id_card',
  portalUrl: DEFAULT_PORTAL_URL,
  previewBeforeDispatch: true,
  emailSubjectTemplate:
    'Official NSSF Provisional Member Statement — {memberName} ({memberNo})',
  whatsappMessageTemplate: `*NATIONAL SOCIAL SECURITY FUND (NSSF) KENYA*
Hello {memberName},

Please find attached your official NSSF Provisional Member Statement ({renamedFile}) for {period}.

*Member No:* {memberNo}
*Total Fund Balance:* KES {totalAmount}

*How to Open:*
Enter {passwordGuide} when prompted for the PDF password.

Self-Service: USSD *303# or {portalUrl}`,
};

export const TEMPLATE_PLACEHOLDERS: Array<{ token: string; label: string }> = [
  { token: '{memberName}', label: 'Member Name' },
  { token: '{memberNo}', label: 'Member No' },
  { token: '{period}', label: 'Period' },
  { token: '{totalAmount}', label: 'Total Balance' },
  { token: '{standardAmount}', label: 'Standard Amt' },
  { token: '{voluntaryAmount}', label: 'Voluntary Amt' },
  { token: '{employer}', label: 'Employer' },
  { token: '{renamedFile}', label: 'PDF Filename' },
  { token: '{passwordGuide}', label: 'Password Guide' },
  { token: '{portalUrl}', label: 'Portal URL' },
  { token: '{statementDate}', label: 'Statement Date' },
];

export const SAMPLE_TEMPLATE_VARS: Record<string, string> = {
  memberName: 'JANE WANJIKU KAMAU',
  memberNo: '102938475',
  period: 'Jan 2024 - Dec 2024',
  employer: 'KENYA COMMERCIAL BANK LTD',
  standardAmount: '1,240,000.00',
  voluntaryAmount: '242,500.00',
  totalAmount: '1,482,500.00',
  renamedFile: 'NSSF_Statement_102938475_20261125.pdf',
  passwordGuide: 'Your National ID Card Number (*****678)',
  portalUrl: DEFAULT_PORTAL_URL,
  statementDate: '25 Nov 2026',
};
