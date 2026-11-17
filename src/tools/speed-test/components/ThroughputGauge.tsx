/** Semicircular arc gauge for the live/final download sample. */

interface ThroughputGaugeProps {
  value: number;
  max: number;
  unitLabel: string;
  caption: string;
}

export function ThroughputGauge({ value, max, unitLabel, caption }: ThroughputGaugeProps) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(1, value / safeMax));

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg
        width={176}
        height={94}
        viewBox="0 0 132 74"
        role="img"
        aria-label={`Download rate gauge, ${caption}: ${value.toFixed(1)} of ${max} ${unitLabel} full scale`}
      >
        <defs>
          <linearGradient id="speed-test-gauge-arc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0a84ff" />
            <stop offset="100%" stopColor="#7cb6ff" />
          </linearGradient>
        </defs>
        <path
          d="M 10 62 A 56 56 0 0 1 122 62"
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={10}
          strokeLinecap="round"
          pathLength={100}
        />
        {pct > 0.002 && (
          <path
            d="M 10 62 A 56 56 0 0 1 122 62"
            fill="none"
            stroke="url(#speed-test-gauge-arc)"
            strokeWidth={10}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={100}
            strokeDashoffset={100 - pct * 100}
            style={{ transition: "stroke-dashoffset 160ms ease-out" }}
          />
        )}
      </svg>
      <div className="flex w-[176px] items-center justify-between px-1 font-mono text-[9px] text-outline/70 tnum">
        <span>0</span>
        <span className="uppercase tracking-[0.08em]">{caption}</span>
        <span>
          {max} {unitLabel}
        </span>
      </div>
    </div>
  );
}
