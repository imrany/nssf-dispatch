import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuditLogsView } from './components/AuditLogsView';
import { DispatchSuccess } from './components/DispatchSuccess';
import { DispatchWorkspace } from './components/DispatchWorkspace';
import { SettingsAuthGate } from './components/SettingsAuthGate';
import { SettingsView } from './components/SettingsView';
import { Toaster } from './components/Toaster';
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
  const { publisher, tagline, officeLocation, ussdCode, receipt, adminToken } = useApp();
  const location = useLocation();

  const viewKey = `${location.pathname}:${receipt ? 'confirmed' : 'form'}:${adminToken ? 'auth' : 'gate'}`;

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
              <Routes location={location}>
                <Route path={ROUTES.ROOT} element={<Navigate to={ROUTES.STATEMENTS} replace />} />
                <Route path={ROUTES.STATEMENTS} element={<StatementsPage />} />
                <Route path={ROUTES.SETTINGS} element={<SettingsPage />} />
                <Route path={ROUTES.AUDIT} element={<AuditPage />} />
                <Route path="*" element={<Navigate to={ROUTES.STATEMENTS} replace />} />
              </Routes>
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
