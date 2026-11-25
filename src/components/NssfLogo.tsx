interface NssfLogoProps {
  showTagline?: boolean;
  subtitle?: string;
}

export function NssfLogo({
  showTagline = true,
  subtitle = 'NSSF DIGITAL STATEMENT DISPATCH',
}: NssfLogoProps) {
  return (
    <div className="inline-flex flex-col items-start select-none">
      <div className="flex items-center gap-3">
        {/* Authentic NSSF emblem: lime-green ribbon chevron, forest-green bars, gold sun */}
        <svg
          viewBox="0 0 88 96"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-12 h-13 shrink-0"
          aria-hidden="true"
        >
          {/* Outer lime-green geometric loop */}
          <path
            d="M44 4L10 24V70L21 76V31L44 17L67 31V24L44 4Z"
            fill="#9BD318"
          />
          <path
            d="M44 92L78 72V26L67 20V65L44 79L21 65V72L44 92Z"
            fill="#9BD318"
          />
          {/* Vertical forest-green pillars */}
          <rect x="26" y="34" width="6.5" height="28" rx="1" fill="#1E6B34" />
          <rect x="55.5" y="34" width="6.5" height="28" rx="1" fill="#1E6B34" />
          <path d="M36 27H41.5V41C38.5 41.5 36.5 43.2 36 45.5V27Z" fill="#1E6B34" />
          <path d="M46.5 27H52V45.5C51.5 43.2 49.5 41.5 46.5 41V27Z" fill="#1E6B34" />
          <path d="M36 50.5C36.5 52.8 38.5 54.5 41.5 55V69H36V50.5Z" fill="#1E6B34" />
          <path d="M46.5 55C49.5 54.5 51.5 52.8 52 50.5V69H46.5V55Z" fill="#1E6B34" />
          {/* Warm gold central sun */}
          <circle cx="44" cy="48" r="8.5" fill="#F8B500" />
        </svg>

        <div className="flex flex-col leading-none">
          <span className="font-display font-bold text-3xl sm:text-[34px] tracking-tight text-[#1E6B34]">
            NSSF
          </span>
          {showTagline && (
            <span className="text-[11px] font-medium text-[#374151] tracking-wide mt-1">
              Growing You. For Good
            </span>
          )}
        </div>
      </div>

      {subtitle && (
        <div className="mt-2 text-[11px] font-bold tracking-[0.16em] text-[#1E6B34] uppercase">
          {subtitle}
        </div>
      )}
    </div>
  );
}
