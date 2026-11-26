import { AlertCircle, Lock } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuditLogsView } from './components/AuditLogsView';
import { DispatchSuccess } from './components/DispatchSuccess';
import { DispatchWorkspace } from './components/DispatchWorkspace';
import { SettingsAuthGate } from './components/SettingsAuthGate';
import { SettingsView } from './components/SettingsView';
import { Toaster } from './components/Toaster';
import { ActionButton } from './components/ui';
import { AppProvider, useApp } from './context/AppContext';
import { APP_NAME, ROUTES, SMOOTH_EASE } from './utils/constants';

function StatementsPage() {
  const { receipt, setReceipt } = useApp();

  if (receipt) {
    return <DispatchSuccess receipt={receipt} onReset={() => setReceipt(null)} />;
  }
  return <DispatchWorkspace />;
}

function SettingsPage() {
  const { adminToken } = useApp();
  return adminToken ? <SettingsView /> : <SettingsAuthGate />;
}

function AuditPage() {
  const { adminToken } = useApp();
  return adminToken ? <AuditLogsView /> : <SettingsAuthGate />;
}

function AppShell() {
  const {
    publisher,
    tagline,
    officeLocation,
    ussdCode,
    receipt,
    adminToken,
    authStatus,
    authStatusLoaded,
    authStatusError,
    refreshAuthStatus,
    pendingRecoveryKey,
  } = useApp();
  const location = useLocation();

  const requiresInitialSetup =
    authStatusLoaded && (!authStatus?.adminExists || Boolean(pendingRecoveryKey));

  const viewKey = !authStatusLoaded
    ? 'loading-init'
    : requiresInitialSetup
      ? `initial-setup:${pendingRecoveryKey ? 'key' : 'form'}`
      : `${location.pathname}:${receipt ? 'confirmed' : 'form'}:${adminToken ? 'auth' : 'gate'}`;

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen flex flex-col bg-white text-[#0F2437]">
        <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-8 py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={viewKey}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: SMOOTH_EASE }}
            >
              {!authStatusLoaded ? (
                <div className="py-16 max-w-md mx-auto text-center space-y-3">
                  <div className="w-11 h-11 rounded-full bg-emerald-50 border border-emerald-200 text-[#2B7A3B] flex items-center justify-center mx-auto">
                    <Lock className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="text-sm font-semibold text-[#0F2437]">
                    Checking system initialization status...
                  </div>
                </div>
              ) : authStatusError && !authStatus ? (
                <div className="py-16 max-w-md mx-auto text-center space-y-4">
                  <AlertCircle className="w-8 h-8 text-red-600 mx-auto" aria-hidden="true" />
                  <div className="text-sm font-semibold text-[#0F2437]">{authStatusError}</div>
                  <ActionButton onClick={() => void refreshAuthStatus()}>Retry</ActionButton>
                </div>
              ) : requiresInitialSetup ? (
                <SettingsAuthGate initialSetupRequired />
              ) : (
                <Routes location={location}>
                  <Route path={ROUTES.ROOT} element={<Navigate to={ROUTES.STATEMENTS} replace />} />
                  <Route path={ROUTES.STATEMENTS} element={<StatementsPage />} />
                  <Route path={ROUTES.SETTINGS} element={<SettingsPage />} />
                  <Route path={ROUTES.AUDIT} element={<AuditPage />} />
                  <Route path="*" element={<Navigate to={ROUTES.STATEMENTS} replace />} />
                </Routes>
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="border-t border-slate-200 bg-white py-5 px-4 sm:px-8">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              {publisher} · {tagline}
            </span>
            <span>
              {officeLocation} · USSD {ussdCode}
            </span>
          </div>
        </footer>
        <Toaster />
      </div>
    </MotionConfig>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider appName={APP_NAME}>
        <AppShell />
      </AppProvider>
    </BrowserRouter>
  );
}
