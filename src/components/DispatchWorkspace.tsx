import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileText,
  Keyboard,
  Pencil,
  RefreshCw,
  UploadCloud,
  X,
} from 'lucide-react';
import type { AppSettings, DispatchChannel, DispatchReceipt, StatementMeta } from '../types';
import { NssfLogo } from './NssfLogo';
import { StatementPreviewModal } from './StatementPreviewModal';
import { toast } from './Toaster';

interface DispatchWorkspaceProps {
  settings: AppSettings;
  onSuccess: (receipt: DispatchReceipt) => void;
  onOpenSettings: () => void;
}

type WizardStep = 'select' | 'validate' | 'confirm';

const SMOOTH_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function DispatchWorkspace({
  settings,
  onSuccess,
  onOpenSettings,
}: DispatchWorkspaceProps) {
  const [step, setStep] = useState<WizardStep>('select');
  const [channel, setChannel] = useState<DispatchChannel>('email');
  const [hoveredCard, setHoveredCard] = useState<DispatchChannel | null>(null);

  const [memberNo, setMemberNo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');

  const [validating, setValidating] = useState(false);
  const [validatedMeta, setValidatedMeta] = useState<StatementMeta | null>(null);
  const [predictedFilename, setPredictedFilename] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shortcutHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});

  const focusFieldById = (id: string) => {
    window.setTimeout(() => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select?.();
      }
    }, 80);
  };

  useEffect(() => {
    setErrorMsg('');
    setHoveredCard(null);
    if (step !== 'confirm') setPreviewOpen(false);
  }, [step, memberNo, file, email, whatsapp]);

  // Prevent browser from navigating away if user drops slightly outside the dropzone
  useEffect(() => {
    if (step !== 'validate') return;
    const preventDefault = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, [step]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => shortcutHandlerRef.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const noChannelsEnabled = !settings.emailEnabled && !settings.whatsappEnabled;

  const handleSelectChannel = (chosen: DispatchChannel) => {
    setChannel(chosen);
    setHoveredCard(null);
    setErrorMsg('');
    setStep('validate');
    focusFieldById('nssf-member-no');
  };

  const handleValidateStep = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!memberNo.trim()) {
      const msg = 'Please enter the member NSSF Number.';
      setErrorMsg(msg);
      toast.warning('Missing Member Number', msg);
      return;
    }
    if (!file) {
      const msg = 'Please upload the member statement PDF.';
      setErrorMsg(msg);
      toast.warning('No PDF attached', msg);
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
        const msg = data.error || 'Statement validation failed.';
        setValidatedMeta(null);
        setErrorMsg(msg);
        toast.error('Statement validation failed', msg);
      } else {
        setValidatedMeta(data.meta);
        setPredictedFilename(data.renamedFile || '');
        toast.success(
          'Statement verified',
          `${data.meta.memberName} (${data.meta.memberNo}) matched successfully.`
        );
        setStep('confirm');
      }
    } catch {
      const msg = 'Unable to communicate with the NSSF validation service.';
      setErrorMsg(msg);
      toast.error('Validation service error', msg);
    } finally {
      setValidating(false);
    }
  };

  const executeDispatch = async (overrideChannel?: DispatchChannel) => {
    setErrorMsg('');
    const activeChannel = overrideChannel ?? channel;

    if (!file || !validatedMeta) {
      setPreviewOpen(false);
      setStep('validate');
      return;
    }

    setSubmitting(true);
    const formData = new FormData();
    formData.append('memberNo', memberNo.trim());
    formData.append('channel', activeChannel);
    formData.append('email', email.trim());
    formData.append('whatsapp', whatsapp.trim());
    formData.append('statement', file);

    try {
      const res = await fetch('/api/dispatch', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const msg = data.error || 'Dispatch failed.';
        setErrorMsg(msg);
        toast.error('Statement dispatch failed', msg);
      } else {
        setPreviewOpen(false);
        toast.success(
          data.deliveryMode === 'live' ? 'Statement dispatched' : 'Statement packaged (Preview)',
          `${data.renamedFile} encrypted and logged to SQLite.`
        );
        onSuccess(data);
      }
    } catch {
      const msg = 'Network error communicating with the NSSF Dispatch Server.';
      setErrorMsg(msg);
      toast.error('Network error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeDispatch();
  };

  shortcutHandlerRef.current = (e: KeyboardEvent) => {
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (!mod) return;

    const key = e.key.toLowerCase();
    if (key !== 'e' && key !== 'w' && key !== 'b' && key !== 'p') return;

    if (key === 'p') {
      if (step === 'confirm' && settings.previewBeforeDispatch) {
        e.preventDefault();
        setPreviewOpen((prev) => !prev);
      }
      return;
    }

    e.preventDefault();
    if (validating || submitting) return;

    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const isWhatsappValid = whatsapp.replace(/[^\d]/g, '').length >= 9;

    if (key === 'e') {
      if (!settings.emailEnabled) {
        toast.warning('Email channel disabled', 'Enable Email in System Settings to use Ctrl+E.');
        return;
      }
      if (step === 'select') {
        handleSelectChannel('email');
        toast.success('Email Statement selected', 'Shortcut Ctrl+E: enter Member Number and attach PDF.');
      } else if (step === 'validate') {
        setChannel('email');
        if (!memberNo.trim()) focusFieldById('nssf-member-no');
        toast.success('Email channel active', 'Shortcut Ctrl+E: statement will be sent via Email.');
      } else if (step === 'confirm') {
        setChannel('email');
        if (isEmailValid) {
          void executeDispatch('email');
        } else {
          focusFieldById('member-email');
          toast.warning(
            'Enter member email',
            'Channel set to Email Only. Enter recipient email and press Ctrl+E again to send.'
          );
        }
      }
      return;
    }

    if (key === 'w') {
      if (!settings.whatsappEnabled) {
        toast.warning('WhatsApp channel disabled', 'Enable WhatsApp in System Settings to use Ctrl+W.');
        return;
      }
      if (step === 'select') {
        handleSelectChannel('whatsapp');
        toast.success('WhatsApp Statement selected', 'Shortcut Ctrl+W: enter Member Number and attach PDF.');
      } else if (step === 'validate') {
        setChannel('whatsapp');
        if (!memberNo.trim()) focusFieldById('nssf-member-no');
        toast.success('WhatsApp channel active', 'Shortcut Ctrl+W: statement will be sent via WhatsApp.');
      } else if (step === 'confirm') {
        setChannel('whatsapp');
        if (isWhatsappValid) {
          void executeDispatch('whatsapp');
        } else {
          focusFieldById('member-whatsapp');
          toast.warning(
            'Enter WhatsApp number',
            'Channel set to WhatsApp Only. Enter phone number and press Ctrl+W again to send.'
          );
        }
      }
      return;
    }

    if (key === 'b') {
      if (!settings.emailEnabled || !settings.whatsappEnabled) {
        toast.warning(
          'Dual channel unavailable',
          'Enable both Email and WhatsApp in System Settings to use Ctrl+B.'
        );
        return;
      }
      if (step === 'select') {
        handleSelectChannel('both');
        toast.success('Dual dispatch selected', 'Shortcut Ctrl+B: enter Member Number and attach PDF.');
      } else if (step === 'validate') {
        setChannel('both');
        if (!memberNo.trim()) focusFieldById('nssf-member-no');
        toast.success('Email & WhatsApp active', 'Shortcut Ctrl+B: statement will be sent via both channels.');
      } else if (step === 'confirm') {
        setChannel('both');
        if (isEmailValid && isWhatsappValid) {
          void executeDispatch('both');
        } else {
          focusFieldById(!isEmailValid ? 'member-email' : 'member-whatsapp');
          toast.warning(
            'Complete recipient details',
            'Enter both Email and WhatsApp number, then press Ctrl+B again to send.'
          );
        }
      }
    }
  };

  const acceptSelectedFile = (candidate: File | null | undefined) => {
    if (!candidate) return;
    const isPdf =
      candidate.type === 'application/pdf' ||
      candidate.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      const msg = `"${candidate.name}" is not a PDF file. Please drop a valid NSSF statement PDF.`;
      setErrorMsg(msg);
      toast.warning('Unsupported file format', msg);
      return;
    }
    if (candidate.size > 15 * 1024 * 1024) {
      const msg = 'Statement PDF exceeds the 15 MB maximum upload size.';
      setErrorMsg(msg);
      toast.warning('File too large', msg);
      return;
    }
    setErrorMsg('');
    setFile(candidate);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragOver(false);
    acceptSelectedFile(e.dataTransfer.files?.[0]);
  };

  const stepHeading =
    step === 'select'
      ? 'SERVICE DESK'
      : step === 'validate'
        ? 'VALIDATION'
        : 'DISPATCH STATEMENT';

  const emailHovered = hoveredCard === 'email' && settings.emailEnabled;
  const whatsappHovered = hoveredCard === 'whatsapp' && settings.whatsappEnabled;
  const bothHovered =
    hoveredCard === 'both' && settings.emailEnabled && settings.whatsappEnabled;

  return (
    <div className="py-4 sm:py-8 space-y-10">
      {/* Brand + Display Heading block inspired by nssfdigital.enssf.co.ke */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <NssfLogo subtitle="NSSF DIGITAL STATEMENT DISPATCH" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.h1
              key={stepHeading}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: SMOOTH_EASE }}
              className="font-display text-4xl sm:text-[44px] font-extrabold tracking-tight text-[#0F2437] mt-2 leading-none"
            >
              {stepHeading}
            </motion.h1>
          </AnimatePresence>
        </div>

        <div className="text-xs text-slate-500 flex items-center gap-2">
          <span>
            {settings.deliveryMode === 'live'
              ? 'Live SMTP & WhatsApp Gateway'
              : 'Preview Mode'}
          </span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={onOpenSettings}
            className="font-semibold text-[#2B7A3B] hover:underline cursor-pointer"
          >
            Settings
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
          <motion.button
            type="button"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: 0.14, ease: SMOOTH_EASE }}
            onClick={onOpenSettings}
            className="px-4 py-2 rounded bg-[#2B7A3B] text-white text-xs font-semibold hover:bg-[#236530] whitespace-nowrap cursor-pointer"
          >
            OPEN SETTINGS
          </motion.button>
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {/* STEP 1: SELF SERVICE CHANNEL SELECTION CARDS (matches screenshots 1 & 2) */}
        {step === 'select' && (
          <motion.div
            key="step-select"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: SMOOTH_EASE }}
            className="space-y-6"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              <motion.button
                type="button"
                disabled={!settings.emailEnabled}
                onClick={() => handleSelectChannel('email')}
                onMouseEnter={() => settings.emailEnabled && setHoveredCard('email')}
                onMouseLeave={() => setHoveredCard((prev) => (prev === 'email' ? null : prev))}
                onFocus={() => settings.emailEnabled && setHoveredCard('email')}
                onBlur={() => setHoveredCard((prev) => (prev === 'email' ? null : prev))}
                whileHover={settings.emailEnabled ? { y: -3 } : undefined}
                whileTap={settings.emailEnabled ? { scale: 0.99 } : undefined}
                transition={{ duration: 0.18, ease: SMOOTH_EASE }}
                className={`relative overflow-hidden bg-white rounded-lg p-12 sm:p-14 text-center shadow-[0_6px_28px_rgba(15,36,55,0.08)] border border-b-[3px] transition-shadow duration-200 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer ${
                  emailHovered
                    ? 'border-[#2B7A3B] border-b-[#2B7A3B] shadow-[0_14px_34px_rgba(43,122,59,0.22)]'
                    : 'border-slate-100 border-b-[#2B7A3B]'
                }`}
              >
                <motion.div
                  aria-hidden="true"
                  initial={false}
                  animate={{ scaleY: emailHovered ? 1 : 0 }}
                  transition={{ duration: 0.2, ease: SMOOTH_EASE }}
                  style={{ transformOrigin: 'bottom' }}
                  className="absolute inset-0 bg-[#2B7A3B] pointer-events-none"
                />
                <div className="relative z-10">
                  <span
                    className={`block font-display text-2xl font-bold transition-colors duration-200 ${
                      emailHovered ? 'text-white' : 'text-[#0F2437]'
                    }`}
                  >
                    Email Statement
                  </span>
                  <span
                    className={`block text-xs mt-2 transition-colors duration-200 ${
                      emailHovered ? 'text-emerald-100' : 'text-slate-500'
                    }`}
                  >
                    {settings.emailEnabled
                      ? 'Validate, encrypt & send via NSSF SMTP'
                      : 'Email channel disabled'}
                  </span>
                  {settings.emailEnabled && (
                    <kbd
                      className={`inline-block mt-3 px-2 py-0.5 rounded text-[11px] font-mono border transition-colors duration-200 ${
                        emailHovered
                          ? 'bg-white/15 border-white/30 text-white'
                          : 'bg-slate-50 border-slate-200 text-slate-500'
                      }`}
                    >
                      Ctrl+E
                    </kbd>
                  )}
                </div>
              </motion.button>

              <motion.button
                type="button"
                disabled={!settings.whatsappEnabled}
                onClick={() => handleSelectChannel('whatsapp')}
                onMouseEnter={() => settings.whatsappEnabled && setHoveredCard('whatsapp')}
                onMouseLeave={() => setHoveredCard((prev) => (prev === 'whatsapp' ? null : prev))}
                onFocus={() => settings.whatsappEnabled && setHoveredCard('whatsapp')}
                onBlur={() => setHoveredCard((prev) => (prev === 'whatsapp' ? null : prev))}
                whileHover={settings.whatsappEnabled ? { y: -3 } : undefined}
                whileTap={settings.whatsappEnabled ? { scale: 0.99 } : undefined}
                transition={{ duration: 0.18, ease: SMOOTH_EASE }}
                className={`relative overflow-hidden bg-white rounded-lg p-12 sm:p-14 text-center shadow-[0_6px_28px_rgba(15,36,55,0.08)] border border-b-[3px] transition-shadow duration-200 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer ${
                  whatsappHovered
                    ? 'border-[#2B7A3B] border-b-[#2B7A3B] shadow-[0_14px_34px_rgba(43,122,59,0.22)]'
                    : 'border-slate-100 border-b-[#2B7A3B]'
                }`}
              >
                <motion.div
                  aria-hidden="true"
                  initial={false}
                  animate={{ scaleY: whatsappHovered ? 1 : 0 }}
                  transition={{ duration: 0.2, ease: SMOOTH_EASE }}
                  style={{ transformOrigin: 'bottom' }}
                  className="absolute inset-0 bg-[#2B7A3B] pointer-events-none"
                />
                <div className="relative z-10">
                  <span
                    className={`block font-display text-2xl font-bold transition-colors duration-200 ${
                      whatsappHovered ? 'text-white' : 'text-[#0F2437]'
                    }`}
                  >
                    WhatsApp Statement
                  </span>
                  <span
                    className={`block text-xs mt-2 transition-colors duration-200 ${
                      whatsappHovered ? 'text-emerald-100' : 'text-slate-500'
                    }`}
                  >
                    {settings.whatsappEnabled
                      ? 'Validate, encrypt & send via WhatsApp'
                      : 'WhatsApp channel disabled'}
                  </span>
                  {settings.whatsappEnabled && (
                    <kbd
                      className={`inline-block mt-3 px-2 py-0.5 rounded text-[11px] font-mono border transition-colors duration-200 ${
                        whatsappHovered
                          ? 'bg-white/15 border-white/30 text-white'
                          : 'bg-slate-50 border-slate-200 text-slate-500'
                      }`}
                    >
                      Ctrl+W
                    </kbd>
                  )}
                </div>
              </motion.button>
            </div>

            {settings.emailEnabled && settings.whatsappEnabled && (
              <motion.button
                type="button"
                onClick={() => handleSelectChannel('both')}
                onMouseEnter={() => setHoveredCard('both')}
                onMouseLeave={() => setHoveredCard((prev) => (prev === 'both' ? null : prev))}
                onFocus={() => setHoveredCard('both')}
                onBlur={() => setHoveredCard((prev) => (prev === 'both' ? null : prev))}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.99 }}
                transition={{ duration: 0.18, ease: SMOOTH_EASE }}
                className={`relative overflow-hidden w-full bg-white rounded-md py-4 px-6 text-center shadow-[0_4px_16px_rgba(15,36,55,0.05)] border border-b-2 transition-shadow duration-200 text-sm font-bold cursor-pointer ${
                  bothHovered
                    ? 'border-[#2B7A3B] border-b-[#2B7A3B] shadow-[0_10px_24px_rgba(43,122,59,0.18)]'
                    : 'border-slate-200 border-b-[#6BC300]'
                }`}
              >
                <motion.div
                  aria-hidden="true"
                  initial={false}
                  animate={{ scaleY: bothHovered ? 1 : 0 }}
                  transition={{ duration: 0.2, ease: SMOOTH_EASE }}
                  style={{ transformOrigin: 'bottom' }}
                  className="absolute inset-0 bg-[#2B7A3B] pointer-events-none"
                />
                <span
                  className={`relative z-10 inline-flex items-center justify-center gap-2.5 transition-colors duration-200 ${
                    bothHovered ? 'text-white' : 'text-[#0F2437]'
                  }`}
                >
                  <span>Dispatch via Both Email &amp; WhatsApp</span>
                  <kbd
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors duration-200 ${
                      bothHovered
                        ? 'bg-white/15 border-white/30 text-white'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    Ctrl+B
                  </kbd>
                </span>
              </motion.button>
            )}
          </motion.div>
        )}

        {/* STEP 2: VALIDATION (matches screenshot 3) */}
        {step === 'validate' && (
          <motion.form
            key="step-validate"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: SMOOTH_EASE }}
            onSubmit={handleValidateStep}
            className="space-y-6"
          >
            {errorMsg && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16, ease: SMOOTH_EASE }}
                className="border border-red-200 bg-red-50 rounded-md p-4 flex items-start gap-2.5 text-sm text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorMsg}</span>
              </motion.div>
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
                    className="w-full h-14 px-5 pr-12 rounded border border-[#D1D9E0] bg-white text-sm font-mono tabular-nums text-[#0F2437] placeholder:text-slate-400 placeholder:tracking-wider focus:outline-none focus:border-[#2B7A3B] transition-colors"
                  />
                  <Pencil
                    className="w-4 h-4 text-slate-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="block text-sm font-medium text-[#0F2437]">
                    Member Statement (PDF)
                  </span>
                  <span className="text-xs text-slate-500">
                    Drag &amp; drop or browse · PDF up to 15 MB
                  </span>
                </div>

                <div
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload member statement PDF via drag and drop or file browser"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className={`relative rounded-lg border-2 border-dashed p-6 sm:p-8 transition-colors duration-150 cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2B7A3B] ${
                    dragOver
                      ? 'border-[#2B7A3B] bg-emerald-50/80 shadow-[0_6px_24px_rgba(43,122,59,0.12)]'
                      : file
                        ? 'border-[#2B7A3B]/60 bg-emerald-50/30 hover:border-[#2B7A3B]'
                        : 'border-[#CBD5E1] bg-slate-50/40 hover:border-[#2B7A3B]/70 hover:bg-emerald-50/20'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    onChange={(e) => {
                      acceptSelectedFile(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />

                  {!file || dragOver ? (
                    <div className="flex flex-col items-center justify-center text-center gap-3 py-2">
                      <motion.div
                        animate={{ scale: dragOver ? 1.12 : 1, y: dragOver ? -2 : 0 }}
                        transition={{ duration: 0.16, ease: SMOOTH_EASE }}
                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors duration-150 ${
                          dragOver
                            ? 'bg-[#2B7A3B] text-white'
                            : 'bg-white border border-slate-200 text-[#2B7A3B] shadow-sm'
                        }`}
                      >
                        <UploadCloud className="w-6 h-6" aria-hidden="true" />
                      </motion.div>

                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-[#0F2437]">
                          {dragOver
                            ? 'Drop statement PDF here to attach'
                            : 'Drag & drop member statement PDF here'}
                        </p>
                        <p className="text-xs text-slate-500">
                          or{' '}
                          <span className="text-[#2B7A3B] font-semibold underline underline-offset-2">
                            browse files
                          </span>{' '}
                          from this workstation
                        </p>
                      </div>
                    </div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.16, ease: SMOOTH_EASE }}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-11 h-11 rounded-md bg-[#2B7A3B] text-white flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-[#0F2437] truncate">
                            {file.name}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                            <span className="font-mono tabular-nums">
                              {(file.size / 1024).toFixed(1)} KB
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#1E6B34] font-medium">
                              PDF attached · Drop another file to replace
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <motion.button
                          type="button"
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          transition={{ duration: 0.14, ease: SMOOTH_EASE }}
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#D1D9E0] bg-white text-xs font-semibold text-[#0F2437] hover:border-[#2B7A3B] hover:text-[#2B7A3B] transition-colors cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Replace</span>
                        </motion.button>

                        <motion.button
                          type="button"
                          whileHover={{ y: -1 }}
                          whileTap={{ scale: 0.97 }}
                          transition={{ duration: 0.14, ease: SMOOTH_EASE }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFile(null);
                            setValidatedMeta(null);
                          }}
                          aria-label="Remove attached statement PDF"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-red-200 bg-white text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Remove</span>
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <motion.button
                type="submit"
                disabled={validating}
                whileHover={!validating ? { y: -1 } : undefined}
                whileTap={!validating ? { scale: 0.99 } : undefined}
                transition={{ duration: 0.15, ease: SMOOTH_EASE }}
                className="w-full h-12 rounded bg-[#2B7A3B] hover:bg-[#226430] text-white text-xs font-bold tracking-[0.18em] uppercase transition-colors disabled:opacity-50 cursor-pointer"
              >
                {validating ? 'VALIDATING STATEMENT...' : 'VALIDATE'}
              </motion.button>

              <motion.button
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.99 }}
                transition={{ duration: 0.15, ease: SMOOTH_EASE }}
                onClick={() => setStep('select')}
                className="w-full h-12 rounded bg-[#6BC300] hover:bg-[#5DAE00] text-white text-xs font-bold tracking-[0.18em] uppercase transition-colors cursor-pointer"
              >
                BACK
              </motion.button>
            </div>
          </motion.form>
        )}

        {/* STEP 3: VERIFIED SUMMARY & RECIPIENT DISPATCH */}
        {step === 'confirm' && validatedMeta && (
          <motion.form
            key="step-confirm"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: SMOOTH_EASE }}
            onSubmit={handleDispatch}
            className="space-y-6"
          >
            {errorMsg && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.16, ease: SMOOTH_EASE }}
                className="border border-red-200 bg-red-50 rounded-md p-4 flex items-start gap-2.5 text-sm text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorMsg}</span>
              </motion.div>
            )}

            {/* Verified Member Summary */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: SMOOTH_EASE }}
              className="border border-emerald-200 bg-emerald-50/40 rounded-md p-5 space-y-4"
            >
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
            </motion.div>

            {/* Channel switcher if user wants to change channel */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  id: 'email' as const,
                  label: 'Email Only',
                  shortcut: 'Ctrl+E',
                  enabled: settings.emailEnabled,
                },
                {
                  id: 'whatsapp' as const,
                  label: 'WhatsApp Only',
                  shortcut: 'Ctrl+W',
                  enabled: settings.whatsappEnabled,
                },
                {
                  id: 'both' as const,
                  label: 'Email & WhatsApp',
                  shortcut: 'Ctrl+B',
                  enabled: settings.emailEnabled && settings.whatsappEnabled,
                },
              ].map((opt) => (
                <motion.button
                  key={opt.id}
                  type="button"
                  disabled={!opt.enabled}
                  whileHover={opt.enabled ? { y: -1 } : undefined}
                  whileTap={opt.enabled ? { scale: 0.98 } : undefined}
                  transition={{ duration: 0.14, ease: SMOOTH_EASE }}
                  onClick={() => setChannel(opt.id)}
                  className={`h-11 rounded px-3 text-xs font-bold uppercase tracking-wider border inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    channel === opt.id
                      ? 'bg-[#2B7A3B] border-[#2B7A3B] text-white'
                      : 'bg-white border-[#D1D9E0] text-[#0F2437] hover:border-[#2B7A3B]'
                  }`}
                >
                  <span>{opt.label}</span>
                  <kbd
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-normal normal-case tracking-normal border ${
                      channel === opt.id
                        ? 'bg-white/15 border-white/30 text-white'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    {opt.shortcut}
                  </kbd>
                </motion.button>
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
                      className="w-full h-14 px-5 pr-12 rounded border border-[#D1D9E0] bg-white text-sm text-[#0F2437] placeholder:text-slate-400 focus:outline-none focus:border-[#2B7A3B] transition-colors"
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
                      className="w-full h-14 px-5 pr-12 rounded border border-[#D1D9E0] bg-white text-sm font-mono tabular-nums text-[#0F2437] placeholder:text-slate-400 focus:outline-none focus:border-[#2B7A3B] transition-colors"
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
              {settings.previewBeforeDispatch && (
                <motion.button
                  type="button"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.99 }}
                  transition={{ duration: 0.15, ease: SMOOTH_EASE }}
                  onClick={() => setPreviewOpen(true)}
                  className="w-full h-12 rounded border border-[#2B7A3B] bg-white hover:bg-emerald-50 text-[#1E6B34] text-xs font-bold tracking-[0.16em] uppercase inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Eye className="w-4 h-4" aria-hidden="true" />
                  <span>PREVIEW PARSED DETAILS &amp; PDF</span>
                  <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono font-normal normal-case tracking-normal border border-emerald-200 bg-emerald-50 text-[#1E6B34]">
                    Ctrl+P
                  </kbd>
                </motion.button>
              )}

              <motion.button
                type="submit"
                disabled={submitting}
                whileHover={!submitting ? { y: -1 } : undefined}
                whileTap={!submitting ? { scale: 0.99 } : undefined}
                transition={{ duration: 0.15, ease: SMOOTH_EASE }}
                className="w-full h-12 rounded bg-[#2B7A3B] hover:bg-[#226430] text-white text-xs font-bold tracking-[0.18em] uppercase transition-colors disabled:opacity-50 cursor-pointer"
              >
                {submitting
                  ? 'ENCRYPTING & DISPATCHING...'
                  : 'ENCRYPT & DISPATCH STATEMENT'}
              </motion.button>

              <motion.button
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.99 }}
                transition={{ duration: 0.15, ease: SMOOTH_EASE }}
                onClick={() => setStep('validate')}
                className="w-full h-12 rounded bg-[#6BC300] hover:bg-[#5DAE00] text-white text-xs font-bold tracking-[0.18em] uppercase transition-colors cursor-pointer"
              >
                BACK
              </motion.button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Global shortcut legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-2 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-600">
          <Keyboard className="w-3.5 h-3.5 text-[#2B7A3B]" aria-hidden="true" />
          <span>Shortcuts:</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white font-mono text-[10px] text-[#0F2437]">
            Ctrl+E
          </kbd>
          <span>Send Email</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white font-mono text-[10px] text-[#0F2437]">
            Ctrl+W
          </kbd>
          <span>Send WhatsApp</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white font-mono text-[10px] text-[#0F2437]">
            Ctrl+B
          </kbd>
          <span>Both</span>
        </span>
        {settings.previewBeforeDispatch && (
          <span className="inline-flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white font-mono text-[10px] text-[#0F2437]">
              Ctrl+P
            </kbd>
            <span>Preview PDF</span>
          </span>
        )}
      </div>

      {settings.previewBeforeDispatch && (
        <StatementPreviewModal
          open={previewOpen}
          file={file}
          meta={validatedMeta}
          predictedFilename={predictedFilename}
          channel={channel}
          email={email}
          whatsapp={whatsapp}
          passwordMode={settings.passwordMode}
          submitting={submitting}
          onClose={() => setPreviewOpen(false)}
          onConfirmDispatch={() => executeDispatch()}
        />
      )}
    </div>
  );
}
