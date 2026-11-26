import type { AuditLog, DispatchReceipt } from '../types';

export function sanitizeSpreadsheetCell(value: string | number): string {
  const str = String(value ?? '');
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toPdfAscii(value: string): string {
  return String(value ?? '')
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/[\u00B7\u2022]/g, '|')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePdfLiteral(value: string): string {
  return toPdfAscii(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapPdfLine(value: string, maxChars: number): string[] {
  const clean = toPdfAscii(value);
  if (!clean) return ['-'];
  if (clean.length <= maxChars) return [clean];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
    while (current.length > maxChars) {
      lines.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function buildDispatchReceiptPdfBlob(
  receipt: DispatchReceipt,
  brand: { appName: string; publisher: string; officeLocation: string; ussdCode: string }
): Blob {
  const cmds: string[] = [];
  const addText = (
    font: 'F1' | 'F2',
    size: number,
    x: number,
    y: number,
    rgb: string,
    text: string
  ) => {
    cmds.push(`BT /${font} ${size} Tf ${rgb} rg 1 0 0 1 ${x} ${y} Tm (${escapePdfLiteral(text)}) Tj ET`);
  };

  // Top NSSF Dark Green Header Banner + Lime Accent Strip
  cmds.push('0.169 0.478 0.231 rg 0 742 595 100 re f');
  cmds.push('0.420 0.765 0.000 rg 0 737 595 5 re f');

  addText('F2', 11, 44, 808, '0.84 0.96 0.86', brand.publisher.toUpperCase());
  addText('F2', 19, 44, 782, '1 1 1', brand.appName);
  addText('F1', 10, 44, 760, '0.92 0.98 0.93', 'OFFICIAL MEMBER STATEMENT DISPATCH RECEIPT');

  // Confirmation Badge Box
  cmds.push('0.925 0.992 0.953 rg 44 676 507 44 re f');
  cmds.push('0.169 0.478 0.231 RG 0.8 w 44 676 507 44 re S');
  addText('F2', 12, 58, 699, '0.118 0.420 0.204', 'DISPATCH CONFIRMED — LIVE DELIVERY RECORDED');
  addText(
    'F1',
    9.5,
    58,
    684,
    '0.22 0.30 0.36',
    `Issued: ${receipt.timestamp}   |   Channel: ${receipt.channel}   |   Status: SENT`
  );

  // Financial & Member Details Card
  const rows: Array<{ label: string; value: string; highlight?: boolean }> = [
    { label: 'Member Name', value: receipt.memberName },
    { label: 'NSSF Member No', value: receipt.memberNo },
    { label: 'Statement Period', value: receipt.period },
    { label: 'Standard Contributions', value: `KES ${receipt.standardAmount}` },
    { label: 'Voluntary Contributions', value: `KES ${receipt.voluntaryAmount}` },
    { label: 'Total Fund Balance', value: `KES ${receipt.totalAmount}`, highlight: true },
    { label: 'Dispatch Channel', value: receipt.channel },
    { label: 'Sent To (Destination)', value: receipt.destination },
    { label: 'Encrypted Attachment', value: receipt.renamedFile },
    { label: 'Original Source File', value: receipt.originalFilename },
    { label: 'Dispatched Timestamp', value: receipt.timestamp },
    { label: 'Member Unlock Guide', value: receipt.passwordGuide },
  ];

  let cursorY = 648;
  addText('F2', 11, 44, cursorY, '0.059 0.141 0.216', 'TRANSACTION & COMPLIANCE SUMMARY');
  cmds.push('0.82 0.86 0.90 RG 0.7 w 44 640 m 551 640 l S');
  cursorY = 620;

  rows.forEach((row, idx) => {
    const wrapped = wrapPdfLine(row.value, 54);
    const rowHeight = Math.max(24, wrapped.length * 14 + 10);
    if (idx % 2 === 0) {
      cmds.push(`0.973 0.980 0.988 rg 44 ${cursorY - rowHeight + 16} 507 ${rowHeight} re f`);
    }
    cmds.push(
      `0.90 0.92 0.95 RG 0.5 w 44 ${cursorY - rowHeight + 16} m 551 ${cursorY - rowHeight + 16} l S`
    );

    addText('F2', 9.5, 52, cursorY, '0.35 0.42 0.49', row.label.toUpperCase());
    wrapped.forEach((line, lineIdx) => {
      addText(
        row.highlight || row.label === 'Encrypted Attachment' ? 'F2' : 'F1',
        10,
        220,
        cursorY - lineIdx * 13,
        row.highlight ? '0.118 0.420 0.204' : '0.059 0.141 0.216',
        line
      );
    });
    cursorY -= rowHeight;
  });

  // Footer Notice
  const footerY = Math.max(54, cursorY - 22);
  cmds.push(`0.82 0.86 0.90 RG 0.7 w 44 ${footerY + 26} m 551 ${footerY + 26} l S`);
  addText(
    'F1',
    8.5,
    44,
    footerY + 12,
    '0.38 0.44 0.50',
    'Notice: This receipt confirms encrypted statement dispatch only. For member confidentiality, raw passwords are never stored.'
  );
  addText(
    'F1',
    8.5,
    44,
    footerY - 2,
    '0.38 0.44 0.50',
    `${brand.publisher} | ${brand.officeLocation} | Self-Service USSD: ${brand.ussdCode}`
  );

  const streamContent = cmds.join('\n');
  const encoder = new TextEncoder();
  const streamBytes = encoder.encode(streamContent).length;

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    `6 0 obj\n<< /Length ${streamBytes} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  let byteOffset = encoder.encode(pdf).length;

  for (const obj of objects) {
    offsets.push(byteOffset);
    pdf += obj;
    byteOffset += encoder.encode(obj).length;
  }

  const xrefOffset = byteOffset;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([encoder.encode(pdf)], { type: 'application/pdf' });
}

export function buildAuditCsvBlob(logs: AuditLog[]): Blob {
  const headers = [
    'ID',
    'Timestamp',
    'MemberNo',
    'MemberName',
    'Channel',
    'Destination',
    'Filename',
    'Status',
    'Details',
  ];
  const escapeCsv = (val: string | number) =>
    `"${sanitizeSpreadsheetCell(val).replace(/"/g, '""')}"`;

  const rows = logs.map((l) =>
    [
      l.id,
      l.timestamp,
      l.memberNo,
      l.memberName,
      l.channel,
      l.destination,
      l.renamedFile,
      l.status,
      l.details,
    ]
      .map(escapeCsv)
      .join(',')
  );

  const csv = `\uFEFF${[headers.join(','), ...rows].join('\r\n')}`;
  return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
}

export function buildAuditExcelBlob(
  logs: AuditLog[],
  appName: string,
  filters: { channel: string; status: string; query: string }
): Blob {
  const exportedAt = new Date().toISOString();
  const headers = [
    'ID',
    'Timestamp',
    'NSSF Member No',
    'Member Name',
    'Channel',
    'Recipient',
    'Protected Filename',
    'Outcome',
    'Compliance Details',
  ];

  const headerCells = headers
    .map((h) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`)
    .join('');

  const dataRows = logs
    .map((l) => {
      const textCells = [
        l.timestamp,
        l.memberNo,
        l.memberName,
        l.channel,
        l.destination,
        l.renamedFile,
        l.status,
        l.details,
      ]
        .map(
          (val) =>
            `<Cell ss:StyleID="Cell"><Data ss:Type="String">${escapeXml(
              sanitizeSpreadsheetCell(val)
            )}</Data></Cell>`
        )
        .join('');
      return `<Row><Cell ss:StyleID="CellNum"><Data ss:Type="Number">${Number(
        l.id
      )}</Data></Cell>${textCells}</Row>`;
    })
    .join('');

  const searchPart = filters.query.trim()
    ? ` | Search: ${escapeXml(sanitizeSpreadsheetCell(filters.query.trim()))}`
    : '';

  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Title">
   <Font ss:Bold="1" ss:Size="13" ss:Color="#0F2437"/>
  </Style>
  <Style ss:ID="Meta">
   <Font ss:Size="10" ss:Color="#475569"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#2B7A3B" ss:Pattern="Solid"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1E6B34"/>
   </Borders>
  </Style>
  <Style ss:ID="Cell">
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
  </Style>
  <Style ss:ID="CellNum">
   <NumberFormat ss:Format="0"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
   </Borders>
  </Style>
 </Styles>
 <Worksheet ss:Name="NSSF Audit Logs">
  <Table>
   <Column ss:Width="45"/>
   <Column ss:Width="135"/>
   <Column ss:Width="105"/>
   <Column ss:Width="180"/>
   <Column ss:Width="80"/>
   <Column ss:Width="175"/>
   <Column ss:Width="200"/>
   <Column ss:Width="115"/>
   <Column ss:Width="250"/>
   <Row>
    <Cell ss:StyleID="Title"><Data ss:Type="String">${escapeXml(appName)} — Compliance Audit Report</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="Meta"><Data ss:Type="String">Generated: ${escapeXml(exportedAt)} | Channel: ${escapeXml(filters.channel)} | Outcome: ${escapeXml(filters.status)}${searchPart} | Records: ${logs.length}</Data></Cell>
   </Row>
   <Row/>
   <Row>${headerCells}</Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;

  return new Blob([workbookXml], { type: 'application/vnd.ms-excel;charset=utf-8' });
}
