import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, X, XCircle } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'warning';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}

type Listener = (items: ToastItem[]) => void;

const TOAST_DURATION_MS = 4500;
const ERROR_TOAST_DURATION_MS = 6500;
const listeners = new Set<Listener>();
let items: ToastItem[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  const snapshot = [...items];
  for (const fn of listeners) {
    fn(snapshot);
  }
}

function scheduleDismiss(id: string, variant: ToastVariant = 'success') {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  const duration = variant === 'error' ? ERROR_TOAST_DURATION_MS : TOAST_DURATION_MS;
  const timer = setTimeout(() => {
    dismissToast(id);
  }, duration);
  timers.set(id, timer);
}

function addToast(variant: ToastVariant, title: string, description?: string): string {
  const id = `nssf-toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  items = [...items.slice(-4), { id, variant, title, description }];
  emit();
  scheduleDismiss(id, variant);
  return id;
}

export function dismissToast(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = items.filter((item) => item.id !== id);
  if (next.length !== items.length) {
    items = next;
    emit();
  }
}

function pauseToastTimer(id: string) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

export const toast = {
  success: (title: string, description?: string) => addToast('success', title, description),
  error: (title: string, description?: string) => addToast('error', title, description),
  warning: (title: string, description?: string) => addToast('warning', title, description),
  dismiss: (id: string) => dismissToast(id),
};

const VARIANT_STYLES: Record<
  ToastVariant,
  {
    container: string;
    icon: typeof CheckCircle2;
    iconClass: string;
    role: 'status' | 'alert';
  }
> = {
  success: {
    container: 'border-emerald-200 border-l-4 border-l-[#2B7A3B]',
    icon: CheckCircle2,
    iconClass: 'text-[#2B7A3B]',
    role: 'status',
  },
  error: {
    container: 'border-red-200 border-l-4 border-l-red-600',
    icon: XCircle,
    iconClass: 'text-red-600',
    role: 'alert',
  },
  warning: {
    container: 'border-amber-200 border-l-4 border-l-amber-500',
    icon: AlertTriangle,
    iconClass: 'text-amber-600',
    role: 'status',
  },
};

export function Toaster() {
  const [activeToasts, setActiveToasts] = useState<ToastItem[]>(items);

  useEffect(() => {
    listeners.add(setActiveToasts);
    return () => {
      listeners.delete(setActiveToasts);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2.5 w-[calc(100%-2.5rem)] max-w-sm pointer-events-none"
    >
      <AnimatePresence mode="popLayout">
        {activeToasts.map((item) => {
          const style = VARIANT_STYLES[item.variant];
          const Icon = style.icon;
          return (
            <motion.div
              key={item.id}
              layout
              role={style.role}
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              onMouseEnter={() => pauseToastTimer(item.id)}
              onMouseLeave={() => scheduleDismiss(item.id, item.variant)}
              className={`pointer-events-auto bg-white border rounded-lg p-3.5 shadow-[0_10px_28px_rgba(15,36,55,0.14)] flex items-start gap-3 ${style.container}`}
            >
              <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${style.iconClass}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-[#0F2437] leading-snug">{item.title}</p>
                {item.description && (
                  <p className="text-xs text-slate-600 mt-0.5 leading-snug break-words whitespace-pre-line">
                    {item.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(item.id)}
                aria-label="Dismiss notification"
                className="text-slate-400 hover:text-slate-700 p-0.5 rounded transition-colors cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
