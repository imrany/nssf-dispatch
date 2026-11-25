import React from 'react';
import { motion } from 'motion/react';
import { SMOOTH_EASE } from '../../utils/constants';

export type ActionButtonVariant = 'primary' | 'lime' | 'outline' | 'outlineGreen' | 'danger';

interface ActionButtonProps {
  type?: 'button' | 'submit' | 'reset';
  variant?: ActionButtonVariant;
  fullWidth?: boolean;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;
  className?: string;
  children: React.ReactNode;
}

const VARIANT_CLASSES: Record<ActionButtonVariant, string> = {
  primary: 'bg-[#2B7A3B] hover:bg-[#226430] text-white',
  lime: 'bg-[#6BC300] hover:bg-[#5DAE00] text-white',
  outline: 'border border-[#D1D9E0] bg-white text-[#0F2437] hover:bg-slate-50',
  outlineGreen: 'border border-[#2B7A3B] bg-white text-[#1E6B34] hover:bg-emerald-50',
  danger:
    'border border-red-300 bg-white text-red-700 hover:bg-red-50',
};

const SIZE_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-xs',
  lg: 'h-12 px-5 text-xs tracking-[0.18em]',
};

export function ActionButton({
  type = 'button',
  variant = 'primary',
  fullWidth = false,
  size = 'md',
  disabled = false,
  onClick,
  ariaLabel,
  className = '',
  children,
}: ActionButtonProps) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      whileHover={!disabled ? { y: -1 } : undefined}
      whileTap={!disabled ? { scale: 0.985 } : undefined}
      transition={{ duration: 0.15, ease: SMOOTH_EASE }}
      className={`inline-flex items-center justify-center gap-2 rounded font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap ${
        VARIANT_CLASSES[variant]
      } ${SIZE_CLASSES[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
    >
      {children}
    </motion.button>
  );
}
