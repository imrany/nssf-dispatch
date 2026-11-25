import { ArrowLeft } from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface BackButtonProps {
  label: string;
  to?: string;
  onClick?: () => void;
}

export function BackButton({ label, to, onClick }: BackButtonProps) {
  const { navigateTo } = useApp();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (to) {
      navigateTo(to);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 -ml-2.5 rounded-md text-xs font-semibold text-slate-600 hover:text-[#0F2437] hover:bg-slate-100/80 transition-colors cursor-pointer whitespace-nowrap"
      >
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{label}</span>
      </button>
    </div>
  );
}
