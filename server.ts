import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  clearFailedLogins,
  checkLoginRateLimit,
  createAdminSessionToken,
  extractBearerToken,
  recordFailedLogin,
  requireAdminAuth,
  revokeAdminSessionToken,
  verifyAdminSessionToken,
  verifyTimingSafeString,
} from './server/auth.ts';
import {
  createInitialAdmin,
  getAuditLogs,
  getPublicSettings,
  getRawSettings,
  getSafeWorkspaceSettings,
  hasAdminAccount,
  initDb,
  insertAuditLog,
  saveSettings,
  verifyStoredAdminCredentials,
} from './server/db.ts';
import { buildOfficialNssfMessage, sendEmailStatement, testSmtpConnection } from './server/mailer.ts';
import { encryptPdfWithPassword, extractAndValidatePdf } from './server/pdfEngine.ts';
import {
  confirmWhatsAppPairingInDb,
  fetchWhatsAppQr,
  resumePairedWhatsAppIfPresent,
  sendWhatsAppStatement,
  unlinkWhatsAppSession,
} from './server/whatsapp.ts';

interface MultipartResult {
  fields: Record<string, string>;
  files: Record<string, { filename: string; contentType: string; data: Buffer }>;
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

function parseMultipart(req: express.Request): Promise<MultipartResult> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
      reject(new Error('Missing multipart/form-data boundary'));
      return;
    }
    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const boundaryBuf = Buffer.from(`--${boundary}`, 'latin1');

    const chunks: Buffer[] = [];
    let total = 0;

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) {
        req.destroy();
        reject(new Error('Uploaded statement exceeds 15 MB limit.'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('error', reject);
    req.on('end', () => {
      const fullBuf = Buffer.concat(chunks);
      const fields: Record<string, string> = {};
      const files: Record<string, { filename: string; contentType: string; data: Buffer }> = {};

      let pos = fullBuf.indexOf(boundaryBuf);
      while (pos !== -1) {
        const partStart = pos + boundaryBuf.length;
        if (fullBuf.subarray(partStart, partStart + 2).toString('latin1') === '--') break;

        // Skip CRLF after boundary
        let headerStart = partStart;
        if (fullBuf[headerStart] === 13 && fullBuf[headerStart + 1] === 10) headerStart += 2;

        const nextBoundary = fullBuf.indexOf(boundaryBuf, headerStart);
        if (nextBoundary === -1) break;

        const headerEnd = fullBuf.indexOf('\r\n\r\n', headerStart);
        if (headerEnd === -1 || headerEnd > nextBoundary) {
          pos = nextBoundary;
          continue;
        }

        const headerStr = fullBuf.subarray(headerStart, headerEnd).toString('utf8');
        let bodyEnd = nextBoundary;
        if (fullBuf[bodyEnd - 2] === 13 && fullBuf[bodyEnd - 1] === 10) bodyEnd -= 2;
        const bodyBuf = fullBuf.subarray(headerEnd + 4, bodyEnd);

        const nameMatch = headerStr.match(/name="([^"]+)"/i);
        const filenameMatch = headerStr.match(/filename="([^"]*)"/i);
        const typeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

        if (nameMatch) {
          const fieldName = nameMatch[1];
          if (filenameMatch) {
            files[fieldName] = {
              filename: filenameMatch[1] || 'statement.pdf',
              contentType: typeMatch?.[1]?.trim() || 'application/pdf',
              data: bodyBuf,
            };
          } else {
            fields[fieldName] = bodyBuf.toString('utf8');
          }
        }

        pos = nextBoundary;
      }

      resolve({ fields, files });
    });
  });
}

// Ephemeral in-memory store for downloading freshly encrypted statement PDFs (auto-expires after 30 min)
const protectedPdfCache = new Map<string, { filename: string; pdf: Buffer; expiresAt: number }>();

