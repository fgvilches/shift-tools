import { clsx } from "clsx";
import { useMemo } from "react";

type Tone = "primary" | "success" | "warning" | "error" | "tertiary" | "neutral";

const STROKE: Record<Tone, string> = {
  primary: "#0a84ff",
  success: "#30d158",
  warning: "#ffd60a",
  error: "#ff453a",
  tertiary: "#bf5af2",
  neutral: "#8b91a0",
};

/** Compact line chart for live series (RSSI, latency, throughput). */
export function Sparkline({
  data,
  width = 160,
  height = 36,
  tone = "primary",
  min,
  max,
  fill = true,
  className,
  ariaLabel,
}: {
  data: number[];
  width?: number;
  height?: number;
  tone?: Tone;
  min?: number;
  max?: number;
  fill?: boolean;
  className?: string;
  ariaLabel: string;
}) {
  const path = useMemo(() => {
    if (data.length === 0) return null;
    const lo = min ?? Math.min(...data);
    const hi = max ?? Math.max(...data);
    const range = hi - lo || 1;
    const stepX = data.length > 1 ? width / (data.length - 1) : width;
    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - lo) / range) * (height - 2) - 1;
      return [x, y] as const;
    });
    const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area };
  }, [data, width, height, min, max]);

  if (!path) {
    return <div className={clsx("rounded bg-white/[0.03]", className)} style={{ width, height }} aria-label={`${ariaLabel}: no data`} />;
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={clsx("overflow-visible", className)}
      role="img"
      aria-label={ariaLabel}
    >
      {fill && (
        <defs>
          <linearGradient id={`spark-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={STROKE[tone]} stopOpacity="0.28" />
            <stop offset="100%" stopColor={STROKE[tone]} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={path.area} fill={`url(#spark-${tone})`} />}
      <path d={path.line} fill="none" stroke={STROKE[tone]} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Hollow arc used for grades (A–F) and score dials. */
export function ScoreRing({
  value,
  max = 100,
  tone = "primary",
  size = 84,
  label,
  sublabel,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  size?: number;
  label: string;
  sublabel?: string;
}) {
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={STROKE[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          style={{ transition: "stroke-dashoffset 400ms cubic-bezier(0.22,0.61,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-mono text-[17px] font-semibold tnum" style={{ color: STROKE[tone] }}>
          {label}
        </span>
        {sublabel && <span className="mt-0.5 text-[9px] uppercase tracking-[0.08em] text-outline">{sublabel}</span>}
      </div>
    </div>
  );
}

/** Horizontal magnitude bars with optional per-row value labels. */
export function BarSeries({
  items,
  tone = "primary",
  unit = "",
  max,
  rowHeight = 20,
  className,
}: {
  items: { label: string; value: number; tone?: Tone }[];
  tone?: Tone;
  unit?: string;
  max?: number;
  rowHeight?: number;
  className?: string;
}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className={clsx("flex flex-col gap-1", className)}>
      {items.map((item) => {
        const pct = Math.max(0, Math.min(100, (item.value / top) * 100));
        return (
          <div key={item.label} className="flex items-center gap-2" style={{ height: rowHeight }}>
            <span className="w-[68px] shrink-0 font-mono text-[10.5px] text-outline truncate tnum">{item.label}</span>
            <div className="flex-1 h-2 rounded-full bg-black/40 overflow-hidden border border-white/[0.04]">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${pct}%`, backgroundColor: STROKE[item.tone ?? tone] }}
              />
            </div>
            <span className="w-[52px] shrink-0 text-right font-mono text-[10.5px] text-on-variant tnum">
              {item.value.toFixed(item.value >= 100 ? 0 : 1)}
              {unit}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Vertical distribution bars (channel congestion, timing buckets). */
export function ColumnChart({
  bars,
  height = 96,
  tone = "primary",
  highlightIndex,
  ariaLabel,
}: {
  bars: { label: string; value: number; tone?: Tone }[];
  height?: number;
  tone?: Tone;
  highlightIndex?: number | null;
  ariaLabel: string;
}) {
  const top = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="flex items-end gap-[3px]" style={{ height }} role="img" aria-label={ariaLabel}>
      {bars.map((b, i) => {
        const h = Math.max(2, (b.value / top) * (height - 16));
        return (
          <div key={`${b.label}-${i}`} className="flex-1 flex flex-col items-center justify-end gap-1 group">
            <div
              className="w-full rounded-t-[2px] transition-all duration-300"
              style={{
                height: h,
                backgroundColor: STROKE[b.tone ?? tone],
                opacity: highlightIndex === i ? 1 : 0.65,
                boxShadow: highlightIndex === i ? `0 0 10px ${STROKE[b.tone ?? tone]}55` : undefined,
              }}
              title={`${b.label}: ${b.value}`}
            />
            <span className={clsx("text-[8px] font-mono", highlightIndex === i ? "text-on-surface" : "text-outline/60")}>{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}
