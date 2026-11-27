import type { AuditLog, DispatchReceipt } from '../types';

export function sanitizeSpreadsheetCell(value: string | number): string {
  const str = String(value ?? '');
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

function stripInvalidXmlChars(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd)
    ) {
      out += value[i];
    }
  }
  return out;
}

export function escapeXml(value: string): string {
  return stripInvalidXmlChars(value)
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
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
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

interface PdfLogoRaster {
  width: number;
  height: number;
  data: Uint8Array;
  compressed: boolean;
}

let cachedPdfLogoPromise: Promise<PdfLogoRaster | null> | null = null;

async function compressDeflate(raw: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate');
    const writer = cs.writable.getWriter();
    const copy = new Uint8Array(raw.byteLength);
    copy.set(raw);
    void writer.write(copy);
    void writer.close();
    const outBuf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(outBuf);
  } catch {
    return null;
  }
}

async function loadPdfLogoRaster(): Promise<PdfLogoRaster | null> {
  if (cachedPdfLogoPromise) return cachedPdfLogoPromise;
  cachedPdfLogoPromise = (async () => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return null;
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Failed to load NSSF logo'));
        el.src = '/assets/nssf-cl_d27cbb88.png';
      });
      const width = img.naturalWidth || 287;
      const height = img.naturalHeight || 150;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const rgb = new Uint8Array(width * height * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        rgb[j] = rgba[i];
        rgb[j + 1] = rgba[i + 1];
        rgb[j + 2] = rgba[i + 2];
      }
      const compressedBytes = await compressDeflate(rgb);
      if (compressedBytes && compressedBytes.length < rgb.length) {
        return { width, height, data: compressedBytes, compressed: true };
      }
      return { width, height, data: rgb, compressed: false };
    } catch {
      cachedPdfLogoPromise = null;
      return null;
    }
  })();
  return cachedPdfLogoPromise;
}

