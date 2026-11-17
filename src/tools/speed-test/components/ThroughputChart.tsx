import { useEffect, useRef, useState } from "react";
import { Sparkline } from "@/components/ui/Charts";

interface ThroughputChartProps {
  values: number[];
  max: number;
  unitLabel: string;
  height?: number;
  ariaLabel: string;
}

function axisLabel(value: number): string {
  if (value === 0) return "0";
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

/**
 * Responsive throughput strip: the kit Sparkline sized to the real container
 * width, a light grid, and a scale gutter on the right.
 */
export function ThroughputChart({ values, max, unitLabel, height = 168, ariaLabel }: ThroughputChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(620);

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

  const gutter = 58;
  const plotWidth = Math.max(120, width - gutter);
  const series = values.length === 1 ? [values[0], values[0]] : values;
  const ceiling = max > 0 ? max : 1;
  const ticks = [ceiling, (ceiling * 2) / 3, ceiling / 3, 0];

  return (
    <div ref={hostRef} className="relative w-full select-none" style={{ height }}>
      <div aria-hidden className="absolute inset-y-0 left-0 flex flex-col justify-between" style={{ width: plotWidth }}>
        {ticks.map((tick) => (
          <div key={tick} className="h-px w-full bg-white/[0.055]" />
        ))}
      </div>

      <div className="absolute inset-y-0 left-0" style={{ width: plotWidth }}>
        <Sparkline
          data={series}
          width={plotWidth}
          height={height}
          tone="primary"
          min={0}
          max={ceiling}
          ariaLabel={ariaLabel}
        />
      </div>

      <div
        aria-hidden
        className="absolute inset-y-0 right-0 flex w-14 flex-col justify-between text-right font-mono text-[9px] text-outline/80 tnum"
      >
        {ticks.map((tick, index) => (
          <span key={tick} className={index === ticks.length - 1 ? "text-outline" : undefined}>
            {axisLabel(tick)}
            {index === ticks.length - 1 ? ` ${unitLabel}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
