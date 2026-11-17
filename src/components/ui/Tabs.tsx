import { clsx } from "clsx";
import type { ReactNode } from "react";

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  items: TabItem<T>[];
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={clsx("flex items-center gap-0.5 border-b border-white/[0.07]", className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={clsx(
              "relative inline-flex items-center gap-1.5 px-2.5 h-8 text-[12px] font-medium transition-colors",
              active ? "text-on-surface" : "text-outline hover:text-on-variant",
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && (
              <span
                className={clsx(
                  "font-mono text-[10px] tnum px-1 rounded",
                  active ? "bg-primary/20 text-primary-soft" : "bg-white/[0.06] text-outline",
                )}
              >
                {item.count}
              </span>
            )}
            {active && <span className="absolute left-1.5 right-1.5 -bottom-px h-[2px] rounded-full bg-primary shadow-[0_0_10px_rgba(10,132,255,0.6)]" />}
          </button>
        );
      })}
    </div>
  );
}
