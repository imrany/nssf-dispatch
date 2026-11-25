import { useAppName } from '../context/AppContext';

interface NssfLogoProps {
  subtitle?: string;
  showSubtitle?: boolean;
  compact?: boolean;
}

export function NssfLogo({
  subtitle,
  showSubtitle = true,
  compact = false,
}: NssfLogoProps) {
  const appName = useAppName();
  const displaySubtitle = subtitle ?? appName;

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

      {showSubtitle && displaySubtitle && (
        <div className="mt-2.5 text-[13px] font-bold tracking-[0.16em] text-[#1E6B34] uppercase">
          {displaySubtitle}
        </div>
      )}
    </div>
  );
}
