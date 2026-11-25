package main

import (
	"bytes"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"html"
	"mime/multipart"
	"net/smtp"
	"net/textproto"
	"strings"
	"time"
)

func maskSecret(val string) string {
	if val == "" {
		return "****"
	}
	if len(val) <= 3 {
		return strings.Repeat("*", len(val))
	}
	return strings.Repeat("*", len(val)-3) + val[len(val)-3:]
}

func RenderMessageTemplate(template string, vars map[string]string, stripNewlines bool) string {
	result := template
	for k, v := range vars {
		result = strings.ReplaceAll(result, "{"+k+"}", v)
	}
	if stripNewlines {
		result = strings.ReplaceAll(result, "\r", " ")
		result = strings.ReplaceAll(result, "\n", " ")
		result = strings.TrimSpace(result)
	}
	return result
}

func BuildOfficialNSSFMessage(meta *StatementMeta, renamedFile, passwordMode, portalURL, rawPassword, emailSubjectTpl, whatsappMessageTpl string) (subject, htmlBody, plainText, whatsappText, passwordGuide string) {
	masked := maskSecret(rawPassword)
	if passwordMode == "id_and_nssf_last4" {
		passwordGuide = fmt.Sprintf("Your National ID Card Number followed by the last 4 characters of your NSSF Member Number (%s)", masked)
	} else {
		passwordGuide = fmt.Sprintf("Your National ID Card Number (%s)", masked)
	}

	vars := map[string]string{
		"memberName":      meta.MemberName,
		"memberNo":        meta.MemberNo,
		"period":          meta.Period,
		"employer":        defaultStr(meta.Employer, "Registered Contributor"),
		"standardAmount":  meta.StandardAmount,
		"voluntaryAmount": meta.VoluntaryAmount,
		"totalAmount":     meta.TotalAmount,
		"renamedFile":     renamedFile,
		"passwordGuide":   passwordGuide,
		"portalUrl":       portalURL,
		"statementDate":   defaultStr(meta.StatementDate, meta.Period),
	}

	subjTpl := defaultStr(strings.TrimSpace(emailSubjectTpl), DefaultEmailSubjectTemplate)
	waTpl := defaultStr(strings.TrimSpace(whatsappMessageTpl), DefaultWhatsAppMessageTemplate)

	subject = RenderMessageTemplate(subjTpl, vars, true)
	whatsappText = RenderMessageTemplate(waTpl, vars, false)

	plainText = fmt.Sprintf(`NATIONAL SOCIAL SECURITY FUND (NSSF) KENYA
Member Self-Service & Statement Dispatch

Dear %s,

Please find attached your official NSSF Provisional Member Statement of Account for the period %s, dispatched upon your request at our NSSF Member Service Desk.

STATEMENT SUMMARY
- Member Name: %s
- NSSF Member No: %s
- Employer: %s
- Standard Contributions: KES %s
- Voluntary Contributions: KES %s
- Total Fund Balance: KES %s
- Protected File Name: %s

HOW TO OPEN & VIEW YOUR STATEMENT
To protect your personal financial records in compliance with the Kenya Data Protection Act, the attached PDF is encrypted and renamed.
1. Download and open the attached PDF file (%s) using Adobe Reader, Chrome, or your phone's PDF viewer.
2. When prompted for a password, enter: %s.
3. Review your monthly contribution breakdown and employer remittance status.

SELF-SERVICE CHANNELS
You can also check your balances or make voluntary contributions anytime via USSD *303# or the NSSF Digital Portal at %s.

National Social Security Fund (NSSF) Kenya
Social Security House, Bishops Road, P.O. Box 30599 - 00100 Nairobi`,
		meta.MemberName, meta.Period, meta.MemberName, meta.MemberNo, defaultStr(meta.Employer, "Registered Contributor"),
		meta.StandardAmount, meta.VoluntaryAmount, meta.TotalAmount, renamedFile, renamedFile, passwordGuide, portalURL)

	htmlBody = fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:24px;background-color:#f4f6f5;font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;">
    <tr>
      <td style="background-color:#006837;padding:22px 28px;border-bottom:4px solid #c59b27;">
        <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">NATIONAL SOCIAL SECURITY FUND (NSSF)</div>
        <div style="font-size:12px;color:#fef3c7;margin-top:4px;">Provisional Member Statement Dispatch · Kenya</div>
      </td>
    </tr>
    <tr>
      <td style="padding:28px;">
        <p style="margin:0 0 14px;font-size:15px;">Dear <strong>%s</strong>,</p>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#374151;">
          Attached is your official <strong>NSSF Provisional Member Statement of Account</strong> covering <strong>%s</strong>, prepared and dispatched at your request through the NSSF Member Service Desk.
        </p>
        <div style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:18px;margin-bottom:20px;">
          <div style="font-size:14px;font-weight:700;color:#006837;margin-bottom:8px;">How to Open &amp; View Your Statement</div>
          <p style="margin:0 0 10px;font-size:13px;line-height:1.55;color:#1f2937;">
            To protect your personal financial data under the Kenya Data Protection Act, the attached PDF file (<strong>%s</strong>) is password-encrypted.
          </p>
          <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.65;color:#1f2937;">
            <li>Save and open <strong>%s</strong> in Adobe Acrobat Reader, Chrome, or your mobile PDF viewer.</li>
            <li>When prompted for a document password, enter <strong>%s</strong>.</li>
            <li>Verify your monthly Standard and Voluntary contributions directly inside the statement.</li>
          </ol>
        </div>
        <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;border-top:1px solid #e5e7eb;">
          <tr><td style="padding:9px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">NSSF Member Number</td><td style="padding:9px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;font-family:monospace;">%s</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Statement Period</td><td style="padding:9px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">%s</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Standard Contributions</td><td style="padding:9px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;">KES %s</td></tr>
          <tr><td style="padding:9px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;">Voluntary Contributions</td><td style="padding:9px 0;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;">KES %s</td></tr>
          <tr><td style="padding:10px 0;color:#111827;font-weight:700;">Total Fund Balance</td><td style="padding:10px 0;text-align:right;font-weight:700;color:#006837;font-family:monospace;font-size:14px;">KES %s</td></tr>
        </table>
        <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#4b5563;">
          You can also access member services anytime via USSD <strong>*303#</strong> or the <a href="%s" style="color:#006837;font-weight:600;">NSSF Digital Portal</a>.
        </p>
      </td>
    </tr>
    <tr>
      <td style="background-color:#f9fafb;padding:16px 28px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280;line-height:1.5;">
        National Social Security Fund (NSSF) · Social Security House, Bishops Road, P.O. Box 30599 - 00100 Nairobi, Kenya.
      </td>
    </tr>
  </table>
</body>
</html>`,
		html.EscapeString(meta.MemberName), html.EscapeString(meta.Period), html.EscapeString(renamedFile),
		html.EscapeString(renamedFile), html.EscapeString(passwordGuide), html.EscapeString(meta.MemberNo),
		html.EscapeString(meta.Period), html.EscapeString(meta.StandardAmount), html.EscapeString(meta.VoluntaryAmount),
		html.EscapeString(meta.TotalAmount), html.EscapeString(portalURL))

	return
}

func dialSMTPClient(cfg AppSettings) (*smtp.Client, error) {
	addr := fmt.Sprintf("%s:%s", cfg.SMTPHost, cfg.SMTPPort)
	var client *smtp.Client
	var err error
	if cfg.SMTPSecurity == "tls" || cfg.SMTPPort == "465" {
		conn, dialErr := tls.Dial("tcp", addr, &tls.Config{ServerName: cfg.SMTPHost})
		if dialErr != nil {
			return nil, dialErr
		}
		client, err = smtp.NewClient(conn, cfg.SMTPHost)
	} else {
		client, err = smtp.Dial(addr)
		if err == nil && cfg.SMTPSecurity == "starttls" {
			if ok, _ := client.Extension("STARTTLS"); ok {
				if tlsErr := client.StartTLS(&tls.Config{ServerName: cfg.SMTPHost}); tlsErr != nil {
					client.Close()
					return nil, tlsErr
				}
			}
		}
	}
	if err != nil {
		return nil, err
	}
	if cfg.SMTPUser != "" {
		auth := smtp.PlainAuth("", cfg.SMTPUser, cfg.SMTPPass, cfg.SMTPHost)
		if err := client.Auth(auth); err != nil {
			client.Close()
			return nil, err
		}
	}
	return client, nil
}

func TestSMTPConnection(cfg AppSettings) error {
	c, err := dialSMTPClient(cfg)
	if err != nil {
		return err
	}
	return c.Quit()
}

func SendEmailStatement(cfg AppSettings, recipient string, meta *StatementMeta, renamedFile string, encryptedPDF []byte, rawPassword string) error {
	if !cfg.EmailEnabled {
		return fmt.Errorf("email dispatch is currently disabled in system settings")
	}

	subject, htmlBody, plainText, _, _ := BuildOfficialNSSFMessage(meta, renamedFile, cfg.PasswordMode, cfg.PortalURL, rawPassword, cfg.EmailSubjectTemplate, cfg.WhatsAppMessageTemplate)

	var buf bytes.Buffer
	mixedWriter := multipart.NewWriter(&buf)
	altBoundary := "NSSF_ALT_" + randomHex(8)

	fmt.Fprintf(&buf, "From: %s\r\n", cfg.SMTPFrom)
	fmt.Fprintf(&buf, "To: %s\r\n", recipient)
	fmt.Fprintf(&buf, "Subject: %s\r\n", subject)
	fmt.Fprintf(&buf, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	fmt.Fprintf(&buf, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&buf, "Content-Type: multipart/mixed; boundary=%s\r\n\r\n", mixedWriter.Boundary())

	altHeader := textproto.MIMEHeader{}
	altHeader.Set("Content-Type", fmt.Sprintf("multipart/alternative; boundary=%s", altBoundary))
	altPart, _ := mixedWriter.CreatePart(altHeader)
	fmt.Fprintf(altPart, "--%s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n", altBoundary, plainText)
	fmt.Fprintf(altPart, "--%s\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n--%s--\r\n", altBoundary, htmlBody, altBoundary)

	pdfHeader := textproto.MIMEHeader{}
	pdfHeader.Set("Content-Type", fmt.Sprintf("application/pdf; name=\"%s\"", renamedFile))
	pdfHeader.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", renamedFile))
	pdfHeader.Set("Content-Transfer-Encoding", "base64")
	pdfPart, _ := mixedWriter.CreatePart(pdfHeader)

	b64 := base64.StdEncoding.EncodeToString(encryptedPDF)
	for i := 0; i < len(b64); i += 76 {
		end := i + 76
		if end > len(b64) {
			end = len(b64)
		}
		_, _ = pdfPart.Write([]byte(b64[i:end] + "\r\n"))
	}
	_ = mixedWriter.Close()

	client, err := dialSMTPClient(cfg)
	if err != nil {
		return err
	}
	defer client.Close()

	fromAddr := cfg.SMTPUser
	if fromAddr == "" {
		fromAddr = "statements@nssfkenya.co.ke"
	}
	if err := client.Mail(fromAddr); err != nil {
		return err
	}
	if err := client.Rcpt(recipient); err != nil {
		return err
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(buf.Bytes()); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
