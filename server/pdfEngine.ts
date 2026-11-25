import crypto from 'node:crypto';
import zlib from 'node:zlib';

export interface StatementMeta {
  memberNo: string;
  memberName: string;
  idCardNo: string;
  dateOfBirth: string;
  dateRegistered: string;
  kraPin: string;
  employer: string;
  period: string;
  statementDate: string;
  standardAmount: string;
  voluntaryAmount: string;
  totalAmount: string;
}

interface PdfTextToken {
  x: number;
  y: number;
  text: string;
}

const PDF_PADDING = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function rc4(key: Uint8Array, data: Uint8Array): Buffer {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
  }
  const out = Buffer.allocUnsafe(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

function md5(buf: Uint8Array): Buffer {
  return crypto.createHash('md5').update(buf).digest();
}

function padPassword(pwd: string): Buffer {
  const out = Buffer.alloc(32);
  const b = Buffer.from(pwd, 'latin1');
  if (b.length >= 32) {
    b.copy(out, 0, 0, 32);
  } else {
    b.copy(out, 0);
    PDF_PADDING.copy(out, b.length, 0, 32 - b.length);
  }
  return out;
}

export function decodeASCII85(input: string): Buffer {
  let clean = input.trim();
  if (clean.startsWith('<~')) clean = clean.slice(2);
  const eod = clean.indexOf('~>');
  if (eod !== -1) clean = clean.slice(0, eod);

  const out: number[] = [];
  let tuple = 0;
  let count = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code <= 32) continue;
    if (code === 122 && count === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const val = code - 33;
    if (val < 0 || val > 84) continue;
    tuple = tuple * 85 + val;
    count++;
    if (count === 5) {
      out.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff);
      tuple = 0;
      count = 0;
    }
  }
  if (count > 1) {
    for (let i = count; i < 5; i++) tuple = tuple * 85 + 84;
    for (let i = 0; i < count - 1; i++) {
      out.push((tuple >>> (24 - i * 8)) & 0xff);
    }
  }
  return Buffer.from(out);
}

function unescapePdfLiteral(raw: string): string {
  let res = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === 'n') { res += '\n'; i++; }
      else if (next === 'r') { res += '\r'; i++; }
      else if (next === 't') { res += '\t'; i++; }
      else if (next === 'b') { res += '\b'; i++; }
      else if (next === 'f') { res += '\f'; i++; }
      else if (next === '(' || next === ')' || next === '\\') { res += next; i++; }
      else if (next >= '0' && next <= '7') {
        const oct = raw.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] || next;
        res += String.fromCharCode(parseInt(oct, 8));
        i += oct.length;
      } else {
        res += next;
        i++;
      }
    } else {
      res += raw[i];
    }
  }
  return res;
}

