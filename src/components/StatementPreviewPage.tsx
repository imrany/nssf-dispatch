import { useEffect, useState } from 'react';
import { ArrowLeft, FileText, Lock, Send, ShieldCheck } from 'lucide-react';
import type { DispatchChannel, StatementMeta } from '../types';
import { formatFileSizeKb, isValidEmail, isValidWhatsappNumber } from '../utils/validation';
import { ActionButton, AlertBanner, KeyValueList, PageHeader, type KeyValueItem } from './ui';

interface StatementPreviewPageProps {
  file: File | null;
  meta: StatementMeta | null;
  predictedFilename: string;
  channel: DispatchChannel;
  email: string;
  whatsapp: string;
  passwordMode: 'id_card' | 'id_and_nssf_last4';
  submitting: boolean;
  errorMsg?: string;
  onBack: () => void;
  onConfirmDispatch: () => void;
}

export function StatementPreviewPage({
  file,
  meta,
  predictedFilename,
  channel,
  email,
  whatsapp,
  passwordMode,
  submitting,
  errorMsg,
  onBack,
  onConfirmDispatch,
}: StatementPreviewPageProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    if (!file) {
      setPdfUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPdfUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  if (!meta) return null;

  const channelLabel =
    channel === 'both' ? 'Email & WhatsApp' : channel === 'whatsapp' ? 'WhatsApp' : 'Email';

  const recipientSummary = [
    channel === 'email' || channel === 'both' ? email.trim() || 'Email pending' : null,
    channel === 'whatsapp' || channel === 'both' ? whatsapp.trim() || 'WhatsApp pending' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const canDispatchDirectly =
    ((channel !== 'email' && channel !== 'both') || isValidEmail(email)) &&
    ((channel !== 'whatsapp' && channel !== 'both') || isValidWhatsappNumber(whatsapp));

  const parsedItems: KeyValueItem[] = [
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
  ];

  const packageItems: KeyValueItem[] = [
    {
      label: 'Renamed File',
      value: predictedFilename,
      valueClassName: 'font-mono text-xs font-semibold text-[#1E6B34] break-all',
    },
    {
      label: 'PDF Encryption',
      value: `Password Protected (${passwordMode === 'id_and_nssf_last4' ? 'ID + NSSF Last 4' : 'National ID No'})`,
      valueClassName: 'font-medium text-[#0F2437]',
    },
    {
      label: 'Dispatch Channel',
      value: channelLabel,
      valueClassName: 'font-semibold text-[#0F2437]',
    },
    {
      label: 'Recipient(s)',
      value: recipientSummary,
      valueClassName: 'font-medium text-[#0F2437] break-all',
    },
  ];

  return (
    <div className="py-4 sm:py-8 space-y-8">
      <PageHeader
        title="STATEMENT PREVIEW"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
            <span className="font-semibold text-[#0F2437]">{meta.memberName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{meta.memberNo}</span>
            <span aria-hidden="true">·</span>
            <span>{channelLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="break-all">{recipientSummary}</span>
          </span>
        }
        actions={
          <>
            <ActionButton
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={submitting}
              className="h-11 px-4"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>EDIT DETAILS</span>
            </ActionButton>
            {canDispatchDirectly && (
              <ActionButton
                type="button"
                disabled={submitting}
                onClick={onConfirmDispatch}
                className="h-11 px-5"
              >
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{submitting ? 'ENCRYPTING & SENDING...' : 'ENCRYPT & SEND'}</span>
              </ActionButton>
            )}
          </>
        }
      />

      {errorMsg && <AlertBanner variant="error" message={errorMsg} />}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <ShieldCheck className="w-4 h-4 text-[#2B7A3B] shrink-0" aria-hidden="true" />
              <h2 className="font-display text-base font-bold text-[#0F2437]">
                Parsed Member Details
              </h2>
            </div>

            <KeyValueList items={parsedItems} className="text-sm" rowClassName="py-2" />
          </section>

          <section className="bg-slate-50/70 border border-slate-200 rounded-lg p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200/70 pb-3">
              <Lock className="w-4 h-4 text-[#2B7A3B] shrink-0" aria-hidden="true" />
              <h2 className="font-display text-base font-bold text-[#0F2437]">
                Generated Output Package
              </h2>
            </div>

            <KeyValueList items={packageItems} className="text-xs" rowClassName="py-2" />
          </section>
        </div>

        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 bg-white border-b border-slate-200 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 font-semibold text-[#0F2437] truncate">
              <FileText className="w-4 h-4 text-[#2B7A3B] shrink-0" aria-hidden="true" />
              <span className="truncate">{predictedFilename}</span>
            </div>
            <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
              {file ? `${formatFileSizeKb(file.size)} · PDF` : 'PDF'}
            </span>
          </div>

          {pdfUrl ? (
            <iframe
              title="Generated Member Statement PDF Preview"
              src={`${pdfUrl}#toolbar=1&navpanes=0`}
              className="w-full h-[600px] lg:h-[680px] border-0 bg-slate-100"
            />
          ) : (
            <div className="h-[600px] lg:h-[680px] flex items-center justify-center text-xs text-slate-500">
              Loading PDF preview...
            </div>
          )}
        </section>
      </div>

      <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-xs text-slate-500">
          {canDispatchDirectly
            ? 'Verify the member details, recipient address, and PDF pages above before encrypting and sending.'
            : 'Review complete. Return to Edit Details to enter valid member recipient details before sending.'}
        </p>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <ActionButton
            type="button"
            variant="lime"
            disabled={submitting}
            onClick={onBack}
            className="h-11 px-5"
          >
            EDIT DETAILS
          </ActionButton>

          {canDispatchDirectly && (
            <ActionButton
              type="button"
              disabled={submitting}
              onClick={onConfirmDispatch}
              className="h-11 px-6"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{submitting ? 'ENCRYPTING & SENDING...' : 'ENCRYPT & SEND'}</span>
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  );
}
