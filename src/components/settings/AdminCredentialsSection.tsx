import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  ApiError,
  changeAdminCredentialsApi,
  regenerateRecoveryKeyApi,
} from '../../utils/api';
import { triggerBlobDownload } from '../../utils/download';
import { isValidAdminUsername, isValidEmail } from '../../utils/validation';
import { toast } from '../Toaster';
import { AlertBanner, FormInput } from '../ui';

export function AdminCredentialsSection() {
  const {
    adminToken,
    adminUsername,
    adminRecoveryEmail,
    authStatus,
    updateAdminCredentialsSession,
    logoutAdmin,
  } = useApp();

  const token = adminToken || '';
  const envManaged = Boolean(authStatus?.envPasscodeConfigured);

  const [newUsername, setNewUsername] = useState(adminUsername || 'admin');
  const [recoveryEmail, setRecoveryEmail] = useState(
    adminRecoveryEmail || authStatus?.recoveryEmail || ''
  );
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [savingCreds, setSavingCreds] = useState(false);
  const [regeneratingKey, setRegeneratingKey] = useState(false);
  const [freshRecoveryKey, setFreshRecoveryKey] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (adminUsername) setNewUsername(adminUsername);
  }, [adminUsername]);

  useEffect(() => {
    if (adminRecoveryEmail) {
      setRecoveryEmail(adminRecoveryEmail);
    } else if (authStatus?.recoveryEmail) {
      setRecoveryEmail(authStatus.recoveryEmail);
    }
  }, [adminRecoveryEmail, authStatus?.recoveryEmail]);

  const handleUpdateCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const cleanUser = newUsername.trim();
    const cleanEmail = recoveryEmail.trim();

    if (!currentPassword) {
      setErrorMsg('Enter your current administrator password to save credential changes.');
      return;
    }
    if (!isValidAdminUsername(cleanUser)) {
      setErrorMsg('Username must be 3 to 64 characters (letters, numbers, ., _, @, -).');
      return;
    }
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      setErrorMsg('Please enter a valid recovery email address.');
      return;
    }
    if (newPassword && newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword && newPassword !== confirmNewPassword) {
      setErrorMsg('New password and confirmation do not match.');
      return;
    }

    setSavingCreds(true);
    try {
      const res = await changeAdminCredentialsApi(token, {
        currentPassword,
        newUsername: cleanUser,
        recoveryEmail: cleanEmail,
        newPassword: newPassword || undefined,
      });
      updateAdminCredentialsSession(res.token, res.username, res.recoveryEmail || '');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setSuccessMsg(res.message);
      toast.success('Credentials updated', `Active administrator: ${res.username}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && !err.message.toLowerCase().includes('current password')) {
        logoutAdmin('expired');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Unable to update administrator credentials.';
      setErrorMsg(msg);
      toast.error('Update failed', msg);
    } finally {
      setSavingCreds(false);
    }
  };

  const handleRegenerateRecoveryKey = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    if (!currentPassword) {
      setErrorMsg('Enter your Current Password above first to regenerate the backup recovery key.');
      toast.warning('Current password required', 'Enter your current password to rotate the recovery key.');
      return;
    }
    setRegeneratingKey(true);
    try {
      const res = await regenerateRecoveryKeyApi(token, currentPassword);
      setFreshRecoveryKey(res.recoveryKey);
      setCopiedKey(false);
      toast.success('Backup recovery key rotated', 'Save the new key shown below.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to regenerate backup recovery key.';
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
      `Administrator Username: ${newUsername || adminUsername || 'admin'}`,
      `Recovery Key:           ${freshRecoveryKey}`,
      `Generated At:           ${new Date().toISOString()}`,
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
            Administrator Credentials &amp; Password Recovery
          </h2>
        </div>
        <span className="text-xs text-slate-500">
          Active account: <strong className="text-[#0F2437]">{adminUsername || 'admin'}</strong>
        </span>
      </div>

      {envManaged ? (
        <AlertBanner
          variant="warning"
          message="Login is currently overridden by the NSSF_ADMIN_PASSCODE environment variable. Unset NSSF_ADMIN_PASSCODE on the host to manage local SQLite credentials here."
          className="text-xs p-3.5"
        />
      ) : (
        <form onSubmit={handleUpdateCredentials} className="space-y-4">
          {errorMsg && <AlertBanner variant="error" message={errorMsg} className="text-xs p-3" />}
          {successMsg && (
            <AlertBanner variant="success" message={successMsg} className="text-xs p-3" />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput
              id="cred-username"
              label="Administrator Username"
              variant="compact"
              required
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="admin"
            />

            <FormInput
              id="cred-recovery-email"
              label="Recovery Email (For Forgot Password)"
              variant="compact"
              type="email"
              value={recoveryEmail}
              onChange={(e) => setRecoveryEmail(e.target.value)}
              placeholder="admin@nssfkenya.co.ke"
            />

            <FormInput
              id="cred-current-password"
              label="Current Password (Required to Save or Rotate Key)"
              variant="compact"
              passwordToggle
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />

            <div className="hidden md:block" />

            <FormInput
              id="cred-new-password"
              label="New Password (Optional)"
              variant="compact"
              passwordToggle
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Leave blank to keep existing password"
            />

            <FormInput
              id="cred-confirm-password"
              label="Confirm New Password"
              variant="compact"
              passwordToggle
              hidePasswordLabel="Hide confirmation password"
              showPasswordLabel="Show confirmation password"
              autoComplete="new-password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder="Re-enter new password"
            />
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
              <span>{savingCreds ? 'Updating...' : 'Update Admin Credentials'}</span>
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
