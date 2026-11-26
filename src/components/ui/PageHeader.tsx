import React from 'react';
import { NssfLogo } from '../NssfLogo';

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, badge, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div>
        <NssfLogo />
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-[#0F2437] tracking-tight">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && <p className="text-sm text-slate-600 mt-1">{subtitle}</p>}
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>}
    </div>
  );
}
