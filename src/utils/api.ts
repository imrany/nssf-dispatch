import type {
  AdminAuthStatus,
  AppSettings,
  AuditLog,
  DispatchChannel,
  DispatchReceipt,
  SystemRuntimeInfo,
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

  const res = await fetch(url, {
    ...rest,
    headers: mergedHeaders,
  });

  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      (data && typeof data.error === 'string' && data.error) ||
      `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, data);
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

export function fetchAuthStatusApi(): Promise<AdminAuthStatus> {
  return requestJson<AdminAuthStatus>('/api/auth/status');
}

export function setupAdminApi(
  username: string,
  password: string
): Promise<{ ok: boolean; token: string; username: string; settings: AppSettings }> {
  return requestJson('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export function loginAdminApi(
  username: string,
  password: string
): Promise<{ ok: boolean; token: string; username: string; settings: AppSettings }> {
  return requestJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export function logoutAdminApi(token: string): Promise<{ ok: boolean }> {
  return requestJson('/api/auth/logout', {
    method: 'POST',
    token,
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
