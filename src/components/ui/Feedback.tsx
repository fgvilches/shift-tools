import { clsx } from "clsx";
import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={clsx("animate-spin text-on-variant", className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={clsx("flex flex-col items-center justify-center text-center mx-auto", compact ? "py-6 gap-2" : "py-14 gap-3 max-w-sm")}>
      {icon && (
        <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center text-outline shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-on-surface">{title}</p>
        {description && <p className="text-[11.5px] text-outline leading-relaxed">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Progress({
  value,
  max = 100,
  indeterminate = false,
  tone = "primary",
  className,
  height = 4,
  label,
}: {
  value?: number;
  max?: number;
  indeterminate?: boolean;
  tone?: "primary" | "success" | "warning" | "error" | "tertiary";
  className?: string;
  height?: number;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, ((value ?? 0) / max) * 100));
  const bar = {
    primary: "bg-gradient-to-r from-[#3e90ff] to-[#0a84ff]",
    success: "bg-gradient-to-r from-[#30d158] to-[#0fa83c]",
    warning: "bg-gradient-to-r from-[#ffd60a] to-[#f0a800]",
    error: "bg-gradient-to-r from-[#ff453a] to-[#d70015]",
    tertiary: "bg-gradient-to-r from-[#bf5af2] to-[#8e3bd1]",
  }[tone];

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={indeterminate ? undefined : Math.round(value ?? 0)}
      aria-label={label}
      className={clsx("w-full rounded-full bg-black/45 overflow-hidden border border-white/[0.05]", className)}
      style={{ height }}
    >
      <div
        className={clsx("h-full rounded-full transition-[width] duration-200 ease-out", bar, indeterminate && "animate-pulse")}
        style={{ width: indeterminate ? "100%" : `${pct}%` }}
      />
    </div>
  );
}

/** Multi-segment memory meter (system / apps / reclaimable). */
export function Meter({
  segments,
  height = 10,
  ariaLabel,
}: {
  segments: { value: number; tone: "primary" | "success" | "warning" | "error" | "tertiary" | "neutral"; label: string }[];
  height?: number;
  ariaLabel: string;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0) || 1;
  const colors = {
    primary: "bg-primary/80",
    success: "bg-secondary/80",
    warning: "bg-warning/80",
    error: "bg-gradient-to-r from-error to-[#ff7b72]",
    tertiary: "bg-tertiary/80",
    neutral: "bg-white/25",
  };
  return (
    <div
      className="w-full rounded-full bg-black/45 p-[3px] flex gap-[3px] overflow-hidden border border-white/[0.05] shadow-inner"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      {segments.map((s, i) => (
        <div
          key={`${s.label}-${i}`}
          className={clsx("h-full rounded-full transition-all duration-500", colors[s.tone])}
          style={{ width: `${(Math.max(0, s.value) / total) * 100}%` }}
          title={`${s.label}: ${Math.round(s.value)}%`}
        />
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton rounded-md", className)} aria-hidden />;
}

/** Inline, non-blocking error surface. Never hides the cause. */
export function ErrorNotice({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Retry",
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={clsx(
        "flex items-start gap-2.5 rounded-lg border border-error/30 bg-error/[0.07] px-3 py-2.5",
        className,
      )}
    >
      <AlertTriangle size={14} className="text-error mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-[#ffb4ab]">{title}</p>
        <p className="text-[11px] text-on-variant/80 leading-relaxed break-words">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-[11px] font-medium text-error hover:text-white px-2 py-1 rounded-md hover:bg-error/15 transition-colors shrink-0"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function InfoNotice({
  icon,
  children,
  tone = "primary",
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  tone?: "primary" | "warning" | "success" | "neutral";
  className?: string;
}) {
  const tones = {
    primary: "border-primary/25 bg-primary/[0.07] text-primary-soft",
    warning: "border-warning/25 bg-warning/[0.06] text-[#ffe066]",
    success: "border-secondary/25 bg-secondary/[0.06] text-[#8ff0a4]",
    neutral: "border-white/10 bg-white/[0.03] text-on-variant",
  }[tone];
  return (
    <div className={clsx("flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed", tones, className)}>
      {icon && <span className="mt-[1px] shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
