import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Download, FileSpreadsheet, FileText, RefreshCw, Search } from 'lucide-react';
import type { AuditLog } from '../types';
import { toast } from './Toaster';

interface AuditLogsViewProps {
  onGoToDispatch: () => void;
}

const SMOOTH_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function sanitizeSpreadsheetCell(value: string | number): string {
  const str = String(value ?? '');
  return /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AuditLogsView({ onGoToDispatch }: AuditLogsViewProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<'ALL' | 'EMAIL' | 'WHATSAPP'>('ALL');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/audit');
      if (!res.ok) throw new Error('Server returned an error');
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch {
      setLogs([]);
      toast.error('Failed to load audit logs', 'Unable to query SQLite audit history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [exportMenuOpen]);

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((row) => {
      if (channelFilter !== 'ALL' && row.channel !== channelFilter) return false;
      if (!q) return true;
      return (
        row.memberNo.toLowerCase().includes(q) ||
        row.memberName.toLowerCase().includes(q) ||
        row.destination.toLowerCase().includes(q) ||
        row.renamedFile.toLowerCase().includes(q) ||
        row.status.toLowerCase().includes(q)
      );
    });
  }, [logs, query, channelFilter]);

  const exportCsv = () => {
    setExportMenuOpen(false);
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
    const rows = filteredLogs.map((l) =>
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
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, `NSSF_Compliance_Audit_${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success('CSV audit log exported', `${filteredLogs.length} compliance record(s) downloaded.`);
  };

  const exportExcel = () => {
    setExportMenuOpen(false);
    const dateStamp = new Date().toISOString().slice(0, 10);
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
      .map(
        (h) =>
          `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`
      )
      .join('');

    const dataRows = filteredLogs
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
    <Cell ss:StyleID="Title"><Data ss:Type="String">NSSF Digital Statement Dispatch — Compliance Audit Report</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="Meta"><Data ss:Type="String">Generated: ${escapeXml(exportedAt)} | Channel: ${escapeXml(channelFilter)}${query.trim() ? ` | Search: ${escapeXml(sanitizeSpreadsheetCell(query.trim()))}` : ''} | Records: ${filteredLogs.length}</Data></Cell>
   </Row>
   <Row/>
   <Row>${headerCells}</Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;

    const blob = new Blob([workbookXml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    triggerDownload(blob, `NSSF_Compliance_Audit_${dateStamp}.xls`);
    toast.success(
      'MS-Excel workbook exported',
      `${filteredLogs.length} compliance record(s) downloaded as .xls.`
    );
  };

  return (
    <div className="py-4 sm:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.16em] text-[#1E6B34] uppercase">
            NSSF DIGITAL STATEMENT DISPATCH
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-[#0F2437] tracking-tight mt-1">
            AUDIT LOGS
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Persistent SQLite record of every statement validation, encryption, and member dispatch attempt.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <motion.button
            type="button"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.14, ease: SMOOTH_EASE }}
            onClick={loadLogs}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-[#D1D9E0] bg-white text-xs font-bold tracking-wider uppercase text-[#0F2437] hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Refresh</span>
          </motion.button>

          <div ref={exportMenuRef} className="relative">
            <motion.button
              type="button"
              onClick={() => setExportMenuOpen((prev) => !prev)}
              disabled={filteredLogs.length === 0}
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              whileHover={filteredLogs.length > 0 ? { y: -1 } : undefined}
              whileTap={filteredLogs.length > 0 ? { scale: 0.98 } : undefined}
              transition={{ duration: 0.14, ease: SMOOTH_EASE }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#2B7A3B] text-white text-xs font-bold tracking-wider uppercase hover:bg-[#226430] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export Logs</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-150 ${
                  exportMenuOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </motion.button>

            <AnimatePresence>
              {exportMenuOpen && filteredLogs.length > 0 && (
                <motion.div
                  role="menu"
                  aria-label="Choose audit log export format"
                  initial={{ opacity: 0, y: 6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.97 }}
                  transition={{ duration: 0.15, ease: SMOOTH_EASE }}
                  style={{ transformOrigin: 'top right' }}
                  className="absolute right-0 mt-2 w-60 rounded-lg border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,36,55,0.14)] py-1.5 z-30"
                >
                  <div className="px-3.5 py-1.5 text-[10px] font-bold tracking-[0.14em] uppercase text-slate-400 border-b border-slate-100">
                    Compliance Format ({filteredLogs.length})
                  </div>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={exportCsv}
                    className="w-full px-3.5 py-2.5 text-left flex items-start gap-2.5 hover:bg-emerald-50/70 transition-colors cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-[#2B7A3B] shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <div className="text-xs font-bold text-[#0F2437]">Download CSV (.csv)</div>
                      <div className="text-[11px] text-slate-500">
                        UTF-8 comma-separated compliance ledger
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={exportExcel}
                    className="w-full px-3.5 py-2.5 text-left flex items-start gap-2.5 hover:bg-emerald-50/70 transition-colors cursor-pointer"
                  >
                    <FileSpreadsheet
                      className="w-4 h-4 text-[#2B7A3B] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div>
                      <div className="text-xs font-bold text-[#0F2437]">
                        Download MS-Excel (.xls)
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Formatted spreadsheet workbook report
                      </div>
                    </div>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search member no, name, recipient..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:border-[#006837]"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md self-start sm:self-auto">
            {(['ALL', 'EMAIL', 'WHATSAPP'] as const).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannelFilter(ch)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                  channelFilter === ch
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {ch === 'ALL' ? 'All Channels' : ch === 'EMAIL' ? 'Email' : 'WhatsApp'}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-10 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm font-medium text-slate-800">
              {logs.length === 0
                ? 'No statement dispatches recorded yet'
                : 'No audit records match your current search'}
            </p>
            <p className="text-xs text-slate-500">
              Validation checks and encrypted dispatches appear here automatically.
            </p>
            {logs.length === 0 && (
              <button
                type="button"
                onClick={onGoToDispatch}
                className="px-4 py-2 rounded-md bg-[#006837] text-white text-xs font-semibold hover:bg-[#00542c] cursor-pointer"
              >
                Dispatch First Statement
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-3 px-4 whitespace-nowrap">Timestamp</th>
                  <th className="py-3 px-4 whitespace-nowrap">Member No</th>
                  <th className="py-3 px-4">Member Name</th>
                  <th className="py-3 px-4 whitespace-nowrap">Channel</th>
                  <th className="py-3 px-4">Recipient</th>
                  <th className="py-3 px-4">Protected File</th>
                  <th className="py-3 px-4 whitespace-nowrap">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((row) => {
                  const isSuccess = row.status.startsWith('SENT') || row.status.startsWith('DISPATCHED');
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {row.timestamp}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {row.memberNo}
                      </td>
                      <td className="py-3 px-4 text-slate-800">{row.memberName}</td>
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">{row.channel}</td>
                      <td className="py-3 px-4 text-slate-700 break-all max-w-[200px]">{row.destination}</td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 break-all max-w-[220px]">
                        {row.renamedFile}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          title={row.details}
                          className={`font-semibold text-xs ${
                            isSuccess ? 'text-[#006837]' : 'text-red-700'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
