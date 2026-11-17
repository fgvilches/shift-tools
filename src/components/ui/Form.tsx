import { clsx } from "clsx";
import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

export const CONTROL =
  "w-full bg-black/40 border border-white/[0.075] rounded-lg text-on-surface placeholder:text-outline/70 " +
  "shadow-[inset_0_1px_2px_rgba(0,0,0,0.55)] transition-colors duration-150 " +
  "hover:border-white/15 focus:outline-none focus:border-primary/70 focus:shadow-[inset_0_1px_2px_rgba(0,0,0,0.55),0_0_0_3px_rgba(10,132,255,0.16)] " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  trailing,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">
          {label}
        </label>
        {trailing}
      </div>
      {children}
      {error ? (
        <p className="text-[10.5px] text-error leading-tight">{error}</p>
      ) : hint ? (
        <p className="text-[10.5px] text-outline leading-tight">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  sizeVariant?: "sm" | "md";
  invalid?: boolean;
  leading?: ReactNode;
  trailingSlot?: ReactNode;
}

export function Input({ mono, sizeVariant = "md", invalid, leading, trailingSlot, className, ...rest }: InputProps) {
  return (
    <div className="relative flex items-center">
      {leading && <span className="absolute left-2.5 text-outline pointer-events-none flex items-center">{leading}</span>}
      <input
        aria-invalid={invalid || undefined}
        className={clsx(
          CONTROL,
          mono && "font-mono tnum",
          sizeVariant === "sm" ? "h-7 text-[12px] px-2.5" : "h-8 text-[12.5px] px-2.5",
          leading && "pl-8",
          trailingSlot && "pr-9",
          invalid && "border-error/60",
          className,
        )}
        {...rest}
      />
      {trailingSlot && <span className="absolute right-1.5 flex items-center">{trailingSlot}</span>}
    </div>
  );
}

export function Textarea({ mono, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return (
    <textarea
      className={clsx(
        CONTROL,
        "resize-none px-2.5 py-2 text-[12.5px] leading-relaxed",
        mono && "font-mono text-[12px]",
        className,
      )}
      {...rest}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
  sizeVariant?: "sm" | "md";
}

export function Select({ options, sizeVariant = "md", className, ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={clsx(
          CONTROL,
          "appearance-none pr-7 cursor-pointer",
          sizeVariant === "sm" ? "h-7 text-[12px] pl-2" : "h-8 text-[12.5px] pl-2.5",
          className,
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-surface-container text-on-surface">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-outline pointer-events-none" />
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  indeterminate = false,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={clsx("inline-flex items-center gap-2 cursor-pointer select-none", disabled && "opacity-40", className)}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={clsx(
          "w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center transition-colors",
          checked || indeterminate
            ? "bg-primary border-primary text-white"
            : "bg-black/40 border-white/20 hover:border-white/35",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-primary-soft peer-focus-visible:outline-offset-2",
        )}
      >
        {indeterminate ? (
          <span className="w-2 h-[2px] bg-white rounded-full" />
        ) : checked ? (
          <svg viewBox="0 0 10 8" className="w-2.5 h-2" fill="none" aria-hidden>
            <path d="M1 4l2.5 2.5L9 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      {label && <span className="text-[12px] text-on-variant">{label}</span>}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  size = "md",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex items-center rounded-full transition-colors duration-150 shrink-0",
        size === "sm" ? "w-7 h-4" : "w-8 h-[18px]",
        checked ? "bg-primary" : "bg-white/12 border border-white/10",
        "focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-2",
        disabled && "opacity-40",
      )}
    >
      <span
        className={clsx(
          "absolute rounded-full bg-white shadow transition-transform duration-150",
          size === "sm" ? "w-3 h-3 top-0.5" : "w-3.5 h-3.5 top-[2px]",
          checked ? (size === "sm" ? "translate-x-[13px]" : "translate-x-[15px]") : "translate-x-[2px]",
        )}
      />
    </button>
  );
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode; count?: number }[];
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={clsx("inline-flex items-center p-0.5 rounded-lg bg-black/35 border border-white/[0.06] gap-0.5", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md font-medium transition-all duration-150",
              size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-[12px]",
              active
                ? "bg-white/[0.1] text-on-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_8px_-4px_rgba(0,0,0,0.8)]"
                : "text-on-variant hover:text-on-surface hover:bg-white/[0.04]",
            )}
          >
            {o.icon}
            {o.label}
            {o.count !== undefined && (
              <span className={clsx("font-mono text-[10px] tnum", active ? "text-primary-soft" : "text-outline")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
