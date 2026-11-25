import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Pencil,
  Upload,
} from 'lucide-react';
import type { AppSettings, DispatchChannel, DispatchReceipt, StatementMeta } from '../types';
import { NssfLogo } from './NssfLogo';

interface DispatchWorkspaceProps {
  settings: AppSettings;
  onSuccess: (receipt: DispatchReceipt) => void;
  onOpenSettings: () => void;
}

type WizardStep = 'select' | 'validate' | 'confirm';

export function DispatchWorkspace({
  settings,
  onSuccess,
  onOpenSettings,
}: DispatchWorkspaceProps) {
  const [step, setStep] = useState<WizardStep>('select');
  const [channel, setChannel] = useState<DispatchChannel>('email');

  const [memberNo, setMemberNo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');

  const [validating, setValidating] = useState(false);
  const [validatedMeta, setValidatedMeta] = useState<StatementMeta | null>(null);
  const [predictedFilename, setPredictedFilename] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setErrorMsg('');
  }, [step, memberNo, file, email, whatsapp]);

  const noChannelsEnabled = !settings.emailEnabled && !settings.whatsappEnabled;

  const handleSelectChannel = (chosen: DispatchChannel) => {
    setChannel(chosen);
    setErrorMsg('');
    setStep('validate');
  };

  const handleValidateStep = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!memberNo.trim()) {
      setErrorMsg('Please enter the member NSSF Number.');
      return;
    }
    if (!file) {
      setErrorMsg('Please upload the member statement PDF.');
      return;
    }

    setValidating(true);
    const formData = new FormData();
    formData.append('memberNo', memberNo.trim());
    formData.append('statement', file);

    try {
      const res = await fetch('/api/validate', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setValidatedMeta(null);
        setErrorMsg(data.error || 'Statement validation failed.');
      } else {
        setValidatedMeta(data.meta);
        setPredictedFilename(data.renamedFile || '');
        setStep('confirm');
      }
    } catch {
      setErrorMsg('Unable to communicate with the NSSF validation service.');
    } finally {
      setValidating(false);
    }
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!file || !validatedMeta) {
      setStep('validate');
      return;
    }

    setSubmitting(true);
    const formData = new FormData();
    formData.append('memberNo', memberNo.trim());
    formData.append('channel', channel);
    formData.append('email', email.trim());
    formData.append('whatsapp', whatsapp.trim());
    formData.append('statement', file);

    try {
      const res = await fetch('/api/dispatch', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error || 'Dispatch failed.');
      } else {
        onSuccess(data);
      }
    } catch {
      setErrorMsg('Network error communicating with the NSSF Dispatch Server.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
    }
  };

  const stepHeading =
    step === 'select'
      ? 'SELF SERVICE'
      : step === 'validate'
        ? 'VALIDATION'
        : 'DISPATCH STATEMENT';

  return (
    <div className="py-4 sm:py-8 space-y-10">
      {/* Brand + Display Heading block inspired by nssfdigital.enssf.co.ke */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <NssfLogo subtitle="NSSF DIGITAL STATEMENT DISPATCH" />
          <h1 className="font-display text-4xl sm:text-[44px] font-extrabold tracking-tight text-[#0F2437] mt-2 leading-none">
            {stepHeading}
          </h1>
        </div>

        <div className="text-xs text-slate-500 flex items-center gap-2">
          <span>
            {settings.deliveryMode === 'live'
              ? 'Live SMTP & WhatsApp Gateway'
              : 'Service Desk Preview Mode'}
          </span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={onOpenSettings}
            className="font-semibold text-[#2B7A3B] hover:underline cursor-pointer"
          >
            System Settings
          </button>
        </div>
      </div>

      {noChannelsEnabled && (
        <div className="border border-amber-300 bg-amber-50 rounded-md p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm text-amber-900">
            <AlertCircle className="w-5 h-5 text-amber-700 shrink-0" aria-hidden="true" />
            <span>
              All dispatch channels are currently disabled. Enable Email or WhatsApp in Settings to send statements.
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="px-4 py-2 rounded bg-[#2B7A3B] text-white text-xs font-semibold hover:bg-[#236530] whitespace-nowrap cursor-pointer"
          >
            OPEN SETTINGS
          </button>
        </div>
      )}

      {/* STEP 1: SELF SERVICE CHANNEL SELECTION CARDS (matches screenshots 1 & 2) */}
      {step === 'select' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            <button
              type="button"
              disabled={!settings.emailEnabled}
              onClick={() => handleSelectChannel('email')}
              className="group relative bg-white rounded-lg p-12 sm:p-14 text-center shadow-[0_6px_28px_rgba(15,36,55,0.08)] border border-slate-100 border-b-[3px] border-b-[#2B7A3B] hover:bg-[#2B7A3B] hover:border-[#2B7A3B] transition-all duration-200 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
            >
              <span className="block font-display text-2xl font-bold text-[#0F2437] group-hover:text-white transition-colors">
                Email Statement
              </span>
              <span className="block text-xs text-slate-500 group-hover:text-emerald-100 mt-2 transition-colors">
                {settings.emailEnabled
                  ? 'Validate PDF, protect with ID Card No & send via NSSF SMTP'
                  : 'Email channel disabled in System Settings'}
              </span>
            </button>

            <button
              type="button"
              disabled={!settings.whatsappEnabled}
              onClick={() => handleSelectChannel('whatsapp')}
              className="group relative bg-white rounded-lg p-12 sm:p-14 text-center shadow-[0_6px_28px_rgba(15,36,55,0.08)] border border-slate-100 border-b-[3px] border-b-[#2B7A3B] hover:bg-[#2B7A3B] hover:border-[#2B7A3B] transition-all duration-200 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
            >
              <span className="block font-display text-2xl font-bold text-[#0F2437] group-hover:text-white transition-colors">
                WhatsApp Statement
              </span>
              <span className="block text-xs text-slate-500 group-hover:text-emerald-100 mt-2 transition-colors">
                {settings.whatsappEnabled
                  ? 'Validate PDF, protect with ID Card No & send via WhatsApp'
                  : 'WhatsApp channel disabled in System Settings'}
              </span>
            </button>
          </div>

          {settings.emailEnabled && settings.whatsappEnabled && (
            <button
              type="button"
              onClick={() => handleSelectChannel('both')}
              className="w-full bg-white rounded-md py-4 px-6 text-center shadow-[0_4px_16px_rgba(15,36,55,0.05)] border border-slate-200 border-b-2 border-b-[#6BC300] hover:bg-[#2B7A3B] hover:text-white hover:border-[#2B7A3B] transition-all duration-200 text-sm font-bold text-[#0F2437] cursor-pointer"
            >
              Dispatch via Both Email &amp; WhatsApp
            </button>
          )}
        </div>
      )}

      {/* STEP 2: VALIDATION (matches screenshot 3) */}
      {step === 'validate' && (
        <form onSubmit={handleValidateStep} className="space-y-6">
          {errorMsg && (
            <div
              role="alert"
              className="border border-red-200 bg-red-50 rounded-md p-4 flex items-start gap-2.5 text-sm text-red-800"
            >
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label
                htmlFor="nssf-member-no"
                className="block text-sm font-medium text-[#0F2437] mb-2"
              >
                Member Number
              </label>
              <div className="relative">
                <input
                  id="nssf-member-no"
                  required
                  type="text"
                  placeholder="MEMBER NUMBER"
                  value={memberNo}
                  onChange={(e) => setMemberNo(e.target.value)}
                  className="w-full h-14 px-5 pr-12 rounded border border-[#D1D9E0] bg-white text-sm font-mono tabular-nums text-[#0F2437] placeholder:text-slate-400 placeholder:tracking-wider focus:outline-none focus:border-[#2B7A3B]"
                />
                <Pencil
                  className="w-4 h-4 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
              </div>
            </div>

            <div>
              <span className="block text-sm font-medium text-[#0F2437] mb-2">
                Member Statement (PDF)
              </span>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`h-14 px-5 rounded border flex items-center justify-between gap-4 cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-[#2B7A3B] bg-emerald-50/60'
                    : file
                      ? 'border-[#2B7A3B] bg-emerald-50/30'
                      : 'border-[#D1D9E0] bg-white hover:border-slate-400'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                {file ? (
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="w-4 h-4 text-[#2B7A3B] shrink-0" aria-hidden="true" />
                    <span className="text-sm font-medium text-[#0F2437] truncate">{file.name}</span>
                    <span className="text-xs font-mono text-slate-500 tabular-nums shrink-0">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-slate-400 tracking-wider uppercase">
                    UPLOAD PROVISIONAL STATEMENT PDF
                  </span>
                )}
                <Upload className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <button
              type="submit"
              disabled={validating}
              className="w-full h-12 rounded bg-[#2B7A3B] hover:bg-[#226430] text-white text-xs font-bold tracking-[0.18em] uppercase transition-colors disabled:opacity-50 cursor-pointer"
            >
              {validating ? 'VALIDATING STATEMENT...' : 'VALIDATE'}
            </button>

            <button
              type="button"
              onClick={() => setStep('select')}
              className="w-full h-12 rounded bg-[#6BC300] hover:bg-[#5DAE00] text-white text-xs font-bold tracking-[0.18em] uppercase transition-colors cursor-pointer"
            >
              BACK
            </button>
          </div>
        </form>
      )}

      {/* STEP 3: VERIFIED SUMMARY & RECIPIENT DISPATCH */}
      {step === 'confirm' && validatedMeta && (
        <form onSubmit={handleDispatch} className="space-y-6">
          {errorMsg && (
            <div
              role="alert"
              className="border border-red-200 bg-red-50 rounded-md p-4 flex items-start gap-2.5 text-sm text-red-800"
            >
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Verified Member Summary */}
          <div className="border border-emerald-200 bg-emerald-50/40 rounded-md p-5 space-y-4">
            <div className="flex items-center justify-between gap-4 border-b border-emerald-200/80 pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-[#1E6B34]">
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Member Statement Verified</span>
              </div>
              <span className="text-xs font-mono text-slate-600">
                File: {predictedFilename}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-slate-500">Member Name</div>
                <div className="font-bold text-[#0F2437] mt-0.5">{validatedMeta.memberName}</div>
              </div>
              <div>
                <div className="text-slate-500">NSSF Member No</div>
                <div className="font-mono font-bold text-[#0F2437] mt-0.5 tabular-nums">
                  {validatedMeta.memberNo}
                </div>
              </div>
              <div>
                <div className="text-slate-500">PDF Password (ID No)</div>
                <div className="font-mono font-bold text-[#0F2437] mt-0.5 tabular-nums">
                  {validatedMeta.maskedIdCardNo}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Total Fund Balance</div>
                <div className="font-mono font-bold text-[#1E6B34] mt-0.5 tabular-nums">
                  KES {validatedMeta.totalAmount}
                </div>
              </div>
            </div>
          </div>

          {/* Channel switcher if user wants to change channel */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { id: 'email' as const, label: 'Email Only', enabled: settings.emailEnabled },
              { id: 'whatsapp' as const, label: 'WhatsApp Only', enabled: settings.whatsappEnabled },
              {
                id: 'both' as const,
                label: 'Email & WhatsApp',
                enabled: settings.emailEnabled && settings.whatsappEnabled,
              },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={!opt.enabled}
                onClick={() => setChannel(opt.id)}
                className={`h-11 rounded text-xs font-bold uppercase tracking-wider border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  channel === opt.id
                    ? 'bg-[#2B7A3B] border-[#2B7A3B] text-white'
                    : 'bg-white border-[#D1D9E0] text-[#0F2437] hover:border-[#2B7A3B]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {(channel === 'email' || channel === 'both') && (
              <div className={channel === 'email' ? 'sm:col-span-2' : ''}>
                <label
                  htmlFor="member-email"
                  className="block text-sm font-medium text-[#0F2437] mb-2"
                >
                  Member Email Address
                </label>
                <div className="relative">
                  <input
                    id="member-email"
                    required
                    type="email"
                    placeholder="MEMBER EMAIL ADDRESS"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-14 px-5 pr-12 rounded border border-[#D1D9E0] bg-white text-sm text-[#0F2437] placeholder:text-slate-400 focus:outline-none focus:border-[#2B7A3B]"
                  />
                  <Pencil
                    className="w-4 h-4 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                </div>
              </div>
            )}

            {(channel === 'whatsapp' || channel === 'both') && (
              <div className={channel === 'whatsapp' ? 'sm:col-span-2' : ''}>
                <label
                  htmlFor="member-whatsapp"
                  className="block text-sm font-medium text-[#0F2437] mb-2"
                >
                  Member WhatsApp Number
                </label>
                <div className="relative">
                  <input
                    id="member-whatsapp"
                    required
                    type="tel"
                    placeholder="254712345678"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    className="w-full h-14 px-5 pr-12 rounded border border-[#D1D9E0] bg-white text-sm font-mono tabular-nums text-[#0F2437] placeholder:text-slate-400 focus:outline-none focus:border-[#2B7A3B]"
                  />
                  <Pencil
                    className="w-4 h-4 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 rounded bg-[#2B7A3B] hover:bg-[#226430] text-white text-xs font-bold tracking-[0.18em] uppercase transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting
                ? 'ENCRYPTING & DISPATCHING...'
                : 'ENCRYPT & DISPATCH STATEMENT'}
            </button>

            <button
              type="button"
              onClick={() => setStep('validate')}
              className="w-full h-12 rounded bg-[#6BC300] hover:bg-[#5DAE00] text-white text-xs font-bold tracking-[0.18em] uppercase transition-colors cursor-pointer"
            >
              BACK
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