export async function buildDispatchReceiptPdfBlob(
  receipt: DispatchReceipt,
  brand: { appName: string; publisher: string; officeLocation: string; ussdCode: string }
): Promise<Blob> {
  const logoRaster = await loadPdfLogoRaster();
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

  // Clean White Official NSSF Letterhead + Logo + Green/Lime Divider Bar
  let textStartX = 44;
  if (logoRaster) {
    const drawHeight = 50;
    const drawWidth = Number(((logoRaster.width / logoRaster.height) * drawHeight).toFixed(2));
    cmds.push(`q ${drawWidth} 0 0 ${drawHeight} 44 754 cm /Im1 Do Q`);
    textStartX = Math.round(44 + drawWidth + 16);
  }

  addText('F2', 9.5, textStartX, 792, '0.118 0.420 0.204', brand.publisher.toUpperCase());
  addText('F2', 15.5, textStartX, 773, '0.059 0.141 0.216', brand.appName);
  addText('F1', 9.5, textStartX, 757, '0.35 0.42 0.49', 'OFFICIAL MEMBER STATEMENT DISPATCH RECEIPT');

  // NSSF Brand Green & Lime Rule underneath letterhead
  cmds.push('0.169 0.478 0.231 rg 44 740 507 3 re f');
  cmds.push('0.420 0.765 0.000 rg 44 738 507 1.5 re f');

  // Confirmation Badge Box
  cmds.push('0.925 0.992 0.953 rg 44 676 507 44 re f');
  cmds.push('0.169 0.478 0.231 RG 0.8 w 44 676 507 44 re S');
  addText('F2', 12, 58, 699, '0.118 0.420 0.204', 'DISPATCH CONFIRMED - LIVE DELIVERY RECORDED');
  addText(
    'F1',
    9.5,
    58,
    684,
    '0.22 0.30 0.36',
    `Issued: ${receipt.timestamp}   |   Channel: ${receipt.channel}   |   Status: SENT`
  );

  // Financial & Member Details Table
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

  const encoder = new TextEncoder();
  const streamBytes = encoder.encode(cmds.join('\n'));
  const xobjectRes = logoRaster ? ' /XObject << /Im1 7 0 R >>' : '';

  const objectParts: Uint8Array[] = [
    encoder.encode('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'),
    encoder.encode('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
    encoder.encode(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${xobjectRes} >> /Contents 6 0 R >>\nendobj\n`
    ),
    encoder.encode('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'),
    encoder.encode('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n'),
    concatBytes([
      encoder.encode(`6 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`),
      streamBytes,
      encoder.encode('\nendstream\nendobj\n'),
    ]),
  ];

  if (logoRaster) {
    const filterEntry = logoRaster.compressed ? ' /Filter /FlateDecode' : '';
    objectParts.push(
      concatBytes([
        encoder.encode(
          `7 0 obj\n<< /Type /XObject /Subtype /Image /Width ${logoRaster.width} /Height ${logoRaster.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${filterEntry} /Length ${logoRaster.data.length} >>\nstream\n`
        ),
        logoRaster.data,
        encoder.encode('\nendstream\nendobj\n'),
      ])
    );
  }

  const headerBytes = encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const chunks: Uint8Array[] = [headerBytes];
  const offsets: number[] = [0];
  let byteOffset = headerBytes.length;

  for (const objBytes of objectParts) {
    offsets.push(byteOffset);
    chunks.push(objBytes);
    byteOffset += objBytes.length;
  }

  const xrefOffset = byteOffset;
  let xrefStr = `xref\n0 ${objectParts.length + 1}\n`;
  xrefStr += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    xrefStr += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xrefStr += `trailer\n<< /Size ${objectParts.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(encoder.encode(xrefStr));

  const pdfBytes = concatBytes(chunks);
  return new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function buildAuditCsvBlob(logs: AuditLog[]): Blob {
  // Note: Never start an unquoted CSV file with "ID" because Microsoft Excel misidentifies it as a SYLK file.
  const headers = [
    'Log ID',
    'Timestamp',
    'Event Type',
    'Actor',
    'Source IP',
    'Member No',
    'Member Name',
    'Channel',
    'Target / Recipient',
    'Resource / File',
    'Status',
    'Details',
  ];
  const escapeCsv = (val: string | number) =>
    `"${sanitizeSpreadsheetCell(val).replace(/"/g, '""')}"`;

  const rows = logs.map((l) =>
    [
      l.id,
      l.timestamp,
      l.eventType || 'DISPATCH',
      l.actor || 'Service Desk',
      l.sourceIp || '',
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

  const csvBody = [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
  const encoder = new TextEncoder();
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const bodyBytes = encoder.encode(csvBody);
  const fullBytes = concatBytes([bom, bodyBytes]);
  return new Blob([fullBytes.buffer as ArrayBuffer], { type: 'text/csv;charset=utf-8;' });
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildStoredZip(entries: Array<{ name: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = encoder.encode(entry.content);
    const sum = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local file header signature
    lv.setUint16(4, 20, true); // Version needed to extract (2.0)
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // Compression method 0 (STORE)
    lv.setUint16(10, 0, true); // Mod time
    lv.setUint16(12, 0x5421, true); // Mod date
    lv.setUint32(14, sum, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central file header signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 filename flag
    cv.setUint16(10, 0, true); // STORE
    cv.setUint16(12, 0, true); // Mod time
    cv.setUint16(14, 0x5421, true); // Mod date
    cv.setUint32(16, sum, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // Extra length
    cv.setUint16(32, 0, true); // Comment length
    cv.setUint16(34, 0, true); // Disk number start
    cv.setUint16(36, 0, true); // Internal attrs
    cv.setUint32(38, 0, true); // External attrs
    cv.setUint32(42, offset, true); // Relative offset of local header
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  let centralSize = 0;
  for (const part of centralParts) centralSize += part.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // End of central directory signature
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return concatBytes([...localParts, ...centralParts, eocd]);
}

function colLetter(indexZeroBased: number): string {
  return String.fromCharCode(65 + indexZeroBased);
}

function inlineStrCell(colIdx: number, rowNum: number, styleIdx: number, value: string): string {
  return `<c r="${colLetter(colIdx)}${rowNum}" s="${styleIdx}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(
    value
  )}</t></is></c>`;
}

function numberCell(colIdx: number, rowNum: number, styleIdx: number, value: number): string {
  const num = Number.isFinite(value) ? value : 0;
  return `<c r="${colLetter(colIdx)}${rowNum}" s="${styleIdx}" t="n"><v>${num}</v></c>`;
}

export function buildAuditExcelBlob(
  logs: AuditLog[],
  appName: string,
  filters: { channel: string; status: string; query: string }
): Blob {
  const exportedAt = new Date().toISOString();
  const headers = [
    'Log ID',
    'Timestamp',
    'Event Type',
    'Actor',
    'Source IP',
    'NSSF Member No',
    'Member Name',
    'Channel',
    'Target / Recipient',
    'Resource / File',
    'Outcome',
    'Audit Details',
  ];

  const searchPart = filters.query.trim()
    ? ` | Search: ${sanitizeSpreadsheetCell(filters.query.trim())}`
    : '';

  const rowsXml: string[] = [];
  rowsXml.push(
    `<row r="1" ht="22" customHeight="1">${inlineStrCell(
      0,
      1,
      1,
      `${appName} - System & Compliance Audit Report`
    )}</row>`
  );
  rowsXml.push(
    `<row r="2" ht="18" customHeight="1">${inlineStrCell(
      0,
      2,
      2,
      `Generated: ${exportedAt} | Category: ${filters.channel} | Outcome: ${filters.status}${searchPart} | Records: ${logs.length}`
    )}</row>`
  );
  rowsXml.push(
    `<row r="4" ht="22" customHeight="1">${headers
      .map((h, idx) => inlineStrCell(idx, 4, 3, h))
      .join('')}</row>`
  );

  logs.forEach((l, i) => {
    const rowNum = 5 + i;
    const cells = [
      numberCell(0, rowNum, 5, Number(l.id)),
      inlineStrCell(1, rowNum, 4, sanitizeSpreadsheetCell(l.timestamp)),
      inlineStrCell(2, rowNum, 4, sanitizeSpreadsheetCell(l.eventType || 'DISPATCH')),
      inlineStrCell(3, rowNum, 4, sanitizeSpreadsheetCell(l.actor || 'Service Desk')),
      inlineStrCell(4, rowNum, 4, sanitizeSpreadsheetCell(l.sourceIp || '')),
      inlineStrCell(5, rowNum, 4, sanitizeSpreadsheetCell(l.memberNo)),
      inlineStrCell(6, rowNum, 4, sanitizeSpreadsheetCell(l.memberName)),
      inlineStrCell(7, rowNum, 4, sanitizeSpreadsheetCell(l.channel)),
      inlineStrCell(8, rowNum, 4, sanitizeSpreadsheetCell(l.destination)),
      inlineStrCell(9, rowNum, 4, sanitizeSpreadsheetCell(l.renamedFile)),
      inlineStrCell(10, rowNum, 4, sanitizeSpreadsheetCell(l.status)),
      inlineStrCell(11, rowNum, 4, sanitizeSpreadsheetCell(l.details)),
    ].join('');
    rowsXml.push(`<row r="${rowNum}">${cells}</row>`);
  });

  const colWidths = [10, 22, 14, 18, 16, 18, 24, 14, 28, 30, 22, 48];
  const colsXml = colWidths
    .map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`)
    .join('');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="NSSF Audit Logs" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><color rgb="FF0F2437"/><name val="Calibri"/></font>
    <font><b/><sz val="13"/><color rgb="FF0F2437"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF475569"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF2B7A3B"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FF1E6B34"/></bottom><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  </cellXfs>
</styleSheet>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml.join('')}</sheetData>
</worksheet>`;

  const zipBytes = buildStoredZip([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/styles.xml', content: stylesXml },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml },
  ]);

  return new Blob([zipBytes.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
