import React from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { SMOOTH_EASE } from '../../utils/constants';

export type AlertVariant = 'error' | 'warning' | 'success';

interface AlertBannerProps {
  variant: AlertVariant;
  message: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

const VARIANT_CLASSES: Record<
  AlertVariant,
  { container: string; iconClass: string; Icon: typeof AlertCircle; role: 'alert' | 'status' }
> = {
  error: {
    container: 'border-red-200 bg-red-50 text-red-800',
    iconClass: 'text-red-700',
    Icon: AlertCircle,
    role: 'alert',
  },
  warning: {
    container: 'border-amber-300 bg-amber-50 text-amber-900',
    iconClass: 'text-amber-700',
    Icon: AlertCircle,
    role: 'status',
  },
  success: {
    container: 'border-emerald-200 bg-emerald-50 text-[#006837]',
    iconClass: 'text-[#006837]',
    Icon: CheckCircle2,
    role: 'status',
  },
};

export function AlertBanner({
  variant,
  message,
  actionLabel,
  onAction,
  className = '',
}: AlertBannerProps) {
  const { container, iconClass, Icon, role } = VARIANT_CLASSES[variant];

  return (
    <motion.div
      role={role}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: SMOOTH_EASE }}
      className={`border rounded-md p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm ${container} ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconClass}`} aria-hidden="true" />
        <span>{message}</span>
      </div>

      {actionLabel && onAction && (
        <motion.button
          type="button"
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.14, ease: SMOOTH_EASE }}
          onClick={onAction}
          className="px-4 py-2 rounded bg-[#2B7A3B] text-white text-xs font-semibold hover:bg-[#236530] whitespace-nowrap cursor-pointer shrink-0 self-start sm:self-auto"
        >
          {actionLabel}
        </motion.button>
      )}
    </motion.div>
  );
}
