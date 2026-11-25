import React from 'react';

export interface KeyValueItem {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  labelClassName?: string;
  stacked?: boolean;
  delayMs?: number;
}

interface KeyValueListProps {
  items: KeyValueItem[];
  dividerClassName?: string;
  className?: string;
  rowClassName?: string;
  animateRows?: boolean;
}

export function KeyValueList({
  items,
  dividerClassName = 'divide-y divide-slate-100',
  className = 'text-xs',
  rowClassName = 'py-2',
  animateRows = false,
}: KeyValueListProps) {
  return (
    <dl className={`${dividerClassName} ${className}`}>
      {items.map((item) => (
        <div
          key={item.label}
          style={
            animateRows && item.delayMs !== undefined
              ? ({ '--delay': `${item.delayMs}ms` } as React.CSSProperties)
              : undefined
          }
          className={`${animateRows ? 'dispatch-row-reveal ' : ''}${rowClassName} ${
            item.stacked ? 'space-y-1' : 'flex items-center justify-between gap-4'
          }`}
        >
          <dt className={`text-slate-500 ${item.labelClassName ?? ''}`}>{item.label}</dt>
          <dd
            className={`${item.stacked ? '' : 'text-right'} ${
              item.valueClassName ?? 'font-semibold text-[#0F2437]'
            }`}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
