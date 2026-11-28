import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from '../components/Toaster';
import type {
  AdminAuthMode,
  AdminAuthStatus,
  AppSettings,
  DispatchReceipt,
  PendingSettingsAction,
} from '../types';
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
  adminAuthMode: AdminAuthMode;
  adminRecoveryEmail: string;
  idleLockMinutes: number;
  setIdleLockMinutes: React.Dispatch<React.SetStateAction<number>>;
  pendingRecoveryKey: string | null;
  clearPendingRecoveryKey: (targetPath?: string) => void;
  authenticateAdmin: (
    token: string,
    username: string,
    fullSettings: AppSettings,
    options?: {
      authMode?: AdminAuthMode;
      recoveryEmail?: string;
      recoveryKey?: string | null;
      idleLockMinutes?: number;
    }
  ) => void;
  updateAdminCredentialsSession: (
    token: string,
    username: string,
    recoveryEmail: string,
    authMode?: AdminAuthMode
  ) => void;
  logoutAdmin: (reason?: 'manual' | 'expired' | 'idle') => void;
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
  const [adminAuthMode, setAdminAuthMode] = useState<AdminAuthMode>('password');
  const [adminRecoveryEmail, setAdminRecoveryEmail] = useState('');
  const [idleLockMinutes, setIdleLockMinutes] = useState(0);
  const [pendingRecoveryKey, setPendingRecoveryKey] = useState<string | null>(null);

  const refreshAuthStatus = useCallback(async (): Promise<AdminAuthStatus | null> => {
    setAuthStatusError('');
    try {
      const data = await fetchAuthStatusApi();
      setAuthStatus(data);
      if (data.authMode) {
        setAdminAuthMode(data.authMode);
      }
      if (typeof data.idleLockMinutes === 'number') {
        setIdleLockMinutes(data.idleLockMinutes);
      }
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
      options?: {
        authMode?: AdminAuthMode;
        recoveryEmail?: string;
        recoveryKey?: string | null;
        idleLockMinutes?: number;
      }
    ) => {
      const recEmail = options?.recoveryEmail ?? '';
      const mode: AdminAuthMode = options?.authMode ?? 'password';
      setAdminToken(token);
      setAdminUsername(username);
      setAdminAuthMode(mode);
      setAdminRecoveryEmail(recEmail);
      if (typeof options?.idleLockMinutes === 'number') {
        setIdleLockMinutes(options.idleLockMinutes);
      }
      setSettings(fullSettings);
      setAuthStatus((prev) => ({
        adminExists: true,
        authenticated: true,
        username,
        authMode: mode,
        envPasscodeConfigured: prev?.envPasscodeConfigured ?? false,
        hasRecoveryEmail: Boolean(recEmail) || Boolean(prev?.hasRecoveryEmail),
        hasRecoveryKey: Boolean(options?.recoveryKey) || Boolean(prev?.hasRecoveryKey),
        smtpConfigured: prev?.smtpConfigured ?? false,
        recoveryEmail: recEmail,
        idleLockMinutes: options?.idleLockMinutes ?? prev?.idleLockMinutes ?? 0,
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
    (token: string, username: string, recoveryEmail: string, authMode?: AdminAuthMode) => {
      setAdminToken(token);
      setAdminUsername(username);
      setAdminRecoveryEmail(recoveryEmail);
      if (authMode) {
        setAdminAuthMode(authMode);
      }
      setAuthStatus((prev) =>
        prev
          ? {
              ...prev,
              username,
              authMode: authMode ?? prev.authMode,
              recoveryEmail,
              hasRecoveryEmail: Boolean(recoveryEmail),
            }
          : prev
      );
    },
    []
  );

  const logoutAdmin = useCallback(
    (reason: 'manual' | 'expired' | 'idle' = 'manual') => {
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
      } else if (reason === 'idle') {
        toast.warning('Settings auto-locked', 'Administrator session locked due to inactivity.');
      } else {
        toast.success('Settings locked', 'Administrator session ended.');
      }
    },
    [adminToken]
  );

  // Automatic inactivity lock for authenticated admin sessions when enabled in Security Policy
  useEffect(() => {
    if (!adminToken || idleLockMinutes <= 0) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutMs = idleLockMinutes * 60 * 1000;

    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        logoutAdmin('idle');
      }, timeoutMs);
    };

    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
    ];
    events.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [adminToken, idleLockMinutes, logoutAdmin]);

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
      adminAuthMode,
      adminRecoveryEmail,
      idleLockMinutes,
      setIdleLockMinutes,
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
      adminAuthMode,
      adminRecoveryEmail,
      idleLockMinutes,
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
