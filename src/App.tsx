import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { AuditLogsView } from './components/AuditLogsView';
import { DispatchSuccess } from './components/DispatchSuccess';
import { DispatchWorkspace } from './components/DispatchWorkspace';
import { SettingsAuthGate } from './components/SettingsAuthGate';
import { SettingsView, type PendingSettingsAction } from './components/SettingsView';
import { Toaster, toast } from './components/Toaster';
import type { ActiveTab, AppSettings, DispatchReceipt } from './types';

const DEFAULT_SETTINGS: AppSettings = {
  smtpHost: 'smtp.nssfkenya.co.ke',
  smtpPort: '587',
  smtpSecurity: 'starttls',
  smtpUser: 'statements@nssfkenya.co.ke',
  hasSmtpPass: false,
  smtpFrom: 'NSSF Kenya Member Services <statements@nssfkenya.co.ke>',
  emailEnabled: true,
  whatsappEnabled: true,
  deliveryMode: 'preview',
  whatsappBridgeUrl: 'http://127.0.0.1:8095',
  whatsappPaired: false,
  whatsappDeviceName: 'NSSF Service Desk Terminal 01',
  filenameTemplate: 'NSSF_Statement_{memberNo}_{date}.pdf',
  passwordMode: 'id_card',
  portalUrl: 'https://nssfdigital.enssf.co.ke',
  previewBeforeDispatch: true,
  emailSubjectTemplate:
    'Official NSSF Provisional Member Statement — {memberName} ({memberNo})',
  whatsappMessageTemplate: `*NATIONAL SOCIAL SECURITY FUND (NSSF) KENYA*
Hello {memberName},

Please find attached your official NSSF Provisional Member Statement ({renamedFile}) for {period}.

*Member No:* {memberNo}
*Total Fund Balance:* KES {totalAmount}

*How to Open:*
Enter {passwordGuide} when prompted for the PDF password.

Self-Service: USSD *303# or {portalUrl}`,
  goServiceEnabled: false,
  goServiceUrl: 'http://127.0.0.1:8080',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dispatch');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [receipt, setReceipt] = useState<DispatchReceipt | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingSettingsAction, setPendingSettingsAction] =
    useState<PendingSettingsAction | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUsername, setAdminUsername] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings', {
      headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined,
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.emailEnabled === 'boolean') {
          setSettings((prev) => ({ ...prev, ...data }));
        }
      })
      .catch(() => {});
  }, [adminToken]);

  const navigateDirectToTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab !== 'dispatch') {
      setReceipt(null);
    }
  };

  const handleTabChange = (tab: ActiveTab) => {
    if (activeTab === 'settings' && tab !== 'settings' && adminToken && settingsDirty) {
      setPendingSettingsAction({ type: 'tab', targetTab: tab });
      return;
    }
    navigateDirectToTab(tab);
  };

  const handleAdminLogout = (reason: 'manual' | 'expired' = 'manual') => {
    const tokenToRevoke = adminToken;
    setAdminToken(null);
    setAdminUsername(null);
    setSettingsDirty(false);
    setPendingSettingsAction(null);
    if (tokenToRevoke) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenToRevoke}` },
      }).catch(() => {});
    }
    if (reason === 'expired') {
      toast.warning('Session expired', 'Please sign in again to access System Settings.');
    } else {
      toast.success('Settings locked', 'Administrator session ended.');
    }
  };

  const viewKey =
    activeTab === 'dispatch'
      ? receipt
        ? 'dispatch-success'
        : 'dispatch-form'
      : activeTab === 'settings' || activeTab === 'audit'
        ? adminToken
          ? activeTab
          : 'settings-auth'
        : activeTab;

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
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeTab === 'dispatch' && !receipt && (
                <DispatchWorkspace
                  settings={settings}
                  onSuccess={(res) => setReceipt(res)}
                  onOpenSettings={() => setActiveTab('settings')}
                />
              )}

              {activeTab === 'dispatch' && receipt && (
                <DispatchSuccess
                  receipt={receipt}
                  onReset={() => setReceipt(null)}
                />
              )}

              {(activeTab === 'settings' || activeTab === 'audit') && !adminToken && (
                <SettingsAuthGate
                  onAuthenticated={(token, username, fullSettings) => {
                    setAdminToken(token);
                    setAdminUsername(username);
                    setSettings(fullSettings);
                  }}
                  onBackToDispatch={() => setActiveTab('dispatch')}
                />
              )}

              {activeTab === 'audit' && adminToken && (
                <AuditLogsView
                  adminToken={adminToken}
                  onGoToDispatch={() => setActiveTab('dispatch')}
                  onBackToSettings={() => setActiveTab('settings')}
                  onAuthExpired={() => handleAdminLogout('expired')}
                />
              )}

              {activeTab === 'settings' && adminToken && (
                <SettingsView
                  settings={settings}
                  adminToken={adminToken}
                  adminUsername={adminUsername || 'admin'}
                  onSettingsUpdated={(updated) => setSettings(updated)}
                  pendingNavigation={pendingSettingsAction}
                  onClearPendingNavigation={() => setPendingSettingsAction(null)}
                  onDirtyChange={setSettingsDirty}
                  onProceedToTab={navigateDirectToTab}
                  onBackToDispatch={() => handleTabChange('dispatch')}
                  onOpenAuditLogs={() => handleTabChange('audit')}
                  onLogout={() => handleAdminLogout('manual')}
                  onAuthExpired={() => handleAdminLogout('expired')}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="border-t border-slate-200 bg-white py-5 px-4 sm:px-8">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <span>National Social Security Fund (NSSF) Kenya · Growing You. For Good</span>
            <span>Social Security House, Bishops Road, Nairobi · USSD *303#</span>
          </div>
        </footer>
        <Toaster />
      </div>
    </MotionConfig>
  );
}