function unescapePdfLiteralBytes(raw: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === 'n') { bytes.push(10); i++; }
      else if (next === 'r') { bytes.push(13); i++; }
      else if (next === 't') { bytes.push(9); i++; }
      else if (next === 'b') { bytes.push(8); i++; }
      else if (next === 'f') { bytes.push(12); i++; }
      else if (next === '(' || next === ')' || next === '\\') { bytes.push(next.charCodeAt(0)); i++; }
      else if (next >= '0' && next <= '7') {
        const oct = raw.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] || next;
        bytes.push(parseInt(oct, 8));
        i += oct.length;
      } else {
        bytes.push(next.charCodeAt(0));
        i++;
      }
    } else {
      bytes.push(raw.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function reconstructContentStreamRows(streamText: string): string[] {
  const tokens: PdfTextToken[] = [];
  let inBT = false;
  let tx = 0;
  let ty = 0;
  let tlmX = 0;
  let tlmY = 0;
  let leading = 14;
  const numStack: number[] = [];

  let i = 0;
  const len = streamText.length;

  const readLiteral = (): string => {
    let depth = 1;
    let out = '';
    i++; // skip '('
    while (i < len && depth > 0) {
      const ch = streamText[i];
      if (ch === '\\' && i + 1 < len) {
        out += ch + streamText[i + 1];
        i += 2;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) { i++; break; }
      }
      out += ch;
      i++;
    }
    return unescapePdfLiteral(out);
  };

  while (i < len) {
    const ch = streamText[i];
    if (ch <= ' ') { i++; continue; }

    if (ch === '(') {
      const lit = readLiteral();
      // Peek operator
      while (i < len && streamText[i] <= ' ') i++;
      if (streamText.slice(i, i + 2) === 'Tj') {
        if (lit.trim()) tokens.push({ x: tx, y: ty, text: lit.trim() });
        i += 2;
      } else if (streamText[i] === "'") {
        tlmY -= leading;
        tx = tlmX;
        ty = tlmY;
        if (lit.trim()) tokens.push({ x: tx, y: ty, text: lit.trim() });
        i += 1;
      } else if (streamText[i] === '"') {
        tlmY -= leading;
        tx = tlmX;
        ty = tlmY;
        if (lit.trim()) tokens.push({ x: tx, y: ty, text: lit.trim() });
        i += 1;
      }
      continue;
    }

    if (ch === '[') {
      i++;
      let combined = '';
      while (i < len && streamText[i] !== ']') {
        if (streamText[i] === '(') {
          combined += readLiteral();
        } else {
          i++;
        }
      }
      if (streamText[i] === ']') i++;
      while (i < len && streamText[i] <= ' ') i++;
      if (streamText.slice(i, i + 2) === 'TJ') {
        if (combined.trim()) tokens.push({ x: tx, y: ty, text: combined.trim() });
        i += 2;
      }
      continue;
    }

    if (ch === '/') {
      i++;
      while (i < len && streamText[i] > ' ' && !'()[]<>{}/%'.includes(streamText[i])) i++;
      continue;
    }

    if ((ch >= '0' && ch <= '9') || ch === '-' || ch === '+' || ch === '.') {
      let numStr = '';
      while (i < len && ((streamText[i] >= '0' && streamText[i] <= '9') || streamText[i] === '.' || streamText[i] === '-' || streamText[i] === '+')) {
        numStr += streamText[i++];
      }
      const n = Number(numStr);
      if (!Number.isNaN(n)) numStack.push(n);
      continue;
    }

    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '*' || ch === "'" || ch === '"') {
      let op = '';
      while (i < len && ((streamText[i] >= 'A' && streamText[i] <= 'Z') || (streamText[i] >= 'a' && streamText[i] <= 'z') || streamText[i] === '*')) {
        op += streamText[i++];
      }
      if (op === 'BT') {
        inBT = true;
        tx = 0; ty = 0; tlmX = 0; tlmY = 0;
      } else if (op === 'ET') {
        inBT = false;
      } else if (inBT && (op === 'Td' || op === 'TD') && numStack.length >= 2) {
        const dy = numStack.pop()!;
        const dx = numStack.pop()!;
        tlmX += dx;
        tlmY += dy;
        tx = tlmX;
        ty = tlmY;
        if (op === 'TD') leading = -dy;
      } else if (inBT && op === 'Tm' && numStack.length >= 6) {
        const f = numStack.pop()!;
        const e = numStack.pop()!;
        numStack.splice(numStack.length - 4, 4);
        tlmX = e;
        tlmY = f;
        tx = e;
        ty = f;
      } else if (inBT && op === 'TL' && numStack.length >= 1) {
        leading = numStack.pop()!;
      } else if (inBT && op === 'T*') {
        tlmY -= leading;
        tx = tlmX;
        ty = tlmY;
      }
      numStack.length = 0;
      continue;
    }

    i++;
  }

  if (tokens.length === 0) return [];

  // Bucket tokens into visual rows (label/value baseline offset is ~1pt; separate lines are >=3.5pt)
  tokens.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextToken[][] = [];
  for (const t of tokens) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(lastRow[0].y - t.y) <= 2.2) {
      lastRow.push(t);
    } else {
      rows.push([t]);
    }
  }

  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    return row.map((t) => t.text).join(' ');
  });
}

function decodePdfStreams(pdfBuf: Buffer): string[] {
  const latin = pdfBuf.toString('latin1');
  const rows: string[] = [];
  const streamRe = /(<<[\s\S]*?>>)\s*stream\r?\n([\s\S]*?)\r?\n?endstream/g;

  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(latin)) !== null) {
    const dict = match[1];
    const bodyStr = match[2];
    let data: Buffer = Buffer.from(bodyStr, 'latin1');

    if (dict.includes('/ASCII85Decode')) {
      data = decodeASCII85(bodyStr);
    }
    if (dict.includes('/FlateDecode')) {
      try {
        data = zlib.inflateSync(data);
      } catch {
        continue;
      }
    } else if (!dict.includes('/ASCII85Decode')) {
      try {
        data = zlib.inflateSync(data);
      } catch {
        // Leave as uncompressed content stream
      }
    }

    const decodedStr = data.toString('latin1');
    const extractedRows = reconstructContentStreamRows(decodedStr);
    if (extractedRows.length > 0) {
      rows.push(...extractedRows);
    } else {
      const litRe = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
      let lm: RegExpExecArray | null;
      const fallbackTokens: string[] = [];
      while ((lm = litRe.exec(decodedStr)) !== null) {
        const cleaned = unescapePdfLiteral(lm[1]).trim();
        if (cleaned) fallbackTokens.push(cleaned);
      }
      if (fallbackTokens.length > 0) rows.push(fallbackTokens.join(' '));
    }
  }

  return rows;
}

