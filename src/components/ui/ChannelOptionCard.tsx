import { motion } from 'motion/react';
import { SMOOTH_EASE } from '../../utils/constants';

interface ChannelOptionCardProps {
  title: string;
  subtitle: string;
  shortcut: string;
  enabled: boolean;
  hovered: boolean;
  onHoverChange: (hovered: boolean) => void;
  onSelect: () => void;
}

export function ChannelOptionCard({
  title,
  subtitle,
  shortcut,
  enabled,
  hovered,
  onHoverChange,
  onSelect,
}: ChannelOptionCardProps) {
  return (
    <motion.button
      type="button"
      disabled={!enabled}
      onClick={onSelect}
      onMouseEnter={() => enabled && onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => enabled && onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
      whileHover={enabled ? { y: -3 } : undefined}
      whileTap={enabled ? { scale: 0.99 } : undefined}
      transition={{ duration: 0.18, ease: SMOOTH_EASE }}
      className={`relative overflow-hidden bg-white rounded-lg p-12 sm:p-14 text-center shadow-[0_6px_28px_rgba(15,36,55,0.08)] border border-b-[3px] transition-shadow duration-200 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer ${
        hovered
          ? 'border-[#2B7A3B] border-b-[#2B7A3B] shadow-[0_14px_34px_rgba(43,122,59,0.22)]'
          : 'border-slate-200'
      }`}
    >
      <motion.div
        aria-hidden="true"
        initial={false}
        animate={{ scaleY: hovered ? 1 : 0 }}
        transition={{ duration: 0.2, ease: SMOOTH_EASE }}
        style={{ transformOrigin: 'bottom' }}
        className="absolute inset-0 bg-[#2B7A3B] pointer-events-none"
      />
      <div className="relative z-10">
        <span
          className={`block font-display text-2xl font-bold transition-colors duration-200 ${
            hovered ? 'text-white' : 'text-[#0F2437]'
          }`}
        >
          {title}
        </span>
        <span
          className={`block text-xs mt-2 transition-colors duration-200 ${
            hovered ? 'text-emerald-100' : 'text-slate-500'
          }`}
        >
          {subtitle}
        </span>
        {enabled && (
          <kbd
            className={`inline-block mt-3 px-2 py-0.5 rounded text-[11px] font-mono border transition-colors duration-200 ${
              hovered
                ? 'bg-white/15 border-white/30 text-white'
                : 'bg-slate-50 border-slate-200 text-slate-500'
            }`}
          >
            {shortcut}
          </kbd>
        )}
      </div>
    </motion.button>
  );
}
