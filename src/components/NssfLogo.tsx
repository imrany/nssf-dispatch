interface NssfLogoProps {
  subtitle?: string;
  compact?: boolean;
}

export function NssfLogo({
  subtitle = 'NSSF DIGITAL STATEMENT DISPATCH',
  compact = false,
}: NssfLogoProps) {
  return (
    <div className="inline-flex flex-col items-start select-none">
      <img
        src="/assets/nssf-cl_d27cbb88.png"
        alt="NSSF — Growing You. For Good"
        className={
          compact
            ? 'h-9 w-auto object-contain block'
            : 'h-16 sm:h-[72px] w-auto object-contain block'
        }
      />

      {subtitle && (
        <div className="mt-2.5 text-[11px] font-bold tracking-[0.16em] text-[#1E6B34] uppercase">
          {subtitle}
        </div>
      )}
    </div>
  );
}
