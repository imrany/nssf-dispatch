import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Eye, FileText, Lock, Send, ShieldCheck, X } from 'lucide-react';
import type { DispatchChannel, StatementMeta } from '../types';

interface StatementPreviewModalProps {
  open: boolean;
  file: File | null;
  meta: StatementMeta | null;
  predictedFilename: string;
  channel: DispatchChannel;
  email: string;
  whatsapp: string;
  passwordMode: 'id_card' | 'id_and_nssf_last4';
  submitting: boolean;
  onClose: () => void;
  onConfirmDispatch: () => void;
}

const SMOOTH_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function StatementPreviewModal({
  open,
  file,
  meta,
  predictedFilename,
  channel,
  email,
  whatsapp,
  passwordMode,
  submitting,
  onClose,
  onConfirmDispatch,
}: StatementPreviewModalProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !file) {
      setPdfUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPdfUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [open, file]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const recipientSummary = [
    channel === 'email' || channel === 'both' ? email.trim() || 'Email pending' : null,
    channel === 'whatsapp' || channel === 'both' ? whatsapp.trim() || 'WhatsApp pending' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const canDispatchDirectly =
    ((channel !== 'email' && channel !== 'both') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) &&
    ((channel !== 'whatsapp' && channel !== 'both') || whatsapp.replace(/[^\d]/g, '').length >= 9);

  return (
    <AnimatePresence>
      {open && meta && (
        <motion.div
          key="statement-preview-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: SMOOTH_EASE }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-[#0F2437]/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="statement-preview-modal-title"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: SMOOTH_EASE }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-5xl bg-white rounded-xl border border-slate-200 shadow-[0_24px_64px_rgba(15,36,55,0.28)] overflow-hidden my-auto"
          >
            {/* Header */}
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-md bg-[#2B7A3B] text-white flex items-center justify-center shrink-0">
                  <Eye className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="statement-preview-modal-title"
                    className="font-display text-base sm:text-lg font-bold text-[#0F2437] truncate"
                  >
                    Pre-Dispatch Statement Preview
                  </h2>
                  <p className="text-xs text-slate-500 truncate">
                    Verify parsed member record and PDF statement output before encryption &amp; dispatch
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close statement preview modal"
                className="p-2 rounded-md text-slate-500 hover:text-[#0F2437] hover:bg-slate-200/60 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-h-[75vh] overflow-y-auto">
              {/* Left: Parsed Member Details */}
              <div className="lg:col-span-5 space-y-4">
                <div className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#1E6B34]">
                    <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Parsed Member Details</span>
                  </div>

                  <dl className="divide-y divide-emerald-200/60 text-xs">
                    <div className="py-2 flex justify-between gap-3">
                      <dt className="text-slate-500">Member Name</dt>
                      <dd className="font-bold text-[#0F2437] text-right">{meta.memberName}</dd>
                    </div>
                    <div className="py-2 flex justify-between gap-3">
                      <dt className="text-slate-500">NSSF Member No</dt>
                      <dd className="font-mono font-bold text-[#0F2437] tabular-nums">{meta.memberNo}</dd>
                    </div>
                    <div className="py-2 flex justify-between gap-3">
                      <dt className="text-slate-500">ID Card No (Masked)</dt>
                      <dd className="font-mono font-semibold text-[#0F2437] tabular-nums">
                        {meta.maskedIdCardNo || 'Protected'}
                      </dd>
                    </div>
                    <div className="py-2 flex justify-between gap-3">
                      <dt className="text-slate-500">KRA PIN</dt>
                      <dd className="font-mono font-medium text-[#0F2437]">{meta.kraPin || '-'}</dd>
                    </div>
                    <div className="py-2 flex justify-between gap-3">
                      <dt className="text-slate-500">Date of Birth</dt>
                      <dd className="font-medium text-[#0F2437]">{meta.dateOfBirth || '-'}</dd>
                    </div>
                    <div className="py-2 flex justify-between gap-3">
                      <dt className="text-slate-500">Date Registered</dt>
                      <dd className="font-medium text-[#0F2437]">{meta.dateRegistered || '-'}</dd>
                    </div>
                    <div className="py-2 flex justify-between gap-3">
                      <dt className="text-slate-500">Employer</dt>
                      <dd className="font-medium text-[#0F2437] text-right">{meta.employer || '-'}</dd>
                    </div>
                    <div className="py-2 flex justify-between gap-3">
                      <dt className="text-slate-500">Statement Period</dt>
                      <dd className="font-medium text-[#0F2437] text-right">{meta.period || '-'}</dd>
                    </div>
                    <div className="py-2 flex justify-between gap-3">
                      <dt className="text-slate-500">Statement Date</dt>
                      <dd className="font-medium text-[#0F2437]">{meta.statementDate || '-'}</dd>
                    </div>
                    <div className="py-2 flex justify-between gap-3">
                      <dt className="text-slate-500">Standard Amount</dt>
                      <dd className="font-mono font-semibold text-[#0F2437] tabular-nums">
                        KES {meta.standardAmount}
                      </dd>
                    </div>
                    <div className="py-2 flex justify-between gap-3">
                      <dt className="text-slate-500">Voluntary Amount</dt>
                      <dd className="font-mono font-semibold text-[#0F2437] tabular-nums">
                        KES {meta.voluntaryAmount}
                      </dd>
                    </div>
                    <div className="py-2 flex justify-between gap-3">
                      <dt className="text-slate-500 font-semibold">Total Fund Balance</dt>
                      <dd className="font-mono font-bold text-[#1E6B34] tabular-nums">
                        KES {meta.totalAmount}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="border border-slate-200 rounded-lg p-4 space-y-2 text-xs bg-slate-50/70">
                  <div className="flex items-center gap-2 font-bold text-[#0F2437]">
                    <Lock className="w-3.5 h-3.5 text-[#2B7A3B]" aria-hidden="true" />
                    <span>Generated Output Package</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Renamed File</span>
                    <span className="font-mono font-semibold text-[#1E6B34] break-all text-right">
                      {predictedFilename}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">PDF Encryption</span>
                    <span className="font-medium text-[#0F2437] text-right">
                      RC4-128 ({passwordMode === 'id_and_nssf_last4' ? 'ID + NSSF Last 4' : 'National ID No'})
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Dispatch Channel</span>
                    <span className="font-semibold uppercase text-[#0F2437]">{channel}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Recipient(s)</span>
                    <span className="font-medium text-[#0F2437] text-right break-all">
                      {recipientSummary}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Generated PDF Preview */}
              <div className="lg:col-span-7 flex flex-col border border-slate-200 rounded-lg overflow-hidden bg-slate-100">
                <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-[#0F2437] truncate">
                    <FileText className="w-4 h-4 text-[#2B7A3B] shrink-0" aria-hidden="true" />
                    <span className="truncate">{predictedFilename}</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 shrink-0">
                    {file ? `${(file.size / 1024).toFixed(1)} KB · PDF` : 'PDF'}
                  </span>
                </div>

                {pdfUrl ? (
                  <iframe
                    title="Generated Member Statement PDF Preview"
                    src={`${pdfUrl}#toolbar=1&navpanes=0`}
                    className="w-full h-[460px] sm:h-[500px] border-0 bg-slate-200"
                  />
                ) : (
                  <div className="h-[460px] flex items-center justify-center text-xs text-slate-500">
                    Loading PDF preview...
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                {canDispatchDirectly
                  ? 'Ready to encrypt with member ID credentials and dispatch.'
                  : 'Review complete. Enter valid member recipient details on the form before sending.'}
              </span>

              <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded border border-[#D1D9E0] bg-white text-xs font-bold uppercase tracking-wider text-[#0F2437] hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  Close Preview
                </button>

                {canDispatchDirectly && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={onConfirmDispatch}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded bg-[#2B7A3B] hover:bg-[#226430] text-white text-xs font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{submitting ? 'Sending...' : 'Confirm & Send Statement'}</span>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
