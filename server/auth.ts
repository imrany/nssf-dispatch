import crypto from 'node:crypto';
import type express from 'express';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

interface SessionEntry {
  username: string;
  expiresAt: number;
}

const activeSessions = new Map<string, SessionEntry>();

// In-memory rate limiting for failed admin login attempts per IP
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [jti, entry] of activeSessions.entries()) {
    if (entry.expiresAt <= now) activeSessions.delete(jti);
  }
}

export function hashPasswordWithSalt(password: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash: derived, salt };
}

export function verifyPasswordHash(password: string, expectedHash: string, salt: string): boolean {
  try {
    const derivedBuf = crypto.scryptSync(password, salt, 64);
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    if (derivedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derivedBuf, expectedBuf);
  } catch {
    return false;
  }
}

export function verifyTimingSafeString(input: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(input, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

export function createAdminSessionToken(username: string): string {
  pruneExpiredSessions();
  const jti = crypto.randomBytes(18).toString('hex');
  const exp = Date.now() + SESSION_TTL_MS;
  activeSessions.set(jti, { username, expiresAt: exp });

  const payloadB64 = Buffer.from(JSON.stringify({ sub: username, jti, exp }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifyAdminSessionToken(token: string | undefined): { valid: boolean; username: string | null } {
  if (!token) return { valid: false, username: null };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, username: null };
  const [payloadB64, providedSig] = parts;

  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, username: null };
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      sub?: string;
      jti?: string;
      exp?: number;
    };
    if (!parsed.jti || !parsed.exp || parsed.exp <= Date.now()) {
      if (parsed.jti) activeSessions.delete(parsed.jti);
      return { valid: false, username: null };
    }
    const entry = activeSessions.get(parsed.jti);
    if (!entry || entry.expiresAt <= Date.now()) {
      activeSessions.delete(parsed.jti);
      return { valid: false, username: null };
    }
    return { valid: true, username: entry.username };
  } catch {
    return { valid: false, username: null };
  }
}

export function revokeAdminSessionToken(token: string | undefined): void {
  if (!token) return;
  const parts = token.split('.');
  if (parts.length !== 2) return;
  try {
    const parsed = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { jti?: string };
    if (parsed.jti) activeSessions.delete(parsed.jti);
  } catch {
    // ignore malformed token on logout
  }
}

export function extractBearerToken(req: express.Request): string | undefined {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return undefined;
  return header.slice(7).trim() || undefined;
}

export function requireAdminAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const token = extractBearerToken(req);
  const verified = verifyAdminSessionToken(token);
  if (!verified.valid) {
    res.status(401).json({
      ok: false,
      error: 'Administrator authentication is required to access System Settings.',
    });
    return;
  }
  next();
}

export function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || record.resetAt <= now) {
    return { allowed: true };
  }
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    return { allowed: false, retryAfterSec: Math.ceil((record.resetAt - now) / 1000) };
  }
  return { allowed: true };
}

export function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || record.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    record.count += 1;
  }
}

export function clearFailedLogins(ip: string): void {
  loginAttempts.delete(ip);
}
