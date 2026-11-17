import { clsx } from "clsx";
import { useMemo, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Monospace editor: line-numbered gutter, tab insertion, optional highlighting.
 * Deliberately dependency-free — WKWebView + a textarea is enough for these
 * payload sizes, and it keeps the bundle native-fast.
 */
export function CodeArea({
  value,
  onChange,
  readOnly = false,
  placeholder,
  minHeight = 180,
  ariaLabel,
  spellCheck = false,
  wrap = false,
  className,
  toolbar,
  errorLine,
}: {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: number | string;
  ariaLabel: string;
  spellCheck?: boolean;
  wrap?: boolean;
  className?: string;
  toolbar?: ReactNode;
  errorLine?: number | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const lines = useMemo(() => value.split("\n").length, [value]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly || e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = `${value.slice(0, start)}  ${value.slice(end)}`;
    onChange?.(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 2;
    });
  };

  return (
    <div className={clsx("relative rounded-lg border border-white/[0.07] bg-black/40 overflow-hidden flex flex-col", className)}>
      {toolbar && (
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-white/[0.055] bg-white/[0.02]">
          {toolbar}
        </div>
      )}
      <div className="flex min-h-0 flex-1" style={{ minHeight }}>
        <div
          aria-hidden
          className="select-none shrink-0 py-2 pl-2.5 pr-2 text-right font-mono text-[11px] leading-[18px] text-white/20 border-r border-white/[0.05] bg-black/20 overflow-hidden"
        >
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={clsx(errorLine === i + 1 && "text-error")}>
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={ref}
          aria-label={ariaLabel}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          spellCheck={spellCheck}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={onKeyDown}
          className={clsx(
            "flex-1 bg-transparent px-2.5 py-2 font-mono text-[11.5px] leading-[18px] text-on-surface",
            "placeholder:text-outline/50 focus:outline-none resize-none tnum",
            wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre overflow-x-auto",
            readOnly && "text-on-variant/85",
          )}
        />
      </div>
    </div>
  );
}

export function CopyButton({
  text,
  label = "Copy",
  size = "xs",
  className,
  disabled,
}: {
  text: string;
  label?: string;
  size?: "xs" | "sm";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || !text}
      onClick={() => {
        void navigator.clipboard.writeText(text);
      }}
      className={clsx(
        "inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] text-on-variant",
        "hover:text-on-surface hover:bg-white/[0.1] transition-colors disabled:opacity-40",
        size === "xs" ? "h-5 px-1.5 text-[10px]" : "h-6 px-2 text-[11px]",
        className,
      )}
      aria-label={`${label} to clipboard`}
    >
      <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </svg>
      {label}
    </button>
  );
}
