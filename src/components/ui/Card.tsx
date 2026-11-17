import { clsx } from "clsx";
import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("glass-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  hint,
  actions,
  icon,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-white/[0.055]", className)}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-on-variant shrink-0">{icon}</span>}
        <div className="min-w-0">
          <div className="text-[12px] font-semibold tracking-tight text-on-surface truncate">{title}</div>
          {hint && <div className="text-[10.5px] text-outline truncate">{hint}</div>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  );
}

/** Small uppercase section label used above groups of controls. */
export function SectionLabel({ children, className, trailing }: { children: ReactNode; className?: string; trailing?: ReactNode }) {
  return (
    <div className={clsx("flex items-center justify-between gap-2", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-outline">{children}</span>
      {trailing}
    </div>
  );
}

/** Recessed metric tile (KPI) — used in tool headers. */
export function StatTile({
  label,
  value,
  tone = "neutral",
  icon,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "error" | "tertiary";
  icon?: ReactNode;
  mono?: boolean;
}) {
  const toneClass = {
    neutral: "text-on-surface",
    primary: "text-primary-soft",
    success: "text-secondary",
    warning: "text-warning",
    error: "text-error",
    tertiary: "text-tertiary",
  }[tone];

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black/30 backdrop-blur-md border border-white/[0.055] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      {icon && <span className={clsx("shrink-0", toneClass)}>{icon}</span>}
      <div className="flex flex-col leading-tight min-w-0">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline whitespace-nowrap">{label}</span>
        <span className={clsx("text-[12.5px] font-semibold", mono && "font-mono tnum", toneClass)}>{value}</span>
      </div>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={clsx("h-px w-full bg-white/[0.06]", className)} />;
}
