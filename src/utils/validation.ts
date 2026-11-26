import { DEFAULT_PORTAL_URL, SAMPLE_TEMPLATE_VARS } from './constants';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9._@-]{3,64}$/;

export const MAX_PDF_BYTES = 15 * 1024 * 1024;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function isValidWhatsappNumber(value: string): boolean {
  return value.replace(/[^\d]/g, '').length >= 9;
}

export function isValidAdminUsername(value: string): boolean {
  return USERNAME_RE.test(value.trim());
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export async function hasPdfMagicHeader(file: File): Promise<boolean> {
  if (file.size < 64) return false;
  try {
    const head = await file.slice(0, 32).text();
    const cleaned = head.replace(/^\uFEFF/, '').trimStart();
    return cleaned.startsWith('%PDF-');
  } catch {
    return false;
  }
}

export function formatFileSizeKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function sanitizePortalUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : DEFAULT_PORTAL_URL;
}

export function renderPreviewTemplate(
  template: string,
  portalUrl: string,
  stripNewlines = false
): string {
  const vars: Record<string, string> = {
    ...SAMPLE_TEMPLATE_VARS,
    portalUrl: portalUrl || SAMPLE_TEMPLATE_VARS.portalUrl,
  };
  const rendered = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const key = Object.keys(vars).find((k) => k.toLowerCase() === token.toLowerCase());
    return key ? vars[key] : match;
  });
  return stripNewlines ? rendered.replace(/[\r\n]+/g, ' ').trim() : rendered;
}
