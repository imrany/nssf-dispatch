import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Lock,
  Mail,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type {
  AppSettings,
  PendingSettingsAction,
  SystemRuntimeInfo,
  SystemUpdateStatus,
  WhatsAppQrData,
} from '../types';
import {
  ApiError,
  applySelfUpdateApi,
  checkForUpdatesApi,
  fetchHealthApi,
  fetchRuntimeApi,
  fetchSettingsApi,
  fetchUpdateStatusApi,
  fetchWhatsAppQrApi,
  fetchWhatsAppStatusApi,
  reconnectWhatsAppApi,
  saveSettingsApi,
  testSmtpApi,
  unlinkWhatsAppApi,
} from '../utils/api';
import { ROUTES } from '../utils/constants';
import { toast } from './Toaster';
import { SectionSaveBar } from './settings/SectionSaveBar';
import { SystemUpdatesSection } from './settings/SystemUpdatesSection';
import { TemplatesSection } from './settings/TemplatesSection';
import { UnsavedChangesModal } from './settings/UnsavedChangesModal';
import { WhatsAppGatewayCard } from './settings/WhatsAppGatewayCard';
import { AlertBanner, BackButton, PageHeader } from './ui';

export function SettingsView() {
  const {
    settings,
    setSettings,
    adminToken,
    adminUsername,
    pendingNavigation,
    setPendingNavigation,
    setSettingsDirty,
    navigateTo,
    logoutAdmin,
  } = useApp();

  const token = adminToken || '';
  const displayUser = adminUsername || 'admin';

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
  const [reconnecting, setReconnecting] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<SystemRuntimeInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<SystemUpdateStatus | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [restartingApp, setRestartingApp] = useState(false);

  useEffect(() => {
    setForm({ ...settings, smtpPass: '' });
  }, [settings]);

  const sectionDirty = useMemo(() => {
    return {
      channels:
        form.emailEnabled !== settings.emailEnabled ||
        form.whatsappEnabled !== settings.whatsappEnabled ||
        form.previewBeforeDispatch !== settings.previewBeforeDispatch,
      smtp:
        form.smtpHost !== settings.smtpHost ||
        String(form.smtpPort) !== String(settings.smtpPort) ||
        form.smtpSecurity !== settings.smtpSecurity ||
        form.smtpUser !== settings.smtpUser ||
        Boolean(form.smtpPass && form.smtpPass.length > 0) ||
        form.smtpFrom !== settings.smtpFrom,
      whatsapp: form.whatsappDeviceName !== settings.whatsappDeviceName,
      defaults:
        form.filenameTemplate !== settings.filenameTemplate ||
        form.passwordMode !== settings.passwordMode ||
        form.portalUrl !== settings.portalUrl,
      templates:
        form.emailSubjectTemplate !== settings.emailSubjectTemplate ||
        form.whatsappMessageTemplate !== settings.whatsappMessageTemplate,
      updates:
        form.autoUpdateEnabled !== settings.autoUpdateEnabled ||
        form.updateRepo !== settings.updateRepo,
    };
  }, [form, settings]);

  const isDirty =
    sectionDirty.channels ||
    sectionDirty.smtp ||
    sectionDirty.whatsapp ||
    sectionDirty.defaults ||
    sectionDirty.templates ||
    sectionDirty.updates;

  const discardSection = (section: keyof typeof sectionDirty) => {
    setForm((prev) => {
      switch (section) {
        case 'channels':
          return {
            ...prev,
            emailEnabled: settings.emailEnabled,
            whatsappEnabled: settings.whatsappEnabled,
            previewBeforeDispatch: settings.previewBeforeDispatch,
          };
        case 'smtp':
          return {
            ...prev,
            smtpHost: settings.smtpHost,
            smtpPort: settings.smtpPort,
            smtpSecurity: settings.smtpSecurity,
            smtpUser: settings.smtpUser,
            smtpPass: '',
            smtpFrom: settings.smtpFrom,
          };
        case 'whatsapp':
          return {
            ...prev,
            whatsappDeviceName: settings.whatsappDeviceName,
          };
        case 'defaults':
          return {
            ...prev,
            filenameTemplate: settings.filenameTemplate,
            passwordMode: settings.passwordMode,
            portalUrl: settings.portalUrl,
          };
        case 'templates':
          return {
            ...prev,
            emailSubjectTemplate: settings.emailSubjectTemplate,
            whatsappMessageTemplate: settings.whatsappMessageTemplate,
          };
        case 'updates':
          return {
            ...prev,
            autoUpdateEnabled: settings.autoUpdateEnabled,
            updateRepo: settings.updateRepo,
          };
      }
    });
  };

  useEffect(() => {
    setSettingsDirty(isDirty);
    return () => setSettingsDirty(false);
  }, [isDirty, setSettingsDirty]);

  const activePendingAction = pendingNavigation ?? localPendingAction;

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
      if (!token) return;
      setLoadingQr(true);
      try {
        const data = await fetchWhatsAppQrApi(token, refresh);
        setQrData(data);
        if (data.settings && data.settings.whatsappPaired !== settings.whatsappPaired) {
          setSettings(data.settings);
        }
        if (refresh && data.qrSvg) {
          toast.success(
            'WhatsApp QR refreshed',
            'Scan the new QR code using WhatsApp Linked Devices.'
          );
        } else if (refresh && data.error) {
          toast.error('WhatsApp connection notice', data.error);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          logoutAdmin('expired');
          return;
        }
        const msg =
          err instanceof Error
            ? err.message
            : 'Could not fetch WhatsApp QR code from Go server.';
        setQrData((prev) => ({
          paired: prev?.paired ?? false,
          connected: false,
          bridgeReachable: false,
          sessionCode: prev?.sessionCode ?? 'N/A',
          qrSvg: '',
          deviceName: form.whatsappDeviceName,
          error: msg,
        }));
        if (refresh) {
          toast.error('QR refresh failed', msg);
        }
      } finally {
        setLoadingQr(false);
      }
    },
    [token, form.whatsappDeviceName, logoutAdmin, setSettings, settings.whatsappPaired]
  );

  const loadRuntime = useCallback(async () => {
    if (!token) return;
    try {
      const [rt, upd] = await Promise.all([
        fetchRuntimeApi(token).catch(() => null),
        fetchUpdateStatusApi(token).catch(() => null),
      ]);
      if (rt && rt.ok) {
        setRuntimeInfo(rt);
      }
      if (upd) {
        setUpdateStatus(upd);
      }
    } catch {
      // Ignore transient runtime probe errors
    }
  }, [token]);

  useEffect(() => {
    void loadQr(false);
    void loadRuntime();
  }, [loadQr, loadRuntime]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const pollStatus = async () => {
      try {
        const data = await fetchWhatsAppStatusApi(token);
        if (cancelled) return;
        setQrData(data);
        if (data.paired && !isPaired) {
          if (data.settings) setSettings(data.settings);
          setForm((prev) => ({ ...prev, whatsappPaired: true }));
          toast.success(
            'WhatsApp device paired',
            data.pairedPhone
              ? `Linked +${data.pairedPhone} via native whatsmeow client.`
              : 'Linked device session confirmed and stored.'
          );
        } else if (!data.paired && isPaired) {
          if (data.settings) setSettings(data.settings);
          setForm((prev) => ({ ...prev, whatsappPaired: false }));
          toast.warning(
            'WhatsApp device unlinked',
            'Session was disconnected from the phone. Scan a new QR code to re-link.'
          );
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401 && !cancelled) {
          logoutAdmin('expired');
        }
      }
    };

    const timer = setInterval(pollStatus, isPaired ? 15000 : 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, isPaired, logoutAdmin, setSettings]);

  const persistFormSettings = async (): Promise<boolean> => {
    setSaving(true);
    setSaveNotice('');
    setSaveError('');

    try {
      const data = await saveSettingsApi(token, form);
      setSettings(data.settings);
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
      } else if (form.whatsappEnabled && !isPaired) {
        toast.warning(
          'WhatsApp device not yet paired',
          'WhatsApp dispatch stays disabled on the Service Desk until a WhatsApp QR code is paired.'
        );
      } else if (form.emailEnabled && !data.settings.emailConfigured) {
        toast.warning(
          'SMTP credentials incomplete',
          'Email dispatch stays disabled on the Service Desk until SMTP host, username, and password are saved.'
        );
      }
      setTimeout(() => setSaveNotice(''), 4000);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logoutAdmin('expired');
        return false;
      }
      const msg = err instanceof Error ? err.message : 'Network error saving settings.';
      setSaveError(msg);
      toast.error('Failed to save configuration', msg);
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
      const data = await fetchSettingsApi(token);
      if (data && typeof data.smtpHost === 'string') {
        setSettings(data);
        setForm({ ...data, smtpPass: '' });
      }
      await loadQr(false);
      await loadRuntime();
      toast.success('Settings refreshed', 'Loaded latest saved configuration from SQLite.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logoutAdmin('expired');
        return;
      }
      toast.error('Refresh failed', 'Unable to reload settings from server.');
    } finally {
      setRefreshingSettings(false);
    }
  };

  const handleRefreshButtonClick = () => {
    if (isDirty) {
      setLocalPendingAction({ type: 'refresh_settings' });
    } else {
      void executeSettingsRefresh();
    }
  };

  const handleLockButtonClick = () => {
    if (isDirty) {
      setLocalPendingAction({ type: 'lock_settings' });
    } else {
      logoutAdmin('manual');
    }
  };

  const clearPendingModal = () => {
    setLocalPendingAction(null);
    setPendingNavigation(null);
  };

  const executePendingAction = async (action: PendingSettingsAction) => {
    clearPendingModal();
    if (action.type === 'route') {
      navigateTo(action.targetPath, { bypassDirtyCheck: true });
    } else if (action.type === 'refresh_settings') {
      await executeSettingsRefresh();
    } else if (action.type === 'browser_reload') {
      window.location.reload();
    } else if (action.type === 'lock_settings') {
      logoutAdmin('manual');
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
    setSettingsDirty(false);
    toast.warning('Unsaved changes discarded', 'Reverted to last saved SQLite configuration.');
    await executePendingAction(activePendingAction);
  };

  const handleTestSmtp = async () => {
    setTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      const data = await testSmtpApi(token, form);
      const text = data.message || 'SMTP connection verified.';
      setSmtpTestResult({ ok: true, text });
      toast.success('SMTP connection verified', text);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logoutAdmin('expired');
        return;
      }
      const text = err instanceof Error ? err.message : 'Unable to reach server to test SMTP.';
      setSmtpTestResult({ ok: false, text });
      toast.error('SMTP test failed', text);
    } finally {
      setTestingSmtp(false);
    }
  };

  const handleReconnectWhatsApp = async () => {
    setReconnecting(true);
    try {
      const data = await reconnectWhatsAppApi(token);
      if (data.qrData) setQrData(data.qrData);
      if (data.settings) setSettings(data.settings);
      if (data.qrData?.connected) {
        toast.success('WhatsApp connected', 'Native whatsmeow WebSocket is online.');
      } else {
        toast.warning(
          'WhatsApp reconnecting',
          data.qrData?.error || 'Connection attempt initiated.'
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logoutAdmin('expired');
        return;
      }
      toast.error(
        'Reconnect failed',
        err instanceof Error ? err.message : 'Unable to reconnect WhatsApp session.'
      );
    } finally {
      setReconnecting(false);
    }
  };

  const handleUnlinkDevice = async () => {
    setUnlinking(true);
    try {
      const data = await unlinkWhatsAppApi(token);
      if (data.qrData) setQrData(data.qrData);
      if (data.settings) setSettings(data.settings);
      setForm((prev) => ({ ...prev, whatsappPaired: false }));
      toast.warning(
        'WhatsApp paired device removed',
        'Scan a new QR code from WhatsApp Linked Devices to reconnect.'
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logoutAdmin('expired');
        return;
      }
      toast.error(
        'Failed to remove device',
        err instanceof Error ? err.message : 'Unable to unlink WhatsApp session.'
      );
    } finally {
      setUnlinking(false);
    }
  };

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const st = await checkForUpdatesApi(token);
      setUpdateStatus(st);
      if (st.state === 'error') {
        toast.error('Update check failed', st.message);
      } else if (st.updateAvailable) {
        toast.warning('New version available', st.message);
      } else if (st.state === 'unconfigured') {
        toast.warning('Update repository not configured', st.message);
      } else {
        toast.success('System is up to date', st.message);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logoutAdmin('expired');
        return;
      }
      toast.error(
        'Update check failed',
        err instanceof Error ? err.message : 'Unable to query GitHub Releases.'
      );
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleApplyUpdate = async () => {
    setApplyingUpdate(true);
    try {
      const res = await applySelfUpdateApi(token);
      setUpdateStatus(res.status);
      if (res.ok && res.status.restartScheduled) {
        setRestartingApp(true);
        toast.success(
          `Updated to v${res.status.latestVersion}`,
          'Restarting service and reloading portal...'
        );
        const deadline = Date.now() + 25000;
        const pollRestart = async () => {
          await new Promise((r) => setTimeout(r, 900));
          while (Date.now() < deadline) {
            try {
              const health = await fetchHealthApi();
              if (health.ok) {
                window.location.reload();
                return;
              }
            } catch {
              // Server restarting; retry shortly
            }
            await new Promise((r) => setTimeout(r, 700));
          }
          setRestartingApp(false);
          setApplyingUpdate(false);
          toast.warning('Restart taking longer than expected', 'Reload the page once the service restarts.');
        };
        void pollRestart();
        return;
      } else if (res.ok) {
        toast.success('Update status', res.status.message);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logoutAdmin('expired');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to install update.';
      toast.error('Self-update failed', msg);
      setUpdateStatus((prev) => (prev ? { ...prev, state: 'error', message: msg } : prev));
    }
    setApplyingUpdate(false);
  };

  return (
    <div className="py-4 sm:py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Settings navigation" className="flex flex-wrap items-center gap-1 -ml-2.5">
          <button
            type="button"
            onClick={() => navigateTo(ROUTES.AUDIT)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold text-slate-600 hover:text-[#0F2437] hover:bg-slate-100/80 transition-colors cursor-pointer whitespace-nowrap"
          >
            <ClipboardList className="w-3.5 h-3.5 text-[#2B7A3B]" aria-hidden="true" />
            <span>Audit Logs</span>
          </button>

          <button
            type="button"
            onClick={() => navigateTo(ROUTES.SECURITY)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold text-slate-600 hover:text-[#0F2437] hover:bg-slate-100/80 transition-colors cursor-pointer whitespace-nowrap"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#2B7A3B]" aria-hidden="true" />
            <span>Security</span>
          </button>

          <button
            type="button"
            onClick={handleLockButtonClick}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold text-slate-600 hover:text-red-700 hover:bg-red-50/70 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Lock Settings</span>
          </button>
        </nav>

        <BackButton
          align="right"
          label="Back to Service Desk"
          onClick={() => navigateTo(ROUTES.STATEMENTS)}
        />
      </div>

      <PageHeader
        title="SETTINGS"
        badge={
          isDirty ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded">
              Unsaved changes
            </span>
          ) : undefined
        }
        subtitle={
          <>
            Signed in as <strong className="text-[#0F2437]">{displayUser}</strong> · Configure Email (SMTP), pair WhatsApp, manage document defaults, and templates.
          </>
        }
        actions={
          <button
            type="button"
            onClick={handleRefreshButtonClick}
            disabled={refreshingSettings}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-[#D1D9E0] bg-white text-xs font-bold tracking-wider uppercase text-[#0F2437] hover:bg-slate-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshingSettings ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{refreshingSettings ? 'Refreshing...' : 'Refresh Settings'}</span>
          </button>
        }
      />

      {saveNotice && <AlertBanner variant="success" message={saveNotice} className="font-medium" />}
      {saveError && <AlertBanner variant="error" message={saveError} className="font-medium" />}

      <form onSubmit={handleSave} className="space-y-6">
        <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <h2 className="font-display text-base font-semibold text-[#006837] border-b border-slate-100 pb-2.5">
            Channel Availability &amp; Pre-Send Preview
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  Allow staff to dispatch protected statements via Email once SMTP credentials are configured.
                </div>
                {!settings.emailConfigured && (
                  <div className="text-[11px] font-semibold text-amber-700 mt-1.5">
                    Setup required: Save SMTP host, user &amp; password below
                  </div>
                )}
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
                  Allow staff to send encrypted statements via WhatsApp once a device QR code is paired.
                </div>
                {!isPaired && (
                  <div className="text-[11px] font-semibold text-amber-700 mt-1.5">
                    Setup required: Pair WhatsApp device via QR code below
                  </div>
                )}
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
          </div>

          <SectionSaveBar
            dirty={sectionDirty.channels}
            saving={saving}
            onDiscard={() => discardSection('channels')}
          />
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="w-4 h-4 text-[#006837] shrink-0" aria-hidden="true" />
                <h2 className="font-display text-base font-semibold text-[#006837] truncate">
                  Official NSSF SMTP Settings
                </h2>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded border shrink-0 ${
                    settings.emailConfigured
                      ? 'bg-emerald-50 text-[#1E6B34] border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  {settings.emailConfigured ? 'SMTP Ready' : 'Password Needed'}
                </span>
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
              <AlertBanner
                variant={smtpTestResult.ok ? 'success' : 'error'}
                message={smtpTestResult.text}
                className="p-3 text-xs"
              />
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

            <SectionSaveBar
              dirty={sectionDirty.smtp}
              saving={saving}
              onDiscard={() => discardSection('smtp')}
            />
          </section>

          <WhatsAppGatewayCard
            qrData={qrData}
            isPaired={isPaired}
            deviceName={form.whatsappDeviceName}
            loadingQr={loadingQr}
            reconnecting={reconnecting}
            unlinking={unlinking}
            dirty={sectionDirty.whatsapp}
            saving={saving}
            onRefreshQr={() => void loadQr(true)}
            onReconnect={() => void handleReconnectWhatsApp()}
            onUnlink={() => void handleUnlinkDevice()}
            onDeviceNameChange={(name) => setForm({ ...form, whatsappDeviceName: name })}
            onDiscard={() => discardSection('whatsapp')}
          />
        </div>

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

          <p className="text-xs text-slate-500 pt-1">
            Installed desktop packages store SQLite databases and configuration privately in your OS hidden user application data folder and remove them automatically upon uninstallation.
          </p>

          <SectionSaveBar
            dirty={sectionDirty.defaults}
            saving={saving}
            onDiscard={() => discardSection('defaults')}
          />
        </section>

        <TemplatesSection
          emailSubjectTemplate={form.emailSubjectTemplate}
          whatsappMessageTemplate={form.whatsappMessageTemplate}
          portalUrl={form.portalUrl}
          dirty={sectionDirty.templates}
          saving={saving}
          onChangeSubject={(next) => setForm({ ...form, emailSubjectTemplate: next })}
          onChangeWhatsapp={(next) => setForm({ ...form, whatsappMessageTemplate: next })}
          onDiscard={() => discardSection('templates')}
        />

        <SystemUpdatesSection
          autoUpdateEnabled={form.autoUpdateEnabled}
          updateRepo={form.updateRepo}
          savedUpdateRepo={settings.updateRepo}
          runtimeInfo={runtimeInfo}
          updateStatus={updateStatus}
          checkingUpdate={checkingUpdate}
          applyingUpdate={applyingUpdate}
          restartingApp={restartingApp}
          dirty={sectionDirty.updates}
          saving={saving}
          onToggleAutoUpdate={(enabled) => setForm({ ...form, autoUpdateEnabled: enabled })}
          onChangeUpdateRepo={(repo) => setForm({ ...form, updateRepo: repo })}
          onCheckNow={() => void handleCheckForUpdates()}
          onApplyUpdate={() => void handleApplyUpdate()}
          onDiscard={() => discardSection('updates')}
        />
      </form>

      <UnsavedChangesModal
        pendingAction={activePendingAction}
        saving={saving}
        onCancel={clearPendingModal}
        onIgnore={() => void handleIgnoreAndProceed()}
        onSaveAndProceed={() => void handleSaveAndProceed()}
      />
    </div>
  );
}
