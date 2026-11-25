import { ExternalLink } from 'lucide-react';
import type { ActiveTab } from '../types';

interface HeaderProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  portalUrl: string;
}

export function Header({ activeTab, onTabChange, portalUrl }: HeaderProps) {
  const navItems: Array<{ id: ActiveTab; label: string }> = [
    { id: 'dispatch', label: 'Self Service' },
    { id: 'audit', label: 'Audit Logs' },
    { id: 'settings', label: 'Settings' },
  ];

  const safePortalHref = /^https?:\/\//i.test(portalUrl)
    ? portalUrl
    : 'https://nssfdigital.enssf.co.ke';

  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onTabChange('dispatch')}
          className="font-display font-bold text-base tracking-tight text-[#1E6B34] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2B7A3B]"
        >
          NSSF Digital
        </button>

        <nav className="flex items-center gap-7 overflow-x-auto" aria-label="Primary navigation">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`relative h-16 px-1 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#2B7A3B] ${
                  isActive
                    ? 'text-[#1E6B34]'
                    : 'text-[#0F2437]/70 hover:text-[#0F2437]'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
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
