import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import type { AppSettings } from './db.ts';
import type { StatementMeta } from './pdfEngine.ts';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function maskSecret(value: string): string {
  if (!value) return '****';
  if (value.length <= 3) return '*'.repeat(value.length);
  return '*'.repeat(value.length - 3) + value.slice(-3);
}

export function buildOfficialNssfMessage(
  meta: StatementMeta,
  renamedFile: string,
  passwordMode: AppSettings['passwordMode'],
  portalUrl: string,
  rawPassword: string
): { subject: string; htmlBody: string; plainText: string; passwordGuide: string } {
  const maskedPassword = maskSecret(rawPassword);
  const passwordRuleLabel =
    passwordMode === 'id_and_nssf_last4'
      ? `Your National ID Card Number followed by the last 4 characters of your NSSF Member Number (${maskedPassword})`
      : `Your National ID Card Number (${maskedPassword})`;

  const subject = `Official NSSF Provisional Member Statement — ${meta.memberName} (${meta.memberNo})`;

  const plainText = `NATIONAL SOCIAL SECURITY FUND (NSSF) KENYA
Member Self-Service & Statement Dispatch

Dear ${meta.memberName},

Please find attached your official NSSF Provisional Member Statement of Account for the period ${meta.period}, dispatched upon your request at our NSSF Member Service Desk.

STATEMENT SUMMARY
- Member Name: ${meta.memberName}
- NSSF Member No: ${meta.memberNo}
- Employer: ${meta.employer || 'Registered Contributor'}
- Standard Contributions: KES ${meta.standardAmount}
- Voluntary Contributions: KES ${meta.voluntaryAmount}
- Total Fund Balance: KES ${meta.totalAmount}
- Protected File Name: ${renamedFile}

HOW TO OPEN & VIEW YOUR STATEMENT
To protect your personal financial records in compliance with the Kenya Data Protection Act, the attached PDF is encrypted and renamed.
1. Download and open the attached PDF file (${renamedFile}) using Adobe Reader, Chrome, or your phone's PDF viewer.
2. When prompted for a password, enter: ${passwordRuleLabel}.
3. Review your monthly contribution breakdown and employer remittance status.

SELF-SERVICE CHANNELS
You can also check your balances or make voluntary contributions anytime via USSD *303# or the NSSF Digital Portal at ${portalUrl}.

National Social Security Fund (NSSF) Kenya
Social Security House, Bishops Road, P.O. Box 30599 - 00100 Nairobi
Toll-Free: 0800 221 2744 | Website: ${portalUrl}`;

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:24px;background-color:#f4f6f5;font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;">
    <tr>
      <td style="background-color:#006837;padding:22px 28px;border-bottom:4px solid #c59b27;">
        <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">NATIONAL SOCIAL SECURITY FUND (NSSF)</div>
        <div style="font-size:12px;color:#fef3c7;margin-top:4px;">Provisional Member Statement Dispatch · Kenya</div>
      </td>
    </tr>
    <tr>
      <td style="padding:28px;">
        <p style="margin:0 0 14px;font-size:15px;">Dear <strong>${escapeHtml(meta.memberName)}</strong>,</p>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#374151;">
          Attached is your official <strong>NSSF Provisional Member Statement of Account</strong> covering <strong>${escapeHtml(meta.period)}</strong>, prepared and dispatched at your request through the NSSF Member Service Desk.
        </p>

        <div style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:18px;margin-bottom:20px;">
          <div style="font-size:14px;font-weight:700;color:#006837;margin-bottom:8px;">How to Open &amp; View Your Statement</div>
          <p style="margin:0 0 10px;font-size:13px;line-height:1.55;color:#1f2937;">
            To protect your personal financial data under the Kenya Data Protection Act, the attached PDF file (<strong>${escapeHtml(renamedFile)}</strong>) is password-encrypted.
          </p>
          <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.65;color:#1f2937;">
            <li>Save and open <strong>${escapeHtml(renamedFile)}</strong> in Adobe Acrobat Reader, Chrome, or your mobile PDF viewer.</li>
            <li>When prompted for a document password, enter <strong>${escapeHtml(passwordRuleLabel)}</strong>.</li>
            <li>Verify your monthly Standard and Voluntary contributions directly inside the statement.</li>
          </ol>
        </div>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;border-top:1px solid #e5e7eb;">
          <tr>
            <td style="padding:9px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">NSSF Member Number</td>
            <td style="padding:9px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-family:monospace;">${escapeHtml(meta.memberNo)}</td>
          </tr>
          <tr>
            <td style="padding:9px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Statement Period</td>
            <td style="padding:9px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">${escapeHtml(meta.period)}</td>
          </tr>
          <tr>
            <td style="padding:9px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Standard Contributions</td>
            <td style="padding:9px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;">KES ${escapeHtml(meta.standardAmount)}</td>
          </tr>
          <tr>
            <td style="padding:9px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Voluntary Contributions</td>
            <td style="padding:9px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;">KES ${escapeHtml(meta.voluntaryAmount)}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;color:#111827;font-weight:700;">Total Fund Balance</td>
            <td style="padding:10px 0;text-align:right;font-weight:700;color:#006837;font-family:monospace;font-size:14px;">KES ${escapeHtml(meta.totalAmount)}</td>
          </tr>
        </table>

        <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#4b5563;">
          You can also access member services, update details, or make contributions anytime via USSD <strong>*303#</strong> or the <a href="${escapeHtml(portalUrl)}" style="color:#006837;font-weight:600;">NSSF Digital Portal</a>.
        </p>
      </td>
    </tr>
    <tr>
      <td style="background-color:#f9fafb;padding:16px 28px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;line-height:1.5;">
        National Social Security Fund (NSSF) · Social Security House, Bishops Road, P.O. Box 30599 - 00100 Nairobi, Kenya.<br />
        Please do not share your National ID or statement password with unauthorized persons.
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, htmlBody, plainText, passwordGuide: passwordRuleLabel };
}

