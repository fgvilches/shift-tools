import { clsx } from "clsx";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button, IconButton } from "./Button";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 520,
  tone = "neutral",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  tone?: "neutral" | "danger";
}) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>("[data-autofocus], button, input");
      target?.focus();
    }, 20);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-6" role="presentation">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className="glass-overlay relative w-full rounded-2xl p-4 anim-rise"
        style={{ maxWidth: width }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className={clsx("text-[14px] font-semibold tracking-tight", tone === "danger" ? "text-[#ffb4ab]" : "text-on-surface")}>
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-[11.5px] leading-relaxed text-on-variant/85">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Close dialog" icon={<X size={13} />} onClick={onClose} size="sm" />
        </div>
        {children && <div className="mt-3">{children}</div>}
        {footer && <div className="mt-4 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
  detail,
  busy = false,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  detail?: ReactNode;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      tone={destructive ? "danger" : "neutral"}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            onClick={onConfirm}
            loading={busy}
            data-autofocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {detail}
    </Modal>
  );
}
