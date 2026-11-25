import { useState, type CSSProperties } from 'react';
import { Download, FileKey2, Mail, MessageSquare } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { DispatchReceipt } from '../types';
import { NssfLogo } from './NssfLogo';

interface DispatchSuccessProps {
  receipt: DispatchReceipt;
  onReset: () => void;
}

const SPARK_ANGLES = [0, 60, 120, 180, 240, 300];

function delayStyle(ms: number): CSSProperties {
  return { '--delay': `${ms}ms` } as CSSProperties;
}

export function DispatchSuccess({ receipt, onReset }: DispatchSuccessProps) {
  const [previewTab, setPreviewTab] = useState<'email' | 'text'>(
    receipt.channel === 'WHATSAPP' ? 'text' : 'email'
  );

  return (
    <div className="py-4 sm:py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
        <div>
          <div className="dispatch-animate-up" style={delayStyle(0)}>
            <NssfLogo subtitle="NSSF DIGITAL STATEMENT DISPATCH" />
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
          <motion.a
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.99 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            href={receipt.downloadUrl}
            download={receipt.renamedFile}
            className="dispatch-cta-sheen inline-flex items-center gap-2 px-5 h-11 rounded bg-[#2B7A3B] hover:bg-[#226430] text-white text-xs font-bold tracking-wider uppercase transition-colors whitespace-nowrap"
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
        <div
          className="dispatch-animate-up border border-amber-200 bg-amber-50 rounded-md px-4 py-3 text-xs text-amber-900"
          style={delayStyle(190)}
        >
          Packaged in Preview Mode: the PDF has been RC4-128 encrypted, renamed, and logged to SQLite. Switch to Live SMTP &amp; WhatsApp in Settings when ready to transmit externally.
        </div>
      )}

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

          <dl className="divide-y divide-slate-100 text-sm">
            <div className="dispatch-row-reveal py-2.5 flex items-center justify-between gap-4" style={delayStyle(260)}>
              <dt className="text-slate-500">Member Name</dt>
              <dd className="font-semibold text-[#0F2437] text-right">{receipt.memberName}</dd>
            </div>
            <div className="dispatch-row-reveal py-2.5 flex items-center justify-between gap-4" style={delayStyle(300)}>
              <dt className="text-slate-500">NSSF Member No</dt>
              <dd className="font-mono font-semibold text-[#0F2437] tabular-nums">{receipt.memberNo}</dd>
            </div>
            <div className="dispatch-row-reveal py-2.5 flex items-center justify-between gap-4" style={delayStyle(340)}>
              <dt className="text-slate-500">Statement Period</dt>
              <dd className="font-medium text-[#0F2437] text-right">{receipt.period}</dd>
            </div>
            <div className="dispatch-row-reveal py-2.5 flex items-center justify-between gap-4" style={delayStyle(380)}>
              <dt className="text-slate-500">Total Fund Balance</dt>
              <dd className="font-mono font-bold text-[#1E6B34] tabular-nums">KES {receipt.totalAmount}</dd>
            </div>
            <div className="dispatch-row-reveal py-2.5 flex items-center justify-between gap-4" style={delayStyle(420)}>
              <dt className="text-slate-500">Renamed Attachment</dt>
              <dd className="font-mono text-xs font-semibold text-[#1E6B34] text-right break-all">
                {receipt.renamedFile}
              </dd>
            </div>
            <div className="dispatch-row-reveal py-2.5 flex items-center justify-between gap-4" style={delayStyle(460)}>
              <dt className="text-slate-500">Sent To</dt>
              <dd className="font-medium text-[#0F2437] text-right break-all">{receipt.destination}</dd>
            </div>
            <div className="dispatch-row-reveal py-2.5 space-y-1" style={delayStyle(500)}>
              <dt className="text-slate-500">Member Unlock Password</dt>
              <dd className="text-xs text-[#0F2437] font-medium">{receipt.passwordGuide}</dd>
            </div>
          </dl>
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

