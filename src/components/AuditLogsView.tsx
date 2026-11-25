import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import type { AuditLog } from '../types';
import { toast } from './Toaster';

interface AuditLogsViewProps {
  adminToken: string;
  onGoToDispatch: () => void;
  onBackToSettings: () => void;
  onAuthExpired: () => void;
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

type ChannelFilter = 'ALL' | 'EMAIL' | 'WHATSAPP' | 'BOTH';
type StatusFilter = 'ALL' | 'SENT' | 'DISPATCHED (PREVIEW)' | 'FAILED' | 'VALIDATION_FAILED';

export function AuditLogsView({
  adminToken,
  onGoToDispatch,
  onBackToSettings,
  onAuthExpired,
}: AuditLogsViewProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/audit', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.status === 401) {
        onAuthExpired();
        return;
      }
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
  }, [adminToken]);

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

  const hasActiveFilters =
    query.trim().length > 0 || channelFilter !== 'ALL' || statusFilter !== 'ALL';

  const resetFilters = () => {
    setQuery('');
    setChannelFilter('ALL');
    setStatusFilter('ALL');
  };

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((row) => {
      if (channelFilter !== 'ALL' && row.channel.toUpperCase() !== channelFilter) return false;
      if (statusFilter !== 'ALL' && row.status.toUpperCase() !== statusFilter) return false;
      if (!q) return true;
      return (
        row.memberNo.toLowerCase().includes(q) ||
        row.memberName.toLowerCase().includes(q) ||
        row.channel.toLowerCase().includes(q) ||
        row.destination.toLowerCase().includes(q) ||
        row.renamedFile.toLowerCase().includes(q) ||
        row.status.toLowerCase().includes(q) ||
        row.details.toLowerCase().includes(q)
      );
    });
  }, [logs, query, channelFilter, statusFilter]);

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
    <Cell ss:StyleID="Meta"><Data ss:Type="String">Generated: ${escapeXml(exportedAt)} | Channel: ${escapeXml(channelFilter)} | Outcome: ${escapeXml(statusFilter)}${query.trim() ? ` | Search: ${escapeXml(sanitizeSpreadsheetCell(query.trim()))}` : ''} | Records: ${filteredLogs.length}</Data></Cell>
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

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <motion.button
            type="button"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.14, ease: SMOOTH_EASE }}
            onClick={onBackToSettings}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-[#D1D9E0] bg-white text-xs font-bold tracking-wider uppercase text-[#0F2437] hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to Settings</span>
          </motion.button>

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
        {/* Search & Filter Toolbar (hidden when there is no audit data) */}
        {!loading && logs.length > 0 && (
          <div className="p-4 border-b border-slate-200 space-y-3 bg-slate-50/40">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Member Number / Keyword Search Bar */}
              <div className="relative flex-1 max-w-md">
                <Search
                  className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  aria-label="Search audit logs by member number, name, recipient, or filename"
                  placeholder="Search by member number, name, recipient, or file..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full h-10 pl-9 pr-9 text-sm bg-white border border-slate-300 rounded-md text-[#0F2437] placeholder:text-slate-400 focus:outline-none focus:border-[#2B7A3B]"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search query"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-[#0F2437] hover:bg-slate-100 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>

              {/* Transaction Type & Outcome Filter Controls */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-600 inline-flex items-center gap-1 whitespace-nowrap">
                    <Filter className="w-3.5 h-3.5 text-[#2B7A3B]" aria-hidden="true" />
                    <span>Type:</span>
                  </span>
                  <div
                    role="group"
                    aria-label="Filter by transaction type"
                    className="flex items-center gap-1 p-1 bg-slate-100 rounded-md"
                  >
                    {(
                      [
                        { id: 'ALL', label: 'All Types' },
                        { id: 'EMAIL', label: 'Email' },
                        { id: 'WHATSAPP', label: 'WhatsApp' },
                        { id: 'BOTH', label: 'Dual Failed' },
                      ] as const
                    ).map((ch) => (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => setChannelFilter(ch.id)}
                        className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                          channelFilter === ch.id
                            ? 'bg-white text-[#0F2437] font-semibold shadow-sm'
                            : 'text-slate-600 hover:text-[#0F2437]'
                        }`}
                      >
                        {ch.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <label
                    htmlFor="audit-status-filter"
                    className="text-xs font-semibold text-slate-600 whitespace-nowrap"
                  >
                    Outcome:
                  </label>
                  <select
                    id="audit-status-filter"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                    className="h-9 px-2.5 rounded-md border border-slate-300 bg-white text-xs font-medium text-[#0F2437] focus:outline-none focus:border-[#2B7A3B] cursor-pointer"
                  >
                    <option value="ALL">All Outcomes</option>
                    <option value="SENT">Live Sent</option>
                    <option value="DISPATCHED (PREVIEW)">Preview Dispatched</option>
                    <option value="FAILED">Delivery Failed</option>
                    <option value="VALIDATION_FAILED">Validation Failed</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pt-0.5">
              <span>
                Showing <strong className="text-[#0F2437] font-mono tabular-nums">{filteredLogs.length}</strong> of{' '}
                <strong className="text-[#0F2437] font-mono tabular-nums">{logs.length}</strong> recorded transaction(s)
              </span>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#1E6B34] hover:underline cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                  <span>Reset Filters</span>
                </button>
              )}
            </div>
          </div>
        )}

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
                : 'No audit records match your current search or filters'}
            </p>
            <p className="text-xs text-slate-500">
              {logs.length === 0
                ? 'Validation checks and encrypted dispatches appear here automatically.'
                : 'Try adjusting the member number search, transaction type, or outcome filter.'}
            </p>
            {logs.length === 0 ? (
              <button
                type="button"
                onClick={onGoToDispatch}
                className="px-4 py-2 rounded-md bg-[#006837] text-white text-xs font-semibold hover:bg-[#00542c] cursor-pointer"
              >
                Dispatch First Statement
              </button>
            ) : (
              <button
                type="button"
                onClick={resetFilters}
                className="px-4 py-2 rounded-md border border-[#2B7A3B] text-[#1E6B34] bg-white text-xs font-semibold hover:bg-emerald-50 cursor-pointer"
              >
                Reset Search &amp; Filters
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
