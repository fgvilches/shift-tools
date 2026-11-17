import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Variant = "default" | "primary" | "destructive" | "ghost" | "success" | "warning";
type Size = "xs" | "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  default:
    "bg-white/[0.06] text-on-surface border border-white/10 hover:bg-white/[0.11] hover:border-white/20 active:bg-white/[0.07]",
  primary:
    "text-white border border-[#4ba2ff] bg-gradient-to-b from-[#3e90ff] to-[#0066cc] hover:from-[#57a3ff] hover:to-[#0a74e0] shadow-[0_1px_0_rgba(255,255,255,0.25)_inset,0_6px_16px_-10px_rgba(10,132,255,0.9)]",
  destructive:
    "text-error bg-error/12 border border-error/35 hover:bg-error/22 hover:border-error/55",
  success:
    "text-[#9ef7b2] bg-secondary/12 border border-secondary/35 hover:bg-secondary/20 hover:border-secondary/55",
  warning:
    "text-[#ffe066] bg-warning/12 border border-warning/35 hover:bg-warning/20 hover:border-warning/55",
  ghost: "text-on-variant border border-transparent hover:bg-white/[0.06] hover:text-on-surface",
};

const SIZES: Record<Size, string> = {
  xs: "h-6 px-2 text-[11px] gap-1 rounded-md",
  sm: "h-7 px-2.5 text-[12px] gap-1.5 rounded-lg",
  md: "h-8 px-3 text-[13px] gap-2 rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  trailing?: ReactNode;
  loading?: boolean;
  block?: boolean;
}

export function Button({
  variant = "default",
  size = "sm",
  icon,
  trailing,
  loading = false,
  block = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center font-medium tracking-tight",
        "transition-all duration-150 ease-out active:scale-[0.98]",
        "disabled:opacity-45 disabled:pointer-events-none",
        "focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-2",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={size === "xs" ? 12 : 14} className="animate-spin" aria-hidden /> : icon}
      {children !== undefined && children !== null && <span className="truncate">{children}</span>}
      {trailing}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  size?: "sm" | "md";
  tone?: "default" | "danger" | "primary";
  active?: boolean;
}

export function IconButton({ label, icon, size = "md", tone = "default", active, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={clsx(
        "inline-flex items-center justify-center rounded-lg transition-colors duration-150",
        size === "sm" ? "w-6 h-6" : "w-7 h-7",
        active
          ? "bg-primary/18 text-primary-soft border border-primary/35"
          : tone === "danger"
            ? "text-on-variant hover:text-error hover:bg-error/12 border border-transparent"
            : tone === "primary"
              ? "text-on-variant hover:text-primary-soft hover:bg-primary/15 border border-transparent"
              : "text-on-variant hover:text-on-surface hover:bg-white/[0.08] border border-transparent",
        "focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-2",
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="font-mono text-[10px] leading-none px-1.5 py-1 rounded-md bg-white/[0.07] border border-white/10 text-on-variant">
      {children}
    </kbd>
  );
}
