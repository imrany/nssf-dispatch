import React, { useState } from 'react';
import { Eye, EyeOff, Pencil } from 'lucide-react';

interface FormInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  id: string;
  label: string;
  variant?: 'large' | 'compact';
  showPencilIcon?: boolean;
  passwordToggle?: boolean;
  hidePasswordLabel?: string;
  showPasswordLabel?: string;
}

export function FormInput({
  id,
  label,
  variant = 'large',
  showPencilIcon = false,
  passwordToggle = false,
  hidePasswordLabel = 'Hide password',
  showPasswordLabel = 'Show password',
  type = 'text',
  className = '',
  disabled,
  ...rest
}: FormInputProps) {
  const [revealed, setRevealed] = useState(false);
  const inputType = passwordToggle ? (revealed ? 'text' : 'password') : type;

  const baseInputClasses =
    variant === 'large'
      ? 'w-full h-14 px-5 pr-12 rounded border border-[#D1D9E0] bg-white text-sm text-[#0F2437] placeholder:text-slate-400 focus:outline-none focus:border-[#2B7A3B] disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors'
      : 'w-full h-11 px-3.5 rounded-md border border-slate-300 text-sm text-[#0F2437] focus:outline-none focus:border-[#2B7A3B] disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors';

  const labelClasses =
    variant === 'large'
      ? 'block text-sm font-medium text-[#0F2437] mb-2'
      : 'block text-xs font-semibold text-[#0F2437] mb-1.5';

  return (
    <div>
      <label htmlFor={id} className={labelClasses}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={inputType}
          disabled={disabled}
          className={`${baseInputClasses} ${passwordToggle ? 'pr-11' : ''} ${className}`}
          {...rest}
        />

        {showPencilIcon && !passwordToggle && (
          <Pencil
            className={`w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none ${
              disabled ? 'text-slate-300' : 'text-slate-400'
            }`}
            aria-hidden="true"
          />
        )}

        {passwordToggle && (
          <button
            type="button"
            onClick={() => setRevealed((prev) => !prev)}
            aria-label={revealed ? hidePasswordLabel : showPasswordLabel}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-[#0F2437] cursor-pointer"
          >
            {revealed ? (
              <EyeOff className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Eye className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
