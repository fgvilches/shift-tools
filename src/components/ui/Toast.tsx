import { create } from "zustand";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { clsx } from "clsx";
import { useEffect } from "react";

type ToastTone = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  duration: number;
}

interface ToastStore {
  items: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => number;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (t) => {
    const id = ++seq;
    set((s) => ({ items: [...s.items.slice(-3), { ...t, id }] }));
    if (t.duration > 0) {
      window.setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), t.duration);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

const api = {
  push: (tone: ToastTone, title: string, description?: string, duration = 4200) =>
    useToastStore.getState().push({ tone, title, description, duration }),
};
export const toast = {
  success: (title: string, description?: string) => api.push("success", title, description),
  error: (title: string, description?: string) => api.push("error", title, description, 6500),
  warning: (title: string, description?: string) => api.push("warning", title, description, 5200),
  info: (title: string, description?: string) => api.push("info", title, description),
};

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES: Record<ToastTone, string> = {
  success: "border-secondary/30 text-[#8ff0a4]",
  error: "border-error/35 text-[#ffb4ab]",
  warning: "border-warning/30 text-[#ffe066]",
  info: "border-primary/30 text-primary-soft",
};

export function Toaster() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && items.length > 0) dismiss(items[items.length - 1]!.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, dismiss]);

  return (
    <div
      className="fixed bottom-8 right-4 z-[90] flex flex-col gap-2 w-[320px] pointer-events-none"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {items.map((item) => {
        const Icon = ICONS[item.tone];
        return (
          <div
            key={item.id}
            className={clsx(
              "pointer-events-auto glass-overlay rounded-xl px-3 py-2.5 flex items-start gap-2.5 anim-rise",
              STYLES[item.tone],
            )}
            role={item.tone === "error" ? "alert" : "status"}
          >
            <Icon size={14} className="mt-[1px] shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium leading-snug text-on-surface">{item.title}</p>
              {item.description && (
                <p className="mt-0.5 text-[10.5px] leading-snug text-on-variant/75 break-words">{item.description}</p>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(item.id)}
              className="text-outline hover:text-on-surface transition-colors shrink-0"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
