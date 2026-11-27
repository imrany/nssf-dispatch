import { RotateCcw, Save } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { SMOOTH_EASE } from '../../utils/constants';

interface SectionSaveBarProps {
  dirty: boolean;
  saving: boolean;
  onDiscard?: () => void;
}

export function SectionSaveBar({ dirty, saving, onDiscard }: SectionSaveBarProps) {
  return (
    <AnimatePresence initial={false}>
      {dirty && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.16, ease: SMOOTH_EASE }}
          className="overflow-hidden"
        >
          <div className="pt-3.5 mt-1 border-t border-amber-200/80 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-amber-800">
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
              <span>Unsaved changes in this section</span>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              {onDiscard && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={onDiscard}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:text-[#0F2437] hover:bg-slate-50 disabled:opacity-50 cursor-pointer transition-colors"
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                  <span>Discard</span>
                </button>
              )}

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-[#2B7A3B] hover:bg-[#226430] text-white text-xs font-bold tracking-wider uppercase disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
              >
                <Save className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
