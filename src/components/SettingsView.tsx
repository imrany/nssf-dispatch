import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronUp,
  ClipboardList,
  FileText,
  LogOut,
  Mail,
  Pencil,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import type { ActiveTab, AppSettings, SystemRuntimeInfo, WhatsAppQrData } from '../types';
import { toast } from './Toaster';

const DEFAULT_EMAIL_SUBJECT_TEMPLATE =
  'Official NSSF Member Statement — {memberName} ({memberNo})';

const DEFAULT_WHATSAPP_MESSAGE_TEMPLATE = `*NATIONAL SOCIAL SECURITY FUND (NSSF) KENYA*
Hello {memberName},

Please find attached your official NSSF Member Statement ({renamedFile}) for {period}.

*Member No:* {memberNo}
*Total Fund Balance:* KES {totalAmount}

*How to Open:*
Enter {passwordGuide} when prompted for the PDF password.

Self-Service: USSD *303# or {portalUrl}`;

const TEMPLATE_PLACEHOLDERS: Array<{ token: string; label: string }> = [
  { token: '{memberName}', label: 'Member Name' },
  { token: '{memberNo}', label: 'Member No' },
  { token: '{period}', label: 'Period' },
  { token: '{totalAmount}', label: 'Total Balance' },
  { token: '{standardAmount}', label: 'Standard Amt' },
  { token: '{voluntaryAmount}', label: 'Voluntary Amt' },
  { token: '{employer}', label: 'Employer' },
  { token: '{renamedFile}', label: 'PDF Filename' },
  { token: '{passwordGuide}', label: 'Password Guide' },
  { token: '{portalUrl}', label: 'Portal URL' },
  { token: '{statementDate}', label: 'Statement Date' },
];

const SAMPLE_TEMPLATE_VARS: Record<string, string> = {
  memberName: 'JANE WANJIKU KAMAU',
  memberNo: '102938475',
  period: 'Jan 2024 - Dec 2024',
  employer: 'KENYA COMMERCIAL BANK LTD',
  standardAmount: '1,240,000.00',
  voluntaryAmount: '242,500.00',
  totalAmount: '1,482,500.00',
  renamedFile: 'NSSF_Statement_102938475_20261125.pdf',
  passwordGuide: 'Your National ID Card Number (*****678)',
  portalUrl: 'https://nssfdigital.enssf.co.ke',
  statementDate: '25 Nov 2026',
};

function renderPreviewTemplate(template: string, portalUrl: string, stripNewlines = false): string {
  const vars: Record<string, string> = {
    ...SAMPLE_TEMPLATE_VARS,
    portalUrl: portalUrl || SAMPLE_TEMPLATE_VARS.portalUrl,
  };
  const rendered = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, token: string) => {
    const key = Object.keys(vars).find((k) => k.toLowerCase() === token.toLowerCase());
    return key ? vars[key] : match;
  });
  return stripNewlines ? rendered.replace(/[\r\n]+/g, ' ').trim() : rendered;
}

export type PendingSettingsAction =
  | { type: 'tab'; targetTab: ActiveTab }
  | { type: 'refresh_settings' }
  | { type: 'browser_reload' }
  | { type: 'lock_settings' };

interface SettingsViewProps {
  settings: AppSettings;
  adminToken: string;
  adminUsername: string;
  onSettingsUpdated: (updated: AppSettings) => void;
  pendingNavigation: PendingSettingsAction | null;
  onClearPendingNavigation: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onProceedToTab: (tab: ActiveTab) => void;
  onBackToDispatch: () => void;
  onOpenAuditLogs: () => void;
  onLogout: () => void;
  onAuthExpired: () => void;
}

