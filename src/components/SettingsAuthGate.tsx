import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import type { AdminAuthStatus, AppSettings } from '../types';
import { toast } from './Toaster';

interface SettingsAuthGateProps {
  onAuthenticated: (token: string, username: string, fullSettings: AppSettings) => void;
}

const SMOOTH_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function SettingsAuthGate({ onAuthenticated }: SettingsAuthGateProps) {
  const [status, setStatus] = useState<AdminAuthStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchAuthStatus = async () => {
    setLoadingStatus(true);
    setStatusError('');
    try {
      const res = await fetch('/api/auth/status');
      if (!res.ok) throw new Error('Unable to check administrator status.');
      const data = (await res.json()) as AdminAuthStatus;
      setStatus(data);
    } catch (err) {
      setStatusError(
        err instanceof Error ? err.message : 'Unable to reach NSSF authentication service.'
      );
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchAuthStatus();
  }, []);

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanUser = username.trim();
    if (!/^[A-Za-z0-9._@-]{3,64}$/.test(cleanUser)) {
      const msg = 'Username must be 3 to 64 characters (letters, numbers, ., _, @, -).';
      setFormError(msg);
      toast.warning('Invalid username', msg);
      return;
    }

    if (password.length < 8) {
      const msg = 'Password must be at least 8 characters long.';
      setFormError(msg);
      toast.warning('Password too short', msg);
      return;
    }

    if (password !== confirmPassword) {
      const msg = 'Password and confirmation do not match.';
      setFormError(msg);
      toast.warning('Passwords do not match', msg);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const msg = data.error || 'Failed to initialize administrator account.';
        setFormError(msg);
        toast.error('Setup failed', msg);
        if (res.status === 409) {
          await fetchAuthStatus();
        }
        return;
      }
      toast.success(
        'Administrator account created',
        `Signed in as ${data.username}. System Settings unlocked.`
      );
      onAuthenticated(data.token, data.username, data.settings);
    } catch {
      const msg = 'Network error during administrator setup.';
      setFormError(msg);
      toast.error('Network error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!password) {
      const msg = 'Please enter the administrator password.';
      setFormError(msg);
      toast.warning('Password required', msg);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const msg = data.error || 'Invalid administrator credentials.';
        setFormError(msg);
        toast.error('Authentication failed', msg);
        return;
      }
      toast.success('Settings unlocked', `Signed in as ${data.username}.`);
      onAuthenticated(data.token, data.username, data.settings);
    } catch {
      const msg = 'Network error verifying administrator credentials.';
      setFormError(msg);
      toast.error('Network error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingStatus) {
    return (
      <div className="py-12 max-w-md mx-auto">
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center shadow-[0_6px_28px_rgba(15,36,55,0.06)] space-y-3">
          <div className="w-11 h-11 rounded-full bg-emerald-50 border border-emerald-200 text-[#2B7A3B] flex items-center justify-center mx-auto">
            <Lock className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-sm font-semibold text-[#0F2437]">
            Checking administrator authentication status...
          </div>
        </div>
      </div>
    );
  }

  if (statusError || !status) {
    return (
      <div className="py-12 max-w-md mx-auto">
        <div className="bg-white border border-red-200 rounded-xl p-8 text-center shadow-[0_6px_28px_rgba(15,36,55,0.06)] space-y-4">
          <AlertCircle className="w-8 h-8 text-red-600 mx-auto" aria-hidden="true" />
          <div className="text-sm font-semibold text-[#0F2437]">
            {statusError || 'Unable to verify administrator status.'}
          </div>
          <button
            type="button"
            onClick={fetchAuthStatus}
            className="px-4 py-2 rounded bg-[#2B7A3B] text-white text-xs font-bold uppercase tracking-wider hover:bg-[#226430] cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isSetupMode = !status.adminExists;

  return (
    <div className="py-6 sm:py-10 max-w-lg mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: SMOOTH_EASE }}
        className="overflow-hidden"
      >
        <div className="py-5 border-b-4 border-[#2B7A3B] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
           <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.16em]">
                Settings
              </div>
              <h1 className="font-display text-xl font-extrabold tracking-tight">
                {isSetupMode ? 'Setup Admin Account' : 'Administrator Sign in'}
              </h1>
            </div>
          </div>
        </div>

        <form
          onSubmit={isSetupMode ? handleSetupSubmit : handleLoginSubmit}
          className="py-6 space-y-5"
        >
          <p className="text-xs text-slate-600 leading-relaxed">
            {isSetupMode
              ? 'Create the initial administrator credentials to secure SMTP settings, WhatsApp pairing, and message templates.'
              : status.envPasscodeConfigured
                ? 'Enter the administrator passcode configured for this server to unlock Settings.'
                : 'Sign in to view or modify Settings.'}
          </p>

          {formError && (
            <div
              role="alert"
              className="border border-red-200 bg-red-50 rounded-md p-3.5 flex items-start gap-2.5 text-xs text-red-800"
            >
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          {(!status.envPasscodeConfigured || isSetupMode) && (
            <div>
              <label
                htmlFor="admin-username"
                className="block text-xs font-semibold text-[#0F2437] mb-1.5"
              >
                Administrator Username
              </label>
              <input
                id="admin-username"
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full h-11 px-3.5 rounded-md border border-slate-300 text-sm text-[#0F2437] focus:outline-none focus:border-[#2B7A3B]"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="admin-password"
              className="block text-xs font-semibold text-[#0F2437] mb-1.5"
            >
              {status.envPasscodeConfigured ? 'Administrator Passcode' : 'Password'}
            </label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete={isSetupMode ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSetupMode ? 'Minimum 8 characters' : 'Enter password'}
                className="w-full h-11 px-3.5 pr-11 rounded-md border border-slate-300 text-sm text-[#0F2437] focus:outline-none focus:border-[#2B7A3B]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-[#0F2437] cursor-pointer"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Eye className="w-4 h-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {isSetupMode && (
            <div>
              <label
                htmlFor="admin-confirm-password"
                className="block text-xs font-semibold text-[#0F2437] mb-1.5"
              >
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id="admin-confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full h-11 px-3.5 pr-11 rounded-md border border-slate-300 text-sm text-[#0F2437] focus:outline-none focus:border-[#2B7A3B]"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((prev) => !prev)}
                  aria-label={showConfirm ? 'Hide confirmation password' : 'Show confirmation password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-[#0F2437] cursor-pointer"
                >
                  {showConfirm ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 rounded bg-[#2B7A3B] hover:bg-[#226430] text-white text-xs font-bold tracking-[0.16em] uppercase inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <KeyRound className="w-4 h-4" aria-hidden="true" />
            <span>
              {submitting
                ? isSetupMode
                  ? 'CREATING...'
                  : 'VERIFYING...'
                : isSetupMode
                  ? 'CREATE ADMIN'
                  : 'SIGN IN'}
            </span>
          </button>
        </form>
      </motion.div>
    </div>
  );
}
