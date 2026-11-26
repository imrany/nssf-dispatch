import { useApp } from '../context/AppContext';
import { ROUTES } from '../utils/constants';
import { AdminCredentialsSection } from './settings/AdminCredentialsSection';
import { BackButton, PageHeader } from './ui';

export function SecurityView() {
  const { adminUsername, navigateTo } = useApp();
  const displayUser = adminUsername || 'admin';

  return (
    <div className="py-4 sm:py-8 space-y-6">
      <BackButton label="Back to Settings" onClick={() => navigateTo(ROUTES.SETTINGS)} />

      <PageHeader
        title="SECURITY"
        subtitle={
          <>
            Signed in as <strong className="text-[#0F2437]">{displayUser}</strong> · Manage administrator credentials, recovery email, password, and backup recovery key.
          </>
        }
      />

      <AdminCredentialsSection />
    </div>
  );
}
