import { useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Search } from 'lucide-react';
import type { AuditLog } from '../types';

interface AuditLogsViewProps {
  onGoToDispatch: () => void;
}

export function AuditLogsView({ onGoToDispatch }: AuditLogsViewProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<'ALL' | 'EMAIL' | 'WHATSAPP'>('ALL');

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/audit');
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

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
    const headers = ['ID', 'Timestamp', 'MemberNo', 'MemberName', 'Channel', 'Destination', 'Filename', 'Status', 'Details'];
    const escapeCsv = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;
    const rows = filteredLogs.map((l) =>
      [l.id, l.timestamp, l.memberNo, l.memberName, l.channel, l.destination, l.renamedFile, l.status, l.details]
        .map(escapeCsv)
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NSSF_Dispatch_Audit_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
          <button
            type="button"
            onClick={loadLogs}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-[#D1D9E0] bg-white text-xs font-bold tracking-wider uppercase text-[#0F2437] hover:bg-slate-50 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={filteredLogs.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#2B7A3B] text-white text-xs font-bold tracking-wider uppercase hover:bg-[#226430] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export CSV</span>
          </button>
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
