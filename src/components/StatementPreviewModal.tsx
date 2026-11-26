import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileText, Lock, Send, ShieldCheck, X } from 'lucide-react';
import type { DispatchChannel, StatementMeta } from '../types';
import { SMOOTH_EASE } from '../utils/constants';
import { formatFileSizeKb, isValidEmail, isValidWhatsappNumber } from '../utils/validation';
import { NssfLogo } from './NssfLogo';
import { KeyValueList, type KeyValueItem } from './ui';

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
    ((channel !== 'email' && channel !== 'both') || isValidEmail(email)) &&
    ((channel !== 'whatsapp' && channel !== 'both') || isValidWhatsappNumber(whatsapp));

  const parsedItems: KeyValueItem[] = meta
    ? [
        { label: 'Member Name', value: meta.memberName, valueClassName: 'font-bold text-[#0F2437]' },
        {
          label: 'NSSF Member No',
          value: meta.memberNo,
          valueClassName: 'font-mono font-bold text-[#0F2437] tabular-nums',
        },
        {
          label: 'ID Card No (Masked)',
          value: meta.maskedIdCardNo || 'Protected',
          valueClassName: 'font-mono font-semibold text-[#0F2437] tabular-nums',
        },
        {
          label: 'KRA PIN',
          value: meta.kraPin || '-',
          valueClassName: 'font-mono font-medium text-[#0F2437]',
        },
        { label: 'Date of Birth', value: meta.dateOfBirth || '-', valueClassName: 'font-medium text-[#0F2437]' },
        {
          label: 'Date Registered',
          value: meta.dateRegistered || '-',
          valueClassName: 'font-medium text-[#0F2437]',
        },
        { label: 'Employer', value: meta.employer || '-', valueClassName: 'font-medium text-[#0F2437]' },
        { label: 'Statement Period', value: meta.period || '-', valueClassName: 'font-medium text-[#0F2437]' },
        {
          label: 'Statement Date',
          value: meta.statementDate || '-',
          valueClassName: 'font-medium text-[#0F2437]',
        },
        {
          label: 'Standard Amount',
          value: `KES ${meta.standardAmount}`,
          valueClassName: 'font-mono font-semibold text-[#0F2437] tabular-nums',
        },
        {
          label: 'Voluntary Amount',
          value: `KES ${meta.voluntaryAmount}`,
          valueClassName: 'font-mono font-semibold text-[#0F2437] tabular-nums',
        },
        {
          label: 'Total Fund Balance',
          labelClassName: 'font-semibold',
          value: `KES ${meta.totalAmount}`,
          valueClassName: 'font-mono font-bold text-[#1E6B34] tabular-nums',
        },
      ]
    : [];

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
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="shrink-0 bg-white border border-slate-200 rounded-md px-2 py-1">
                  <NssfLogo compact showSubtitle={false} />
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

            <div className="p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-h-[75vh] overflow-y-auto">
              <div className="lg:col-span-5 space-y-4">
                <div className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#1E6B34]">
                    <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Parsed Member Details</span>
                  </div>

                  <KeyValueList
                    items={parsedItems}
                    dividerClassName="divide-y divide-emerald-200/60"
                  />
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

              <div className="lg:col-span-7 flex flex-col border border-slate-200 rounded-lg overflow-hidden bg-slate-100">
                <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-[#0F2437] truncate">
                    <FileText className="w-4 h-4 text-[#2B7A3B] shrink-0" aria-hidden="true" />
                    <span className="truncate">{predictedFilename}</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 shrink-0">
                    {file ? `${formatFileSizeKb(file.size)} · PDF` : 'PDF'}
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