function storeProtectedPdf(filename: string, pdf: Buffer): string {
  const now = Date.now();
  for (const [k, v] of protectedPdfCache.entries()) {
    if (v.expiresAt < now) protectedPdfCache.delete(k);
  }
  const token = crypto.randomBytes(16).toString('hex');
  protectedPdfCache.set(token, { filename, pdf, expiresAt: now + 30 * 60 * 1000 });
  return token;
}

function formatDateCompact(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function buildRenamedFile(template: string, memberNo: string): string {
  const safeMember = memberNo.replace(/[^A-Za-z0-9_-]/g, '');
  const compactDate = formatDateCompact(new Date());
  const raw = (template || 'NSSF_Statement_{memberNo}_{date}.pdf')
    .replace(/\{memberNo\}/gi, safeMember)
    .replace(/\{date\}/gi, compactDate);
  const safeName = raw.replace(/[^A-Za-z0-9_.-]/g, '_');
  return safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
}

function parseSafeGoServiceUrl(rawUrl: string): URL {
  const parsed = new URL((rawUrl || '').trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Go service URL must use http or https.');
  }
  if (parsed.hostname === '169.254.169.254' || parsed.hostname === 'metadata.google.internal') {
    throw new Error('Disallowed metadata host for Go service URL.');
  }
  return parsed;
}

async function probeGoService(rawUrl: string): Promise<{ reachable: boolean; details?: Record<string, unknown>; error?: string }> {
  try {
    const parsed = parseSafeGoServiceUrl(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${parsed.origin}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      return { reachable: false, error: `Go service returned HTTP ${resp.status}` };
    }
    const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (data && data.engine === 'go') {
      return { reachable: true, details: data };
    }
    return { reachable: false, error: 'Target endpoint did not identify as NSSF Go service.' };
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : 'Unable to reach Go service.',
    };
  }
}

