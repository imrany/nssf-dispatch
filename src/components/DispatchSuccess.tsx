import { useState, type CSSProperties } from 'react';
import { Download, FileKey2, Mail, MessageSquare } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useApp } from '../context/AppContext';
import type { DispatchReceipt } from '../types';
import { SMOOTH_EASE } from '../utils/constants';
import { buildDispatchReceiptPdfBlob, triggerBlobDownload } from '../utils/download';
import { NssfLogo } from './NssfLogo';
import { toast } from './Toaster';
import { ActionButton, KeyValueList, type KeyValueItem } from './ui';

interface DispatchSuccessProps {
  receipt: DispatchReceipt;
  onReset: () => void;
}

const SPARK_ANGLES = [0, 60, 120, 180, 240, 300];

function delayStyle(ms: number): CSSProperties {
  return { '--delay': `${ms}ms` } as CSSProperties;
}

export function DispatchSuccess({ receipt, onReset }: DispatchSuccessProps) {
  const { appName, publisher, officeLocation, ussdCode } = useApp();
  const [previewTab, setPreviewTab] = useState<'email' | 'text'>(
    receipt.channel === 'WHATSAPP' ? 'text' : 'email'
  );

  const handleDownloadReceipt = async () => {
    const safeMemberNo = (receipt.memberNo || 'MEMBER').replace(/[^A-Za-z0-9_-]/g, '');
    const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const receiptFilename = `NSSF_Dispatch_Receipt_${safeMemberNo}_${dateStamp}.pdf`;
    const blob = await buildDispatchReceiptPdfBlob(receipt, {
      appName,
      publisher,
      officeLocation,
      ussdCode,
    });
    triggerBlobDownload(blob, receiptFilename);
    toast.success(
      'Dispatch receipt downloaded',
      `${receiptFilename} saved for ${receipt.memberName}.`
    );
  };

  const receiptRows: KeyValueItem[] = [
    { label: 'Member Name', value: receipt.memberName, delayMs: 260 },
    {
      label: 'NSSF Member No',
      value: receipt.memberNo,
      valueClassName: 'font-mono font-semibold text-[#0F2437] tabular-nums',
      delayMs: 300,
    },
    {
      label: 'Statement Period',
      value: receipt.period,
      valueClassName: 'font-medium text-[#0F2437]',
      delayMs: 340,
    },
    {
      label: 'Total Fund Balance',
      value: `KES ${receipt.totalAmount}`,
      valueClassName: 'font-mono font-bold text-[#1E6B34] tabular-nums',
      delayMs: 380,
    },
    {
      label: 'Renamed Attachment',
      value: receipt.renamedFile,
      valueClassName: 'font-mono text-xs font-semibold text-[#1E6B34] break-all',
      delayMs: 420,
    },
    {
      label: 'Sent To',
      value: receipt.destination,
      valueClassName: 'font-medium text-[#0F2437] break-all',
      delayMs: 460,
    },
    {
      label: 'Member Unlock Password',
      value: receipt.passwordGuide,
      valueClassName: 'text-xs text-[#0F2437] font-medium',
      stacked: true,
      delayMs: 500,
    },
  ];

  return (
    <div className="py-4 sm:py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
        <div>
          <div className="dispatch-animate-up" style={delayStyle(0)}>
            <NssfLogo />
          </div>

          <div className="flex items-center gap-3.5 mt-3">
            <div className="relative w-11 h-11 flex items-center justify-center shrink-0">
              <span
                aria-hidden="true"
                className="dispatch-ring-burst absolute inset-0 rounded-full border-2 border-[#6BC300]"
              />
              <span
                aria-hidden="true"
                className="dispatch-ring-burst-delayed absolute inset-0 rounded-full border border-[#2B7A3B]/60"
              />
              {SPARK_ANGLES.map((angle, idx) => (
                <span
                  key={angle}
                  aria-hidden="true"
                  style={{ '--spark-angle': `${angle}deg` } as CSSProperties}
                  className={`dispatch-spark absolute left-1/2 top-1/2 -ml-0.5 -mt-1 w-1 h-2 rounded-full ${
                    idx % 2 === 0 ? 'bg-[#6BC300]' : 'bg-[#2B7A3B]'
                  }`}
                />
              ))}
              <svg
                viewBox="0 0 48 48"
                className="dispatch-badge-pop relative z-10 w-11 h-11"
                aria-hidden="true"
              >
                <circle
                  cx="24"
                  cy="24"
                  r="22"
                  fill="#ECFDF3"
                  stroke="#2B7A3B"
                  strokeWidth="2.5"
                  className="dispatch-circle-draw"
                  transform="rotate(-90 24 24)"
                />
                <path
                  d="M15 24.5 L21.2 30.5 L33.5 18"
                  fill="none"
                  stroke="#2B7A3B"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="dispatch-check-draw"
                />
              </svg>
            </div>

            <h1
              className="dispatch-animate-up font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-[#0F2437]"
              style={delayStyle(70)}
            >
              DISPATCH CONFIRMED
            </h1>
          </div>

          <div
            className="dispatch-animate-up flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 mt-2.5"
            style={delayStyle(130)}
          >
            <span className="font-medium text-[#0F2437]">{receipt.memberName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{receipt.memberNo}</span>
            <span aria-hidden="true">·</span>
            <span>{receipt.channel}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{receipt.timestamp}</span>
          </div>
        </div>

        <div
          className="dispatch-animate-up flex flex-wrap items-center gap-3 shrink-0"
          style={delayStyle(160)}
        >
          <motion.button
            type="button"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.99 }}
            transition={{ duration: 0.16, ease: SMOOTH_EASE }}
            onClick={() => void handleDownloadReceipt()}
            className="dispatch-cta-sheen inline-flex items-center gap-2 px-5 h-11 rounded bg-[#2B7A3B] hover:bg-[#226430] text-white text-xs font-bold tracking-wider uppercase transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>DOWNLOAD DISPATCH RECEIPT</span>
          </motion.button>
          <ActionButton variant="lime" onClick={onReset} className="h-11 px-5">
            <span>NEW DISPATCH</span>
          </ActionButton>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section
          className="dispatch-animate-up lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 shadow-[0_4px_20px_rgba(15,36,55,0.05)] space-y-5"
          style={delayStyle(220)}
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <FileKey2 className="w-4 h-4 text-[#2B7A3B]" aria-hidden="true" />
            <h2 className="font-display text-base font-bold text-[#0F2437]">
              Dispatch Receipt
            </h2>
          </div>

          <KeyValueList
            items={receiptRows}
            className="text-sm"
            rowClassName="py-2.5"
            animateRows
          />
        </section>

        <section
          className="dispatch-animate-up lg:col-span-7 bg-white border border-slate-200 rounded-lg shadow-[0_4px_20px_rgba(15,36,55,0.05)] overflow-hidden"
          style={delayStyle(280)}
        >
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-bold text-[#0F2437]">
                Official NSSF Message Sent
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 truncate max-w-md">
                {receipt.emailPreview.subject}
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md shrink-0">
              <button
                type="button"
                onClick={() => setPreviewTab('email')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
                  previewTab === 'email'
                    ? 'bg-white text-[#0F2437] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F2437]'
                }`}
              >
                <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                <span>HTML Email</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab('text')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
                  previewTab === 'text'
                    ? 'bg-white text-[#0F2437] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F2437]'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                <span>WhatsApp / Text</span>
              </button>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {previewTab === 'email' ? (
              <motion.div
                key="email"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14 }}
              >
                <iframe
                  title="NSSF Official Email Preview"
                  sandbox=""
                  srcDoc={receipt.emailPreview.htmlBody}
                  className="w-full h-[540px] border-0 bg-white"
                />
              </motion.div>
            ) : (
              <motion.pre
                key="text"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14 }}
                className="p-6 text-xs font-mono text-[#0F2437] whitespace-pre-wrap leading-relaxed bg-slate-50 max-h-[540px] overflow-y-auto"
              >
                {receipt.emailPreview.whatsappText || receipt.emailPreview.plainText}
              </motion.pre>
            )}
          </AnimatePresence>
        </section>
      </div>
    </div>
  );
}
