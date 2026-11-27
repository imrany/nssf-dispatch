import { ArrowUpCircle, CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import type { SystemRuntimeInfo, SystemUpdateStatus } from '../../types';
import { AlertBanner } from '../ui';
import { SectionSaveBar } from './SectionSaveBar';

interface SystemUpdatesSectionProps {
  autoUpdateEnabled: boolean;
  updateRepo: string;
  savedUpdateRepo: string;
  runtimeInfo: SystemRuntimeInfo | null;
  updateStatus: SystemUpdateStatus | null;
  checkingUpdate: boolean;
  applyingUpdate: boolean;
  restartingApp: boolean;
  dirty: boolean;
  saving: boolean;
  togglingAutoUpdate?: boolean;
  onToggleAutoUpdate: (enabled: boolean) => void;
  onChangeUpdateRepo: (repo: string) => void;
  onCheckNow: () => void;
  onApplyUpdate: () => void;
  onDiscard: () => void;
}

function getSafeReleaseUrl(raw?: string): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:' && parsed.hostname === 'github.com') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function SystemUpdatesSection({
  autoUpdateEnabled,
  updateRepo,
  savedUpdateRepo,
  runtimeInfo,
  updateStatus,
  checkingUpdate,
  applyingUpdate,
  restartingApp,
  dirty,
  saving,
  togglingAutoUpdate = false,
  onToggleAutoUpdate,
  onChangeUpdateRepo,
  onCheckNow,
  onApplyUpdate,
  onDiscard,
}: SystemUpdatesSectionProps) {
  const currentVersion =
    updateStatus?.currentVersion || runtimeInfo?.goEngineInfo?.version || runtimeInfo?.version || '1.0.0';
  const commit = runtimeInfo?.goEngineInfo?.commit || runtimeInfo?.commit || '';
  const platformLabel =
    runtimeInfo?.goEngineInfo?.os && runtimeInfo?.goEngineInfo?.arch
      ? `${runtimeInfo.goEngineInfo.os}/${runtimeInfo.goEngineInfo.arch}`
      : '';
  const safeReleaseUrl = getSafeReleaseUrl(updateStatus?.releaseUrl);
  const repoUnsaved = updateRepo.trim() !== savedUpdateRepo.trim();

  const statusBadge = (() => {
    if (restartingApp || updateStatus?.state === 'restarting') {
      return {
        label: 'Restarting...',
        cls: 'bg-blue-50 text-blue-700 border-blue-200',
      };
    }
    if (applyingUpdate || updateStatus?.state === 'downloading' || updateStatus?.state === 'applying') {
      return {
        label: 'Updating...',
        cls: 'bg-blue-50 text-blue-700 border-blue-200',
      };
    }
    if (updateStatus?.updateAvailable) {
      return {
        label: `v${updateStatus.latestVersion} Available`,
        cls: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    }
    if (updateStatus?.state === 'up_to_date') {
      return {
        label: 'Up to Date',
        cls: 'bg-emerald-50 text-[#1E6B34] border-emerald-200',
      };
    }
    if (updateStatus?.state === 'error') {
      return {
        label: 'Check Failed',
        cls: 'bg-red-50 text-red-700 border-red-200',
      };
    }
    if (updateStatus?.state === 'unconfigured') {
      return {
        label: 'Repo Not Set',
        cls: 'bg-slate-100 text-slate-600 border-slate-200',
      };
    }
    return {
      label: `v${currentVersion.replace(/^v/i, '')}`,
      cls: 'bg-slate-100 text-[#0F2437] border-slate-200',
    };
  })();

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <ArrowUpCircle className="w-4 h-4 text-[#006837] shrink-0" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold text-[#006837]">
            Automatic Self-Update &amp; Version
          </h2>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border shrink-0 ${statusBadge.cls}`}>
            {statusBadge.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCheckNow}
            disabled={checkingUpdate || applyingUpdate || restartingApp || repoUnsaved}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{checkingUpdate ? 'Checking...' : 'Check for Updates'}</span>
          </button>

          {updateStatus?.updateAvailable && (
            <button
              type="button"
              onClick={onApplyUpdate}
              disabled={applyingUpdate || restartingApp || !updateStatus.canSelfUpdate}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-[#2B7A3B] text-white text-xs font-semibold hover:bg-[#226430] disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {restartingApp
                  ? 'Restarting...'
                  : applyingUpdate
                    ? 'Installing...'
                    : `Update to v${updateStatus.latestVersion}`}
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <label
          className={`flex items-start gap-3 p-4 rounded-md border border-slate-200 transition-colors ${
            togglingAutoUpdate || saving
              ? 'opacity-70 cursor-wait'
              : 'cursor-pointer hover:border-slate-300'
          }`}
        >
          <input
            type="checkbox"
            checked={autoUpdateEnabled}
            disabled={togglingAutoUpdate || saving}
            onChange={(e) => onToggleAutoUpdate(e.target.checked)}
            className="mt-1 h-4 w-4 accent-[#006837]"
          />
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Enable Automatic Self-Update
              {togglingAutoUpdate && (
                <span className="ml-2 text-[11px] font-medium text-[#2B7A3B]">Saving...</span>
              )}
            </div>
            <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Automatically checks GitHub Releases in the background, verifies SHA-256 checksums, replaces the executable, and restarts when a newer version is released.
            </div>
          </div>
        </label>

        <div>
          <label htmlFor="update-repo" className="block text-xs font-medium text-slate-700 mb-1">
            GitHub Releases Repository (<span className="font-mono">owner/repo</span>)
          </label>
          <input
            id="update-repo"
            value={updateRepo}
            onChange={(e) => onChangeUpdateRepo(e.target.value)}
            placeholder="e.g. organization/nssf-statement-dispatch"
            className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm font-mono focus:outline-none focus:border-[#006837]"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            {repoUnsaved
              ? 'Save changes below to apply the new repository before checking.'
              : 'Auto-populated from GitHub Actions builds. Requires SHA256SUMS.txt in each release.'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200/80 rounded-md px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            Installed: <strong className="font-mono text-[#0F2437]">v{currentVersion.replace(/^v/i, '')}</strong>
          </span>
          {commit && (
            <span>
              Build: <strong className="font-mono text-[#0F2437]">{commit}</strong>
            </span>
          )}
          {platformLabel && (
            <span>
              Platform: <strong className="font-mono text-[#0F2437]">{platformLabel}</strong>
            </span>
          )}
          {updateStatus?.lastCheckedAt && (
            <span>Last checked: {updateStatus.lastCheckedAt}</span>
          )}
        </div>

        {safeReleaseUrl && (
          <a
            href={safeReleaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-[#1E6B34] hover:underline"
          >
            <span>View GitHub Release</span>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        )}
      </div>

      {updateStatus?.message && (
        <>
          {updateStatus.state === 'error' ? (
            <AlertBanner variant="error" message={updateStatus.message} className="p-3 text-xs" />
          ) : updateStatus.updateAvailable ? (
            <AlertBanner
              variant="warning"
              message={
                updateStatus.canSelfUpdate
                  ? updateStatus.message
                  : `${updateStatus.message} ${updateStatus.selfUpdateHint || ''}`.trim()
              }
              className="p-3 text-xs"
            />
          ) : updateStatus.state === 'up_to_date' ? (
            <div className="flex items-center gap-2 text-xs text-[#1E6B34] font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{updateStatus.message}</span>
            </div>
          ) : (
            <p className="text-xs text-slate-500">{updateStatus.message}</p>
          )}
        </>
      )}

      <SectionSaveBar dirty={dirty} saving={saving} onDiscard={onDiscard} />
    </section>
  );
}
