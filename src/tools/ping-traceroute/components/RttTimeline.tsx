import { useEffect, useRef, useState } from "react";
import { Sparkline } from "@/components/ui/Charts";

interface RttTimelineProps {
  values: number[];
  height?: number;
  ariaLabel: string;
}

/**
 * Responsive RTT strip: the kit Sparkline sized to the real container width,
 * with a mean guide line and a label gutter carrying the live scale.
 */
export function RttTimeline({ values, height = 148, ariaLabel }: RttTimelineProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const measure = () => {
      const next = Math.round(node.clientWidth);
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const series = values.slice(-120);
  const plotWidth = Math.max(160, width - 68);
  const hasData = series.length > 0;
  const lo = hasData ? Math.min(...series) : 0;
  const hi = hasData ? Math.max(...series) : 0;
  const spread = hasData ? Math.max(hi - lo, 0.4) : 1;
  const min = hasData ? Math.max(0, lo - spread * 0.2) : 0;
  const max = hasData ? hi + spread * 0.2 : 1;
  const mean = hasData ? series.reduce((sum, value) => sum + value, 0) / series.length : null;
  const meanTop = mean === null ? null : ((max - mean) / (max - min)) * height;
  const line = series.length === 1 ? [series[0], series[0]] : series;

  return (
    <div ref={hostRef} className="relative w-full select-none" style={{ height }}>
      <div aria-hidden className="absolute inset-y-0 left-0 flex flex-col justify-between" style={{ width: plotWidth }}>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-px w-full bg-white/[0.055]" />
        ))}
      </div>

      <div className="absolute inset-y-0 left-0" style={{ width: plotWidth }}>
        {hasData ? (
          <Sparkline
            data={line}
            width={plotWidth}
            height={height}
            tone="primary"
            min={min}
            max={max}
            ariaLabel={ariaLabel}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-black/20">
            <span className="text-[10.5px] text-outline">Waiting for the first echo reply</span>
          </div>
        )}
      </div>

      {meanTop !== null && (
        <div
          aria-hidden
          className="absolute border-t border-dashed border-secondary/40"
          style={{ left: 0, width: plotWidth, top: Math.min(height - 1, Math.max(1, meanTop)) }}
        />
      )}

      <div
        aria-hidden
        className="absolute inset-y-0 right-0 flex w-16 flex-col justify-between text-right font-mono text-[9px] text-outline/80 tnum"
      >
        {hasData ? (
          <>
            <span>{`${max.toFixed(1)} ms`}</span>
            <span className={mean === null ? "text-outline/40" : "text-secondary/80"}>
              {mean === null ? "" : `${mean.toFixed(1)} ms`}
            </span>
            <span>{`${min.toFixed(1)} ms`}</span>
          </>
        ) : (
          <span className="mt-auto text-outline/40">ms</span>
        )}
      </div>
    </div>
  );
}