export function SettingsView({
  settings,
  adminToken,
  adminUsername,
  onSettingsUpdated,
  pendingNavigation,
  onClearPendingNavigation,
  onDirtyChange,
  onProceedToTab,
  onBackToDispatch,
  onOpenAuditLogs,
  onLogout,
  onAuthExpired,
}: SettingsViewProps) {
  const [form, setForm] = useState<AppSettings>({ ...settings, smtpPass: '' });
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const [localPendingAction, setLocalPendingAction] = useState<PendingSettingsAction | null>(null);
  const [refreshingSettings, setRefreshingSettings] = useState(false);

  const [testingSmtp, setTestingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [qrData, setQrData] = useState<WhatsAppQrData | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const [runtimeInfo, setRuntimeInfo] = useState<SystemRuntimeInfo | null>(null);
  const [testingGo, setTestingGo] = useState(false);
  const [goTestResult, setGoTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [templatesExpanded, setTemplatesExpanded] = useState(false);
  const [activeTemplateField, setActiveTemplateField] = useState<'subject' | 'whatsapp'>('whatsapp');
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const whatsappTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setForm({ ...settings, smtpPass: '' });
  }, [settings]);

  const isDirty = useMemo(() => {
    return (
      form.smtpHost !== settings.smtpHost ||
      String(form.smtpPort) !== String(settings.smtpPort) ||
      form.smtpSecurity !== settings.smtpSecurity ||
      form.smtpUser !== settings.smtpUser ||
      Boolean(form.smtpPass && form.smtpPass.length > 0) ||
      form.smtpFrom !== settings.smtpFrom ||
      form.emailEnabled !== settings.emailEnabled ||
      form.whatsappEnabled !== settings.whatsappEnabled ||
      form.deliveryMode !== settings.deliveryMode ||
      form.whatsappBridgeUrl !== settings.whatsappBridgeUrl ||
      form.whatsappDeviceName !== settings.whatsappDeviceName ||
      form.filenameTemplate !== settings.filenameTemplate ||
      form.passwordMode !== settings.passwordMode ||
      form.portalUrl !== settings.portalUrl ||
      form.previewBeforeDispatch !== settings.previewBeforeDispatch ||
      form.emailSubjectTemplate !== settings.emailSubjectTemplate ||
      form.whatsappMessageTemplate !== settings.whatsappMessageTemplate ||
      Boolean(form.goServiceEnabled) !== Boolean(settings.goServiceEnabled) ||
      (form.goServiceUrl ?? 'http://127.0.0.1:8080') !== (settings.goServiceUrl ?? 'http://127.0.0.1:8080')
    );
  }, [form, settings]);

  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  const activePendingAction = pendingNavigation ?? localPendingAction;

  // Guard native browser reload/tab close and Ctrl/Cmd+R or F5 when unsaved edits exist
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const isReloadKey =
        e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r');
      if (isReloadKey) {
        e.preventDefault();
        setLocalPendingAction({ type: 'browser_reload' });
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDirty]);

  const isPaired = qrData ? qrData.paired : form.whatsappPaired;

  const loadQr = useCallback(
    async (refresh = false) => {
      setLoadingQr(true);
      try {
        const res = await fetch(refresh ? '/api/whatsapp/qr?refresh=1' : '/api/whatsapp/qr', {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (res.status === 401) {
          onAuthExpired();
          return;
        }
        if (!res.ok) throw new Error('Unable to load WhatsApp QR code');
        const data = (await res.json()) as WhatsAppQrData & { settings?: AppSettings };
        setQrData(data);
        if (data.settings && data.settings.whatsappPaired !== settings.whatsappPaired) {
          onSettingsUpdated(data.settings);
        }
        if (refresh) {
          toast.success('WhatsApp QR refreshed', 'Scan the new QR code using WhatsApp Linked Devices.');
        }
      } catch {
        setQrData(null);
        if (refresh) {
          toast.error('QR refresh failed', 'Could not fetch a new WhatsApp QR code from server.');
        }
      } finally {
        setLoadingQr(false);
      }
    },
    [adminToken, onAuthExpired, onSettingsUpdated, settings.whatsappPaired]
  );

  const loadRuntime = useCallback(async () => {
    try {
      const res = await fetch('/api/system/runtime', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as SystemRuntimeInfo;
      if (data && data.ok) {
        setRuntimeInfo(data);
      }
    } catch {
      // Ignore transient runtime probe errors
    }
  }, [adminToken]);

  useEffect(() => {
    loadQr(false);
    loadRuntime();
  }, [loadQr, loadRuntime]);

  // Poll /api/whatsapp/status every 5 seconds while device is not yet paired
  useEffect(() => {
    if (isPaired) return;

    let cancelled = false;
    const pollStatus = async () => {
      try {
        const res = await fetch('/api/whatsapp/status', {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (res.status === 401) {
          if (!cancelled) onAuthExpired();
          return;
        }
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as WhatsAppQrData & { settings?: AppSettings };
        if (cancelled) return;
        setQrData(data);
        if (data.paired) {
          if (data.settings) {
            onSettingsUpdated(data.settings);
          }
          setForm((prev) => ({ ...prev, whatsappPaired: true }));
          toast.success(
            'WhatsApp device paired',
            'Linked device session confirmed and stored in SQLite.'
          );
        }
      } catch {
        // Keep polling quietly on transient network blips
      }
    };

    const timer = setInterval(pollStatus, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [adminToken, isPaired, onAuthExpired, onSettingsUpdated]);

  const persistFormSettings = async (): Promise<boolean> => {
    setSaving(true);
    setSaveNotice('');
    setSaveError('');

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(form),
      });
      if (res.status === 401) {
        onAuthExpired();
        return false;
      }
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const msg = data.error || 'Failed to save settings.';
        setSaveError(msg);
        toast.error('Failed to save configuration', msg);
        return false;
      } else {
        onSettingsUpdated(data.settings);
        setForm({ ...data.settings, smtpPass: '' });
        void loadRuntime();
        const msg = 'System configuration saved to SQLite database.';
        setSaveNotice(msg);
        toast.success('Settings saved', msg);
        if (!form.emailEnabled && !form.whatsappEnabled) {
          toast.warning(
            'All dispatch channels disabled',
            'Staff cannot send statements until Email or WhatsApp is enabled.'
          );
        } else if (form.deliveryMode === 'live' && form.whatsappEnabled && !isPaired) {
          toast.warning(
            'WhatsApp device not yet paired',
            'Scan the WhatsApp QR code before sending live WhatsApp statements.'
          );
        }
        setTimeout(() => setSaveNotice(''), 4000);
        return true;
      }
    } catch {
      const msg = 'Network error saving settings.';
      setSaveError(msg);
      toast.error('Network error', msg);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await persistFormSettings();
  };

  const executeSettingsRefresh = async () => {
    setRefreshingSettings(true);
    try {
      const res = await fetch('/api/settings', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.status === 401) {
        onAuthExpired();
        return;
      }
      const data = (await res.json()) as AppSettings;
      if (data && typeof data.smtpHost === 'string') {
        onSettingsUpdated(data);
        setForm({ ...data, smtpPass: '' });
      }
      await loadQr(false);
      await loadRuntime();
      toast.success('Settings refreshed', 'Loaded latest saved configuration from SQLite.');
    } catch {
      toast.error('Refresh failed', 'Unable to reload settings from server.');
    } finally {
      setRefreshingSettings(false);
    }
  };

  const handleRefreshButtonClick = () => {
    if (isDirty) {
      setLocalPendingAction({ type: 'refresh_settings' });
    } else {
      executeSettingsRefresh();
    }
  };

  const handleBackToDispatchClick = () => {
    if (isDirty) {
      setLocalPendingAction({ type: 'tab', targetTab: 'dispatch' });
    } else {
      onBackToDispatch();
    }
  };

  const handleLockButtonClick = () => {
    if (isDirty) {
      setLocalPendingAction({ type: 'lock_settings' });
    } else {
      onLogout();
    }
  };

  const handleTestGoService = async () => {
    setTestingGo(true);
    setGoTestResult(null);
    try {
      const res = await fetch('/api/system/test-go', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ goServiceUrl: form.goServiceUrl || 'http://127.0.0.1:8080' }),
      });
      if (res.status === 401) {
        onAuthExpired();
        return;
      }
      const data = await res.json();
      const ok = Boolean(data.ok);
      const text = ok ? data.message : data.error || 'Go service connection test failed.';
      setGoTestResult({ ok, text });
      if (ok) {
        toast.success('Go service reachable', text);
        await loadRuntime();
      } else {
        toast.error('Go service test failed', text);
      }
    } catch {
      const text = 'Unable to reach server to test Go service.';
      setGoTestResult({ ok: false, text });
      toast.error('Go service test failed', text);
    } finally {
      setTestingGo(false);
    }
  };

  const clearPendingModal = () => {
    setLocalPendingAction(null);
    onClearPendingNavigation();
  };

  const executePendingAction = async (action: PendingSettingsAction) => {
    clearPendingModal();
    if (action.type === 'tab') {
      onProceedToTab(action.targetTab);
    } else if (action.type === 'refresh_settings') {
      await executeSettingsRefresh();
    } else if (action.type === 'browser_reload') {
      window.location.reload();
    } else if (action.type === 'lock_settings') {
      onLogout();
    }
  };

  const handleSaveAndProceed = async () => {
    if (!activePendingAction) return;
    const saved = await persistFormSettings();
    if (saved) {
      await executePendingAction(activePendingAction);
    }
  };

  const handleIgnoreAndProceed = async () => {
    if (!activePendingAction) return;
    setForm({ ...settings, smtpPass: '' });
    onDirtyChange(false);
    toast.warning('Unsaved changes discarded', 'Reverted to last saved SQLite configuration.');
    await executePendingAction(activePendingAction);
  };

  const handleTestSmtp = async () => {
    setTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      const res = await fetch('/api/settings/test-smtp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(form),
      });
      if (res.status === 401) {
        onAuthExpired();
        return;
      }
      const data = await res.json();
      const ok = Boolean(data.ok);
      const text = ok ? data.message : data.error || 'SMTP test failed.';
      setSmtpTestResult({ ok, text });
      if (ok) {
        toast.success('SMTP connection verified', text);
      } else {
        toast.error('SMTP test failed', text);
      }
    } catch {
      const text = 'Unable to reach server to test SMTP.';
      setSmtpTestResult({ ok: false, text });
      toast.error('SMTP test failed', text);
    } finally {
      setTestingSmtp(false);
    }
  };

  const handleUnlinkDevice = async () => {
    setUnlinking(true);
    try {
      const res = await fetch('/api/whatsapp/unlink', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.status === 401) {
        onAuthExpired();
        return;
      }
      const data = await res.json();
      if (res.ok && data.ok) {
        if (data.qrData) setQrData(data.qrData);
        if (data.settings) onSettingsUpdated(data.settings);
        setForm((prev) => ({ ...prev, whatsappPaired: false }));
        toast.warning(
          'WhatsApp paired device removed',
          'Scan a new QR code from WhatsApp Linked Devices to reconnect.'
        );
      } else {
        toast.error('Failed to remove device', data.error || 'Unable to unlink WhatsApp session.');
      }
    } catch {
      toast.error('Network error', 'Unable to reach server to remove paired WhatsApp device.');
    } finally {
      setUnlinking(false);
    }
  };

  const insertPlaceholder = (token: string) => {
    if (activeTemplateField === 'subject') {
      const input = subjectInputRef.current;
      const current = form.emailSubjectTemplate;
      const start = input?.selectionStart ?? current.length;
      const end = input?.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);
      setForm((prev) => ({ ...prev, emailSubjectTemplate: next }));
      window.requestAnimationFrame(() => {
        if (input) {
          input.focus();
          input.setSelectionRange(start + token.length, start + token.length);
        }
      });
    } else {
      const textarea = whatsappTextareaRef.current;
      const current = form.whatsappMessageTemplate;
      const start = textarea?.selectionStart ?? current.length;
      const end = textarea?.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);
      setForm((prev) => ({ ...prev, whatsappMessageTemplate: next }));
      window.requestAnimationFrame(() => {
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(start + token.length, start + token.length);
        }
      });
    }
  };

  const qrDataUri = qrData?.qrSvg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrData.qrSvg)}`
    : '';

  return (
    <div className="py-4 sm:py-8 space-y-6">
      <div>
        <button
          type="button"
          onClick={handleBackToDispatchClick}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 -ml-2.5 rounded-md text-xs font-semibold text-slate-600 hover:text-[#0F2437] hover:bg-slate-100/80 transition-colors cursor-pointer whitespace-nowrap"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to Service Desk</span>
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.16em] text-[#1E6B34] uppercase">
            NSSF DIGITAL STATEMENT DISPATCH
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-[#0F2437] tracking-tight">
              SETTINGS
            </h1>
	    
            {isDirty && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded">
                Unsaved changes
              </span>
            )}
          </div>
            <p className="text-sm text-slate-600 mt-1">
              Signed in as <strong className="text-[#0F2437]">{adminUsername}</strong> · Configure Email (SMTP), pair WhatsApp, manage Go service integration, and templates.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleRefreshButtonClick}
              disabled={refreshingSettings}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-[#D1D9E0] bg-white text-xs font-bold tracking-wider uppercase text-[#0F2437] hover:bg-slate-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingSettings ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{refreshingSettings ? 'Refreshing...' : 'Refresh Settings'}</span>
            </button>

            <button
              type="button"
              onClick={handleLockButtonClick}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-slate-300 bg-white text-xs font-bold tracking-wider uppercase text-slate-700 hover:border-red-300 hover:text-red-700 hover:bg-red-50/60 cursor-pointer whitespace-nowrap transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Lock Settings</span>
            </button>
          </div>
        </div>

      {saveNotice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3.5 flex items-center gap-2 text-sm text-[#006837] font-medium">
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{saveNotice}</span>
        </div>
      )}

      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3.5 flex items-center gap-2 text-sm text-red-800 font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{saveError}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Channel Activation & Delivery Mode */}
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <h2 className="font-display text-base font-semibold text-[#006837] border-b border-slate-100 pb-2.5">
            Channel Availability, Preview &amp; Delivery Mode
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <label className="flex items-start gap-3 p-4 rounded-md border border-slate-200 cursor-pointer hover:border-slate-300">
              <input
                type="checkbox"
                checked={form.emailEnabled}
                onChange={(e) => setForm({ ...form, emailEnabled: e.target.checked })}
                className="mt-1 h-4 w-4 accent-[#006837]"
              />
              <div>
                <div className="text-sm font-semibold text-slate-900">Enable Email (SMTP)</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Allow staff to dispatch protected statements to member email addresses.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 p-4 rounded-md border border-slate-200 cursor-pointer hover:border-slate-300">
              <input
                type="checkbox"
                checked={form.whatsappEnabled}
                onChange={(e) => setForm({ ...form, whatsappEnabled: e.target.checked })}
                className="mt-1 h-4 w-4 accent-[#006837]"
              />
              <div>
                <div className="text-sm font-semibold text-slate-900">Enable WhatsApp</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Allow staff to send encrypted PDF statements to member WhatsApp numbers.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 p-4 rounded-md border border-slate-200 cursor-pointer hover:border-slate-300">
              <input
                type="checkbox"
                checked={form.previewBeforeDispatch}
                onChange={(e) => setForm({ ...form, previewBeforeDispatch: e.target.checked })}
                className="mt-1 h-4 w-4 accent-[#006837]"
              />
              <div>
                <div className="text-sm font-semibold text-slate-900">Pre-Send Preview Modal</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Allow staff to view parsed details and PDF preview before sending.
                </div>
              </div>
            </label>

            <div className="p-4 rounded-md border border-slate-200 space-y-2">
              <label htmlFor="delivery-mode" className="block text-sm font-semibold text-slate-900">
                Dispatch Mode
              </label>
              <select
                id="delivery-mode"
                value={form.deliveryMode}
                onChange={(e) =>
                  setForm({ ...form, deliveryMode: e.target.value as AppSettings['deliveryMode'] })
                }
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 text-xs font-medium text-slate-800 focus:outline-none focus:border-[#006837]"
              >
                <option value="preview">Service Desk Preview &amp; Package (Local)</option>
                <option value="live">Live SMTP &amp; WhatsApp Gateway</option>
              </select>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* SMTP Configuration */}
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-[#006837]" aria-hidden="true" />
                <h2 className="font-display text-base font-semibold text-[#006837]">
                  Official NSSF SMTP Settings
                </h2>
              </div>
              <button
                type="button"
                onClick={handleTestSmtp}
                disabled={testingSmtp}
                className="px-3 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {testingSmtp ? 'Testing...' : 'Test SMTP Connection'}
              </button>
            </div>

            {smtpTestResult && (
              <div
                className={`p-3 rounded-md text-xs flex items-start gap-2 border ${
                  smtpTestResult.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {smtpTestResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                )}
                <span>{smtpTestResult.text}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
              <div className="sm:col-span-3">
                <label htmlFor="smtp-host" className="block text-xs font-medium text-slate-700 mb-1">
                  SMTP Host
                </label>
                <input
                  id="smtp-host"
                  value={form.smtpHost}
                  onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-[#006837]"
                />
              </div>

              <div className="sm:col-span-1">
                <label htmlFor="smtp-port" className="block text-xs font-medium text-slate-700 mb-1">
                  Port
                </label>
                <input
                  id="smtp-port"
                  value={form.smtpPort}
                  onChange={(e) => setForm({ ...form, smtpPort: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm font-mono tabular-nums focus:outline-none focus:border-[#006837]"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="smtp-sec" className="block text-xs font-medium text-slate-700 mb-1">
                  Encryption
                </label>
                <select
                  id="smtp-sec"
                  value={form.smtpSecurity}
                  onChange={(e) =>
                    setForm({ ...form, smtpSecurity: e.target.value as AppSettings['smtpSecurity'] })
                  }
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-[#006837]"
                >
                  <option value="starttls">STARTTLS (587)</option>
                  <option value="tls">SSL / TLS (465)</option>
                  <option value="none">Plain (25)</option>
                </select>
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="smtp-user" className="block text-xs font-medium text-slate-700 mb-1">
                  SMTP Username
                </label>
                <input
                  id="smtp-user"
                  value={form.smtpUser}
                  onChange={(e) => setForm({ ...form, smtpUser: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-[#006837]"
                />
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="smtp-pass" className="block text-xs font-medium text-slate-700 mb-1">
                  SMTP Password {form.hasSmtpPass ? '(Stored in SQLite)' : ''}
                </label>
                <input
                  id="smtp-pass"
                  type="password"
                  placeholder={form.hasSmtpPass ? 'Leave blank to keep saved password' : 'Enter SMTP password'}
                  value={form.smtpPass || ''}
                  onChange={(e) => setForm({ ...form, smtpPass: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-[#006837]"
                />
              </div>

              <div className="sm:col-span-6">
                <label htmlFor="smtp-from" className="block text-xs font-medium text-slate-700 mb-1">
                  Sender Display Header (From)
                </label>
                <input
                  id="smtp-from"
                  value={form.smtpFrom}
                  onChange={(e) => setForm({ ...form, smtpFrom: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-[#006837]"
                />
              </div>
            </div>
          </section>

          {/* WhatsApp QR Setup OR Remove WhatsApp Paired Device (SQLite backed) */}
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
                  {/* Static QR Code box — untouched by any animations so scanners read cleanly */}
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
                          {qrData.bridgeReachable && qrDataUri
                            ? 'Connected to WhatsApp Web · Scan with Linked Devices'
                            : 'WhatsApp Web gateway not connected yet'}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => loadQr(true)}
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
                      Remove WhatsApp Paired Device
                    </h2>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#006837]">
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Connected</span>
                  </span>
                </div>

                <div className="border border-emerald-200 bg-emerald-50/50 rounded-md p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-md bg-[#2B7A3B] text-white flex items-center justify-center shrink-0">
                      <Smartphone className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <div className="text-xs space-y-1 min-w-0">
                      <div className="font-bold text-[#0F2437] text-sm truncate">
                        {qrData?.deviceName || form.whatsappDeviceName}
                      </div>
                      <div className="text-slate-600">
                        Active WhatsApp session linked and stored in SQLite.
                      </div>
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
                        {qrData?.pairedPhone || qrData?.pairedAt || 'Active'}
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleUnlinkDevice}
                  disabled={unlinking}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border border-red-300 bg-white text-xs font-bold uppercase tracking-wider text-red-700 hover:bg-red-50 disabled:opacity-50 cursor-pointer transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {unlinking ? 'Removing Paired Device...' : 'Remove WhatsApp Paired Device'}
                  </span>
                </button>
              </>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
              <div>
                <label htmlFor="wa-bridge" className="block text-xs font-medium text-slate-700 mb-1">
                  WhatsApp Gateway URL
                </label>
                <input
                  id="wa-bridge"
                  value={form.whatsappBridgeUrl}
                  onChange={(e) => setForm({ ...form, whatsappBridgeUrl: e.target.value })}
                  className="w-full px-3 py-1.5 rounded border border-slate-300 text-xs font-mono focus:outline-none focus:border-[#006837]"
                />
              </div>
              <div>
                <label htmlFor="wa-device" className="block text-xs font-medium text-slate-700 mb-1">
                  Desk Device Label
                </label>
                <input
                  id="wa-device"
                  value={form.whatsappDeviceName}
                  onChange={(e) => setForm({ ...form, whatsappDeviceName: e.target.value })}
                  className="w-full px-3 py-1.5 rounded border border-slate-300 text-xs focus:outline-none focus:border-[#006837]"
                />
              </div>
            </div>
          </section>
        </div>

        {/* App Defaults & Packaging Info */}
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <Server className="w-4 h-4 text-[#006837]" aria-hidden="true" />
            <h2 className="font-display text-base font-semibold text-[#006837]">
              Document Defaults &amp; Embedded Go Binary Packaging
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="filename-tpl" className="block text-xs font-medium text-slate-700 mb-1">
                Renamed Attachment Pattern
              </label>
              <input
                id="filename-tpl"
                value={form.filenameTemplate}
                onChange={(e) => setForm({ ...form, filenameTemplate: e.target.value })}
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm font-mono focus:outline-none focus:border-[#006837]"
              />
            </div>

            <div>
              <label htmlFor="pwd-mode" className="block text-xs font-medium text-slate-700 mb-1">
                PDF Password Credential
              </label>
              <select
                id="pwd-mode"
                value={form.passwordMode}
                onChange={(e) =>
                  setForm({ ...form, passwordMode: e.target.value as AppSettings['passwordMode'] })
                }
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-[#006837]"
              >
                <option value="id_card">Member National ID Card Number</option>
                <option value="id_and_nssf_last4">National ID + Last 4 of NSSF No</option>
              </select>
            </div>

            <div>
              <label htmlFor="portal-url" className="block text-xs font-medium text-slate-700 mb-1">
                NSSF Digital Portal URL
              </label>
              <input
                id="portal-url"
                value={form.portalUrl}
                onChange={(e) => setForm({ ...form, portalUrl: e.target.value })}
                className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-[#006837]"
              />
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-md p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="text-xs text-slate-600">
                <strong className="text-slate-800">Go Backend Service Integration:</strong>{' '}
                Run the standalone Go server in <code className="text-[#006837]">go/cmd/server</code> for native PDF validation, encryption, and dispatch, or proxy requests to it from the Node.js workspace.
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider border ${
                    runtimeInfo?.activeEngine === 'go'
                      ? 'bg-emerald-50 text-[#1E6B34] border-emerald-200'
                      : runtimeInfo?.activeEngine === 'go-proxy'
                        ? runtimeInfo.goServiceReachable
                          ? 'bg-emerald-50 text-[#1E6B34] border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  Engine:{' '}
                  {runtimeInfo?.activeEngine === 'go'
                    ? 'Go Standalone'
                    : runtimeInfo?.activeEngine === 'go-proxy'
                      ? runtimeInfo.goServiceReachable
                        ? 'Go Proxy (Connected)'
                        : 'Go Proxy (Fallback to Node)'
                      : 'Node.js'}
                </span>
              </div>
            </div>

            {runtimeInfo?.activeEngine !== 'go' && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pt-2 border-t border-slate-200">
                <label className="md:col-span-5 flex items-start gap-2.5 p-2.5 rounded border border-slate-200 bg-white cursor-pointer hover:border-slate-300">
                  <input
                    type="checkbox"
                    checked={Boolean(form.goServiceEnabled)}
                    onChange={(e) => setForm({ ...form, goServiceEnabled: e.target.checked })}
                    className="mt-0.5 h-4 w-4 accent-[#006837]"
                  />
                  <div className="text-xs">
                    <div className="font-semibold text-slate-900">Delegate Dispatch to Go Service</div>
                    <div className="text-slate-500">
                      Proxy validate, encrypt &amp; send operations to Go backend
                    </div>
                  </div>
                </label>

                <div className="md:col-span-5">
                  <label htmlFor="go-service-url" className="block text-xs font-medium text-slate-700 mb-1">
                    Go Service Base URL
                  </label>
                  <input
                    id="go-service-url"
                    value={form.goServiceUrl ?? 'http://127.0.0.1:8080'}
                    onChange={(e) => setForm({ ...form, goServiceUrl: e.target.value })}
                    placeholder="http://127.0.0.1:8080"
                    className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-xs font-mono focus:outline-none focus:border-[#006837]"
                  />
                </div>

                <div className="md:col-span-2">
                  <button
                    type="button"
                    onClick={handleTestGoService}
                    disabled={testingGo}
                    className="w-full py-2 px-3 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                  >
                    {testingGo ? 'Testing...' : 'Test Go'}
                  </button>
                </div>
              </div>
            )}

            {goTestResult && (
              <div
                className={`p-2.5 rounded border text-xs flex items-center gap-2 ${
                  goTestResult.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {goTestResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                )}
                <span>{goTestResult.text}</span>
              </div>
            )}
          </div>
        </section>

        {/* Templates Section: Compact summary with "Edit Templates" toggle to save space */}
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2.5">
              <FileText className="w-4 h-4 text-[#006837]" aria-hidden="true" />
              <div>
                <h2 className="font-display text-base font-semibold text-[#006837]">
                  Templates
                </h2>
                <p className="text-xs text-slate-500">
                  Customize email subject line and WhatsApp message body with dynamic placeholders.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setTemplatesExpanded((prev) => !prev)}
              aria-expanded={templatesExpanded}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold uppercase tracking-wider border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                templatesExpanded
                  ? 'border-slate-300 bg-slate-50 text-[#0F2437] hover:bg-slate-100'
                  : 'border-[#2B7A3B] bg-white text-[#1E6B34] hover:bg-emerald-50'
              }`}
            >
              {templatesExpanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Hide Template Editor</span>
                </>
              ) : (
                <>
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Edit Templates</span>
                </>
              )}
            </button>
          </div>

          {!templatesExpanded && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
                <div className="font-semibold text-slate-700 mb-1">Email Subject Line</div>
                <div className="font-mono text-[#0F2437] truncate">
                  {form.emailSubjectTemplate || DEFAULT_EMAIL_SUBJECT_TEMPLATE}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
                <div className="font-semibold text-slate-700 mb-1">WhatsApp Message Body</div>
                <div className="font-mono text-[#0F2437] truncate">
                  {(form.whatsappMessageTemplate || DEFAULT_WHATSAPP_MESSAGE_TEMPLATE)
                    .split('\n')
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(' · ')}
                </div>
              </div>
            </div>
          )}

          <AnimatePresence initial={false}>
            {templatesExpanded && (
              <motion.div
                key="templates-editor"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <div className="space-y-5 pt-1">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-600">Dynamic Placeholders</span>
                    <span className="text-xs text-slate-500">
                      Click any chip to insert into{' '}
                      <strong className="text-[#0F2437]">
                        {activeTemplateField === 'subject'
                          ? 'Email Subject Line'
                          : 'WhatsApp Message Body'}
                      </strong>
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {TEMPLATE_PLACEHOLDERS.map((item) => (
                      <button
                        key={item.token}
                        type="button"
                        onClick={() => insertPlaceholder(item.token)}
                        title={`Insert ${item.token} (${item.label})`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-200 bg-slate-50 hover:border-[#2B7A3B] hover:bg-emerald-50 text-xs transition-colors cursor-pointer"
                      >
                        <code className="font-mono font-semibold text-[#1E6B34]">{item.token}</code>
                        <span className="text-[11px] text-slate-500">{item.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Email Subject Line Template */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="email-subject-tpl"
                        className="block text-xs font-semibold text-slate-800"
                      >
                        Email Subject Line Template
                      </label>
                      {form.emailSubjectTemplate !== DEFAULT_EMAIL_SUBJECT_TEMPLATE && (
                        <button
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              emailSubjectTemplate: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
                            })
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-[#2B7A3B] cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" aria-hidden="true" />
                          <span>Reset Default</span>
                        </button>
                      )}
                    </div>
                    <input
                      ref={subjectInputRef}
                      id="email-subject-tpl"
                      value={form.emailSubjectTemplate}
                      onFocus={() => setActiveTemplateField('subject')}
                      onChange={(e) =>
                        setForm({ ...form, emailSubjectTemplate: e.target.value })
                      }
                      placeholder={DEFAULT_EMAIL_SUBJECT_TEMPLATE}
                      className="w-full px-3.5 py-2.5 rounded-md border border-slate-300 text-sm font-mono text-[#0F2437] focus:outline-none focus:border-[#006837]"
                    />
                    <div className="bg-slate-50 border border-slate-200 rounded px-3 py-2 text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">Subject Preview: </span>
                      <span className="text-[#0F2437]">
                        {renderPreviewTemplate(
                          form.emailSubjectTemplate.trim() || DEFAULT_EMAIL_SUBJECT_TEMPLATE,
                          form.portalUrl,
                          true
                        )}
                      </span>
                    </div>
                  </div>

                  {/* WhatsApp Message Body Template */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="whatsapp-body-tpl"
                          className="block text-xs font-semibold text-slate-800"
                        >
                          WhatsApp Message Body Template
                        </label>
                        {form.whatsappMessageTemplate !== DEFAULT_WHATSAPP_MESSAGE_TEMPLATE && (
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                whatsappMessageTemplate: DEFAULT_WHATSAPP_MESSAGE_TEMPLATE,
                              })
                            }
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-[#2B7A3B] cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" aria-hidden="true" />
                            <span>Reset Default</span>
                          </button>
                        )}
                      </div>
                      <textarea
                        ref={whatsappTextareaRef}
                        id="whatsapp-body-tpl"
                        rows={8}
                        value={form.whatsappMessageTemplate}
                        onFocus={() => setActiveTemplateField('whatsapp')}
                        onChange={(e) =>
                          setForm({ ...form, whatsappMessageTemplate: e.target.value })
                        }
                        placeholder={DEFAULT_WHATSAPP_MESSAGE_TEMPLATE}
                        className="w-full px-3.5 py-2.5 rounded-md border border-slate-300 text-xs font-mono leading-relaxed text-[#0F2437] focus:outline-none focus:border-[#006837]"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-800">
                        WhatsApp Caption Preview (Sample Member)
                      </div>
                      <pre className="p-3.5 rounded-md border border-emerald-200 bg-emerald-50/40 text-xs font-sans text-[#0F2437] whitespace-pre-wrap leading-relaxed min-h-[196px]">
                        {renderPreviewTemplate(
                          form.whatsappMessageTemplate.trim() || DEFAULT_WHATSAPP_MESSAGE_TEMPLATE,
                          form.portalUrl,
                          false
                        )}
                      </pre>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Compliance & Audit Logs Link Section */}
        <section className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-md bg-emerald-50 border border-emerald-200 text-[#1E6B34] flex items-center justify-center shrink-0 mt-0.5">
                <ClipboardList className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-display text-base font-semibold text-[#006837]">
                  Compliance &amp; Audit Logs
                </h2>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                  Review statement validation checks, encryption records, delivery history, and export CSV or MS-Excel compliance reports.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenAuditLogs}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded border border-[#2B7A3B] bg-white text-xs font-bold tracking-wider uppercase text-[#1E6B34] hover:bg-emerald-50 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
            >
              <span>View Audit Logs</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-8 h-12 rounded bg-[#2B7A3B] text-white text-xs font-bold tracking-[0.16em] uppercase hover:bg-[#226430] disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <Save className="w-4 h-4" aria-hidden="true" />
            <span>{saving ? 'SAVING TO SQLITE...' : 'SAVE SYSTEM CONFIGURATION'}</span>
          </button>
        </div>
      </form>

      {/* Unsaved Settings Changes Confirmation Dialog */}
      <AnimatePresence>
        {activePendingAction && (
          <motion.div
            key="unsaved-settings-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onClick={clearPendingModal}
            className="fixed inset-0 z-50 bg-[#0F2437]/55 backdrop-blur-[2px] flex items-center justify-center p-4"
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="unsaved-settings-title"
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-[0_20px_50px_rgba(15,36,55,0.24)] overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <h2 id="unsaved-settings-title" className="font-display text-base font-bold text-[#0F2437]">
                    Unsaved Settings Changes
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={clearPendingModal}
                  aria-label="Cancel and stay on settings"
                  className="p-1.5 rounded text-slate-400 hover:text-[#0F2437] hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="px-5 py-4 text-sm text-slate-600 leading-relaxed">
                You have modified system configuration settings that have not been saved to SQLite yet. Save your changes before{' '}
                {activePendingAction.type === 'tab'
                  ? `navigating to ${activePendingAction.targetTab === 'dispatch' ? 'Service Desk' : 'Audit Logs'}`
                  : activePendingAction.type === 'lock_settings'
                    ? 'locking System Settings'
                    : 'refreshing settings'}
                , or discard them to continue?
              </div>

              <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={clearPendingModal}
                  className="px-3.5 py-2 rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleIgnoreAndProceed}
                  className="px-3.5 py-2 rounded border border-red-200 bg-white text-xs font-bold text-red-700 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                >
                  Ignore Changes &amp; Proceed
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveAndProceed}
                  className="px-4 py-2 rounded bg-[#2B7A3B] text-white text-xs font-bold hover:bg-[#226430] cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save & Proceed'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
