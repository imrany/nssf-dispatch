import { useEffect, useState } from 'react';
import { AuditLogsView } from './components/AuditLogsView';
import { DispatchSuccess } from './components/DispatchSuccess';
import { DispatchWorkspace } from './components/DispatchWorkspace';
import { Header } from './components/Header';
import { SettingsView } from './components/SettingsView';
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
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('dispatch');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [receipt, setReceipt] = useState<DispatchReceipt | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.smtpHost === 'string') {
          setSettings(data);
        }
      })
      .catch(() => {});
  }, []);

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab !== 'dispatch') {
      setReceipt(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#0F2437]">
      <Header
        activeTab={activeTab}
        onTabChange={handleTabChange}
        portalUrl={settings.portalUrl}
      />

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-8 py-8">
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

        {activeTab === 'audit' && (
          <AuditLogsView onGoToDispatch={() => setActiveTab('dispatch')} />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            settings={settings}
            onSettingsUpdated={(updated) => setSettings(updated)}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-5 px-4 sm:px-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>National Social Security Fund (NSSF) Kenya · Growing You. For Good</span>
          <span>Social Security House, Bishops Road, Nairobi · USSD *303#</span>
        </div>
      </footer>
    </div>
  );
}
