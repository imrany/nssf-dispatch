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
	"net"
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

func nssfLogoDataURI() string {
	if len(embeddedLogoPNG) == 0 {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(embeddedLogoPNG)
}

func buildOfficialNSSFEmailHTML(logoSrc, memberName, period, renamedFile, passwordGuide, memberNo, standardAmount, voluntaryAmount, totalAmount, portalURL string) string {
	logoMarkup := ""
	if logoSrc != "" {
		logoMarkup = fmt.Sprintf(
			`<img src="%s" alt="NSSF — Growing You. For Good" style="height:52px;width:auto;display:block;border:0;margin-bottom:8px;" />`,
			logoSrc,
		)
	}

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#0f2437;">
  <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;">
    <tr>
      <td style="padding:24px 24px 16px;border-bottom:3px solid #2B7A3B;">
        %s
        <div style="font-size:15px;font-weight:800;color:#0f2437;letter-spacing:0.2px;">NATIONAL SOCIAL SECURITY FUND (NSSF) KENYA</div>
        <div style="font-size:12px;font-weight:600;color:#1E6B34;margin-top:3px;">Official Provisional Member Statement Dispatch</div>
      </td>
    </tr>
    <tr>
      <td style="padding:24px;">
        <p style="margin:0 0 14px;font-size:15px;color:#0f2437;">Dear <strong>%s</strong>,</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#334155;">
          Attached is your official <strong>NSSF Provisional Member Statement of Account</strong> covering <strong>%s</strong>, prepared and dispatched at your request through the NSSF Member Service Desk.
        </p>
        <div style="border-left:3px solid #2B7A3B;background-color:#f8faf9;padding:14px 18px;margin-bottom:22px;">
          <div style="font-size:13px;font-weight:700;color:#1E6B34;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">How to Open &amp; View Your Statement</div>
          <p style="margin:0 0 10px;font-size:13px;line-height:1.55;color:#1e293b;">
            To protect your personal financial data under the Kenya Data Protection Act, the attached PDF file (<strong>%s</strong>) is password-encrypted.
          </p>
          <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.65;color:#1e293b;">
            <li>Save and open <strong>%s</strong> in Adobe Acrobat Reader, Chrome, or your mobile PDF viewer.</li>
            <li>When prompted for a document password, enter <strong>%s</strong>.</li>
            <li>Verify your monthly Standard and Voluntary contributions directly inside the statement.</li>
          </ol>
        </div>
        <table role="presentation" width="100%%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;border-top:1px solid #e2e8f0;">
          <tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;">NSSF Member Number</td><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;font-family:monospace;color:#0f2437;">%s</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;">Statement Period</td><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600;color:#0f2437;">%s</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;">Standard Contributions</td><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;color:#0f2437;">KES %s</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;">Voluntary Contributions</td><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-family:monospace;color:#0f2437;">KES %s</td></tr>
          <tr><td style="padding:11px 0;border-bottom:1px solid #e2e8f0;color:#0f2437;font-weight:700;">Total Fund Balance</td><td style="padding:11px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#1E6B34;font-family:monospace;font-size:14px;">KES %s</td></tr>
        </table>
        <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#475569;">
          You can also access member services anytime via USSD <strong>*303#</strong> or the <a href="%s" style="color:#1E6B34;font-weight:600;">NSSF Digital Portal</a>.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 24px 24px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;line-height:1.5;">
        National Social Security Fund (NSSF) · Social Security House, Bishops Road, P.O. Box 30599 - 00100 Nairobi, Kenya.
      </td>
    </tr>
  </table>
</body>
</html>`,
		logoMarkup,
		html.EscapeString(memberName), html.EscapeString(period), html.EscapeString(renamedFile),
		html.EscapeString(renamedFile), html.EscapeString(passwordGuide), html.EscapeString(memberNo),
		html.EscapeString(period), html.EscapeString(standardAmount), html.EscapeString(voluntaryAmount),
		html.EscapeString(totalAmount), html.EscapeString(portalURL))
}

func BuildOfficialNSSFMessage(meta *StatementMeta, renamedFile, passwordMode, portalURL, rawPassword, emailSubjectTpl, whatsappMessageTpl string) (subject, htmlBody, plainText, whatsappText, passwordGuide string) {
	masked := maskSecret(rawPassword)
	maskedMemberNo := maskSecret(strings.TrimSpace(meta.MemberNo))
	if passwordMode == "id_and_nssf_last4" {
		passwordGuide = fmt.Sprintf("Your National ID Card Number followed by the last 4 characters of your NSSF Member Number (%s)", masked)
	} else {
		passwordGuide = fmt.Sprintf("Your National ID Card Number (%s)", masked)
	}

	vars := map[string]string{
		"memberName":      meta.MemberName,
		"memberNo":        maskedMemberNo,
		"maskedMemberNo":  maskedMemberNo,
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
		meta.MemberName, meta.Period, meta.MemberName, maskedMemberNo, defaultStr(meta.Employer, "Registered Contributor"),
		meta.StandardAmount, meta.VoluntaryAmount, meta.TotalAmount, renamedFile, renamedFile, passwordGuide, portalURL)

	htmlBody = buildOfficialNSSFEmailHTML(
		nssfLogoDataURI(),
		meta.MemberName,
		meta.Period,
		renamedFile,
		passwordGuide,
		maskedMemberNo,
		meta.StandardAmount,
		meta.VoluntaryAmount,
		meta.TotalAmount,
		portalURL,
	)

	return
}

func dialSMTPClient(cfg AppSettings) (*smtp.Client, error) {
	host := strings.TrimSpace(cfg.SMTPHost)
	port := strings.TrimSpace(cfg.SMTPPort)
	if host == "" || port == "" {
		return nil, fmt.Errorf("SMTP host and port must be configured in System Settings")
	}
	addr := net.JoinHostPort(host, port)
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	var client *smtp.Client
	var err error
	if cfg.SMTPSecurity == "tls" || port == "465" {
		conn, dialErr := tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{ServerName: host})
		if dialErr != nil {
			return nil, dialErr
		}
		_ = conn.SetDeadline(time.Now().Add(45 * time.Second))
		client, err = smtp.NewClient(conn, host)
	} else {
		conn, dialErr := dialer.Dial("tcp", addr)
		if dialErr != nil {
			return nil, dialErr
		}
		_ = conn.SetDeadline(time.Now().Add(45 * time.Second))
		client, err = smtp.NewClient(conn, host)
		if err == nil && cfg.SMTPSecurity == "starttls" {
			if ok, _ := client.Extension("STARTTLS"); ok {
				if tlsErr := client.StartTLS(&tls.Config{ServerName: host}); tlsErr != nil {
					client.Close()
					return nil, tlsErr
				}
			}
		}
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(cfg.SMTPUser) != "" {
		auth := smtp.PlainAuth("", strings.TrimSpace(cfg.SMTPUser), cfg.SMTPPass, host)
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

func writeBase64Wrapped(w *bytes.Buffer, data []byte) {
	b64 := base64.StdEncoding.EncodeToString(data)
	for i := 0; i < len(b64); i += 76 {
		end := i + 76
		if end > len(b64) {
			end = len(b64)
		}
		_, _ = w.Write([]byte(b64[i:end] + "\r\n"))
	}
}

func SendEmailStatement(cfg AppSettings, recipient string, meta *StatementMeta, renamedFile string, encryptedPDF []byte, rawPassword string) error {
	if !cfg.EmailEnabled {
		return fmt.Errorf("email dispatch is currently disabled in system settings")
	}
	recipient = strings.TrimSpace(recipient)
	if recipient == "" {
		return fmt.Errorf("recipient email address is required")
	}
	if strings.TrimSpace(cfg.SMTPHost) == "" {
		return fmt.Errorf("SMTP host is not configured in system settings")
	}

	subject, htmlBody, plainText, _, passwordGuide := BuildOfficialNSSFMessage(meta, renamedFile, cfg.PasswordMode, cfg.PortalURL, rawPassword, cfg.EmailSubjectTemplate, cfg.WhatsAppMessageTemplate)

	hasLogo := len(embeddedLogoPNG) > 0
	if hasLogo {
		htmlBody = buildOfficialNSSFEmailHTML(
			"cid:nssf-logo",
			meta.MemberName,
			meta.Period,
			renamedFile,
			passwordGuide,
			maskSecret(strings.TrimSpace(meta.MemberNo)),
			meta.StandardAmount,
			meta.VoluntaryAmount,
			meta.TotalAmount,
			cfg.PortalURL,
		)
	}

	var buf bytes.Buffer
	mixedWriter := multipart.NewWriter(&buf)
	altBoundary := "NSSF_ALT_" + randomHex(8)
	relBoundary := "NSSF_REL_" + randomHex(8)

	fromHeader := defaultStr(strings.TrimSpace(cfg.SMTPFrom), defaultStr(strings.TrimSpace(cfg.SMTPUser), "statements@nssfkenya.co.ke"))
	fmt.Fprintf(&buf, "From: %s\r\n", fromHeader)
	fmt.Fprintf(&buf, "To: %s\r\n", recipient)
	fmt.Fprintf(&buf, "Subject: %s\r\n", subject)
	fmt.Fprintf(&buf, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	fmt.Fprintf(&buf, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&buf, "Content-Type: multipart/mixed; boundary=%s\r\n\r\n", mixedWriter.Boundary())

	if hasLogo {
		relHeader := textproto.MIMEHeader{}
		relHeader.Set("Content-Type", fmt.Sprintf("multipart/related; boundary=%s", relBoundary))
		relPart, _ := mixedWriter.CreatePart(relHeader)
		fmt.Fprintf(relPart, "--%s\r\nContent-Type: multipart/alternative; boundary=%s\r\n\r\n", relBoundary, altBoundary)
		fmt.Fprintf(relPart, "--%s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n", altBoundary, plainText)
		fmt.Fprintf(relPart, "--%s\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n--%s--\r\n", altBoundary, htmlBody, altBoundary)

		var logoBuf bytes.Buffer
		writeBase64Wrapped(&logoBuf, embeddedLogoPNG)
		fmt.Fprintf(relPart, "--%s\r\nContent-Type: image/png; name=\"nssf-logo.png\"\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <nssf-logo>\r\nContent-Disposition: inline; filename=\"nssf-logo.png\"\r\n\r\n%s--%s--\r\n",
			relBoundary, logoBuf.String(), relBoundary)
	} else {
		altHeader := textproto.MIMEHeader{}
		altHeader.Set("Content-Type", fmt.Sprintf("multipart/alternative; boundary=%s", altBoundary))
		altPart, _ := mixedWriter.CreatePart(altHeader)
		fmt.Fprintf(altPart, "--%s\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n", altBoundary, plainText)
		fmt.Fprintf(altPart, "--%s\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n--%s--\r\n", altBoundary, htmlBody, altBoundary)
	}

	pdfHeader := textproto.MIMEHeader{}
	pdfHeader.Set("Content-Type", fmt.Sprintf("application/pdf; name=\"%s\"", renamedFile))
	pdfHeader.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", renamedFile))
	pdfHeader.Set("Content-Transfer-Encoding", "base64")
	pdfPart, _ := mixedWriter.CreatePart(pdfHeader)

	var pdfB64Buf bytes.Buffer
	writeBase64Wrapped(&pdfB64Buf, encryptedPDF)
	_, _ = pdfPart.Write(pdfB64Buf.Bytes())
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

func SendPlainTextEmail(cfg AppSettings, recipient, subject, body string) error {
	if strings.TrimSpace(cfg.SMTPHost) == "" {
		return fmt.Errorf("SMTP host is not configured")
	}
	var buf bytes.Buffer
	fromHeader := defaultStr(strings.TrimSpace(cfg.SMTPFrom), defaultStr(strings.TrimSpace(cfg.SMTPUser), "statements@nssfkenya.co.ke"))
	fmt.Fprintf(&buf, "From: %s\r\n", fromHeader)
	fmt.Fprintf(&buf, "To: %s\r\n", recipient)
	fmt.Fprintf(&buf, "Subject: %s\r\n", strings.NewReplacer("\r", "", "\n", "").Replace(subject))
	fmt.Fprintf(&buf, "Date: %s\r\n", time.Now().UTC().Format(time.RFC1123Z))
	fmt.Fprintf(&buf, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&buf, "Content-Type: text/plain; charset=UTF-8\r\n\r\n%s\r\n", body)

	client, err := dialSMTPClient(cfg)
	if err != nil {
		return err
	}
	defer client.Close()

	fromAddr := defaultStr(strings.TrimSpace(cfg.SMTPUser), "statements@nssfkenya.co.ke")
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
