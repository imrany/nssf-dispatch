import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  Hash,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import type { AdminAuthMode, AdminAuthStatus } from '../types';
import {
  ApiError,
  fetchAuthStatusApi,
  forgotPasswordApi,
  loginAdminApi,
  resetPasswordApi,
  setupAdminApi,
} from '../utils/api';
import { ROUTES, SMOOTH_EASE } from '../utils/constants';
import { triggerBlobDownload } from '../utils/download';
import { isValidAdminUsername, isValidEmail } from '../utils/validation';
import { NssfLogo } from './NssfLogo';
import { toast } from './Toaster';
import { ActionButton, AlertBanner, BackButton, FormInput } from './ui';

type GateMode = 'setup' | 'login' | 'forgot';
type ResetMethod = 'recovery_key' | 'email_code';

export function SettingsAuthGate({
  initialSetupRequired = false,
}: {
  initialSetupRequired?: boolean;
}) {
  const {
    authStatus: ctxAuthStatus,
    pendingRecoveryKey,
    clearPendingRecoveryKey,
    authenticateAdmin,
    navigateTo,
    refreshAuthStatus,
  } = useApp();

  const [status, setStatus] = useState<AdminAuthStatus | null>(ctxAuthStatus);
  const [loadingStatus, setLoadingStatus] = useState(!ctxAuthStatus);
  const [statusError, setStatusError] = useState('');

  const [mode, setMode] = useState<GateMode>(
    ctxAuthStatus && !ctxAuthStatus.adminExists ? 'setup' : 'login'
  );
  const [setupAuthMode, setSetupAuthMode] = useState<AdminAuthMode>('password');
  const [resetMethod, setResetMethod] = useState<ResetMethod>('recovery_key');
  const [emailCodeSent, setEmailCodeSent] = useState(false);

  const [username, setUsername] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');

  const [resetCode, setResetCode] = useState('');
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [confirmNewSecret, setConfirmNewSecret] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formNotice, setFormNotice] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);

  const loadStatus = async () => {
    setLoadingStatus(true);
    setStatusError('');
    try {
      const data = await fetchAuthStatusApi();
      setStatus(data);
      setMode(data.adminExists ? 'login' : 'setup');
      if (data.authMode === 'passcode' && data.smtpConfigured && data.hasRecoveryEmail) {
        setResetMethod('email_code');
      }
    } catch (err) {
      setStatusError(
        err instanceof Error ? err.message : 'Unable to reach NSSF authentication service.'
      );
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormNotice('');

    const cleanUser = username.trim();
    const cleanEmail = recoveryEmail.trim();

    if (cleanEmail && !isValidEmail(cleanEmail)) {
      const msg = 'Please enter a valid recovery email address.';
      setFormError(msg);
      toast.warning('Invalid recovery email', msg);
      return;
    }

    if (setupAuthMode === 'passcode') {
      const cleanCode = passcode.trim();
      if (cleanCode.length < 6 || cleanCode.length > 64) {
        const msg = 'Passcode must be between 6 and 64 characters.';
        setFormError(msg);
        toast.warning('Passcode too short', msg);
        return;
      }
      if (cleanCode !== confirmPasscode.trim()) {
        const msg = 'Passcode and confirmation do not match.';
        setFormError(msg);
        toast.warning('Passcodes do not match', msg);
        return;
      }

      setSubmitting(true);
      try {
        const data = await setupAdminApi({
          authMode: 'passcode',
          username: 'admin',
          passcode: cleanCode,
          recoveryEmail: cleanEmail,
        });
        toast.success(
          'Administrator passcode configured',
          'Save your backup recovery key before continuing.'
        );
        authenticateAdmin(data.token, data.username, data.settings, {
          authMode: data.authMode,
          recoveryEmail: data.recoveryEmail || cleanEmail,
          recoveryKey: data.recoveryKey || null,
          idleLockMinutes: data.idleLockMinutes ?? 0,
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Failed to initialize administrator account.';
        setFormError(msg);
        toast.error('Setup failed', msg);
        if (err instanceof ApiError && err.status === 409) {
          await loadStatus();
          await refreshAuthStatus();
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

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
      const data = await setupAdminApi({
        authMode: 'password',
        username: cleanUser,
        password,
        recoveryEmail: cleanEmail,
      });
      toast.success(
        'Administrator account created',
        `Signed in as ${data.username}. Save your backup recovery key before continuing.`
      );
      authenticateAdmin(data.token, data.username, data.settings, {
        authMode: data.authMode,
        recoveryEmail: data.recoveryEmail || cleanEmail,
        recoveryKey: data.recoveryKey || null,
        idleLockMinutes: data.idleLockMinutes ?? 0,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to initialize administrator account.';
      setFormError(msg);
      toast.error('Setup failed', msg);
      if (err instanceof ApiError && err.status === 409) {
        await loadStatus();
        await refreshAuthStatus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const activeLoginIsPasscode =
    Boolean(status?.envPasscodeConfigured) || status?.authMode === 'passcode';

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormNotice('');

    if (activeLoginIsPasscode) {
      const cleanCode = passcode.trim();
      if (!cleanCode) {
        const msg = 'Please enter the administrator passcode.';
        setFormError(msg);
        toast.warning('Passcode required', msg);
        return;
      }

      setSubmitting(true);
      try {
        const data = await loginAdminApi({ passcode: cleanCode });
        toast.success('Settings unlocked', 'Administrator signed in with passcode.');
        authenticateAdmin(data.token, data.username, data.settings, {
          authMode: data.authMode || 'passcode',
          recoveryEmail: data.recoveryEmail || '',
          idleLockMinutes: data.idleLockMinutes ?? 0,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid administrator passcode.';
        setFormError(msg);
        toast.error('Authentication failed', msg);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!password) {
      const msg = 'Please enter the administrator password.';
      setFormError(msg);
      toast.warning('Password required', msg);
      return;
    }

    setSubmitting(true);
    try {
      const data = await loginAdminApi({ username: username.trim(), password });
      toast.success('Settings unlocked', `Signed in as ${data.username}.`);
      authenticateAdmin(data.token, data.username, data.settings, {
        authMode: data.authMode || 'password',
        recoveryEmail: data.recoveryEmail || '',
        idleLockMinutes: data.idleLockMinutes ?? 0,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid administrator credentials.';
      setFormError(msg);
      toast.error('Authentication failed', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestEmailCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormNotice('');

    if (!activeLoginIsPasscode && !isValidAdminUsername(username.trim())) {
      setFormError('Enter your administrator username.');
      return;
    }
    if (!isValidEmail(recoveryEmail.trim())) {
      setFormError('Enter your configured recovery email address.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await forgotPasswordApi(
        activeLoginIsPasscode ? '' : username.trim(),
        recoveryEmail.trim()
      );
      setEmailCodeSent(true);
      setFormNotice(res.message);
      toast.success('Verification code requested', 'Check your recovery inbox for the reset code.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to send verification code.';
      setFormError(msg);
      toast.error('Reset request failed', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetSecretSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormNotice('');

    if (!activeLoginIsPasscode && !isValidAdminUsername(username.trim())) {
      setFormError('Enter your administrator username.');
      return;
    }

    if (resetMethod === 'recovery_key' && recoveryKeyInput.trim().length < 12) {
      setFormError('Enter your Backup Recovery Key (e.g. NSSF-XXXX-XXXX-XXXX-XXXX).');
      return;
    }

    if (resetMethod === 'email_code' && resetCode.trim().length < 6) {
      setFormError('Enter the 8-character verification code sent to your recovery email.');
      return;
    }

    const cleanNew = activeLoginIsPasscode ? newSecret.trim() : newSecret;
    const cleanConfirm = activeLoginIsPasscode ? confirmNewSecret.trim() : confirmNewSecret;
    const minLen = activeLoginIsPasscode ? 6 : 8;

    if (cleanNew.length < minLen) {
      setFormError(
        activeLoginIsPasscode
          ? 'New passcode must be at least 6 characters long.'
          : 'New password must be at least 8 characters long.'
      );
      return;
    }

    if (cleanNew !== cleanConfirm) {
      setFormError(
        activeLoginIsPasscode
          ? 'New passcode and confirmation do not match.'
          : 'New password and confirmation do not match.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await resetPasswordApi({
        method: resetMethod,
        username: activeLoginIsPasscode ? undefined : username.trim(),
        code: resetMethod === 'email_code' ? resetCode.trim() : undefined,
        recoveryKey: resetMethod === 'recovery_key' ? recoveryKeyInput.trim() : undefined,
        newPassword: activeLoginIsPasscode ? undefined : cleanNew,
        newPasscode: activeLoginIsPasscode ? cleanNew : undefined,
      });
      toast.success(
        activeLoginIsPasscode ? 'Passcode reset complete' : 'Password reset complete',
        res.message
      );
      setPassword('');
      setPasscode('');
      setNewSecret('');
      setConfirmNewSecret('');
      setResetCode('');
      setRecoveryKeyInput('');
      setEmailCodeSent(false);
      setFormNotice(res.message);
      setMode('login');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : activeLoginIsPasscode
            ? 'Unable to reset administrator passcode.'
            : 'Unable to reset administrator password.';
      setFormError(msg);
      toast.error('Reset failed', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyRecoveryKey = async () => {
    if (!pendingRecoveryKey) return;
    try {
      await navigator.clipboard.writeText(pendingRecoveryKey);
      setCopiedKey(true);
      toast.success('Recovery key copied', 'Store it safely outside this browser.');
      setTimeout(() => setCopiedKey(false), 2500);
    } catch {
      toast.warning('Copy failed', 'Use Download Key File instead.');
    }
  };

  const handleDownloadRecoveryKey = () => {
    if (!pendingRecoveryKey) return;
    const content = [
      'NSSF DIGITAL STATEMENT DISPATCH — ADMINISTRATOR RECOVERY KEY',
      '==============================================================',
      `Administrator Account: ${username || status?.username || 'admin'}`,
      `Recovery Key:          ${pendingRecoveryKey}`,
      `Generated At:          ${new Date().toISOString()}`,
      '',
      'Keep this recovery key in a secure location. It allows resetting your',
      'administrator password or passcode even when SMTP email is not configured.',
      '',
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    triggerBlobDownload(blob, 'NSSF_Admin_Recovery_Key.txt');
    toast.success('Recovery key downloaded', 'Saved NSSF_Admin_Recovery_Key.txt');
  };

  if (pendingRecoveryKey) {
    return (
      <div className="py-6 sm:py-10 max-w-lg mx-auto space-y-6">
        <NssfLogo />

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: SMOOTH_EASE }}
          className="overflow-hidden"
        >
          <div className="py-5 border-b-4 border-[#2B7A3B] flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-[#2B7A3B] shrink-0" aria-hidden="true" />
            <div>
              <h1 className="font-display text-xl font-extrabold tracking-tight text-[#0F2437]">
                Save Your Backup Recovery Key
              </h1>
            </div>
          </div>

          <div className="py-6 space-y-5">
            <p className="text-xs text-slate-600 leading-relaxed">
              Your administrator account is ready. Store this one-time recovery key securely—it is
              only shown once and allows you to reset a forgotten password or passcode even offline.
            </p>

            <div className="py-4 border-y border-slate-200 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Administrator Recovery Key
              </div>
              <div className="font-mono text-base sm:text-lg font-bold tracking-wider text-[#0F2437] select-all tabular-nums">
                {pendingRecoveryKey}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void handleCopyRecoveryKey()}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded border border-[#D1D9E0] bg-white text-xs font-bold uppercase tracking-wider text-[#0F2437] hover:bg-slate-50 cursor-pointer"
              >
                {copiedKey ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#2B7A3B]" aria-hidden="true" />
                    <span>Copied Key</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copy Key</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownloadRecoveryKey}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded border border-[#D1D9E0] bg-white text-xs font-bold uppercase tracking-wider text-[#0F2437] hover:bg-slate-50 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Download .txt</span>
              </button>
            </div>

            <div className="pt-2 space-y-2.5">
              <ActionButton
                fullWidth
                size="lg"
                onClick={() => clearPendingRecoveryKey(ROUTES.STATEMENTS)}
              >
                CONTINUE TO SERVICE DESK
              </ActionButton>
              <ActionButton
                variant="outlineGreen"
                fullWidth
                size="md"
                onClick={() => clearPendingRecoveryKey(ROUTES.SETTINGS)}
              >
                OPEN SYSTEM SETTINGS
              </ActionButton>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

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
      <div className="py-12 max-w-md mx-auto space-y-5">
        {!initialSetupRequired && (
          <BackButton label="Back to Service Desk" onClick={() => navigateTo(ROUTES.STATEMENTS)} />
        )}
        <NssfLogo />
        <div className="text-center pt-4 space-y-4">
          <AlertCircle className="w-8 h-8 text-red-600 mx-auto" aria-hidden="true" />
          <div className="text-sm font-semibold text-[#0F2437]">
            {statusError || 'Unable to verify administrator status.'}
          </div>
          <ActionButton onClick={() => void loadStatus()}>Retry</ActionButton>
        </div>
      </div>
    );
  }

  const isSetupMode = !status.adminExists || mode === 'setup';
  const isForgotMode = status.adminExists && mode === 'forgot' && !status.envPasscodeConfigured;

  return (
    <div className="py-6 sm:py-10 max-w-lg mx-auto space-y-5">
      {!initialSetupRequired && !isSetupMode && (
        <BackButton label="Back to Service Desk" onClick={() => navigateTo(ROUTES.STATEMENTS)} />
      )}
      <NssfLogo />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: SMOOTH_EASE }}
        className="overflow-hidden"
      >
        <div className="py-5 border-b-4 border-[#2B7A3B] flex items-center justify-between gap-4">
          <h1 className="font-display text-xl font-extrabold tracking-tight text-[#0F2437]">
            {isSetupMode
              ? 'Setup Admin Account'
              : isForgotMode
                ? activeLoginIsPasscode
                  ? 'Recover Administrator Passcode'
                  : 'Reset Administrator Password'
                : 'Administrator Sign In'}
          </h1>
        </div>

        {isForgotMode ? (
          <div className="py-6 space-y-5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setFormError('');
                  setFormNotice('');
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#0F2437] cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Back to Sign In</span>
              </button>
            </div>

            <div
              role="group"
              aria-label="Recovery method"
              className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md"
            >
              <button
                type="button"
                onClick={() => {
                  setResetMethod('email_code');
                  setFormError('');
                  setFormNotice('');
                }}
                className={`px-3 py-2 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                  resetMethod === 'email_code'
                    ? 'bg-white text-[#0F2437] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F2437]'
                }`}
              >
                Recovery Email Code
              </button>
              <button
                type="button"
                onClick={() => {
                  setResetMethod('recovery_key');
                  setFormError('');
                  setFormNotice('');
                }}
                className={`px-3 py-2 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                  resetMethod === 'recovery_key'
                    ? 'bg-white text-[#0F2437] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F2437]'
                }`}
              >
                Backup Recovery Key
              </button>
            </div>

            {formError && (
              <AlertBanner variant="error" message={formError} className="text-xs p-3.5" />
            )}
            {formNotice && (
              <AlertBanner variant="success" message={formNotice} className="text-xs p-3.5" />
            )}

            {resetMethod === 'email_code' && !emailCodeSent ? (
              <form onSubmit={handleRequestEmailCode} className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  {status.smtpConfigured && status.hasRecoveryEmail
                    ? activeLoginIsPasscode
                      ? 'Enter your configured recovery email address to receive a one-time verification code to reset your passcode.'
                      : 'Enter your administrator username and recovery email address to receive a one-time reset code.'
                    : 'Email recovery requires both a saved Recovery Email and a configured SMTP server. If not configured, switch to Backup Recovery Key.'}
                </p>

                {!activeLoginIsPasscode && (
                  <FormInput
                    id="forgot-username"
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
                  id="forgot-email"
                  label="Recovery Email Address"
                  variant="compact"
                  type="email"
                  required
                  autoComplete="email"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  placeholder="admin@nssfkenya.co.ke"
                />

                <ActionButton type="submit" fullWidth disabled={submitting} className="h-11">
                  <Mail className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {submitting
                      ? 'SENDING CODE...'
                      : activeLoginIsPasscode
                        ? 'SEND PASSCODE RESET CODE'
                        : 'SEND RESET CODE'}
                  </span>
                </ActionButton>
              </form>
            ) : (
              <form onSubmit={handleResetSecretSubmit} className="space-y-4">
                {!activeLoginIsPasscode && (
                  <FormInput
                    id="reset-username"
                    label="Administrator Username"
                    variant="compact"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                  />
                )}

                {resetMethod === 'recovery_key' ? (
                  <FormInput
                    id="reset-recovery-key"
                    label="Backup Recovery Key"
                    variant="compact"
                    required
                    value={recoveryKeyInput}
                    onChange={(e) => setRecoveryKeyInput(e.target.value)}
                    placeholder="NSSF-XXXX-XXXX-XXXX-XXXX"
                    className="font-mono uppercase tracking-wider"
                  />
                ) : (
                  <div className="space-y-1.5">
                    <FormInput
                      id="reset-email-code"
                      label="Email Verification Code"
                      variant="compact"
                      required
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value)}
                      placeholder="XXXX-XXXX"
                      className="font-mono uppercase tracking-wider"
                    />
                    <button
                      type="button"
                      onClick={() => setEmailCodeSent(false)}
                      className="text-xs font-semibold text-[#2B7A3B] hover:underline cursor-pointer"
                    >
                      Resend verification code
                    </button>
                  </div>
                )}

                <FormInput
                  id="reset-new-secret"
                  label={activeLoginIsPasscode ? 'New Passcode' : 'New Password'}
                  variant="compact"
                  passwordToggle
                  hidePasswordLabel={activeLoginIsPasscode ? 'Hide passcode' : 'Hide password'}
                  showPasswordLabel={activeLoginIsPasscode ? 'Show passcode' : 'Show password'}
                  required
                  autoComplete="new-password"
                  value={newSecret}
                  onChange={(e) => setNewSecret(e.target.value)}
                  placeholder={
                    activeLoginIsPasscode ? 'Minimum 6 characters' : 'Minimum 8 characters'
                  }
                />

                <FormInput
                  id="reset-confirm-secret"
                  label={activeLoginIsPasscode ? 'Confirm New Passcode' : 'Confirm New Password'}
                  variant="compact"
                  passwordToggle
                  hidePasswordLabel={
                    activeLoginIsPasscode
                      ? 'Hide confirmation passcode'
                      : 'Hide confirmation password'
                  }
                  showPasswordLabel={
                    activeLoginIsPasscode
                      ? 'Show confirmation passcode'
                      : 'Show confirmation password'
                  }
                  required
                  autoComplete="new-password"
                  value={confirmNewSecret}
                  onChange={(e) => setConfirmNewSecret(e.target.value)}
                  placeholder={
                    activeLoginIsPasscode ? 'Re-enter new passcode' : 'Re-enter new password'
                  }
                />

                <ActionButton type="submit" fullWidth disabled={submitting} className="h-11">
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {submitting
                      ? activeLoginIsPasscode
                        ? 'RESETTING PASSCODE...'
                        : 'RESETTING PASSWORD...'
                      : activeLoginIsPasscode
                        ? 'RESET PASSCODE'
                        : 'RESET PASSWORD'}
                  </span>
                </ActionButton>
              </form>
            )}

            <p className="text-[11px] text-slate-500 pt-2 border-t border-slate-100 leading-relaxed">
              On a local workstation terminal, you can also reset credentials by running{' '}
              <code className="font-mono text-[#0F2437] bg-slate-100 px-1 py-0.5 rounded">
                nssf-statement-dispatch --reset-admin
              </code>
              .
            </p>
          </div>
        ) : (
          <form
            onSubmit={isSetupMode ? handleSetupSubmit : handleLoginSubmit}
            className="py-6 space-y-5"
          >
            <p className="text-xs text-slate-600 leading-relaxed">
              {isSetupMode
                ? 'Initial administrator setup is required before using the NSSF Service Desk. Choose either Username & Password or Passcode login.'
                : activeLoginIsPasscode
                  ? 'Enter your administrator passcode to unlock System Settings, Security, and Audit Logs.'
                  : 'Sign in with your administrator username and password to manage System Settings and Audit Logs.'}
            </p>

            {isSetupMode && (
              <div
                role="group"
                aria-label="Administrator sign-in method"
                className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md"
              >
                <button
                  type="button"
                  onClick={() => {
                    setSetupAuthMode('password');
                    setFormError('');
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                    setupAuthMode === 'password'
                      ? 'bg-white text-[#0F2437] shadow-sm'
                      : 'text-slate-600 hover:text-[#0F2437]'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Username &amp; Password</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSetupAuthMode('passcode');
                    setFormError('');
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                    setupAuthMode === 'passcode'
                      ? 'bg-white text-[#0F2437] shadow-sm'
                      : 'text-slate-600 hover:text-[#0F2437]'
                  }`}
                >
                  <Hash className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Passcode Login</span>
                </button>
              </div>
            )}

            {formError && (
              <AlertBanner variant="error" message={formError} className="text-xs p-3.5" />
            )}
            {formNotice && (
              <AlertBanner variant="success" message={formNotice} className="text-xs p-3.5" />
            )}

            {((isSetupMode && setupAuthMode === 'password') ||
              (!isSetupMode && !activeLoginIsPasscode)) && (
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

            {isSetupMode && (
              <FormInput
                id="admin-recovery-email"
                label={
                  setupAuthMode === 'passcode'
                    ? 'Recovery Email (Recommended for Passcode Reset)'
                    : 'Recovery Email (Optional)'
                }
                variant="compact"
                type="email"
                autoComplete="email"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                placeholder="admin@nssfkenya.co.ke"
              />
            )}

            {(isSetupMode && setupAuthMode === 'passcode') ||
            (!isSetupMode && activeLoginIsPasscode) ? (
              <>
                <FormInput
                  id="admin-passcode"
                  label="Administrator Passcode"
                  variant="compact"
                  passwordToggle
                  hidePasswordLabel="Hide passcode"
                  showPasswordLabel="Show passcode"
                  required
                  autoComplete={isSetupMode ? 'new-password' : 'current-password'}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder={
                    isSetupMode ? 'Minimum 6 characters (digits or text)' : 'Enter passcode'
                  }
                  className="font-mono tracking-wider"
                />

                {!isSetupMode && !status.envPasscodeConfigured && (
                  <div className="flex justify-end -mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setResetMethod(
                          status.smtpConfigured && status.hasRecoveryEmail
                            ? 'email_code'
                            : 'recovery_key'
                        );
                        setMode('forgot');
                        setFormError('');
                        setFormNotice('');
                      }}
                      className="text-xs font-semibold text-[#2B7A3B] hover:underline cursor-pointer"
                    >
                      Forgot passcode?
                    </button>
                  </div>
                )}

                {isSetupMode && (
                  <FormInput
                    id="admin-confirm-passcode"
                    label="Confirm Passcode"
                    variant="compact"
                    passwordToggle
                    hidePasswordLabel="Hide confirmation passcode"
                    showPasswordLabel="Show confirmation passcode"
                    required
                    autoComplete="new-password"
                    value={confirmPasscode}
                    onChange={(e) => setConfirmPasscode(e.target.value)}
                    placeholder="Re-enter passcode"
                    className="font-mono tracking-wider"
                  />
                )}
              </>
            ) : (
              <>
                <FormInput
                  id="admin-password"
                  label="Password"
                  variant="compact"
                  passwordToggle
                  required
                  autoComplete={isSetupMode ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSetupMode ? 'Minimum 8 characters' : 'Enter password'}
                />

                {!isSetupMode && !status.envPasscodeConfigured && (
                  <div className="flex justify-end -mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setResetMethod(
                          status.smtpConfigured && status.hasRecoveryEmail
                            ? 'email_code'
                            : 'recovery_key'
                        );
                        setMode('forgot');
                        setFormError('');
                        setFormNotice('');
                      }}
                      className="text-xs font-semibold text-[#2B7A3B] hover:underline cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

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
              </>
            )}

            <ActionButton type="submit" fullWidth disabled={submitting} className="h-11">
              <KeyRound className="w-4 h-4" aria-hidden="true" />
              <span>
                {submitting
                  ? isSetupMode
                    ? 'CREATING ADMIN...'
                    : 'VERIFYING...'
                  : isSetupMode
                    ? setupAuthMode === 'passcode'
                      ? 'SET ADMIN PASSCODE'
                      : 'CREATE ADMIN ACCOUNT'
                    : 'SIGN IN'}
              </span>
            </ActionButton>
          </form>
        )}
      </motion.div>
    </div>
  );
}
