import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  CheckCircle2,
  ClipboardList,
  Clock,
  Lock,
  LogOut,
  ShieldAlert,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { SecurityOverview, SecurityPolicy } from '../types';
import {
  ApiError,
  fetchSecurityOverviewApi,
  revokeAdminSessionsApi,
  saveSecurityPolicyApi,
} from '../utils/api';
import { ROUTES } from '../utils/constants';
import { toast } from './Toaster';
import { AdminCredentialsSection } from './settings/AdminCredentialsSection';
import { AlertBanner, BackButton, PageHeader } from './ui';

const DEFAULT_POLICY: SecurityPolicy = {
  sessionTtlMinutes: 480,
  maxLoginAttempts: 10,
  lockoutMinutes: 15,
  idleLockMinutes: 0,
};

export function SecurityView() {
  const {
    adminToken,
    adminUsername,
    adminAuthMode,
    navigateTo,
    logoutAdmin,
    setIdleLockMinutes,
  } = useApp();

  const token = adminToken || '';
  const displayUser = adminUsername || 'admin';

  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [policyForm, setPolicyForm] = useState<SecurityPolicy>(DEFAULT_POLICY);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [policyNotice, setPolicyNotice] = useState('');
  const [policyError, setPolicyError] = useState('');

  const loadOverview = useCallback(async () => {
    if (!token) return;
    try {
      const data = await fetchSecurityOverviewApi(token);
      setOverview(data);
      setPolicyForm(data.policy);
      setIdleLockMinutes(data.policy.idleLockMinutes);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logoutAdmin('expired');
        return;
      }
      setPolicyError(
        err instanceof Error ? err.message : 'Unable to load security overview.'
      );
    } finally {
      setLoading(false);
    }
  }, [token, logoutAdmin, setIdleLockMinutes]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setPolicyError('');
    setPolicyNotice('');
    setSavingPolicy(true);
    try {
      const res = await saveSecurityPolicyApi(token, policyForm);
      setPolicyForm(res.policy);
      setIdleLockMinutes(res.policy.idleLockMinutes);
      setPolicyNotice(res.message);
      toast.success('Security policy updated', res.message);
      await loadOverview();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logoutAdmin('expired');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to save security policy.';
      setPolicyError(msg);
      toast.error('Save failed', msg);
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleRevokeSessions = async (includeCurrent: boolean) => {
    setRevoking(true);
    setPolicyError('');
    try {
      const res = await revokeAdminSessionsApi(token, includeCurrent);
      if (res.signedOutCurrent) {
        logoutAdmin('manual');
        return;
      }
      toast.success('Sessions updated', res.message);
      await loadOverview();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logoutAdmin('expired');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Unable to revoke sessions.';
      setPolicyError(msg);
      toast.error('Session revocation failed', msg);
    } finally {
      setRevoking(false);
    }
  };

  const activeMode = overview?.authMode ?? adminAuthMode;
  const activeSessions = overview?.activeSessionCount ?? 1;

  return (
    <div className="py-4 sm:py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackButton label="Back to Settings" onClick={() => navigateTo(ROUTES.SETTINGS)} />

        <Link
          to={ROUTES.AUDIT}
          onClick={(e) => {
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
              e.preventDefault();
              navigateTo(ROUTES.AUDIT);
            }
          }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#2B7A3B] hover:underline underline-offset-4 transition-colors whitespace-nowrap"
        >
          <ClipboardList className="w-3.5 h-3.5 text-[#2B7A3B]" aria-hidden="true" />
          <span>Full Audit Logs</span>
        </Link>
      </div>

      <PageHeader
        title="SECURITY"
        subtitle={
          <>
            Signed in as <strong className="text-[#0F2437]">{displayUser}</strong> · Manage
            sign-in method (Passcode or Username &amp; Password), recovery email, session policies,
            and active access.
          </>
        }
      />

      {/* Security Posture Summary */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Active Login Method
          </div>
          <div className="text-sm font-bold text-[#0F2437]">
            {activeMode === 'passcode' ? 'Passcode Only' : 'Username & Password'}
          </div>
          <div className="text-[11px] text-slate-500">
            Exclusive (one method active)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Recovery Email
          </div>
          <div className="text-sm font-bold text-[#0F2437] truncate">
            {overview?.recoveryEmail ? overview.recoveryEmail : 'Not configured'}
          </div>
          <div
            className={`text-[11px] font-semibold ${
              overview?.recoveryEmail && overview?.smtpConfigured
                ? 'text-[#1E6B34]'
                : 'text-amber-700'
            }`}
          >
            {overview?.recoveryEmail && overview?.smtpConfigured
              ? 'Email recovery ready'
              : overview?.recoveryEmail
                ? 'Configure SMTP to enable email send'
                : 'Add email below for recovery'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Backup Recovery Key
          </div>
          <div className="text-sm font-bold text-[#0F2437] flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-[#2B7A3B]" aria-hidden="true" />
            <span>{overview?.hasRecoveryKey ? 'Offline Key Active' : 'Managed by Env'}</span>
          </div>
          <div className="text-[11px] text-slate-500">
            Works even without SMTP
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Active Admin Sessions
          </div>
          <div className="text-sm font-bold text-[#0F2437] tabular-nums">
            {loading ? '...' : `${activeSessions} active session${activeSessions === 1 ? '' : 's'}`}
          </div>
          <div className="text-[11px] text-slate-500">
            {policyForm.idleLockMinutes > 0
              ? `Auto-locks after ${policyForm.idleLockMinutes}m idle`
              : 'Idle auto-lock disabled'}
          </div>
        </div>
      </section>

      <AdminCredentialsSection overview={overview} onChanged={loadOverview} />

      {/* Session & Brute-Force Protection Policy */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#006837]" aria-hidden="true" />
            <h2 className="font-display text-base font-semibold text-[#006837]">
              Session Timeout &amp; Lockout Protection
            </h2>
          </div>
          <span className="text-xs text-slate-500">Enforced server-side on all admin routes</span>
        </div>

        {policyError && <AlertBanner variant="error" message={policyError} className="text-xs p-3" />}
        {policyNotice && (
          <AlertBanner variant="success" message={policyNotice} className="text-xs p-3" />
        )}

        <form onSubmit={handleSavePolicy} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label
                htmlFor="sec-session-ttl"
                className="block text-xs font-semibold text-[#0F2437] mb-1.5"
              >
                Session Lifetime
              </label>
              <select
                id="sec-session-ttl"
                value={policyForm.sessionTtlMinutes}
                onChange={(e) =>
                  setPolicyForm((prev) => ({
                    ...prev,
                    sessionTtlMinutes: Number(e.target.value),
                  }))
                }
                className="w-full h-11 px-3 rounded-md border border-slate-300 text-sm text-[#0F2437] focus:outline-none focus:border-[#2B7A3B]"
              >
                <option value={15}>15 minutes</option>
                <option value={60}>1 hour</option>
                <option value={240}>4 hours</option>
                <option value={480}>8 hours (Default)</option>
                <option value={1440}>24 hours</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="sec-idle-lock"
                className="block text-xs font-semibold text-[#0F2437] mb-1.5"
              >
                Inactivity Auto-Lock
              </label>
              <select
                id="sec-idle-lock"
                value={policyForm.idleLockMinutes}
                onChange={(e) =>
                  setPolicyForm((prev) => ({
                    ...prev,
                    idleLockMinutes: Number(e.target.value),
                  }))
                }
                className="w-full h-11 px-3 rounded-md border border-slate-300 text-sm text-[#0F2437] focus:outline-none focus:border-[#2B7A3B]"
              >
                <option value={0}>Disabled</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="sec-max-attempts"
                className="block text-xs font-semibold text-[#0F2437] mb-1.5"
              >
                Failed Attempts Before Lockout
              </label>
              <select
                id="sec-max-attempts"
                value={policyForm.maxLoginAttempts}
                onChange={(e) =>
                  setPolicyForm((prev) => ({
                    ...prev,
                    maxLoginAttempts: Number(e.target.value),
                  }))
                }
                className="w-full h-11 px-3 rounded-md border border-slate-300 text-sm text-[#0F2437] focus:outline-none focus:border-[#2B7A3B]"
              >
                <option value={3}>3 attempts (Strict)</option>
                <option value={5}>5 attempts</option>
                <option value={10}>10 attempts (Default)</option>
                <option value={15}>15 attempts</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="sec-lockout-mins"
                className="block text-xs font-semibold text-[#0F2437] mb-1.5"
              >
                Lockout Cooldown Window
              </label>
              <select
                id="sec-lockout-mins"
                value={policyForm.lockoutMinutes}
                onChange={(e) =>
                  setPolicyForm((prev) => ({
                    ...prev,
                    lockoutMinutes: Number(e.target.value),
                  }))
                }
                className="w-full h-11 px-3 rounded-md border border-slate-300 text-sm text-[#0F2437] focus:outline-none focus:border-[#2B7A3B]"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes (Default)</option>
                <option value={30}>30 minutes</option>
                <option value={60}>60 minutes</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => void handleRevokeSessions(false)}
                disabled={revoking || activeSessions <= 1}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-[#D1D9E0] bg-white text-xs font-bold uppercase tracking-wider text-[#0F2437] hover:bg-slate-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign Out Other Sessions</span>
              </button>

              <button
                type="button"
                onClick={() => void handleRevokeSessions(true)}
                disabled={revoking}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-red-300 bg-white text-xs font-bold uppercase tracking-wider text-red-700 hover:bg-red-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Revoke All &amp; Lock Now</span>
              </button>
            </div>

            <button
              type="submit"
              disabled={savingPolicy}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded bg-[#2B7A3B] text-white text-xs font-bold uppercase tracking-wider hover:bg-[#226430] disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{savingPolicy ? 'Saving...' : 'Save Security Policy'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Recent Security & Auth Events */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#006837]" aria-hidden="true" />
            <h2 className="font-display text-base font-semibold text-[#006837]">
              Recent Authentication &amp; Security Events
            </h2>
          </div>
          <Link
            to={ROUTES.AUDIT}
            onClick={(e) => {
              if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                navigateTo(ROUTES.AUDIT);
              }
            }}
            className="text-xs font-semibold text-[#2B7A3B] hover:underline"
          >
            View all in Audit Logs
          </Link>
        </div>

        {loading ? (
          <div className="text-xs text-slate-500 py-4">Loading recent security activity...</div>
        ) : !overview?.recentEvents || overview.recentEvents.length === 0 ? (
          <div className="text-xs text-slate-500 py-4">
            No authentication or security events recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {overview.recentEvents.map((evt) => {
              const isAlert =
                evt.status.includes('FAILED') ||
                evt.status.includes('BLOCKED') ||
                evt.status.includes('UNAUTHORIZED') ||
                evt.status.includes('REVOKED');
              return (
                <div
                  key={evt.id}
                  className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                          isAlert
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-emerald-50 text-[#1E6B34] border border-emerald-200'
                        }`}
                      >
                        {evt.status}
                      </span>
                      <span className="font-semibold text-[#0F2437]">{evt.actor || 'System'}</span>
                      {evt.sourceIp && (
                        <span className="font-mono text-[11px] text-slate-400">
                          {evt.sourceIp}
                        </span>
                      )}
                    </div>
                    <p className="text-slate-600 break-words">{evt.details}</p>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400 shrink-0 tabular-nums">
                    {evt.timestamp}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
