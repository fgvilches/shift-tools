import { clsx } from "clsx";
import type { ReactNode } from "react";
import { Eyebrow, type Tone } from "../ui/Badge";
import { StatTile } from "../ui/Card";

export interface Telemetry {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "error" | "tertiary";
  icon?: ReactNode;
}

/**
 * Standard tool frame: glass header card (eyebrow, title, description,
 * telemetry tiles), an action/toolbar row, then the tool body.
 * Every view uses this so the app reads as one product.
 */
export function ToolView({
  eyebrow,
  eyebrowTone = "primary",
  eyebrowHint,
  eyebrowPulse = true,
  title,
  description,
  telemetry,
  toolbar,
  status,
  headerExtra,
  children,
  className,
  bodyClassName,
}: {
  eyebrow?: string;
  eyebrowTone?: Tone;
  eyebrowHint?: string;
  eyebrowPulse?: boolean;
  title: string;
  description: string;
  telemetry?: Telemetry[];
  toolbar?: ReactNode;
  status?: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={clsx("flex flex-col gap-3 p-3 min-h-full", className)}>
      <section
        aria-label={`${title} header`}
        className="relative glass-card overflow-hidden px-4 py-3.5 flex flex-col gap-3"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-28 -left-16 w-72 h-56 rounded-full bg-primary/[0.09] blur-3xl"
        />
        <div className="relative flex flex-col xl:flex-row xl:items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            {(eyebrow || eyebrowHint) && (
              <div className="flex items-center gap-2 flex-wrap">
                {eyebrow && (
                  <Eyebrow tone={eyebrowTone} pulse={eyebrowPulse}>
                    {eyebrow}
                  </Eyebrow>
                )}
                {eyebrowHint && (
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-outline">{eyebrowHint}</span>
                )}
              </div>
            )}
            <h1 className="text-[20px] leading-7 font-semibold tracking-tight text-on-surface truncate">{title}</h1>
            <p className="text-[12px] leading-[18px] text-on-variant/80 max-w-2xl">{description}</p>
          </div>
          {telemetry && telemetry.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              {telemetry.map((t) => (
                <StatTile key={t.label} label={t.label} value={t.value} tone={t.tone} icon={t.icon} />
              ))}
            </div>
          )}
        </div>
        {headerExtra}
        {(toolbar || status) && (
          <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-2 pt-0.5">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">{toolbar}</div>
            {status && <div className="flex items-center gap-1.5 shrink-0">{status}</div>}
          </div>
        )}
      </section>
      <div className={clsx("flex-1 min-h-0 flex flex-col gap-3", bodyClassName)}>{children}</div>
    </div>
  );
}

/** Two-pane workbench: fixed-width inspector + fluid canvas. */
export function Workbench({
  sidebar,
  sidebarWidth = 300,
  children,
  className,
}: {
  sidebar: ReactNode;
  sidebarWidth?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex-1 min-h-0 flex gap-3", className)}>
      <aside className="shrink-0 flex flex-col gap-3 overflow-y-auto pr-0.5" style={{ width: sidebarWidth }}>
        {sidebar}
      </aside>
      <div className="flex-1 min-w-0 flex flex-col gap-3">{children}</div>
    </div>
  );
}
