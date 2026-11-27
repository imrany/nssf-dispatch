import { AlertTriangle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { PendingSettingsAction } from '../../types';
import { ROUTES, SMOOTH_EASE } from '../../utils/constants';

interface UnsavedChangesModalProps {
  pendingAction: PendingSettingsAction | null;
  saving: boolean;
  onCancel: () => void;
  onIgnore: () => void;
  onSaveAndProceed: () => void;
}

export function UnsavedChangesModal({
  pendingAction,
  saving,
  onCancel,
  onIgnore,
  onSaveAndProceed,
}: UnsavedChangesModalProps) {
  const targetDescription =
    pendingAction?.type === 'route'
      ? `navigating to ${
          pendingAction.targetPath === ROUTES.STATEMENTS
            ? 'Service Desk'
            : pendingAction.targetPath === ROUTES.SECURITY
              ? 'Security'
              : 'Audit Logs'
        }`
      : pendingAction?.type === 'lock_settings'
        ? 'locking Settings'
        : 'refreshing settings';

  return (
    <AnimatePresence>
      {pendingAction && (
        <motion.div
          key="unsaved-settings-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: SMOOTH_EASE }}
          onClick={onCancel}
          className="fixed inset-0 z-50 bg-[#0F2437]/55 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-settings-title"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: SMOOTH_EASE }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-[0_20px_50px_rgba(15,36,55,0.24)] overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                </div>
                <h2 id="unsaved-settings-title" className="font-display text-base font-bold text-[#0F2437]">
                  Unsaved Settings Changes
                </h2>
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Cancel and stay on settings"
                className="p-1.5 rounded text-slate-400 hover:text-[#0F2437] hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="px-5 py-4 text-sm text-slate-600 leading-relaxed">
              You have modified system configuration settings that have not been saved yet. Save your changes before {targetDescription}, or discard them to continue?
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <button
                type="button"
                disabled={saving}
                onClick={onIgnore}
                className="px-3.5 py-2 rounded border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
              >
                Ignore Changes
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={onSaveAndProceed}
                className="px-4 py-2 rounded bg-[#2B7A3B] text-white text-xs font-bold hover:bg-[#226430] cursor-pointer disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save & Proceed'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