async function startServer() {
  initDb();
  resumePairedWhatsAppIfPresent(getRawSettings());

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, engine: 'node', port: 3000 });
  });

  app.get('/api/system/runtime', async (req, res) => {
    const cfg = getRawSettings();
    const verified = verifyAdminSessionToken(extractBearerToken(req));
    let goServiceReachable = false;
    let goEngineInfo: Record<string, unknown> | undefined;
    if (cfg.goServiceUrl && (cfg.goServiceEnabled || verified.valid)) {
      const probe = await probeGoService(cfg.goServiceUrl);
      goServiceReachable = probe.reachable;
      goEngineInfo = probe.details;
    }
    res.json({
      ok: true,
      activeEngine: cfg.goServiceEnabled ? 'go-proxy' : 'node',
      goServiceEnabled: cfg.goServiceEnabled,
      goServiceUrl: verified.valid ? cfg.goServiceUrl : '',
      goServiceReachable,
      goEngineInfo: verified.valid ? goEngineInfo : undefined,
    });
  });

  app.post('/api/system/test-go', requireAdminAuth, async (req, res) => {
    const current = getRawSettings();
    const targetUrl = String(req.body?.goServiceUrl ?? current.goServiceUrl).trim();
    const probe = await probeGoService(targetUrl);
    if (!probe.reachable) {
      res.status(400).json({
        ok: false,
        error: probe.error || `Unable to reach Go service at ${targetUrl}`,
      });
      return;
    }
    res.json({
      ok: true,
      message: `Connected to NSSF Go service at ${targetUrl}`,
      details: probe.details,
    });
  });

  // 1. Validate PDF against entered Member NSSF Number
  app.post('/api/validate', async (req, res) => {
    try {
      const { fields, files } = await parseMultipart(req);
      const memberNo = (fields.memberNo || '').trim();
      const file = files.statement;
      if (!file || file.data.length === 0) {
        res.status(400).json({ ok: false, error: 'Please upload a member statement PDF.' });
        return;
      }

      const cfg = getRawSettings();
      if (cfg.goServiceEnabled) {
        try {
          const goUrl = parseSafeGoServiceUrl(cfg.goServiceUrl);
          const form = new FormData();
          form.append('memberNo', memberNo);
          form.append('statement', new Blob([new Uint8Array(file.data)], { type: file.contentType }), file.filename);
          const goResp = await fetch(`${goUrl.origin}/api/validate`, {
            method: 'POST',
            body: form,
          });
          const payload = await goResp.json();
          res.status(goResp.status).json(payload);
          return;
        } catch (err) {
          res.status(502).json({
            ok: false,
            error: `Go service unreachable at ${cfg.goServiceUrl}: ${err instanceof Error ? err.message : 'connection failed'}`,
          });
          return;
        }
      }

      const meta = extractAndValidatePdf(file.data, memberNo);
      const renamedFile = buildRenamedFile(cfg.filenameTemplate, meta.memberNo);

      res.json({
        ok: true,
        meta: {
          ...meta,
          maskedIdCardNo: meta.idCardNo.length > 3 ? '*'.repeat(meta.idCardNo.length - 3) + meta.idCardNo.slice(-3) : '***',
        },
        renamedFile,
      });
    } catch (err) {
      res.status(422).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to validate uploaded PDF.',
      });
    }
  });

  // 2. Validate, Password-Protect, Rename & Dispatch Member Statement
  app.post('/api/dispatch', async (req, res) => {
    let memberNo = '';
    let channel = 'email';
    let email = '';
    let whatsapp = '';

    try {
      const { fields, files } = await parseMultipart(req);
      memberNo = (fields.memberNo || '').trim();
      channel = (fields.channel || 'email').trim();
      email = (fields.email || '').trim();
      whatsapp = (fields.whatsapp || '').trim();

      if (!['email', 'whatsapp', 'both'].includes(channel)) {
        res.status(400).json({ ok: false, error: 'Invalid dispatch channel selected.' });
        return;
      }

      const file = files.statement;
      if (!file || file.data.length === 0) {
        res.status(400).json({ ok: false, error: 'Statement PDF upload is required.' });
        return;
      }

      const cfg = getRawSettings();

      if (cfg.goServiceEnabled) {
        try {
          const goUrl = parseSafeGoServiceUrl(cfg.goServiceUrl);
          const form = new FormData();
          form.append('memberNo', memberNo);
          form.append('channel', channel);
          form.append('email', email);
          form.append('whatsapp', whatsapp);
          form.append('statement', new Blob([new Uint8Array(file.data)], { type: file.contentType }), file.filename);
          const goResp = await fetch(`${goUrl.origin}/api/dispatch`, {
            method: 'POST',
            body: form,
          });
          const payload = await goResp.json();
          res.status(goResp.status).json(payload);
          return;
        } catch (err) {
          res.status(502).json({
            ok: false,
            error: `Go service unreachable at ${cfg.goServiceUrl}: ${err instanceof Error ? err.message : 'connection failed'}`,
          });
          return;
        }
      }

      if ((channel === 'email' || channel === 'both') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ ok: false, error: 'Please enter a valid member email address.' });
        return;
      }

      if ((channel === 'whatsapp' || channel === 'both') && whatsapp.replace(/[^\d]/g, '').length < 9) {
        res.status(400).json({ ok: false, error: 'Please enter a valid member WhatsApp phone number.' });
        return;
      }

      if ((channel === 'email' || channel === 'both') && !cfg.emailEnabled) {
        res.status(400).json({ ok: false, error: 'Email dispatch is disabled in System Settings.' });
        return;
      }
      if ((channel === 'whatsapp' || channel === 'both') && !cfg.whatsappEnabled) {
        res.status(400).json({ ok: false, error: 'WhatsApp dispatch is disabled in System Settings.' });
        return;
      }

      // Step 1: Parse & validate statement against entered NSSF Member Number
      let meta;
      try {
        meta = extractAndValidatePdf(file.data, memberNo);
      } catch (valErr) {
        const msg = valErr instanceof Error ? valErr.message : 'Validation failed';
        insertAuditLog({
          memberNo: memberNo || 'UNSPECIFIED',
          memberName: 'UNVERIFIED',
          channel: channel.toUpperCase(),
          destination: [email, whatsapp].filter(Boolean).join(' / ') || '-',
          renamedFile: file.filename,
          status: 'VALIDATION_FAILED',
          details: msg,
        });
        res.status(422).json({ ok: false, error: msg });
        return;
      }

      // Step 2: Derive password from member credentials, then encrypt PDF (RC4-128)
      const rawPassword =
        cfg.passwordMode === 'id_and_nssf_last4'
          ? `${meta.idCardNo}${meta.memberNo.slice(-4)}`
          : meta.idCardNo;

      const encryptedPdf = encryptPdfWithPassword(file.data, rawPassword);
      const renamedFile = buildRenamedFile(cfg.filenameTemplate, meta.memberNo);
      const downloadToken = storeProtectedPdf(renamedFile, encryptedPdf);

      const { subject, htmlBody, plainText, whatsappText, passwordGuide } = buildOfficialNssfMessage(
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

      // Step 3: Dispatch via Email and/or WhatsApp
      const deliveredChannels: string[] = [];

      if (channel === 'email' || channel === 'both') {
        if (cfg.deliveryMode === 'live') {
          try {
            await sendEmailStatement(cfg, email, meta, renamedFile, encryptedPdf, rawPassword);
            insertAuditLog({
              memberNo: meta.memberNo,
              memberName: meta.memberName,
              channel: 'EMAIL',
              destination: email,
              renamedFile,
              status: 'SENT',
              details: `SMTP delivered via ${cfg.smtpHost}`,
            });
            deliveredChannels.push('EMAIL');
          } catch (mailErr) {
            const msg = mailErr instanceof Error ? mailErr.message : 'SMTP dispatch error';
            insertAuditLog({
              memberNo: meta.memberNo,
              memberName: meta.memberName,
              channel: 'EMAIL',
              destination: email,
              renamedFile,
              status: 'FAILED',
              details: msg,
            });
            res.status(502).json({ ok: false, error: msg });
            return;
          }
        } else {
          insertAuditLog({
            memberNo: meta.memberNo,
            memberName: meta.memberName,
            channel: 'EMAIL',
            destination: email,
            renamedFile,
            status: 'DISPATCHED (PREVIEW)',
            details: 'Encrypted PDF & official NSSF email packaged in preview mode',
          });
          deliveredChannels.push('EMAIL');
        }
      }

      if (channel === 'whatsapp' || channel === 'both') {
        if (cfg.deliveryMode === 'live') {
          try {
            await sendWhatsAppStatement(cfg, whatsapp, meta, renamedFile, encryptedPdf, rawPassword);
            insertAuditLog({
              memberNo: meta.memberNo,
              memberName: meta.memberName,
              channel: 'WHATSAPP',
              destination: whatsapp,
              renamedFile,
              status: 'SENT',
              details: 'WhatsApp document dispatched via paired desk gateway',
            });
            deliveredChannels.push('WHATSAPP');
          } catch (waErr) {
            const msg = waErr instanceof Error ? waErr.message : 'WhatsApp dispatch error';
            insertAuditLog({
              memberNo: meta.memberNo,
              memberName: meta.memberName,
              channel: 'WHATSAPP',
              destination: whatsapp,
              renamedFile,
              status: 'FAILED',
              details: msg,
            });
            res.status(502).json({ ok: false, error: msg });
            return;
          }
        } else {
          insertAuditLog({
            memberNo: meta.memberNo,
            memberName: meta.memberName,
            channel: 'WHATSAPP',
            destination: whatsapp,
            renamedFile,
            status: 'DISPATCHED (PREVIEW)',
            details: 'Encrypted PDF & WhatsApp caption packaged in preview mode',
          });
          deliveredChannels.push('WHATSAPP');
        }
      }

      res.json({
        ok: true,
        deliveryMode: cfg.deliveryMode,
        memberNo: meta.memberNo,
        memberName: meta.memberName,
        period: meta.period,
        standardAmount: meta.standardAmount,
        voluntaryAmount: meta.voluntaryAmount,
        totalAmount: meta.totalAmount,
        originalFilename: file.filename,
        renamedFile,
        channel: deliveredChannels.join(' & '),
        destination: [email, whatsapp].filter(Boolean).join(' · '),
        timestamp: new Date().toLocaleString('en-KE', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        passwordGuide,
        downloadUrl: `/api/download/${downloadToken}`,
        emailPreview: {
          subject,
          htmlBody,
          plainText,
          whatsappText,
        },
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unexpected server error during dispatch.',
      });
    }
  });

  // 3. Download freshly encrypted PDF receipt copy
  app.get('/api/download/:token', async (req, res) => {
    const entry = protectedPdfCache.get(req.params.token);
    if (entry && entry.expiresAt >= Date.now()) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);
      res.send(entry.pdf);
      return;
    }

    const cfg = getRawSettings();
    if (cfg.goServiceEnabled) {
      try {
        const goUrl = parseSafeGoServiceUrl(cfg.goServiceUrl);
        const goResp = await fetch(`${goUrl.origin}/api/download/${encodeURIComponent(req.params.token)}`);
        if (goResp.ok) {
          const buf = Buffer.from(await goResp.arrayBuffer());
          const disp = goResp.headers.get('content-disposition') || 'attachment; filename="NSSF_Statement.pdf"';
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', disp);
          res.send(buf);
          return;
        }
      } catch {
        // fall through to 404
      }
    }

    res.status(404).json({ ok: false, error: 'Protected PDF link expired. Re-run dispatch to generate a new copy.' });
  });

  // 4. Settings Admin Auth Endpoints (SQLite scrypt + Signed Bearer Tokens)
  app.get('/api/auth/status', (req, res) => {
    const envPasscode = (process.env.NSSF_ADMIN_PASSCODE || '').trim();
    const envPasscodeConfigured = envPasscode.length > 0;
    const adminExists = envPasscodeConfigured || hasAdminAccount();
    const token = extractBearerToken(req);
    const verified = verifyAdminSessionToken(token);
    res.json({
      adminExists,
      authenticated: verified.valid,
      username: verified.username,
      envPasscodeConfigured,
    });
  });

  app.post('/api/auth/setup', (req, res) => {
    const envPasscode = (process.env.NSSF_ADMIN_PASSCODE || '').trim();
    if (envPasscode.length > 0 || hasAdminAccount()) {
      res.status(409).json({
        ok: false,
        error: 'An administrator account is already configured. Please sign in.',
      });
      return;
    }

    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!/^[A-Za-z0-9._@-]{3,64}$/.test(username)) {
      res.status(400).json({
        ok: false,
        error: 'Admin username must be 3 to 64 characters (letters, numbers, ., _, @, -).',
      });
      return;
    }

    if (password.length < 8 || password.length > 128) {
      res.status(400).json({
        ok: false,
        error: 'Admin password must be between 8 and 128 characters.',
      });
      return;
    }

    try {
      const created = createInitialAdmin(username, password);
      const token = createAdminSessionToken(created.username);
      res.status(201).json({
        ok: true,
        token,
        username: created.username,
        settings: getPublicSettings(),
      });
    } catch {
      res.status(409).json({
        ok: false,
        error: 'Administrator setup already completed. Please sign in.',
      });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rate = checkLoginRateLimit(clientIp);
    if (!rate.allowed) {
      res.status(429).json({
        ok: false,
        error: `Too many failed login attempts. Try again in ${rate.retryAfterSec} seconds.`,
      });
      return;
    }

    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const envPasscode = (process.env.NSSF_ADMIN_PASSCODE || '').trim();

    if (envPasscode.length > 0) {
      if (!password || !verifyTimingSafeString(password, envPasscode)) {
        recordFailedLogin(clientIp);
        res.status(401).json({ ok: false, error: 'Invalid administrator credentials.' });
        return;
      }
      clearFailedLogins(clientIp);
      const effectiveUser = username || 'admin';
      const token = createAdminSessionToken(effectiveUser);
      res.json({
        ok: true,
        token,
        username: effectiveUser,
        settings: getPublicSettings(),
      });
      return;
    }

    if (!hasAdminAccount()) {
      res.status(400).json({
        ok: false,
        error: 'No administrator account exists yet. Complete initial admin setup first.',
      });
      return;
    }

    const verified = verifyStoredAdminCredentials(username, password);
    if (!verified.ok || !verified.username) {
      recordFailedLogin(clientIp);
      res.status(401).json({ ok: false, error: 'Invalid username or password.' });
      return;
    }

    clearFailedLogins(clientIp);
    const token = createAdminSessionToken(verified.username);
    res.json({
      ok: true,
      token,
      username: verified.username,
      settings: getPublicSettings(),
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    revokeAdminSessionToken(extractBearerToken(req));
    res.json({ ok: true });
  });

  // 5. Settings Endpoints (SQLite backed; sensitive fields & mutations require admin auth)
  app.get('/api/settings', (req, res) => {
    const verified = verifyAdminSessionToken(extractBearerToken(req));
    if (verified.valid) {
      res.json(getPublicSettings());
      return;
    }
    res.json(getSafeWorkspaceSettings());
  });

  app.post('/api/settings', requireAdminAuth, (req, res) => {
    saveSettings(req.body || {});
    res.json({ ok: true, settings: getPublicSettings() });
  });

  app.post('/api/settings/test-smtp', requireAdminAuth, async (req, res) => {
    const current = getRawSettings();
    const override = req.body || {};
    const testCfg = {
      ...current,
      smtpHost: override.smtpHost ?? current.smtpHost,
      smtpPort: String(override.smtpPort ?? current.smtpPort),
      smtpSecurity: override.smtpSecurity ?? current.smtpSecurity,
      smtpUser: override.smtpUser ?? current.smtpUser,
      smtpPass:
        typeof override.smtpPass === 'string' && override.smtpPass.length > 0
          ? override.smtpPass
          : current.smtpPass,
      smtpFrom: override.smtpFrom ?? current.smtpFrom,
    };

    try {
      await testSmtpConnection(testCfg);
      res.json({ ok: true, message: `Authenticated successfully with ${testCfg.smtpHost}:${testCfg.smtpPort}` });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : 'SMTP connection failed.',
      });
    }
  });

  // 6. WhatsApp QR & Pairing Endpoints (SQLite backed, protected by admin auth)
  app.get('/api/whatsapp/qr', requireAdminAuth, async (req, res) => {
    const cfg = getRawSettings();
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const qrData = await fetchWhatsAppQr(cfg, forceRefresh);
    res.json({ ...qrData, settings: getPublicSettings() });
  });

  app.get('/api/whatsapp/status', requireAdminAuth, async (_req, res) => {
    const cfg = getRawSettings();
    const qrData = await fetchWhatsAppQr(cfg, false);
    res.json({ ...qrData, settings: getPublicSettings() });
  });

  app.post('/api/whatsapp/pair-confirm', requireAdminAuth, (req, res) => {
    const cfg = getRawSettings();
    const sessionCode = String(req.body?.sessionCode || '').trim();
    const pairedPhone = String(req.body?.phone || req.body?.pairedPhone || '').trim();
    const updated = confirmWhatsAppPairingInDb(cfg, sessionCode, pairedPhone);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'Active QR session not found or expired.' });
      return;
    }
    res.json({ ok: true, qrData: updated, settings: getPublicSettings() });
  });

  app.post('/api/whatsapp/unlink', requireAdminAuth, async (_req, res) => {
    const cfg = getRawSettings();
    const qrData = await unlinkWhatsAppSession(cfg);
    res.json({ ok: true, qrData, settings: getPublicSettings() });
  });

  // 7. Audit Logs Endpoint (accessible to authenticated Settings administrators)
  app.get('/api/audit', requireAdminAuth, (_req, res) => {
    res.json(getAuditLogs(150));
  });

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });

    // Prevent @vite/client from opening an HMR WebSocket in proxied environments where HMR is disabled
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url) { return url; }
export class ErrorOverlay {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Frontend build not found.');
      }
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NSSF Digital Statement Dispatch running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
