import type { AuditLog } from '../types';

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