function buildMimeMessage(
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
  plainText: string,
  attachmentName: string,
  attachmentBytes: Buffer
): Buffer {
  const mixedBoundary = `----NSSF_MIXED_${crypto.randomBytes(8).toString('hex')}`;
  const altBoundary = `----NSSF_ALT_${crypto.randomBytes(8).toString('hex')}`;

  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@nssfkenya.co.ke>`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    '',
    plainText,
    '',
    `--${altBoundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    '',
    htmlBody,
    '',
    `--${altBoundary}--`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: application/pdf; name="${attachmentName}"`,
    `Content-Disposition: attachment; filename="${attachmentName}"`,
    `Content-Transfer-Encoding: base64`,
    '',
  ].join('\r\n');

  const b64 = attachmentBytes.toString('base64');
  const wrappedLines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) {
    wrappedLines.push(b64.slice(i, i + 76));
  }

  const tail = `\r\n--${mixedBoundary}--\r\n`;
  // Dot-stuff lines starting with '.' per RFC 5321
  const fullPayload = headers + wrappedLines.join('\r\n') + tail;
  const dotStuffed = fullPayload.replace(/\r\n\./g, '\r\n..');
  return Buffer.from(dotStuffed, 'utf8');
}

class SmtpConnection {
  private socket: net.Socket | tls.TLSSocket;
  private buffer = '';
  private waiters: Array<{ resolve: (line: string) => void; reject: (err: Error) => void }> = [];

  constructor(socket: net.Socket | tls.TLSSocket) {
    this.socket = socket;
    this.attachListeners(socket);
  }

  private attachListeners(sock: net.Socket | tls.TLSSocket): void {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drainResponses();
    });
    sock.on('error', (err) => {
      while (this.waiters.length) this.waiters.shift()?.reject(err);
    });
    sock.on('close', () => {
      while (this.waiters.length) this.waiters.shift()?.reject(new Error('SMTP connection closed unexpectedly'));
    });
  }

  private drainResponses(): void {
    while (this.waiters.length > 0) {
      const lines = this.buffer.split('\r\n');
      if (lines.length < 2) break;
      // Find a complete SMTP response (last line has space at index 3, not '-')
      let completeIdx = -1;
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          completeIdx = i;
          break;
        }
      }
      if (completeIdx === -1) break;
      const resp = lines.slice(0, completeIdx + 1).join('\r\n');
      this.buffer = lines.slice(completeIdx + 1).join('\r\n');
      this.waiters.shift()?.resolve(resp);
    }
  }

  readResponse(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.drainResponses();
    });
  }

  async command(cmd: string, expectedPrefixes: string[]): Promise<string> {
    this.socket.write(cmd + '\r\n');
    const resp = await this.readResponse();
    if (!expectedPrefixes.some((p) => resp.startsWith(p))) {
      throw new Error(`SMTP error (${cmd.split(' ')[0]}): ${resp}`);
    }
    return resp;
  }

  async upgradeToTls(host: string): Promise<void> {
    this.socket.removeAllListeners('data');
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('close');
    this.socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const tlsSock = tls.connect({ socket: this.socket, servername: host }, () => resolve(tlsSock));
      tlsSock.once('error', reject);
    });
    this.attachListeners(this.socket);
  }

  sendRaw(payload: Buffer): Promise<string> {
    this.socket.write(payload);
    this.socket.write('\r\n.\r\n');
    return this.readResponse();
  }

  close(): void {
    try {
      this.socket.end();
    } catch {
      // ignore
    }
  }
}

async function openAuthenticatedSmtp(cfg: AppSettings): Promise<SmtpConnection> {
  const port = parseInt(cfg.smtpPort, 10) || 587;
  const host = cfg.smtpHost.trim();
  if (!host) throw new Error('SMTP Host is not configured.');

  const sock = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
    const timeoutMs = 12000;
    const onError = (err: Error) => reject(new Error(`Cannot connect to SMTP ${host}:${port}: ${err.message}`));

    if (cfg.smtpSecurity === 'tls' || port === 465) {
      const s = tls.connect({ host, port, servername: host, timeout: timeoutMs }, () => resolve(s));
      s.once('error', onError);
      s.once('timeout', () => { s.destroy(); reject(new Error(`SMTP connection timed out (${host}:${port})`)); });
    } else {
      const s = net.connect({ host, port, timeout: timeoutMs }, () => resolve(s));
      s.once('error', onError);
      s.once('timeout', () => { s.destroy(); reject(new Error(`SMTP connection timed out (${host}:${port})`)); });
    }
  });

  const conn = new SmtpConnection(sock);
  const greeting = await conn.readResponse();
  if (!greeting.startsWith('220')) {
    conn.close();
    throw new Error(`Unexpected SMTP greeting: ${greeting}`);
  }

  let ehloResp = await conn.command('EHLO nssf-dispatch.local', ['250']);

  if (cfg.smtpSecurity === 'starttls' && port !== 465 && ehloResp.includes('STARTTLS')) {
    await conn.command('STARTTLS', ['220']);
    await conn.upgradeToTls(host);
    ehloResp = await conn.command('EHLO nssf-dispatch.local', ['250']);
  }

  if (cfg.smtpUser) {
    if (ehloResp.includes('AUTH') && ehloResp.includes('PLAIN')) {
      const token = Buffer.from(`\0${cfg.smtpUser}\0${cfg.smtpPass}`, 'utf8').toString('base64');
      await conn.command(`AUTH PLAIN ${token}`, ['235']);
    } else {
      await conn.command('AUTH LOGIN', ['334']);
      await conn.command(Buffer.from(cfg.smtpUser, 'utf8').toString('base64'), ['334']);
      await conn.command(Buffer.from(cfg.smtpPass, 'utf8').toString('base64'), ['235']);
    }
  }

  return conn;
}

export async function testSmtpConnection(cfg: AppSettings): Promise<void> {
  const conn = await openAuthenticatedSmtp(cfg);
  try {
    await conn.command('QUIT', ['221', '250']);
  } finally {
    conn.close();
  }
}

export async function sendEmailStatement(
  cfg: AppSettings,
  recipientEmail: string,
  meta: StatementMeta,
  renamedFile: string,
  encryptedPdf: Buffer,
  rawPassword: string
): Promise<void> {
  if (!cfg.emailEnabled) {
    throw new Error('Email dispatch is currently disabled in System Settings.');
  }
  const fromAddress = cfg.smtpUser || cfg.smtpFrom.match(/<([^>]+)>/)?.[1] || 'statements@nssfkenya.co.ke';
  const { subject, htmlBody, plainText } = buildOfficialNssfMessage(
    meta,
    renamedFile,
    cfg.passwordMode,
    cfg.portalUrl,
    rawPassword
  );
  const mimePayload = buildMimeMessage(
    cfg.smtpFrom || fromAddress,
    recipientEmail,
    subject,
    htmlBody,
    plainText,
    renamedFile,
    encryptedPdf
  );

  const conn = await openAuthenticatedSmtp(cfg);
  try {
    await conn.command(`MAIL FROM:<${fromAddress}>`, ['250']);
    await conn.command(`RCPT TO:<${recipientEmail}>`, ['250', '251']);
    await conn.command('DATA', ['354']);
    const dataResp = await conn.sendRaw(mimePayload);
    if (!dataResp.startsWith('250')) {
      throw new Error(`SMTP DATA failed: ${dataResp}`);
    }
    await conn.command('QUIT', ['221', '250']);
  } finally {
    conn.close();
  }
}
