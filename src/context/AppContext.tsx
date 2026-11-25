import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from '../components/Toaster';
import type { AppSettings, DispatchReceipt, PendingSettingsAction } from '../types';
import { fetchSettingsApi, logoutAdminApi } from '../utils/api';
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
  adminToken: string | null;
  adminUsername: string | null;
  authenticateAdmin: (token: string, username: string, fullSettings: AppSettings) => void;
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
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUsername, setAdminUsername] = useState<string | null>(null);

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
    void refreshSettings(adminToken);
  }, [adminToken, refreshSettings]);

  // Keep browser tab title synchronized with context appName and active route
  useEffect(() => {
    const routeSuffix =
      location.pathname === ROUTES.SETTINGS
        ? 'Settings'
        : location.pathname === ROUTES.AUDIT
          ? 'Audit Logs'
          : receipt
            ? 'Dispatch Confirmed'
            : 'Service Desk';
    document.title = `${appName} — ${routeSuffix}`;
  }, [appName, location.pathname, receipt]);

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
    (token: string, username: string, fullSettings: AppSettings) => {
      setAdminToken(token);
      setAdminUsername(username);
      setSettings(fullSettings);
    },
    []
  );

  const logoutAdmin = useCallback(
    (reason: 'manual' | 'expired' = 'manual') => {
      const tokenToRevoke = adminToken;
      setAdminToken(null);
      setAdminUsername(null);
      setSettingsDirty(false);
      setPendingNavigation(null);

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
      adminToken,
      adminUsername,
      authenticateAdmin,
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
      adminToken,
      adminUsername,
      authenticateAdmin,
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
