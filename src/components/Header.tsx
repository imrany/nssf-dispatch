import { ExternalLink } from 'lucide-react';
import { motion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { ROUTES } from '../utils/constants';
import { sanitizePortalUrl } from '../utils/validation';

export function Header() {
  const { appName, settings, navigateTo } = useApp();
  const location = useLocation();

  const navItems = [
    { path: ROUTES.STATEMENTS, label: 'Self Service' },
    { path: ROUTES.SETTINGS, label: 'Settings' },
  ];

  const safePortalHref = sanitizePortalUrl(settings.portalUrl);

  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => navigateTo(ROUTES.STATEMENTS)}
          aria-label={`${appName} Home`}
          className="shrink-0 cursor-pointer flex items-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2B7A3B]"
        >
          <img
            src="/assets/nssf-cl_d27cbb88.png"
            alt="NSSF — Growing You. For Good"
            className="h-9 w-auto object-contain block"
          />
        </button>

        <nav className="flex items-center gap-7 overflow-x-auto" aria-label="Primary navigation">
          {navItems.map((item) => {
            const isActive =
              location.pathname === item.path ||
              (item.path === ROUTES.SETTINGS && location.pathname === ROUTES.AUDIT);
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigateTo(item.path)}
                className={`relative h-16 px-1 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#2B7A3B] ${
                  isActive
                    ? 'text-[#1E6B34]'
                    : 'text-[#0F2437]/70 hover:text-[#0F2437]'
                }`}
              >
                {item.label}
                {isActive && (
                  <motion.span
                    layoutId="nssf-nav-indicator"
                    transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                    className="absolute inset-x-0 bottom-0 h-[3px] bg-[#2B7A3B]"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="hidden sm:flex items-center shrink-0">
          <a
            href={safePortalHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold bg-[#2B7A3B] text-white hover:bg-[#236530] transition-colors whitespace-nowrap shrink-0"
          >
            <span>NSSF Portal</span>
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </header>
  );
}
