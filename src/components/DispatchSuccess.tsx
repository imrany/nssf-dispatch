import { useState } from 'react';
import { CheckCircle2, Download, FileKey2, Mail, MessageSquare } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { DispatchReceipt } from '../types';
import { NssfLogo } from './NssfLogo';

interface DispatchSuccessProps {
  receipt: DispatchReceipt;
  onReset: () => void;
}

export function DispatchSuccess({ receipt, onReset }: DispatchSuccessProps) {
  const [previewTab, setPreviewTab] = useState<'email' | 'text'>('email');

  return (
    <div className="py-4 sm:py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
        <div>
          <NssfLogo subtitle="NSSF DIGITAL STATEMENT DISPATCH" />
          <div className="flex items-center gap-3 mt-3">
            <motion.div
              initial={{ scale: 0.75, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            >
              <CheckCircle2 className="w-8 h-8 text-[#2B7A3B] shrink-0" aria-hidden="true" />
            </motion.div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-[#0F2437]">
              DISPATCH CONFIRMED
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 mt-2">
            <span>{receipt.memberName}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{receipt.memberNo}</span>
            <span aria-hidden="true">·</span>
            <span>{receipt.channel}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{receipt.timestamp}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <motion.a
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.99 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            href={receipt.downloadUrl}
            download={receipt.renamedFile}
            className="inline-flex items-center gap-2 px-5 h-11 rounded bg-[#2B7A3B] hover:bg-[#226430] text-white text-xs font-bold tracking-wider uppercase transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>DOWNLOAD PROTECTED PDF</span>
          </motion.a>
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.99 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 px-5 h-11 rounded bg-[#6BC300] hover:bg-[#5DAE00] text-white text-xs font-bold tracking-wider uppercase transition-colors whitespace-nowrap cursor-pointer"
          >
            <span>NEW DISPATCH</span>
          </motion.button>
        </div>
      </div>

      {receipt.deliveryMode === 'preview' && (
        <div className="border border-amber-200 bg-amber-50 rounded-md px-4 py-3 text-xs text-amber-900">
          Packaged in Preview Mode: the PDF has been RC4-128 encrypted, renamed, and logged to SQLite. Switch to Live SMTP &amp; WhatsApp Gateway in Settings when ready to transmit externally.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 shadow-[0_4px_20px_rgba(15,36,55,0.05)] space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <FileKey2 className="w-4 h-4 text-[#2B7A3B]" aria-hidden="true" />
            <h2 className="font-display text-base font-bold text-[#0F2437]">
              Dispatch Receipt
            </h2>
          </div>

          <dl className="divide-y divide-slate-100 text-sm">
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500">Member Name</dt>
              <dd className="font-semibold text-[#0F2437] text-right">{receipt.memberName}</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500">NSSF Member No</dt>
              <dd className="font-mono font-semibold text-[#0F2437] tabular-nums">{receipt.memberNo}</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500">Statement Period</dt>
              <dd className="font-medium text-[#0F2437] text-right">{receipt.period}</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500">Total Fund Balance</dt>
              <dd className="font-mono font-bold text-[#1E6B34] tabular-nums">KES {receipt.totalAmount}</dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500">Renamed Attachment</dt>
              <dd className="font-mono text-xs font-semibold text-[#1E6B34] text-right break-all">
                {receipt.renamedFile}
              </dd>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500">Sent To</dt>
              <dd className="font-medium text-[#0F2437] text-right break-all">{receipt.destination}</dd>
            </div>
            <div className="py-2.5 space-y-1">
              <dt className="text-slate-500">Member Unlock Password</dt>
              <dd className="text-xs text-[#0F2437] font-medium">{receipt.passwordGuide}</dd>
            </div>
          </dl>
        </section>

        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg shadow-[0_4px_20px_rgba(15,36,55,0.05)] overflow-hidden">
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
                  className="w-full h-[540px] border-0 bg-[#f4f6f5]"
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
