import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  FileText,
  Keyboard,
  RefreshCw,
  UploadCloud,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { DispatchChannel, StatementMeta } from '../types';
import { dispatchStatementApi, validateStatementApi, verifyStatementFileApi } from '../utils/api';
import { ROUTES, SMOOTH_EASE } from '../utils/constants';
import {
  MAX_PDF_BYTES,
  formatFileSizeKb,
  hasPdfMagicHeader,
  isPdfFile,
  isValidEmail,
  isValidWhatsappNumber,
} from '../utils/validation';
import { NssfLogo } from './NssfLogo';
import { StatementPreviewModal } from './StatementPreviewModal';
import { toast } from './Toaster';
import { ActionButton, AlertBanner, ChannelOptionCard, FormInput } from './ui';

type WizardStep = 'select' | 'validate' | 'confirm';

export function DispatchWorkspace() {
  const { settings, setReceipt, navigateTo } = useApp();

  const [step, setStep] = useState<WizardStep>('select');
  const [channel, setChannel] = useState<DispatchChannel>('email');
  const [hoveredCard, setHoveredCard] = useState<DispatchChannel | null>(null);

  const [memberNo, setMemberNo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');

  const [validating, setValidating] = useState(false);
  const [checkingFile, setCheckingFile] = useState(false);
  const [validatedMeta, setValidatedMeta] = useState<StatementMeta | null>(null);
  const [predictedFilename, setPredictedFilename] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const uploadCheckIdRef = useRef(0);
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

  useEffect(() => {
    if (step === 'validate') {
      setValidatedMeta(null);
      setPredictedFilename('');
    }
  }, [step, memberNo, file]);

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

  const emailConfigured = Boolean(settings.emailConfigured ?? settings.hasSmtpPass);
  const whatsappConfigured = Boolean(settings.whatsappPaired);
  const emailReady = settings.emailEnabled && emailConfigured;
  const whatsappReady = settings.whatsappEnabled && whatsappConfigured;
  const bothReady = emailReady && whatsappReady;
  const noChannelsReady = !emailReady && !whatsappReady;
  const uploadBusy = validating || checkingFile;

  useEffect(() => {
    if (step === 'select') return;
    if (
      (channel === 'email' && !emailReady) ||
      (channel === 'whatsapp' && !whatsappReady) ||
      (channel === 'both' && !bothReady)
    ) {
      setStep('select');
    }
  }, [step, channel, emailReady, whatsappReady, bothReady]);

  const handleSelectChannel = (chosen: DispatchChannel) => {
    if (chosen === 'email' && !emailReady) {
      toast.error(
        'Email dispatch unavailable',
        !settings.emailEnabled
          ? 'Email dispatch is disabled in Settings.'
          : 'Configure SMTP host, username, and password in Settings first.'
      );
      return;
    }
    if (chosen === 'whatsapp' && !whatsappReady) {
      toast.error(
        'WhatsApp dispatch unavailable',
        !settings.whatsappEnabled
          ? 'WhatsApp dispatch is disabled in Settings.'
          : 'Pair a WhatsApp device QR code in Settings first.'
      );
      return;
    }
    if (chosen === 'both' && !bothReady) {
      toast.error(
        'Dual dispatch unavailable',
        'Both Email (SMTP) and WhatsApp must be enabled and configured in Settings first.'
      );
      return;
    }
    setChannel(chosen);
    setHoveredCard(null);
    setErrorMsg('');
    setStep('validate');
    focusFieldById('nssf-member-no');
  };

  const handleValidateStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploadBusy) return;
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
    setDragOver(false);
    try {
      const data = await validateStatementApi(memberNo, file);
      if (!data.ok || !data.meta) {
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
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to communicate with the NSSF validation service.';
      setValidatedMeta(null);
      setErrorMsg(msg);
      toast.error('Statement validation failed', msg);
    } finally {
      setValidating(false);
    }
  };

  const getDispatchFailureTitle = (activeChannel: DispatchChannel, reason: string): string => {
    const lower = reason.toLowerCase();
    if (lower.includes('whatsapp error')) {
      return 'WhatsApp dispatch failed';
    }
    if (lower.includes('email error')) {
      return 'Email dispatch failed';
    }
    if (activeChannel === 'email') return 'Email dispatch failed';
    if (activeChannel === 'whatsapp') return 'WhatsApp dispatch failed';
    if (lower.includes('whatsapp')) return 'WhatsApp dispatch failed';
    if (lower.includes('email') || lower.includes('smtp')) return 'Email dispatch failed';
    return 'Email & WhatsApp dispatch failed';
  };

  const extractDispatchError = (err: unknown): string => {
    if (err instanceof Error && err.message.trim()) {
      return err.message.trim();
    }
    if (typeof err === 'string' && err.trim()) {
      return err.trim();
    }
    if (err && typeof err === 'object') {
      const maybeObj = err as { error?: unknown; message?: unknown };
      if (typeof maybeObj.error === 'string' && maybeObj.error.trim()) {
        return maybeObj.error.trim();
      }
      if (typeof maybeObj.message === 'string' && maybeObj.message.trim()) {
        return maybeObj.message.trim();
      }
    }
    return 'Network error communicating with the NSSF Dispatch Server.';
  };

  const validateDispatchReady = (activeChannel: DispatchChannel): boolean => {
    if (!file || !validatedMeta) {
      const msg = 'Please attach and validate an official NSSF statement PDF before dispatching.';
      setPreviewOpen(false);
      setErrorMsg(msg);
      toast.error(getDispatchFailureTitle(activeChannel, msg), msg);
      setStep('validate');
      return false;
    }

    if ((activeChannel === 'email' || activeChannel === 'both') && !emailReady) {
      const msg = !settings.emailEnabled
        ? 'Email dispatch is disabled in System Settings.'
        : 'Email (SMTP) is not configured in System Settings.';
      setPreviewOpen(false);
      setErrorMsg(msg);
      toast.error('Email dispatch failed', msg);
      return false;
    }

    if ((activeChannel === 'whatsapp' || activeChannel === 'both') && !whatsappReady) {
      const msg = !settings.whatsappEnabled
        ? 'WhatsApp dispatch is disabled in System Settings.'
        : 'WhatsApp device is not paired in System Settings.';
      setPreviewOpen(false);
      setErrorMsg(msg);
      toast.error('WhatsApp dispatch failed', msg);
      return false;
    }

    if ((activeChannel === 'email' || activeChannel === 'both') && !isValidEmail(email)) {
      const msg = 'Please enter a valid member email address before sending.';
      setPreviewOpen(false);
      setErrorMsg(msg);
      focusFieldById('member-email');
      toast.error('Email dispatch failed', msg);
      return false;
    }

    if ((activeChannel === 'whatsapp' || activeChannel === 'both') && !isValidWhatsappNumber(whatsapp)) {
      const msg = 'Please enter a valid member WhatsApp phone number (at least 9 digits).';
      setPreviewOpen(false);
      setErrorMsg(msg);
      focusFieldById('member-whatsapp');
      toast.error('WhatsApp dispatch failed', msg);
      return false;
    }

    return true;
  };

  const executeDispatch = async (overrideChannel?: DispatchChannel) => {
    if (submitting) return;
    setErrorMsg('');
    const activeChannel = overrideChannel ?? channel;

    if (!validateDispatchReady(activeChannel) || !file) {
      return;
    }

    setSubmitting(true);
    try {
      const data = await dispatchStatementApi({
        memberNo,
        channel: activeChannel,
        email,
        whatsapp,
        file,
      });
      if (!data || !data.ok) {
        const msg =
          (data && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
            ? (data as { error: string }).error.trim()
            : '') || 'Statement dispatch failed.';
        setPreviewOpen(false);
        setErrorMsg(msg);
        toast.error(getDispatchFailureTitle(activeChannel, msg), msg);
        return;
      }
      setPreviewOpen(false);
      toast.success(
        'Statement dispatched',
        `${data.renamedFile} encrypted and dispatched to member.`
      );
      setReceipt(data);
    } catch (err) {
      const msg = extractDispatchError(err);
      setPreviewOpen(false);
      setErrorMsg(msg);
      toast.error(getDispatchFailureTitle(activeChannel, msg), msg);
    } finally {
      setSubmitting(false);
    }
  };

  const triggerSendOrPreview = async (overrideChannel?: DispatchChannel) => {
    if (submitting) return;
    setErrorMsg('');
    const activeChannel = overrideChannel ?? channel;

    if (!validateDispatchReady(activeChannel)) {
      return;
    }

    if (settings.previewBeforeDispatch) {
      setPreviewOpen(true);
      return;
    }

    await executeDispatch(activeChannel);
  };

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    await triggerSendOrPreview();
  };

  shortcutHandlerRef.current = (e: KeyboardEvent) => {
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (!mod) return;

    const key = e.key.toLowerCase();
    if (key !== 'e' && key !== 'w' && key !== 'b') return;

    e.preventDefault();
    if (uploadBusy || submitting || previewOpen) return;

    const emailValid = isValidEmail(email);
    const whatsappValid = isValidWhatsappNumber(whatsapp);

    if (key === 'e') {
      if (!emailReady) {
        toast.error(
          'Email channel unavailable',
          !settings.emailEnabled
            ? 'Enable Email in System Settings to use Ctrl+E.'
            : 'Configure SMTP host, user, and password in System Settings to use Ctrl+E.'
        );
        return;
      }
      if (step === 'select') {
        handleSelectChannel('email');
        toast.success(
          'Email Statement selected',
          'Shortcut Ctrl+E: enter Member Number and attach PDF.'
        );
      } else if (step === 'validate') {
        setChannel('email');
        if (!memberNo.trim()) focusFieldById('nssf-member-no');
        toast.success('Email channel active', 'Shortcut Ctrl+E: statement will be sent via Email.');
      } else if (step === 'confirm') {
        setChannel('email');
        if (emailValid) {
          void triggerSendOrPreview('email');
        } else {
          const msg = 'Enter a valid member email address and press Ctrl+E again to continue.';
          setErrorMsg(msg);
          focusFieldById('member-email');
          toast.error('Invalid member email', msg);
        }
      }
      return;
    }

    if (key === 'w') {
      if (!whatsappReady) {
        toast.error(
          'WhatsApp channel unavailable',
          !settings.whatsappEnabled
            ? 'Enable WhatsApp in System Settings to use Ctrl+W.'
            : 'Pair a WhatsApp device QR code in System Settings to use Ctrl+W.'
        );
        return;
      }
      if (step === 'select') {
        handleSelectChannel('whatsapp');
        toast.success(
          'WhatsApp Statement selected',
          'Shortcut Ctrl+W: enter Member Number and attach PDF.'
        );
      } else if (step === 'validate') {
        setChannel('whatsapp');
        if (!memberNo.trim()) focusFieldById('nssf-member-no');
        toast.success(
          'WhatsApp channel active',
          'Shortcut Ctrl+W: statement will be sent via WhatsApp.'
        );
      } else if (step === 'confirm') {
        setChannel('whatsapp');
        if (whatsappValid) {
          void triggerSendOrPreview('whatsapp');
        } else {
          const msg = 'Enter a valid WhatsApp phone number and press Ctrl+W again to continue.';
          setErrorMsg(msg);
          focusFieldById('member-whatsapp');
          toast.error('Invalid WhatsApp number', msg);
        }
      }
      return;
    }

    if (key === 'b') {
      if (!bothReady) {
        toast.error(
          'Dual channel unavailable',
          'Both Email (SMTP) and WhatsApp must be enabled and set up in System Settings to use Ctrl+B.'
        );
        return;
      }
      if (step === 'select') {
        handleSelectChannel('both');
        toast.success(
          'Dual dispatch selected',
          'Shortcut Ctrl+B: enter Member Number and attach PDF.'
        );
      } else if (step === 'validate') {
        setChannel('both');
        if (!memberNo.trim()) focusFieldById('nssf-member-no');
        toast.success(
          'Email & WhatsApp active',
          'Shortcut Ctrl+B: statement will be sent via both channels.'
        );
      } else if (step === 'confirm') {
        setChannel('both');
        if (emailValid && whatsappValid) {
          void triggerSendOrPreview('both');
        } else {
          const msg = 'Enter both a valid Email and WhatsApp number, then press Ctrl+B again to continue.';
          setErrorMsg(msg);
          focusFieldById(!emailValid ? 'member-email' : 'member-whatsapp');
          toast.error('Incomplete recipient details', msg);
        }
      }
    }
  };

  const acceptSelectedFile = async (candidate: File | null | undefined) => {
    if (uploadBusy || !candidate) return;
    if (!isPdfFile(candidate)) {
      const msg = `Rejected "${candidate.name}": only official NSSF statement PDF files are accepted.`;
      setFile(null);
      setValidatedMeta(null);
      setErrorMsg(msg);
      toast.warning('Unsupported file format', msg);
      return;
    }
    if (candidate.size > MAX_PDF_BYTES) {
      const msg = 'Statement PDF exceeds the 15 MB maximum upload size.';
      setFile(null);
      setValidatedMeta(null);
      setErrorMsg(msg);
      toast.warning('File too large', msg);
      return;
    }

    const hasMagic = await hasPdfMagicHeader(candidate);
    if (!hasMagic) {
      const msg = `Rejected "${candidate.name}": file is not a genuine PDF document.`;
      setFile(null);
      setValidatedMeta(null);
      setErrorMsg(msg);
      toast.error('Invalid PDF file', msg);
      return;
    }

    const checkId = ++uploadCheckIdRef.current;
    setCheckingFile(true);
    setErrorMsg('');
    setValidatedMeta(null);
    setPredictedFilename('');

    try {
      await verifyStatementFileApi(candidate);
      if (uploadCheckIdRef.current !== checkId) return;
      setFile(candidate);
      toast.success(
        'NSSF statement attached',
        `${candidate.name} verified as an official NSSF Member Statement PDF.`
      );
    } catch (err) {
      if (uploadCheckIdRef.current !== checkId) return;
      const msg =
        err instanceof Error
          ? err.message
          : 'Rejected: uploaded file is not an official NSSF Member Statement PDF.';
      setFile(null);
      setValidatedMeta(null);
      setErrorMsg(msg);
      toast.error('Non-NSSF file rejected', msg);
    } finally {
      if (uploadCheckIdRef.current === checkId) {
        setCheckingFile(false);
      }
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (uploadBusy) return;
    dragDepthRef.current += 1;
    setDragOver(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = uploadBusy ? 'none' : 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (uploadBusy) return;
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
    if (uploadBusy) return;
    void acceptSelectedFile(e.dataTransfer.files?.[0]);
  };

  const stepHeading =
    step === 'select'
      ? 'SERVICE DESK'
      : step === 'validate'
        ? 'VALIDATION'
        : 'DISPATCH STATEMENT';

  const bothHovered = hoveredCard === 'both' && bothReady;

  return (
    <div className="py-4 sm:py-8 space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <NssfLogo />
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

        <div className="text-xs flex items-center">
          <button
            type="button"
            onClick={() => navigateTo(ROUTES.SETTINGS)}
            className="font-semibold text-[#2B7A3B] hover:underline cursor-pointer"
          >
            Settings
          </button>
        </div>
      </div>

      {noChannelsReady ? (
        <AlertBanner
          variant="warning"
          message="No dispatch channels are ready yet. Configure SMTP Email credentials or pair a WhatsApp device in Settings before sending statements."
          actionLabel="OPEN SETTINGS"
          onAction={() => navigateTo(ROUTES.SETTINGS)}
        />
      ) : (
        <>
          {settings.emailEnabled && !emailConfigured && (
            <AlertBanner
              variant="warning"
              message="Email dispatch is disabled until SMTP host, username, and password are configured in Settings."
              actionLabel="SETUP EMAIL"
              onAction={() => navigateTo(ROUTES.SETTINGS)}
            />
          )}
          {settings.whatsappEnabled && !whatsappConfigured && (
            <AlertBanner
              variant="warning"
              message="WhatsApp dispatch is disabled until a WhatsApp device QR code is paired in Settings."
              actionLabel="PAIR WHATSAPP"
              onAction={() => navigateTo(ROUTES.SETTINGS)}
            />
          )}
        </>
      )}

      <AnimatePresence mode="wait" initial={false}>
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
              <ChannelOptionCard
                title="Email Statement"
                subtitle={
                  !settings.emailEnabled
                    ? 'Email channel disabled in Settings'
                    : !emailConfigured
                      ? 'Email not set up — configure SMTP in Settings'
                      : 'Validate, encrypt & send via NSSF SMTP'
                }
                shortcut="Ctrl+E"
                enabled={emailReady}
                hovered={hoveredCard === 'email' && emailReady}
                onHoverChange={(isHov) =>
                  setHoveredCard((prev) =>
                    isHov ? 'email' : prev === 'email' ? null : prev
                  )
                }
                onSelect={() => handleSelectChannel('email')}
              />

              <ChannelOptionCard
                title="WhatsApp Statement"
                subtitle={
                  !settings.whatsappEnabled
                    ? 'WhatsApp channel disabled in Settings'
                    : !whatsappConfigured
                      ? 'WhatsApp not set up — pair device in Settings'
                      : 'Validate, encrypt & send via WhatsApp'
                }
                shortcut="Ctrl+W"
                enabled={whatsappReady}
                hovered={hoveredCard === 'whatsapp' && whatsappReady}
                onHoverChange={(isHov) =>
                  setHoveredCard((prev) =>
                    isHov ? 'whatsapp' : prev === 'whatsapp' ? null : prev
                  )
                }
                onSelect={() => handleSelectChannel('whatsapp')}
              />
            </div>

            {bothReady && (
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
                    : 'border-slate-200'
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
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-normal normal-case tracking-normal border transition-colors duration-200 ${
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

        {step === 'validate' && (
          <motion.form
            key="step-validate"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: SMOOTH_EASE }}
            noValidate
            onSubmit={handleValidateStep}
            className="space-y-6"
          >
            {errorMsg && <AlertBanner variant="error" message={errorMsg} />}

            <div className="space-y-5">
              <FormInput
                id="nssf-member-no"
                label="Member Number"
                required
                type="text"
                disabled={uploadBusy}
                readOnly={uploadBusy}
                showPencilIcon
                placeholder="MEMBER NUMBER"
                value={memberNo}
                onChange={(e) => {
                  if (!uploadBusy) setMemberNo(e.target.value);
                }}
                className="font-mono tabular-nums placeholder:tracking-wider"
              />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="block text-sm font-medium text-[#0F2437]">
                    Official NSSF Member Statement (PDF)
                  </span>
                  <span className="text-xs text-slate-500">
                    NSSF statements only · PDF up to 15 MB
                  </span>
                </div>

                <div
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => {
                    if (!uploadBusy) fileInputRef.current?.click();
                  }}
                  role="button"
                  tabIndex={uploadBusy ? -1 : 0}
                  aria-disabled={uploadBusy}
                  aria-label="Upload official NSSF member statement PDF via drag and drop or file browser"
                  onKeyDown={(e) => {
                    if (uploadBusy) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className={`relative rounded-lg border-2 border-dashed p-6 sm:p-8 transition-colors duration-150 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2B7A3B] ${
                    uploadBusy
                      ? 'border-slate-200 bg-slate-100/80 opacity-75 cursor-not-allowed'
                      : dragOver
                        ? 'border-[#2B7A3B] bg-emerald-50/80 shadow-[0_6px_24px_rgba(43,122,59,0.12)] cursor-pointer'
                        : file
                          ? 'border-[#2B7A3B]/60 bg-emerald-50/30 hover:border-[#2B7A3B] cursor-pointer'
                          : 'border-[#CBD5E1] bg-slate-50/40 hover:border-[#2B7A3B]/70 hover:bg-emerald-50/20 cursor-pointer'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={uploadBusy}
                    className="sr-only"
                    onChange={(e) => {
                      if (!uploadBusy) void acceptSelectedFile(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />

                  {checkingFile ? (
                    <div className="flex flex-col items-center justify-center text-center gap-3 py-2">
                      <div className="w-12 h-12 rounded-full bg-white border border-slate-200 text-[#2B7A3B] shadow-sm flex items-center justify-center">
                        <RefreshCw className="w-5 h-5 animate-spin" aria-hidden="true" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-[#0F2437]">
                          Verifying NSSF statement format...
                        </p>
                        <p className="text-xs text-slate-500">
                          Checking PDF signature and official NSSF member statement structure
                        </p>
                      </div>
                    </div>
                  ) : !file || dragOver ? (
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
                            ? 'Drop NSSF statement PDF here to attach'
                            : 'Drag & drop official NSSF member statement PDF here'}
                        </p>
                        <p className="text-xs text-slate-500">
                          or{' '}
                          <span className="text-[#2B7A3B] font-semibold underline underline-offset-2">
                            browse files
                          </span>{' '}
                          from this workstation (non-NSSF files are rejected automatically)
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
                              {formatFileSizeKb(file.size)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#1E6B34] font-medium">
                              {validating
                                ? 'Locked during validation'
                                : 'Official NSSF PDF verified · Drop another to replace'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <motion.button
                          type="button"
                          disabled={uploadBusy}
                          whileHover={!uploadBusy ? { y: -1 } : undefined}
                          whileTap={!uploadBusy ? { scale: 0.97 } : undefined}
                          transition={{ duration: 0.14, ease: SMOOTH_EASE }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!uploadBusy) fileInputRef.current?.click();
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#D1D9E0] bg-white text-xs font-semibold text-[#0F2437] hover:border-[#2B7A3B] hover:text-[#2B7A3B] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Replace</span>
                        </motion.button>

                        <motion.button
                          type="button"
                          disabled={uploadBusy}
                          whileHover={!uploadBusy ? { y: -1 } : undefined}
                          whileTap={!uploadBusy ? { scale: 0.97 } : undefined}
                          transition={{ duration: 0.14, ease: SMOOTH_EASE }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (uploadBusy) return;
                            setFile(null);
                            setValidatedMeta(null);
                          }}
                          aria-label="Remove attached statement PDF"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-red-200 bg-white text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
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
              <ActionButton type="submit" fullWidth size="lg" disabled={uploadBusy || !file}>
                {validating
                  ? 'VALIDATING STATEMENT...'
                  : checkingFile
                    ? 'VERIFYING UPLOAD...'
                    : 'VALIDATE'}
              </ActionButton>

              <ActionButton
                variant="lime"
                fullWidth
                size="lg"
                disabled={uploadBusy}
                onClick={() => {
                  if (!uploadBusy) setStep('select');
                }}
              >
                BACK
              </ActionButton>
            </div>
          </motion.form>
        )}

        {step === 'confirm' && validatedMeta && (
          <motion.form
            key="step-confirm"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: SMOOTH_EASE }}
            noValidate
            onSubmit={handleDispatch}
            className="space-y-6"
          >
            {errorMsg && <AlertBanner variant="error" message={errorMsg} />}

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {(channel === 'email' || channel === 'both') && (
                <div className={channel === 'email' ? 'sm:col-span-2' : ''}>
                  <FormInput
                    id="member-email"
                    label="Member Email Address"
                    required
                    type="email"
                    disabled={submitting}
                    readOnly={submitting}
                    showPencilIcon
                    placeholder="MEMBER EMAIL ADDRESS"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              )}

              {(channel === 'whatsapp' || channel === 'both') && (
                <div className={channel === 'whatsapp' ? 'sm:col-span-2' : ''}>
                  <FormInput
                    id="member-whatsapp"
                    label="Member WhatsApp Number"
                    required
                    type="tel"
                    disabled={submitting}
                    readOnly={submitting}
                    showPencilIcon
                    placeholder="254712345678"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    className="font-mono tabular-nums"
                  />
                </div>
              )}
            </div>

            <div className="space-y-3 pt-2">
              <ActionButton type="submit" fullWidth size="lg" disabled={submitting}>
                {submitting
                  ? 'ENCRYPTING & SENDING...'
                  : settings.previewBeforeDispatch
                    ? 'PREVIEW & SEND'
                    : 'ENCRYPT & SEND'}
              </ActionButton>

              <ActionButton
                variant="lime"
                fullWidth
                size="lg"
                disabled={submitting}
                onClick={() => {
                  if (!submitting) setStep('validate');
                }}
              >
                BACK
              </ActionButton>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

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
          onConfirmDispatch={() => void executeDispatch()}
        />
      )}
    </div>
  );
}
