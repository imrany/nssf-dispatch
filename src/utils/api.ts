import type {
  AdminAuthMode,
  AdminAuthStatus,
  AppSettings,
  AuditLog,
  DispatchChannel,
  DispatchReceipt,
  SecurityOverview,
  SecurityPolicy,
  SystemRuntimeInfo,
  SystemUpdateStatus,
  ValidationResponse,
  WhatsAppQrData,
} from '../types';

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function requestJson<T>(
  url: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token, headers, ...rest } = options;
  const mergedHeaders = new Headers(headers);
  if (token) {
    mergedHeaders.set('Authorization', `Bearer ${token}`);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: mergedHeaders,
    });
  } catch (err) {
    const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
    throw new ApiError(
      `Unable to reach the NSSF dispatch server${detail}. Please verify the server is running and try again.`,
      0,
      err
    );
  }

  const rawText = await res.text();
  let data: Record<string, unknown> | null = null;
  if (rawText.trim()) {
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      data = null;
    }
  }

  const extractBackendMessage = (): string => {
    if (data) {
      if (typeof data.error === 'string' && data.error.trim()) return data.error.trim();
      if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
    }
    const trimmed = rawText.trim();
    if (trimmed && !trimmed.startsWith('<')) {
      return trimmed.length > 260 ? `${trimmed.slice(0, 260)}...` : trimmed;
    }
    return '';
  };

  if (!res.ok) {
    const message =
      extractBackendMessage() ||
      `Request failed with status ${res.status}${res.statusText ? ` (${res.statusText})` : ''}`;
    throw new ApiError(message, res.status, data ?? rawText);
  }

  if (data && data.ok === false) {
    const message = extractBackendMessage() || 'The server reported that the request failed.';
    throw new ApiError(message, res.status, data);
  }

  if (data === null && rawText.trim()) {
    throw new ApiError(
      extractBackendMessage() || 'Server returned an unexpected non-JSON response.',
      res.status,
      rawText
    );
  }

  return data as T;
}

export function fetchSettingsApi(token?: string | null): Promise<AppSettings> {
  return requestJson<AppSettings>('/api/settings', { token });
}

export function saveSettingsApi(
  token: string,
  settings: AppSettings
): Promise<{ ok: boolean; settings: AppSettings; error?: string }> {
  return requestJson('/api/settings', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

export function testSmtpApi(
  token: string,
  settings: AppSettings
): Promise<{ ok: boolean; message?: string; error?: string }> {
  return requestJson('/api/settings/test-smtp', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

export function fetchRuntimeApi(token?: string | null): Promise<SystemRuntimeInfo> {
  return requestJson<SystemRuntimeInfo>('/api/system/runtime', { token });
}

export function fetchUpdateStatusApi(token: string): Promise<SystemUpdateStatus> {
  return requestJson<SystemUpdateStatus>('/api/system/update/status', { token });
}

export function checkForUpdatesApi(token: string): Promise<SystemUpdateStatus> {
  return requestJson<SystemUpdateStatus>('/api/system/update/check', {
    method: 'POST',
    token,
  });
}

export function applySelfUpdateApi(token: string): Promise<{
  ok: boolean;
  status: SystemUpdateStatus;
  error?: string;
  requiresElevation?: boolean;
}> {
  return requestJson('/api/system/update/apply', {
    method: 'POST',
    token,
  });
}

export function fetchHealthApi(): Promise<{ ok: boolean; version?: string }> {
  return requestJson<{ ok: boolean; version?: string }>('/api/health');
}

export function fetchAuthStatusApi(): Promise<AdminAuthStatus> {
  return requestJson<AdminAuthStatus>('/api/auth/status');
}

export function setupAdminApi(params: {
  authMode: AdminAuthMode;
  username?: string;
  password?: string;
  passcode?: string;
  recoveryEmail?: string;
}): Promise<{
  ok: boolean;
  token: string;
  username: string;
  authMode: AdminAuthMode;
  recoveryEmail?: string;
  recoveryKey?: string;
  idleLockMinutes?: number;
  settings: AppSettings;
}> {
  return requestJson('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function loginAdminApi(params: {
  username?: string;
  password?: string;
  passcode?: string;
}): Promise<{
  ok: boolean;
  token: string;
  username: string;
  authMode?: AdminAuthMode;
  recoveryEmail?: string;
  idleLockMinutes?: number;
  settings: AppSettings;
}> {
  return requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function forgotPasswordApi(
  username: string,
  recoveryEmail: string
): Promise<{ ok: boolean; message: string }> {
  return requestJson('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, recoveryEmail }),
  });
}

export function resetPasswordApi(params: {
  method: 'email_code' | 'recovery_key';
  username?: string;
  code?: string;
  recoveryKey?: string;
  newPassword?: string;
  newPasscode?: string;
}): Promise<{ ok: boolean; message: string }> {
  return requestJson('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function changeAdminCredentialsApi(
  token: string,
  params: {
    authMode: AdminAuthMode;
    currentCredential: string;
    newUsername?: string;
    recoveryEmail: string;
    newPassword?: string;
    newPasscode?: string;
  }
): Promise<{
  ok: boolean;
  token: string;
  username: string;
  authMode: AdminAuthMode;
  recoveryEmail: string;
  message: string;
}> {
  return requestJson('/api/auth/change-credentials', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function regenerateRecoveryKeyApi(
  token: string,
  currentCredential: string
): Promise<{ ok: boolean; recoveryKey: string }> {
  return requestJson('/api/auth/regenerate-recovery-key', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentCredential }),
  });
}

export function fetchSecurityOverviewApi(token: string): Promise<SecurityOverview> {
  return requestJson<SecurityOverview>('/api/auth/security', { token });
}

export function saveSecurityPolicyApi(
  token: string,
  policy: SecurityPolicy
): Promise<{ ok: boolean; policy: SecurityPolicy; message: string }> {
  return requestJson('/api/auth/security-policy', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(policy),
  });
}

export function testRecoveryEmailApi(
  token: string,
  recoveryEmail?: string
): Promise<{ ok: boolean; message: string }> {
  return requestJson('/api/auth/test-recovery-email', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recoveryEmail: recoveryEmail || '' }),
  });
}

