import {
  AlertCircle,
  CheckCircle2,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { WhatsAppQrData } from '../../types';
import { SectionSaveBar } from './SectionSaveBar';

interface WhatsAppGatewayCardProps {
  qrData: WhatsAppQrData | null;
  isPaired: boolean;
  deviceName: string;
  loadingQr: boolean;
  reconnecting: boolean;
  unlinking: boolean;
  dirty: boolean;
  saving: boolean;
  onRefreshQr: () => void;
  onReconnect: () => void;
  onUnlink: () => void;
  onDeviceNameChange: (name: string) => void;
  onDiscard: () => void;
}

export function WhatsAppGatewayCard({
  qrData,
  isPaired,
  deviceName,
  loadingQr,
  reconnecting,
  unlinking,
  dirty,
  saving,
  onRefreshQr,
  onReconnect,
  onUnlink,
  onDeviceNameChange,
  onDiscard,
}: WhatsAppGatewayCardProps) {
  const qrDataUri = qrData?.qrSvg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrData.qrSvg)}`
    : '';

  return (
    <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
      {!isPaired ? (
        <>
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2">
              <QrCode className="w-4 h-4 text-[#006837]" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-[#006837]">
                WhatsApp QR Setup
              </h2>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
              <motion.span
                aria-hidden="true"
                animate={{ scale: [1, 1.35, 1], opacity: [0.55, 1, 0.55] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                className="w-2 h-2 rounded-full bg-amber-500 inline-block"
              />
              <span>Awaiting Scan</span>
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4">
            <div className="border border-slate-200 rounded-md p-2.5 bg-white shrink-0">
              {loadingQr ? (
                <div className="w-[170px] h-[170px] bg-slate-100 rounded flex items-center justify-center text-xs text-slate-500 text-center px-3">
                  Connecting to WhatsApp Web...
                </div>
              ) : qrDataUri ? (
                <img
                  src={qrDataUri}
                  alt="WhatsApp Link Device QR Code"
                  className="w-[170px] h-[170px] block"
                />
              ) : (
                <div className="w-[170px] h-[170px] bg-amber-50 border border-amber-200 rounded flex flex-col items-center justify-center text-center px-3 gap-2">
                  <AlertCircle className="w-6 h-6 text-amber-600" aria-hidden="true" />
                  <span className="text-[11px] font-medium text-amber-900 leading-snug">
                    QR unavailable
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-3 text-xs text-slate-600 flex-1">
              <p className="leading-relaxed">
                On the official NSSF desk phone, open <strong>WhatsApp</strong>, go to{' '}
                <strong>Linked Devices</strong>, tap <strong>Link a Device</strong>, and scan this QR code. Pairing completes automatically once scanned.
              </p>

              {qrData?.error && !qrDataUri && (
                <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 leading-relaxed">
                  {qrData.error}
                </div>
              )}

              {qrData && (
                <div className="space-y-1 font-mono text-[11px] text-slate-500">
                  <div>Session: {qrData.sessionCode}</div>
                  <div className="font-sans text-[11px] text-slate-500">
                    {qrDataUri
                      ? 'Live QR code active · Scan with WhatsApp Linked Devices'
                      : 'Waiting for WhatsApp QR code...'}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onRefreshQr}
                  disabled={loadingQr}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" aria-hidden="true" />
                  <span>{qrDataUri ? 'Refresh QR' : 'Retry Connection'}</span>
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-[#006837]" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-[#006837]">
                WhatsApp Paired Device
              </h2>
            </div>
            {qrData?.connected === false ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Reconnecting</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#006837]">
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Connected</span>
              </span>
            )}
          </div>

          <div className="border border-emerald-200 bg-emerald-50/50 rounded-md p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-md bg-[#2B7A3B] text-white flex items-center justify-center shrink-0">
                <Smartphone className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="text-xs space-y-1 min-w-0">
                <div className="font-bold text-[#0F2437] text-sm truncate">
                  {qrData?.deviceName || deviceName}
                </div>
                <div className="text-slate-600">multi-device session stored locally.</div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-emerald-200/70 text-xs">
              <div>
                <div className="text-slate-500">Session ID</div>
                <div className="font-mono font-semibold text-[#0F2437] mt-0.5">
                  {qrData?.sessionCode || 'Paired'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">
                  {qrData?.pairedPhone ? 'Linked Phone' : 'Paired Timestamp'}
                </div>
                <div className="font-mono font-semibold text-[#0F2437] mt-0.5">
                  {qrData?.pairedPhone ? `+${qrData.pairedPhone}` : qrData?.pairedAt || 'Active'}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            {qrData?.connected === false && (
              <button
                type="button"
                onClick={onReconnect}
                disabled={reconnecting}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-[#2B7A3B] bg-white text-xs font-bold uppercase tracking-wider text-[#1E6B34] hover:bg-emerald-50 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${reconnecting ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{reconnecting ? 'Connecting...' : 'Reconnect'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onUnlink}
              disabled={unlinking}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-red-300 bg-white text-xs font-bold uppercase tracking-wider text-red-700 hover:bg-red-50 disabled:opacity-50 cursor-pointer transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{unlinking ? 'Removing Paired Device...' : 'Remove Paired Device'}</span>
            </button>
          </div>
        </>
      )}

      <div className="pt-2 border-t border-slate-100">
        <label htmlFor="wa-device" className="block text-xs font-medium text-slate-700 mb-1">
          Desk Device Label
        </label>
        <input
          id="wa-device"
          value={deviceName}
          onChange={(e) => onDeviceNameChange(e.target.value)}
          className="w-full px-3 py-1.5 rounded border border-slate-300 text-xs focus:outline-none focus:border-[#006837]"
        />
      </div>

      <SectionSaveBar dirty={dirty} saving={saving} onDiscard={onDiscard} />
    </section>
  );
}
