import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, KeyRound, Lock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { AdminAuthStatus } from '../types';
import { ApiError, fetchAuthStatusApi, loginAdminApi, setupAdminApi } from '../utils/api';
import { ROUTES, SMOOTH_EASE } from '../utils/constants';
import { isValidAdminUsername } from '../utils/validation';
import { toast } from './Toaster';
import { ActionButton, AlertBanner, BackButton, FormInput } from './ui';

export function SettingsAuthGate() {
  const { appName, authenticateAdmin, navigateTo } = useApp();

  const [status, setStatus] = useState<AdminAuthStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchAuthStatus = async () => {
    setLoadingStatus(true);
    setStatusError('');
    try {
      const data = await fetchAuthStatusApi();
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
    void fetchAuthStatus();
  }, []);

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanUser = username.trim();
    if (!isValidAdminUsername(cleanUser)) {
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
      const data = await setupAdminApi(cleanUser, password);
      toast.success(
        'Administrator account created',
        `Signed in as ${data.username}. System Settings unlocked.`
      );
      authenticateAdmin(data.token, data.username, data.settings);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to initialize administrator account.';
      setFormError(msg);
      toast.error('Setup failed', msg);
      if (err instanceof ApiError && err.status === 409) {
        await fetchAuthStatus();
      }
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
      const data = await loginAdminApi(username.trim(), password);
      toast.success('Settings unlocked', `Signed in as ${data.username}.`);
      authenticateAdmin(data.token, data.username, data.settings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid administrator credentials.';
      setFormError(msg);
      toast.error('Authentication failed', msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingStatus) {
    return (
      <div className="py-12 mt-8 max-w-md mx-auto">
        <div className="text-center space-y-3">
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
      <div className="py-12 max-w-md mx-auto space-y-4">
        <BackButton label="Back to Service Desk" onClick={() => navigateTo(ROUTES.STATEMENTS)} />
        <div className="text-center pt-8 space-y-4">
          <AlertCircle className="w-8 h-8 text-red-600 mx-auto" aria-hidden="true" />
          <div className="text-sm font-semibold text-[#0F2437]">
            {statusError || 'Unable to verify administrator status.'}
          </div>
          <ActionButton onClick={fetchAuthStatus}>Retry</ActionButton>
        </div>
      </div>
    );
  }

  const isSetupMode = !status.adminExists;

  return (
    <div className="py-6 sm:py-10 max-w-lg mx-auto space-y-4">
      <BackButton label="Back to Service Desk" onClick={() => navigateTo(ROUTES.STATEMENTS)} />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: SMOOTH_EASE }}
        className="overflow-hidden"
      >
        <div className="py-5 border-b-4 border-[#2B7A3B] flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#1E6B34]">
              {appName}
            </div>
            <h1 className="font-display text-xl font-extrabold tracking-tight text-[#0F2437] mt-0.5">
              {isSetupMode ? 'Setup Admin Account' : 'Administrator Sign in'}
            </h1>
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

          {formError && <AlertBanner variant="error" message={formError} className="text-xs p-3.5" />}

          {(!status.envPasscodeConfigured || isSetupMode) && (
            <FormInput
              id="admin-username"
              label="Administrator Username"
              variant="compact"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
            />
          )}

          <FormInput
            id="admin-password"
            label={status.envPasscodeConfigured ? 'Administrator Passcode' : 'Password'}
            variant="compact"
            passwordToggle
            required
            autoComplete={isSetupMode ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isSetupMode ? 'Minimum 8 characters' : 'Enter password'}
          />

          {isSetupMode && (
            <FormInput
              id="admin-confirm-password"
              label="Confirm Password"
              variant="compact"
              passwordToggle
              hidePasswordLabel="Hide confirmation password"
              showPasswordLabel="Show confirmation password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
            />
          )}

          <ActionButton type="submit" fullWidth disabled={submitting} className="h-11">
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
          </ActionButton>
        </form>
      </motion.div>
    </div>
  );
}