export function revokeAdminSessionsApi(
  token: string,
  includeCurrent: boolean
): Promise<{
  ok: boolean;
  signedOutCurrent: boolean;
  revokedCount: number;
  activeSessionCount: number;
  message: string;
}> {
  return requestJson('/api/auth/revoke-sessions', {
    method: 'POST',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeCurrent }),
  });
}

export function logoutAdminApi(token: string): Promise<{ ok: boolean }> {
  return requestJson('/api/auth/logout', {
    method: 'POST',
    token,
  });
}

export function verifyStatementFileApi(
  file: File
): Promise<{ ok: boolean; error?: string }> {
  const formData = new FormData();
  formData.append('statement', file);
  return requestJson<{ ok: boolean; error?: string }>('/api/verify-statement-file', {
    method: 'POST',
    body: formData,
  });
}

export function validateStatementApi(
  memberNo: string,
  file: File
): Promise<ValidationResponse> {
  const formData = new FormData();
  formData.append('memberNo', memberNo.trim());
  formData.append('statement', file);
  return requestJson<ValidationResponse>('/api/validate', {
    method: 'POST',
    body: formData,
  });
}

export function dispatchStatementApi(params: {
  memberNo: string;
  channel: DispatchChannel;
  email: string;
  whatsapp: string;
  file: File;
}): Promise<DispatchReceipt> {
  const formData = new FormData();
  formData.append('memberNo', params.memberNo.trim());
  formData.append('channel', params.channel);
  formData.append('email', params.email.trim());
  formData.append('whatsapp', params.whatsapp.trim());
  formData.append('statement', params.file);
  return requestJson<DispatchReceipt>('/api/dispatch', {
    method: 'POST',
    body: formData,
  });
}

export function fetchWhatsAppQrApi(
  token: string,
  refresh = false
): Promise<WhatsAppQrData & { settings?: AppSettings }> {
  return requestJson(refresh ? '/api/whatsapp/qr?refresh=1' : '/api/whatsapp/qr', {
    token,
  });
}

export function fetchWhatsAppStatusApi(
  token: string
): Promise<WhatsAppQrData & { settings?: AppSettings }> {
  return requestJson('/api/whatsapp/status', { token });
}

export function reconnectWhatsAppApi(
  token: string
): Promise<{ ok: boolean; qrData?: WhatsAppQrData; settings?: AppSettings; error?: string }> {
  return requestJson('/api/whatsapp/reconnect', {
    method: 'POST',
    token,
  });
}

export function unlinkWhatsAppApi(
  token: string
): Promise<{ ok: boolean; qrData?: WhatsAppQrData; settings?: AppSettings; error?: string }> {
  return requestJson('/api/whatsapp/unlink', {
    method: 'POST',
    token,
  });
}

export function fetchAuditLogsApi(token: string): Promise<AuditLog[]> {
  return requestJson<AuditLog[]>('/api/audit', { token });
}
