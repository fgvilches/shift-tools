import { ChevronDown } from "lucide-react";
import { clsx } from "clsx";
import type { HttpMethod } from "@/lib/types";
import { METHODS, METHOD_TEXT } from "../lib/request";

/**
 * Locally composed method select: the shared Select hardcodes a neutral text
 * colour, and the method pill has to read as part of the colour language.
 */
export function MethodSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: HttpMethod;
  onChange: (method: HttpMethod) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("relative shrink-0", className)}>
      <select
        aria-label="HTTP method"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as HttpMethod)}
        className={clsx(
          "appearance-none w-full h-8 pl-2.5 pr-6 rounded-lg bg-black/45 border border-white/[0.075]",
          "font-mono font-semibold text-[11.5px] tracking-tight cursor-pointer",
          "shadow-[inset_0_1px_2px_rgba(0,0,0,0.55)] transition-colors duration-150",
          "hover:border-white/15 focus:outline-none focus:border-primary/70 focus:shadow-[0_0_0_3px_rgba(10,132,255,0.16)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          METHOD_TEXT[value],
        )}
      >
        {METHODS.map((method) => (
          <option key={method.value} value={method.value} className="bg-surface-container text-on-surface font-mono">
            {method.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
    </div>
  );
}
