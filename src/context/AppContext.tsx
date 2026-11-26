import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from '../components/Toaster';
import type { AdminAuthStatus, AppSettings, DispatchReceipt, PendingSettingsAction } from '../types';
import { fetchAuthStatusApi, fetchSettingsApi, logoutAdminApi } from '../utils/api';
import {
  APP_NAME,
  APP_OFFICE_LOCATION,
  APP_PUBLISHER,
  APP_TAGLINE,
  APP_USSD_CODE,
  DEFAULT_SETTINGS,
  ROUTES,
} from '../utils/constants';

export interface AppContextValue {
  appName: string;
  publisher: string;
  tagline: string;
  officeLocation: string;
  ussdCode: string;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  refreshSettings: (tokenOverride?: string | null) => Promise<void>;
  receipt: DispatchReceipt | null;
  setReceipt: React.Dispatch<React.SetStateAction<DispatchReceipt | null>>;
  authStatus: AdminAuthStatus | null;
  authStatusLoaded: boolean;
  authStatusError: string;
  refreshAuthStatus: () => Promise<AdminAuthStatus | null>;
  adminToken: string | null;
  adminUsername: string | null;
  adminRecoveryEmail: string;
  pendingRecoveryKey: string | null;
  clearPendingRecoveryKey: (targetPath?: string) => void;
  authenticateAdmin: (
    token: string,
    username: string,
    fullSettings: AppSettings,
    options?: { recoveryEmail?: string; recoveryKey?: string | null }
  ) => void;
  updateAdminCredentialsSession: (
    token: string,
    username: string,
    recoveryEmail: string
  ) => void;
  logoutAdmin: (reason?: 'manual' | 'expired') => void;
  settingsDirty: boolean;
  setSettingsDirty: React.Dispatch<React.SetStateAction<boolean>>;
  pendingNavigation: PendingSettingsAction | null;
  setPendingNavigation: React.Dispatch<React.SetStateAction<PendingSettingsAction | null>>;
  navigateTo: (targetPath: string, options?: { bypassDirtyCheck?: boolean }) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  appName = APP_NAME,
  children,
}: {
  appName?: string;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [receipt, setReceipt] = useState<DispatchReceipt | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingSettingsAction | null>(null);

  const [authStatus, setAuthStatus] = useState<AdminAuthStatus | null>(null);
  const [authStatusLoaded, setAuthStatusLoaded] = useState(false);
  const [authStatusError, setAuthStatusError] = useState('');

  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUsername, setAdminUsername] = useState<string | null>(null);
  const [adminRecoveryEmail, setAdminRecoveryEmail] = useState('');
  const [pendingRecoveryKey, setPendingRecoveryKey] = useState<string | null>(null);

  const refreshAuthStatus = useCallback(async (): Promise<AdminAuthStatus | null> => {
    setAuthStatusError('');
    try {
      const data = await fetchAuthStatusApi();
      setAuthStatus(data);
      setAuthStatusLoaded(true);
      return data;
    } catch (err) {
      setAuthStatusError(
        err instanceof Error ? err.message : 'Unable to reach NSSF authentication service.'
      );
      setAuthStatusLoaded(true);
      return null;
    }
  }, []);

  const refreshSettings = useCallback(
    async (tokenOverride?: string | null) => {
      const effectiveToken = tokenOverride !== undefined ? tokenOverride : adminToken;
      try {
        const data = await fetchSettingsApi(effectiveToken);
        if (data && typeof data.emailEnabled === 'boolean') {
          setSettings((prev) => ({ ...prev, ...data }));
        }
      } catch {
        // Ignore transient network errors on passive settings refresh
      }
    },
    [adminToken]
  );

  useEffect(() => {
    void refreshAuthStatus();
  }, [refreshAuthStatus]);

  useEffect(() => {
    void refreshSettings(adminToken);
  }, [adminToken, refreshSettings]);

  // Keep browser tab title synchronized with context appName and active route
  useEffect(() => {
    let routeSuffix = 'Service Desk';
    if (!authStatusLoaded || !authStatus?.adminExists || pendingRecoveryKey) {
      routeSuffix = 'Initial Admin Setup';
    } else if (location.pathname === ROUTES.SETTINGS) {
      routeSuffix = 'Settings';
    } else if (location.pathname === ROUTES.SECURITY) {
      routeSuffix = 'Security';
    } else if (location.pathname === ROUTES.AUDIT) {
      routeSuffix = 'Audit Logs';
    } else if (receipt) {
      routeSuffix = 'Dispatch Confirmed';
    }
    document.title = `${appName} — ${routeSuffix}`;
  }, [appName, authStatus?.adminExists, authStatusLoaded, location.pathname, pendingRecoveryKey, receipt]);

  const navigateTo = useCallback(
    (targetPath: string, options?: { bypassDirtyCheck?: boolean }) => {
      if (
        !options?.bypassDirtyCheck &&
        location.pathname === ROUTES.SETTINGS &&
        targetPath !== ROUTES.SETTINGS &&
        adminToken &&
        settingsDirty
      ) {
        setPendingNavigation({ type: 'route', targetPath });
        return;
      }

      if (targetPath !== ROUTES.STATEMENTS) {
        setReceipt(null);
      } else {
        void refreshSettings(adminToken);
      }

      navigate(targetPath);
    },
    [adminToken, location.pathname, navigate, refreshSettings, settingsDirty]
  );

  const authenticateAdmin = useCallback(
    (
      token: string,
      username: string,
      fullSettings: AppSettings,
      options?: { recoveryEmail?: string; recoveryKey?: string | null }
    ) => {
      const recEmail = options?.recoveryEmail ?? '';
      setAdminToken(token);
      setAdminUsername(username);
      setAdminRecoveryEmail(recEmail);
      setSettings(fullSettings);
      setAuthStatus((prev) => ({
        adminExists: true,
        authenticated: true,
        username,
        envPasscodeConfigured: prev?.envPasscodeConfigured ?? false,
        hasRecoveryEmail: Boolean(recEmail) || Boolean(prev?.hasRecoveryEmail),
        hasRecoveryKey: Boolean(options?.recoveryKey) || Boolean(prev?.hasRecoveryKey),
        smtpConfigured: prev?.smtpConfigured ?? false,
        recoveryEmail: recEmail,
      }));
      if (options?.recoveryKey) {
        setPendingRecoveryKey(options.recoveryKey);
      }
    },
    []
  );

  const clearPendingRecoveryKey = useCallback(
    (targetPath?: string) => {
      setPendingRecoveryKey(null);
      if (targetPath) {
        navigate(targetPath);
      }
    },
    [navigate]
  );

  const updateAdminCredentialsSession = useCallback(
    (token: string, username: string, recoveryEmail: string) => {
      setAdminToken(token);
      setAdminUsername(username);
      setAdminRecoveryEmail(recoveryEmail);
      setAuthStatus((prev) =>
        prev
          ? {
              ...prev,
              username,
              recoveryEmail,
              hasRecoveryEmail: Boolean(recoveryEmail),
            }
          : prev
      );
    },
    []
  );

  const logoutAdmin = useCallback(
    (reason: 'manual' | 'expired' = 'manual') => {
      const tokenToRevoke = adminToken;
      setAdminToken(null);
      setAdminUsername(null);
      setAdminRecoveryEmail('');
      setSettingsDirty(false);
      setPendingNavigation(null);
      setAuthStatus((prev) =>
        prev ? { ...prev, authenticated: false, username: null, recoveryEmail: null } : prev
      );

      if (tokenToRevoke) {
        logoutAdminApi(tokenToRevoke).catch(() => {});
      }

      if (reason === 'expired') {
        toast.warning('Session expired', 'Please sign in again to access System Settings.');
      } else {
        toast.success('Settings locked', 'Administrator session ended.');
      }
    },
    [adminToken]
  );

  const value = useMemo<AppContextValue>(
    () => ({
      appName,
      publisher: APP_PUBLISHER,
      tagline: APP_TAGLINE,
      officeLocation: APP_OFFICE_LOCATION,
      ussdCode: APP_USSD_CODE,
      settings,
      setSettings,
      refreshSettings,
      receipt,
      setReceipt,
      authStatus,
      authStatusLoaded,
      authStatusError,
      refreshAuthStatus,
      adminToken,
      adminUsername,
      adminRecoveryEmail,
      pendingRecoveryKey,
      clearPendingRecoveryKey,
      authenticateAdmin,
      updateAdminCredentialsSession,
      logoutAdmin,
      settingsDirty,
      setSettingsDirty,
      pendingNavigation,
      setPendingNavigation,
      navigateTo,
    }),
    [
      appName,
      settings,
      refreshSettings,
      receipt,
      authStatus,
      authStatusLoaded,
      authStatusError,
      refreshAuthStatus,
      adminToken,
      adminUsername,
      adminRecoveryEmail,
      pendingRecoveryKey,
      clearPendingRecoveryKey,
      authenticateAdmin,
      updateAdminCredentialsSession,
      logoutAdmin,
      settingsDirty,
      pendingNavigation,
      navigateTo,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
}

export function useAppName(): string {
  return useApp().appName;
}
