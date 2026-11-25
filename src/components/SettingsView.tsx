import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Mail,
  QrCode,
  RefreshCw,
  Save,
  Server,
  Smartphone,
} from 'lucide-react';
import type { AppSettings, WhatsAppQrData } from '../types';

interface SettingsViewProps {
  settings: AppSettings;
  onSettingsUpdated: (updated: AppSettings) => void;
}

export function SettingsView({ settings, onSettingsUpdated }: SettingsViewProps) {
  const [form, setForm] = useState<AppSettings>({ ...settings, smtpPass: '' });
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const [saveError, setSaveError] = useState('');

  const [testingSmtp, setTestingSmtp] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [qrData, setQrData] = useState<WhatsAppQrData | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);

  useEffect(() => {
    setForm({ ...settings, smtpPass: '' });
  }, [settings]);

  const loadQr = async () => {
    setLoadingQr(true);
    try {
      const res = await fetch('/api/whatsapp/qr');
      const data = (await res.json()) as WhatsAppQrData;
      setQrData(data);
    } catch {
      setQrData(null);
    } finally {
      setLoadingQr(false);
    }
  };

  useEffect(() => {
    loadQr();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveNotice('');
    setSaveError('');

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSaveError(data.error || 'Failed to save settings.');
      } else {
        onSettingsUpdated(data.settings);
        setSaveNotice('System configuration saved to SQLite database.');
        setTimeout(() => setSaveNotice(''), 4000);
      }
    } catch {
      setSaveError('Network error saving settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestSmtp = async () => {
    setTestingSmtp(true);
    setSmtpTestResult(null);
    try {
      const res = await fetch('/api/settings/test-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      setSmtpTestResult({
        ok: Boolean(data.ok),
        text: data.ok ? data.message : data.error || 'SMTP test failed.',
      });
    } catch {
      setSmtpTestResult({ ok: false, text: 'Unable to reach server to test SMTP.' });
    } finally {
      setTestingSmtp(false);
    }
  };

  const handleTogglePairing = async (paired: boolean) => {
    try {
      const res = await fetch('/api/whatsapp/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paired }),
      });
      const data = await res.json();
      if (data.ok && data.settings) {
        onSettingsUpdated(data.settings);
        setForm((prev) => ({ ...prev, whatsappPaired: paired }));
        setQrData((prev) => (prev ? { ...prev, paired } : prev));
      }
    } catch {
      // ignore
    }
  };

  const qrDataUri = qrData?.qrSvg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrData.qrSvg)}`
    : '';

  return (
    <div className="py-4 sm:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.16em] text-[#1E6B34] uppercase">
            NSSF DIGITAL STATEMENT DISPATCH
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-[#0F2437] tracking-tight mt-1">
            SYSTEM SETTINGS
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Configure Email (SMTP), pair the NSSF WhatsApp desk device via QR code, and manage SQLite defaults.
          </p>
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
            Channel Availability &amp; Delivery Mode
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

          {/* WhatsApp QR Pairing */}
          <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-[#006837]" aria-hidden="true" />
                <h2 className="font-display text-base font-semibold text-[#006837]">
                  WhatsApp QR Setup
                </h2>
              </div>
              <span
                className={`text-xs font-semibold ${
                  form.whatsappPaired ? 'text-[#006837]' : 'text-amber-700'
                }`}
              >
                {form.whatsappPaired ? 'Paired' : 'Awaiting Scan'}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="border border-slate-200 rounded-md p-2.5 bg-white shrink-0">
                {loadingQr || !qrDataUri ? (
                  <div className="w-[170px] h-[170px] bg-slate-100 rounded flex items-center justify-center text-xs text-slate-500">
                    Generating QR...
                  </div>
                ) : (
                  <img
                    src={qrDataUri}
                    alt="WhatsApp Link Device QR Code"
                    className="w-[170px] h-[170px] block"
                  />
                )}
              </div>

              <div className="space-y-3 text-xs text-slate-600 flex-1">
                <p className="leading-relaxed">
                  On the official NSSF desk phone, open <strong>WhatsApp</strong>, go to{' '}
                  <strong>Linked Devices</strong>, tap <strong>Link a Device</strong>, and scan this QR code.
                </p>

                {qrData && (
                  <div className="font-mono text-[11px] text-slate-500">
                    Session: {qrData.sessionCode}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={loadQr}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" aria-hidden="true" />
                    <span>Refresh QR</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTogglePairing(!form.whatsappPaired)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs font-semibold cursor-pointer ${
                      form.whatsappPaired
                        ? 'border border-red-300 text-red-700 hover:bg-red-50'
                        : 'bg-[#006837] text-white hover:bg-[#00542c]'
                    }`}
                  >
                    <Smartphone className="w-3 h-3" aria-hidden="true" />
                    <span>{form.whatsappPaired ? 'Unlink Device' : 'Mark Device Paired'}</span>
                  </button>
                </div>
              </div>
            </div>

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

          <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 text-xs text-slate-600 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <strong className="text-slate-800">Standalone Go Packaging:</strong>{' '}
              Zero-dependency Go source in <code className="text-[#006837]">go/cmd/server</code> embeds{' '}
              <code>dist/*</code>, links NSSF crest icon &amp; publisher metadata via{' '}
              <code>go/packaging/windows/app.rc</code>, and stores settings/logs in SQLite.
            </div>
            <span className="font-mono text-[11px] text-slate-500 shrink-0">go/build.sh</span>
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
    </div>
  );
}
