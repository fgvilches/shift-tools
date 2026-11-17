import { clsx } from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FileUp } from "lucide-react";
import { isTauri } from "@/lib/ipc";

const EXTENSIONS = (accept?: string[]) => accept?.map((a) => a.replace(/^\./, "").toLowerCase());

/**
 * Drag & drop zone. Uses the Tauri drag-drop event in the native app and the
 * DOM DataTransfer API in the browser, so both paths land on the same handler.
 */
export function DropZone({
  onPaths,
  accept,
  multiple = true,
  icon,
  title,
  description,
  disabled = false,
  className,
  children,
}: {
  onPaths: (paths: string[]) => void;
  accept?: string[];
  multiple?: boolean;
  icon?: ReactNode;
  title: string;
  description?: string;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  const accepts = useCallback(
    (path: string) => {
      if (!accept || accept.length === 0) return true;
      const lower = path.toLowerCase();
      return accept.some((ext) => lower.endsWith(ext.toLowerCase()));
    },
    [accept],
  );

  const handlePaths = useCallback(
    (paths: string[]) => {
      const filtered = multiple ? paths : paths.slice(0, 1);
      const valid = filtered.filter(accepts);
      if (valid.length > 0) onPaths(valid);
    },
    [accepts, multiple, onPaths],
  );

  /**
   * Tauri intercepts native drag & drop before the WebView sees it, and the
   * wry WebView does not expose File.path. So in the native app we subscribe to
   * the window drag-drop event and use the dialog plugin to browse.
   */
  useEffect(() => {
    if (!isTauri || disabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const stop = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "leave") {
            setOver(false);
            depth.current = 0;
            return;
          }
          const inside = (() => {
            if (!zoneRef.current || !("position" in payload) || !payload.position) return true;
            const rect = zoneRef.current.getBoundingClientRect();
            const ratio = window.devicePixelRatio || 1;
            const x = payload.position.x / ratio;
            const y = payload.position.y / ratio;
            return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          })();

          if (payload.type === "enter" || payload.type === "over") {
            if (inside) setOver(true);
          } else if (payload.type === "drop") {
            setOver(false);
            depth.current = 0;
            if (inside && payload.paths?.length) handlePaths(payload.paths);
          }
        });
        if (cancelled) stop();
        else unlisten = stop;
      } catch {
        /* older Tauri builds: fall back to DOM events */
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [disabled, handlePaths]);

  const browse = useCallback(async () => {
    if (disabled) return;
    if (!isTauri) {
      inputRef.current?.click();
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const extensions = EXTENSIONS(accept);
      const selection = await open({
        multiple,
        directory: false,
        filters: extensions && extensions.length > 0 ? [{ name: "Supported files", extensions }] : undefined,
      });
      if (typeof selection === "string") handlePaths([selection]);
      else if (Array.isArray(selection)) handlePaths(selection);
    } catch {
      inputRef.current?.click();
    }
  }, [accept, disabled, handlePaths, multiple]);

  const zoneRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={zoneRef}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        if (!disabled) setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        depth.current -= 1;
        if (depth.current <= 0) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files ?? []) as File[];
        const paths = files.map((f) => (f as File & { path?: string }).path ?? f.name).filter(Boolean);
        if (paths.length > 0) handlePaths(paths);
      }}
      onClick={() => void browse()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void browse();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={`${title}. Drop files or press Enter to browse.`}
      aria-disabled={disabled}
      className={clsx(
        "relative flex flex-col items-center justify-center rounded-xl border border-dashed transition-all duration-150 cursor-pointer",
        "focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-2",
        over
          ? "border-primary/70 bg-primary/[0.08] shadow-[inset_0_0_40px_rgba(10,132,255,0.12)]"
          : "border-white/15 bg-black/25 hover:border-white/25 hover:bg-white/[0.03]",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple={multiple}
        accept={accept?.join(",")}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          const paths = files.map((f) => (f as File & { path?: string }).path ?? f.name).filter(Boolean);
          if (paths.length > 0) handlePaths(paths);
          e.target.value = "";
        }}
      />
      {children ?? (
        <div className="flex flex-col items-center gap-2 py-9 px-6 text-center">
          <div
            className={clsx(
              "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
              over ? "bg-primary/20 text-primary-soft" : "bg-white/[0.05] text-outline",
            )}
          >
            {icon ?? <FileUp size={18} />}
          </div>
          <div>
            <p className="text-[12.5px] font-medium text-on-surface">{title}</p>
            {description && <p className="mt-0.5 text-[11px] text-outline">{description}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
