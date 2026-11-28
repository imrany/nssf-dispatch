import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Hash,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { AdminAuthMode, SecurityOverview } from '../../types';
import {
  ApiError,
  changeAdminCredentialsApi,
  regenerateRecoveryKeyApi,
  testRecoveryEmailApi,
} from '../../utils/api';
import { triggerBlobDownload } from '../../utils/download';
import { isValidAdminUsername, isValidEmail } from '../../utils/validation';
import { toast } from '../Toaster';
import { AlertBanner, FormInput } from '../ui';

interface AdminCredentialsSectionProps {
  overview?: SecurityOverview | null;
  onChanged?: () => void | Promise<void>;
}

export function AdminCredentialsSection({ overview, onChanged }: AdminCredentialsSectionProps) {
  const {
    adminToken,
    adminUsername,
    adminAuthMode,
    adminRecoveryEmail,
    authStatus,
    updateAdminCredentialsSession,
    logoutAdmin,
  } = useApp();

  const token = adminToken || '';
  const envManaged = Boolean(
    overview?.envPasscodeConfigured ?? authStatus?.envPasscodeConfigured
  );
  const currentActiveMode: AdminAuthMode =
    overview?.authMode ?? authStatus?.authMode ?? adminAuthMode ?? 'password';
  const smtpConfigured = Boolean(overview?.smtpConfigured ?? authStatus?.smtpConfigured);

  const [selectedMode, setSelectedMode] = useState<AdminAuthMode>(currentActiveMode);
  const [newUsername, setNewUsername] = useState(
    overview?.username || adminUsername || 'admin'
  );
  const [recoveryEmail, setRecoveryEmail] = useState(
    overview?.recoveryEmail || adminRecoveryEmail || authStatus?.recoveryEmail || ''
  );
  const [currentCredential, setCurrentCredential] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [confirmNewPasscode, setConfirmNewPasscode] = useState('');

  const [savingCreds, setSavingCreds] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [regeneratingKey, setRegeneratingKey] = useState(false);
  const [freshRecoveryKey, setFreshRecoveryKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    setSelectedMode(currentActiveMode);
  }, [currentActiveMode]);

  useEffect(() => {
    if (overview?.username) {
      setNewUsername(overview.username);
    } else if (adminUsername) {
      setNewUsername(adminUsername);
    }
  }, [overview?.username, adminUsername]);

  useEffect(() => {
    if (overview?.recoveryEmail !== undefined) {
      setRecoveryEmail(overview.recoveryEmail);
    } else if (adminRecoveryEmail) {
      setRecoveryEmail(adminRecoveryEmail);
    } else if (authStatus?.recoveryEmail) {
      setRecoveryEmail(authStatus.recoveryEmail);
    }
  }, [overview?.recoveryEmail, adminRecoveryEmail, authStatus?.recoveryEmail]);

  const isSwitchingMode = selectedMode !== currentActiveMode;
  const savedRecoveryEmail = (overview?.recoveryEmail ?? adminRecoveryEmail ?? '').trim();

  const handleSelectMode = (nextMode: AdminAuthMode) => {
    setSelectedMode(nextMode);
    setErrorMsg('');
    setSuccessMsg('');
    if (nextMode === 'passcode') {
      setNewPassword('');
      setConfirmNewPassword('');
    } else {
      setNewPasscode('');
      setConfirmNewPasscode('');
    }
  };

  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const cleanUser = newUsername.trim() || 'admin';
    const cleanEmail = recoveryEmail.trim();

    if (!currentCredential) {
      setErrorMsg(
        currentActiveMode === 'passcode'
          ? 'Enter your current administrator passcode to save changes.'
          : 'Enter your current administrator password to save changes.'
      );
      return;
    }

    if (cleanEmail && !isValidEmail(cleanEmail)) {
      setErrorMsg('Please enter a valid recovery email address.');
      return;
    }

    if (selectedMode === 'password') {
      if (!isValidAdminUsername(cleanUser)) {
        setErrorMsg('Username must be 3 to 64 characters (letters, numbers, ., _, @, -).');
        return;
      }
      if (isSwitchingMode && !newPassword) {
        setErrorMsg('Enter a new password (8 to 128 characters) to switch to Username & Password login.');
        return;
      }
      if (newPassword && (newPassword.length < 8 || newPassword.length > 128)) {
        setErrorMsg('New password must be between 8 and 128 characters.');
        return;
      }
      if (newPassword && newPassword !== confirmNewPassword) {
        setErrorMsg('New password and confirmation do not match.');
        return;
      }
    } else {
      const cleanPasscode = newPasscode.trim();
      const cleanConfirm = confirmNewPasscode.trim();
      if (isSwitchingMode && !cleanPasscode) {
        setErrorMsg('Enter a new passcode (6 to 64 characters) to switch to Passcode login.');
        return;
      }
      if (cleanPasscode && (cleanPasscode.length < 6 || cleanPasscode.length > 64)) {
        setErrorMsg('New passcode must be between 6 and 64 characters.');
        return;
      }
      if (cleanPasscode && cleanPasscode !== cleanConfirm) {
        setErrorMsg('New passcode and confirmation do not match.');
        return;
      }
    }

    setSavingCreds(true);
    try {
      const res = await changeAdminCredentialsApi(token, {
        authMode: selectedMode,
        currentCredential,
        newUsername: selectedMode === 'password' ? cleanUser : adminUsername || 'admin',
        recoveryEmail: cleanEmail,
        newPassword: selectedMode === 'password' && newPassword ? newPassword : undefined,
        newPasscode:
          selectedMode === 'passcode' && newPasscode.trim() ? newPasscode.trim() : undefined,
      });
      updateAdminCredentialsSession(
        res.token,
        res.username,
        res.recoveryEmail || '',
        res.authMode
      );
      setCurrentCredential('');
      setNewPassword('');
      setConfirmNewPassword('');
      setNewPasscode('');
      setConfirmNewPasscode('');
      setSuccessMsg(res.message);
      toast.success(
        'Security credentials updated',
        res.authMode === 'passcode'
          ? 'Passcode login is now active (Username & Password disabled).'
          : `Username & Password login is now active for ${res.username} (Passcode disabled).`
      );
      await onChanged?.();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 401 &&
        !err.message.toLowerCase().includes('current')
      ) {
        logoutAdmin('expired');
        return;
      }
      const msg =
        err instanceof Error ? err.message : 'Unable to update administrator credentials.';
      setErrorMsg(msg);
      toast.error('Update failed', msg);
    } finally {
      setSavingCreds(false);
    }
  };

  const handleTestRecoveryEmail = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    const target = recoveryEmail.trim();
    if (!target || !isValidEmail(target)) {
      setErrorMsg('Enter a valid recovery email address before running a test.');
      return;
    }
    setTestingEmail(true);
    try {
      const res = await testRecoveryEmailApi(token, target);
      setSuccessMsg(res.message);
      toast.success('Recovery email verified', res.message);
      await onChanged?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logoutAdmin('expired');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to send test recovery email.';
      setErrorMsg(msg);
      toast.error('Recovery email test failed', msg);
    } finally {
      setTestingEmail(false);
    }
  };

  const handleRegenerateRecoveryKey = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    if (!currentCredential) {
      setErrorMsg(
        currentActiveMode === 'passcode'
          ? 'Enter your Current Passcode first to regenerate the backup recovery key.'
          : 'Enter your Current Password first to regenerate the backup recovery key.'
      );
      toast.warning(
        'Current credential required',
        currentActiveMode === 'passcode'
          ? 'Enter your current passcode to rotate the recovery key.'
          : 'Enter your current password to rotate the recovery key.'
      );
      return;
    }
    setRegeneratingKey(true);
    try {
      const res = await regenerateRecoveryKeyApi(token, currentCredential);
      setFreshRecoveryKey(res.recoveryKey);
      setCopiedKey(false);
      toast.success('Backup recovery key rotated', 'Save the new key shown below.');
      await onChanged?.();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to regenerate backup recovery key.';
      setErrorMsg(msg);
      toast.error('Rotation failed', msg);
    } finally {
      setRegeneratingKey(false);
    }
  };

  const handleCopyKey = async () => {
    if (!freshRecoveryKey) return;
    try {
      await navigator.clipboard.writeText(freshRecoveryKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2500);
    } catch {
      toast.warning('Copy failed', 'Download the key file instead.');
    }
  };

  const handleDownloadKey = () => {
    if (!freshRecoveryKey) return;
    const body = [
      'NSSF DIGITAL STATEMENT DISPATCH — ADMINISTRATOR RECOVERY KEY',
      '==============================================================',
      `Administrator Account: ${newUsername || adminUsername || 'admin'}`,
      `Login Method:          ${selectedMode === 'passcode' ? 'Passcode' : 'Username & Password'}`,
      `Recovery Key:          ${freshRecoveryKey}`,
      `Generated At:          ${new Date().toISOString()}`,
      '',
    ].join('\n');
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    triggerBlobDownload(blob, 'NSSF_Admin_Recovery_Key.txt');
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#006837]" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold text-[#006837]">
            Login Method, Credentials &amp; Recovery
          </h2>
        </div>
        <span className="text-xs text-slate-500">
          Active method:{' '}
          <strong className="text-[#0F2437]">
            {currentActiveMode === 'passcode' ? 'Passcode Only' : 'Username & Password'}
          </strong>
        </span>
      </div>

      {envManaged ? (
        <AlertBanner
          variant="warning"
          message="Login is currently overridden by the NSSF_ADMIN_PASSCODE environment variable. Unset NSSF_ADMIN_PASSCODE on the host to manage local administrator credentials or login methods here."
          className="text-xs p-3.5"
        />
      ) : (
        <form onSubmit={handleUpdateCredentials} className="space-y-5">
          {errorMsg && <AlertBanner variant="error" message={errorMsg} className="text-xs p-3" />}
          {successMsg && (
            <AlertBanner variant="success" message={successMsg} className="text-xs p-3" />
          )}

          {/* Mutually Exclusive Login Method Switcher */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0F2437]">
                Administrator Sign-In Method (Choose One)
              </span>
              <span className="text-[11px] text-slate-500">
                Only one sign-in method can be active at a time
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleSelectMode('password')}
                className={`text-left p-3.5 rounded-md border transition-colors cursor-pointer ${
                  selectedMode === 'password'
                    ? 'border-[#2B7A3B] bg-emerald-50/50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0F2437]">
                    <UserCheck className="w-4 h-4 text-[#2B7A3B]" aria-hidden="true" />
                    <span>Username &amp; Password</span>
                  </span>
                  {currentActiveMode === 'password' && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-[#1E6B34]">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Standard administrator username with an 8+ character password.
                </p>
              </button>

              <button
                type="button"
                onClick={() => handleSelectMode('passcode')}
                className={`text-left p-3.5 rounded-md border transition-colors cursor-pointer ${
                  selectedMode === 'passcode'
                    ? 'border-[#2B7A3B] bg-emerald-50/50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0F2437]">
                    <Hash className="w-4 h-4 text-[#2B7A3B]" aria-hidden="true" />
                    <span>Passcode Login</span>
                  </span>
                  {currentActiveMode === 'passcode' && (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-[#1E6B34]">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Quick 6+ character passcode sign-in with email recovery if forgotten.
                </p>
              </button>
            </div>

            {isSwitchingMode && (
              <AlertBanner
                variant="warning"
                message={
                  selectedMode === 'passcode'
                    ? 'Switching to Passcode Login will disable Username & Password sign-in once saved.'
                    : 'Switching to Username & Password will disable Passcode sign-in once saved.'
                }
                className="text-xs p-3"
              />
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedMode === 'password' && (
              <FormInput
                id="cred-username"
                label="Administrator Username"
                variant="compact"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="admin"
              />
            )}

            <div className={selectedMode === 'passcode' ? 'md:col-span-2' : ''}>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <FormInput
                    id="cred-recovery-email"
                    label={
                      selectedMode === 'passcode'
                        ? 'Recovery Email (For Forgot Passcode)'
                        : 'Recovery Email (For Forgot Password)'
                    }
                    variant="compact"
                    type="email"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="admin@nssfkenya.co.ke"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleTestRecoveryEmail()}
                  disabled={testingEmail || !smtpConfigured || !recoveryEmail.trim()}
                  title={
                    smtpConfigured
                      ? 'Send a test verification email to verify recovery delivery'
                      : 'Configure SMTP in Settings first to enable email recovery'
                  }
                  className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-md border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                >
                  <Mail className="w-3.5 h-3.5 text-[#2B7A3B]" aria-hidden="true" />
                  <span>{testingEmail ? 'Sending...' : 'Test Email'}</span>
                </button>
              </div>
              {!smtpConfigured && (
                <p className="text-[11px] text-amber-700 mt-1">
                  Configure SMTP credentials in Settings so forgotten passwords or passcodes can be
                  emailed to {savedRecoveryEmail || 'your recovery inbox'}.
                </p>
              )}
            </div>

            <FormInput
              id="cred-current-credential"
              label={
                currentActiveMode === 'passcode'
                  ? 'Current Passcode (Required to Save or Rotate Key)'
                  : 'Current Password (Required to Save or Rotate Key)'
              }
              variant="compact"
              passwordToggle
              hidePasswordLabel={
                currentActiveMode === 'passcode' ? 'Hide current passcode' : 'Hide current password'
              }
              showPasswordLabel={
                currentActiveMode === 'passcode' ? 'Show current passcode' : 'Show current password'
              }
              required
              autoComplete="current-password"
              value={currentCredential}
              onChange={(e) => setCurrentCredential(e.target.value)}
              placeholder={
                currentActiveMode === 'passcode'
                  ? 'Enter current passcode'
                  : 'Enter current password'
              }
            />

            <div className="hidden md:block" />

            {selectedMode === 'password' ? (
              <>
                <FormInput
                  id="cred-new-password"
                  label={
                    isSwitchingMode
                      ? 'New Password (Required to Switch)'
                      : 'New Password (Optional)'
                  }
                  variant="compact"
                  passwordToggle
                  required={isSwitchingMode}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={
                    isSwitchingMode
                      ? 'Minimum 8 characters'
                      : 'Leave blank to keep existing password'
                  }
                />

                <FormInput
                  id="cred-confirm-password"
                  label="Confirm New Password"
                  variant="compact"
                  passwordToggle
                  hidePasswordLabel="Hide confirmation password"
                  showPasswordLabel="Show confirmation password"
                  required={isSwitchingMode || Boolean(newPassword)}
                  autoComplete="new-password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Re-enter new password"
                />
              </>
            ) : (
              <>
                <FormInput
                  id="cred-new-passcode"
                  label={
                    isSwitchingMode
                      ? 'New Passcode (Required to Switch)'
                      : 'New Passcode (Optional)'
                  }
                  variant="compact"
                  passwordToggle
                  hidePasswordLabel="Hide new passcode"
                  showPasswordLabel="Show new passcode"
                  required={isSwitchingMode}
                  autoComplete="new-password"
                  value={newPasscode}
                  onChange={(e) => setNewPasscode(e.target.value)}
                  placeholder={
                    isSwitchingMode
                      ? 'Minimum 6 characters (digits or text)'
                      : 'Leave blank to keep existing passcode'
                  }
                  className="font-mono tracking-wider"
                />

                <FormInput
                  id="cred-confirm-passcode"
                  label="Confirm New Passcode"
                  variant="compact"
                  passwordToggle
                  hidePasswordLabel="Hide confirmation passcode"
                  showPasswordLabel="Show confirmation passcode"
                  required={isSwitchingMode || Boolean(newPasscode.trim())}
                  autoComplete="new-password"
                  value={confirmNewPasscode}
                  onChange={(e) => setConfirmNewPasscode(e.target.value)}
                  placeholder="Re-enter new passcode"
                  className="font-mono tracking-wider"
                />
              </>
            )}
          </div>

          {freshRecoveryKey && (
            <div className="p-4 rounded-md bg-emerald-50/50 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#1E6B34]">
                  New Backup Recovery Key (Save Now)
                </div>
                <div className="font-mono text-sm font-bold text-[#0F2437] mt-0.5 select-all tabular-nums">
                  {freshRecoveryKey}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleCopyKey()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-semibold text-[#0F2437] hover:bg-slate-50 cursor-pointer"
                >
                  {copiedKey ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#2B7A3B]" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadKey}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-semibold text-[#0F2437] hover:bg-slate-50 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Download</span>
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={() => void handleRegenerateRecoveryKey()}
              disabled={regeneratingKey || savingCreds}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-[#D1D9E0] bg-white text-xs font-bold uppercase tracking-wider text-[#0F2437] hover:bg-slate-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${regeneratingKey ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>
                {regeneratingKey ? 'Generating...' : 'Regenerate Backup Recovery Key'}
              </span>
            </button>

            <button
              type="submit"
              disabled={savingCreds || regeneratingKey}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded bg-[#0F2437] text-white text-xs font-bold uppercase tracking-wider hover:bg-[#1a3650] disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {savingCreds
                  ? 'Saving...'
                  : isSwitchingMode
                    ? selectedMode === 'passcode'
                      ? 'Switch to Passcode Login'
                      : 'Switch to Password Login'
                    : 'Update Admin Credentials'}
              </span>
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
