import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/ipc";

/** Icon-only clipboard action with a short-lived confirmation tick. */
export function CopyIconButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      toast.error("Copy failed", errorMessage(err));
    }
  };

  return (
    <IconButton
      size="sm"
      label={copied ? "Copied" : label}
      onClick={() => void copy()}
      icon={copied ? <Check size={12} className="text-secondary" /> : <Copy size={12} />}
    />
  );
}