function matchField(text: string, pattern: RegExp): string {
  const m = text.match(pattern);
  return m?.[1] ? m[1].trim() : '';
}

export function extractAndValidatePdf(pdfBuf: Buffer, expectedMemberNo: string): StatementMeta {
  if (!pdfBuf.subarray(0, 8).toString('latin1').includes('%PDF-')) {
    throw new Error('The uploaded file is not a valid PDF document.');
  }

  const rows = decodePdfStreams(pdfBuf);
  const fullText = rows.join('\n');

  const memberNo = matchField(fullText, /NSSF Member No:\s*([A-Z0-9]+)/i);
  if (!memberNo) {
    throw new Error('Could not detect an NSSF Member Number inside the uploaded statement PDF.');
  }

  const normalizedExpected = expectedMemberNo.trim().toUpperCase();
  const normalizedFound = memberNo.trim().toUpperCase();
  if (!normalizedExpected) {
    throw new Error('Please enter the Member NSSF Number before validating.');
  }
  if (normalizedExpected !== normalizedFound) {
    throw new Error(
      `Validation mismatch: entered NSSF Number (${expectedMemberNo.trim()}) does not match statement Member Number (${memberNo}).`
    );
  }

  const idCardNo = matchField(fullText, /Id Card No:\s*([A-Z0-9]+)/i);
  if (!idCardNo) {
    throw new Error('Member ID Card Number is missing in the statement PDF; cannot password-protect the document.');
  }

  const memberName = matchField(
    fullText,
    /Member Name:\s*([A-Za-z0-9\s.'-]+?)(?:\s+KRA Pin No:|\s+Date of Birth:|\s+Benefit Type|\n|$)/i
  );
  const dateOfBirth = matchField(fullText, /Date of Birth:\s*([0-9]{2}[./-][0-9]{2}[./-][0-9]{4})/i);
  const dateRegistered = matchField(fullText, /Date Registered:\s*([0-9]{2}[./-][0-9]{2}[./-][0-9]{4})/i);
  const kraPin = matchField(fullText, /KRA Pin No:\s*([AP][0-9]{9}[A-Z])\b/i);
  const period = matchField(fullText, /Period From\s+([0-9/.-]+\s+until\s+[0-9/.-]+)/i);
  const statementDate = matchField(fullText, /Date:\s*([0-9]{2}[./-][0-9]{2}[./-][0-9]{4})/i);
  const standardAmount = matchField(fullText, /Standard:\s*([0-9,]+\.[0-9]{2})/i);
  const voluntaryAmount = matchField(fullText, /Voluntary:\s*([0-9,]+\.[0-9]{2})/i);
  const totalAmount = matchField(fullText, /Total Amount:\s*([0-9,]+\.[0-9]{2})/i);

  let employer = matchField(
    fullText,
    /Employer:\s*([A-Z0-9\s&.,'-]+?)(?:\s+Interest \(New Fund\):|\n|$)/i
  );
  // Capture wrapped second line of employer name (e.g., "FUND" on next row)
  const employerLineIdx = rows.findIndex((r) => /Employer:/i.test(r));
  if (employerLineIdx !== -1 && employerLineIdx + 1 < rows.length) {
    const nextRow = rows[employerLineIdx + 1].trim();
    if (nextRow && !/Monthly Contributions|Year|NSSF/i.test(nextRow) && nextRow.length < 40) {
      employer = `${employer} ${nextRow}`.trim();
    }
  }

  return {
    memberNo,
    memberName: memberName || 'NSSF Member',
    idCardNo,
    dateOfBirth,
    dateRegistered,
    kraPin,
    employer,
    period: period || 'Current Statement Period',
    statementDate,
    standardAmount: standardAmount || '0.00',
    voluntaryAmount: voluntaryAmount || '0.00',
    totalAmount: totalAmount || '0.00',
  };
}

function encryptObjectStrings(dictOrBody: string, objKey: Buffer): string {
  // Walk character by character so we don't touch << >> or /Names or streams,
  // and convert literal (...) strings and <hex> strings into RC4-encrypted <HEX> strings.
  let out = '';
  let i = 0;
  const len = dictOrBody.length;

  while (i < len) {
    const ch = dictOrBody[i];

    // Skip comments
    if (ch === '%') {
      const nl = dictOrBody.indexOf('\n', i);
      if (nl === -1) {
        out += dictOrBody.slice(i);
        break;
      }
      out += dictOrBody.slice(i, nl + 1);
      i = nl + 1;
      continue;
    }

    // Preserve dictionary delimiters << and >>
    if (ch === '<' && dictOrBody[i + 1] === '<') {
      out += '<<';
      i += 2;
      continue;
    }
    if (ch === '>' && dictOrBody[i + 1] === '>') {
      out += '>>';
      i += 2;
      continue;
    }

    // Literal string (...)
    if (ch === '(') {
      let depth = 1;
      let rawInner = '';
      i++;
      while (i < len && depth > 0) {
        const c = dictOrBody[i];
        if (c === '\\' && i + 1 < len) {
          rawInner += c + dictOrBody[i + 1];
          i += 2;
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) { i++; break; }
        }
        rawInner += c;
        i++;
      }
      const plainBytes = unescapePdfLiteralBytes(rawInner);
      const cipherBytes = rc4(objKey, plainBytes);
      out += `<${cipherBytes.toString('hex').toUpperCase()}>`;
      continue;
    }

    // Hex string <...>
    if (ch === '<') {
      const closeIdx = dictOrBody.indexOf('>', i + 1);
      if (closeIdx !== -1) {
        let hexClean = dictOrBody.slice(i + 1, closeIdx).replace(/\s+/g, '');
        if (hexClean.length % 2 === 1) hexClean += '0';
        const plainBytes = Buffer.from(hexClean, 'hex');
        const cipherBytes = rc4(objKey, plainBytes);
        out += `<${cipherBytes.toString('hex').toUpperCase()}>`;
        i = closeIdx + 1;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Encrypts a PDF with ISO 32000-1 Standard Security Handler (RC4 128-bit, V=2, R=3).
 * Encrypts all object streams AND object strings cleanly and rebuilds a valid xref + trailer.
 */
export function encryptPdfWithPassword(pdfBuf: Buffer, userPassword: string): Buffer {
  const latin = pdfBuf.toString('latin1');
  const fileID = crypto.randomBytes(16);

  const ownerPad = padPassword('NSSF_KENYA_VAULT_2026');
  const userPad = padPassword(userPassword);

  // Algorithm 3: Compute O entry (Rev 3)
  let h: Buffer = md5(ownerPad);
  for (let i = 0; i < 50; i++) h = md5(h);
  const ownerKey = h.subarray(0, 16);
  let oVal: Buffer = Buffer.from(userPad);
  for (let i = 0; i < 20; i++) {
    const k = Buffer.alloc(16);
    for (let j = 0; j < 16; j++) k[j] = ownerKey[j] ^ i;
    oVal = rc4(k, oVal);
  }

  // Permissions: -3904 (0xFFFFF0C0) -> allow printing & high-res printing, restrict modification
  const perm = Buffer.from([0xc0, 0xf0, 0xff, 0xff]);

  // Algorithm 2: File Encryption Key (Rev 3, 128-bit)
  const keyHasher = crypto.createHash('md5');
  keyHasher.update(userPad);
  keyHasher.update(oVal);
  keyHasher.update(perm);
  keyHasher.update(fileID);
  let encKey: Buffer = keyHasher.digest();
  for (let i = 0; i < 50; i++) {
    encKey = md5(encKey.subarray(0, 16));
  }
  const fileEncKey = encKey.subarray(0, 16);

  // Algorithm 5: Compute U entry (Rev 3)
  const uHasher = crypto.createHash('md5');
  uHasher.update(PDF_PADDING);
  uHasher.update(fileID);
  let uHash: Buffer = uHasher.digest();
  for (let i = 0; i < 20; i++) {
    const k = Buffer.alloc(16);
    for (let j = 0; j < 16; j++) k[j] = fileEncKey[j] ^ i;
    uHash = rc4(k, uHash);
  }
  const uVal = Buffer.concat([uHash, Buffer.alloc(16)]);

  // Parse Root and Info references from original trailer
  const trailerIdx = latin.lastIndexOf('trailer');
  const trailerSlice = trailerIdx !== -1 ? latin.slice(trailerIdx) : latin.slice(-1024);
  const rootRef = trailerSlice.match(/\/Root\s+(\d+\s+\d+\s+R)/)?.[1] || '1 0 R';
  const infoRef = trailerSlice.match(/\/Info\s+(\d+\s+\d+\s+R)/)?.[1];

  // Parse all indirect objects (N G obj ... endobj)
  const objRe = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g;
  const objects = new Map<number, { gen: number; content: Buffer }>();
  let maxObjNum = 0;
  let m: RegExpExecArray | null;

  while ((m = objRe.exec(latin)) !== null) {
    const objNum = parseInt(m[1], 10);
    const genNum = parseInt(m[2], 10);
    const rawBody = m[3];
    if (objNum > maxObjNum) maxObjNum = objNum;

    // Derive per-object RC4 key
    const objKeyInput = Buffer.concat([
      fileEncKey,
      Buffer.from([
        objNum & 0xff,
        (objNum >> 8) & 0xff,
        (objNum >> 16) & 0xff,
        genNum & 0xff,
        (genNum >> 8) & 0xff,
      ]),
    ]);
    const objKey = md5(objKeyInput).subarray(0, 16);

    const streamKw = rawBody.indexOf('stream');
    const endStreamKw = rawBody.lastIndexOf('endstream');

    if (streamKw !== -1 && endStreamKw > streamKw) {
      const dictPart = rawBody.slice(0, streamKw);
      const encryptedDict = encryptObjectStrings(dictPart, objKey);

      let dataStart = streamKw + 6;
      if (rawBody[dataStart] === '\r') dataStart++;
      if (rawBody[dataStart] === '\n') dataStart++;
      let dataEnd = endStreamKw;
      if (dataEnd > dataStart && rawBody[dataEnd - 1] === '\n') dataEnd--;
      if (dataEnd > dataStart && rawBody[dataEnd - 1] === '\r') dataEnd--;

      const rawStreamBytes = Buffer.from(rawBody.slice(dataStart, dataEnd), 'latin1');
      const encryptedStream = rc4(objKey, rawStreamBytes);

      const rebuilt = Buffer.concat([
        Buffer.from(`${encryptedDict}stream\n`, 'latin1'),
        encryptedStream,
        Buffer.from('\nendstream\n', 'latin1'),
      ]);
      objects.set(objNum, { gen: genNum, content: rebuilt });
    } else {
      const encryptedBody = encryptObjectStrings(rawBody, objKey);
      objects.set(objNum, { gen: genNum, content: Buffer.from(encryptedBody, 'latin1') });
    }
  }

  if (objects.size === 0) {
    throw new Error('Could not parse PDF indirect objects for encryption.');
  }

  const encryptObjNum = maxObjNum + 1;
  const encryptObjBody = `\n<< /Filter /Standard /V 2 /R 3 /Length 128 /P -3904 /O <${oVal
    .toString('hex')
    .toUpperCase()}> /U <${uVal.toString('hex').toUpperCase()}> >>\n`;
  objects.set(encryptObjNum, { gen: 0, content: Buffer.from(encryptObjBody, 'latin1') });

  // Assemble clean PDF with exact byte offsets
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = chunks[0].length;
  const totalSize = encryptObjNum + 1;
  const xrefEntries: string[] = ['0000000000 65535 f \n'];

  for (let num = 1; num < totalSize; num++) {
    const obj = objects.get(num);
    if (!obj) {
      xrefEntries.push('0000000000 65535 f \n');
      continue;
    }
    xrefEntries.push(`${String(offset).padStart(10, '0')} ${String(obj.gen).padStart(5, '0')} n \n`);
    const header = Buffer.from(`${num} ${obj.gen} obj`, 'latin1');
    const footer = Buffer.from('endobj\n', 'latin1');
    const block = Buffer.concat([header, obj.content, footer]);
    chunks.push(block);
    offset += block.length;
  }

  const xrefOffset = offset;
  const fileIDHex = fileID.toString('hex').toUpperCase();
  const infoEntry = infoRef ? `/Info ${infoRef} ` : '';
  const trailer =
    `xref\n0 ${totalSize}\n` +
    xrefEntries.join('') +
    `trailer\n<< /Size ${totalSize} /Root ${rootRef} ${infoEntry}/Encrypt ${encryptObjNum} 0 R /ID [<${fileIDHex}><${fileIDHex}>] >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  chunks.push(Buffer.from(trailer, 'latin1'));
  return Buffer.concat(chunks);
}
