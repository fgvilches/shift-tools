import { clsx } from "clsx";
import type { ReactNode } from "react";

export type Tone = "neutral" | "primary" | "success" | "warning" | "error" | "tertiary";

const TONES: Record<Tone, string> = {
  neutral: "bg-white/[0.07] text-on-variant border-white/12",
  primary: "bg-primary/14 text-primary-soft border-primary/30",
  success: "bg-secondary/14 text-[#8ff0a4] border-secondary/30",
  warning: "bg-warning/14 text-[#ffe066] border-warning/30",
  error: "bg-error/14 text-[#ff8b81] border-error/32",
  tertiary: "bg-tertiary/14 text-[#dda6ff] border-tertiary/30",
};

export function Badge({
  tone = "neutral",
  mono = false,
  dot = false,
  pulse = false,
  children,
  className,
  title,
}: {
  tone?: Tone;
  mono?: boolean;
  dot?: boolean;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1.5 h-5 px-2 rounded-full border text-[10px] font-semibold whitespace-nowrap",
        mono && "font-mono tracking-tight tnum",
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={clsx(
            "w-1.5 h-1.5 rounded-full",
            tone === "success" && "bg-secondary",
            tone === "warning" && "bg-warning",
            tone === "error" && "bg-error",
            tone === "primary" && "bg-primary",
            tone === "tertiary" && "bg-tertiary",
            tone === "neutral" && "bg-outline",
            pulse && "beacon",
          )}
        />
      )}
      {children}
    </span>
  );
}

export function Dot({ tone = "success", pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  const bg = {
    neutral: "bg-outline",
    primary: "bg-primary",
    success: "bg-secondary shadow-[0_0_8px_rgba(48,209,88,0.7)]",
    warning: "bg-warning shadow-[0_0_8px_rgba(255,214,10,0.6)]",
    error: "bg-error shadow-[0_0_8px_rgba(255,69,58,0.7)]",
    tertiary: "bg-tertiary shadow-[0_0_8px_rgba(191,90,242,0.6)]",
  }[tone];
  return <span className={clsx("inline-block w-1.5 h-1.5 rounded-full shrink-0", bg, pulse && "beacon", className)} />;
}

/** Eyebrow chip that opens a tool header: "KILL SERVICE", "PASSIVE SCAN". */
export function Eyebrow({ tone = "primary", children, pulse = true }: { tone?: Tone; children: ReactNode; pulse?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 h-5 px-2 rounded-full border text-[9.5px] font-semibold uppercase tracking-[0.1em]",
        TONES[tone],
      )}
    >
      {pulse && <Dot tone={tone} pulse />}
      {children}
    </span>
  );
}
