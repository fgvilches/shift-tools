import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Check, Copy } from "lucide-react";
import { toast } from "@/components/ui/Toast";

/**
 * Icon-only clipboard control with an inline confirmation state.
 * The shared CopyButton gives no feedback, so this view keeps its own.
 */
export function CopyIcon({
  value,
  label,
  className,
}: {
  value: string;
  /** Human description of what is copied, used for the accessible name. */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const write = () => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(
      () => setCopied(true),
      () =>
        toast.error(
          "Clipboard unavailable",
          "The system refused the write — select the value and copy it manually.",
        ),
    );
  };

  return (
    <button
      type="button"
      onClick={write}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className={clsx(
        "inline-flex items-center justify-center w-5 h-5 rounded-[5px] border transition-colors shrink-0",
        copied
          ? "border-secondary/40 bg-secondary/15 text-secondary"
          : "border-white/[0.07] bg-white/[0.04] text-outline hover:text-on-surface hover:bg-white/[0.09]",
        "focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-1",
        className,
      )}
    >
      {copied ? <Check size={10} aria-hidden /> : <Copy size={10} aria-hidden />}
    </button>
  );
}
