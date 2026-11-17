import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Eraser } from "lucide-react";
import { SegmentedControl } from "./Form";
import { CopyButton } from "./CodeArea";
import { EmptyState } from "./Feedback";

export type LogLevel = "info" | "warn" | "error" | "success" | "debug";

export interface LogEntry {
  id: string | number;
  level: LogLevel;
  message: string;
  timestamp: string;
  detail?: string;
}

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: "text-on-variant",
  debug: "text-outline",
  warn: "text-[#ffe066]",
  error: "text-[#ff8b81]",
  success: "text-[#8ff0a4]",
};

const LEVEL_TAG: Record<LogLevel, string> = {
  info: "INFO",
  debug: "DBG ",
  warn: "WARN",
  error: "ERR ",
  success: "OK  ",
};

export function LogViewer({
  logs,
  autoScroll = true,
  onClear,
  height = 200,
  emptyLabel = "No output yet",
  title,
  className,
}: {
  logs: LogEntry[];
  autoScroll?: boolean;
  onClear?: () => void;
  height?: number | string;
  emptyLabel?: string;
  title?: string;
  className?: string;
}) {
  const [filter, setFilter] = useState<"all" | "warn" | "error">("all");
  const [follow, setFollow] = useState(autoScroll);
  const boxRef = useRef<HTMLDivElement>(null);

  const visible = logs.filter((l) => (filter === "all" ? true : filter === "warn" ? l.level === "warn" || l.level === "error" : l.level === "error"));

  useEffect(() => {
    if (!follow || !boxRef.current) return;
    boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [visible.length, follow]);

  const plain = visible.map((l) => `${l.timestamp} ${LEVEL_TAG[l.level]} ${l.message}${l.detail ? ` — ${l.detail}` : ""}`).join("\n");

  return (
    <div className={clsx("flex flex-col rounded-lg border border-white/[0.07] bg-black/45 overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-white/[0.055] bg-white/[0.02]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline whitespace-nowrap">
            {title ?? "Execution log"}
          </span>
          <span className="font-mono text-[10px] text-outline/70 tnum">{logs.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            ariaLabel="Log level filter"
            options={[
              { value: "all", label: "All" },
              { value: "warn", label: "Warn+" },
              { value: "error", label: "Errors" },
            ]}
          />
          <button
            type="button"
            onClick={() => setFollow((f) => !f)}
            aria-pressed={follow}
            aria-label="Follow new output"
            title="Follow new output"
            className={clsx(
              "w-6 h-6 flex items-center justify-center rounded-md transition-colors",
              follow ? "text-primary-soft bg-primary/15" : "text-outline hover:text-on-surface hover:bg-white/[0.07]",
            )}
          >
            <ArrowDownToLine size={12} />
          </button>
          <CopyButton text={plain} label="Copy" />
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear log"
              title="Clear log"
              className="w-6 h-6 flex items-center justify-center rounded-md text-outline hover:text-error hover:bg-error/12 transition-colors"
            >
              <Eraser size={12} />
            </button>
          )}
        </div>
      </div>
      <div
        ref={boxRef}
        role="log"
        aria-live="polite"
        aria-label={title ?? "Execution log"}
        className="overflow-auto font-mono text-[11px] leading-[17px] px-2 py-1.5"
        style={{ height }}
      >
        {visible.length === 0 ? (
          <EmptyState compact title={emptyLabel} description="Commands and backend output appear here." />
        ) : (
          visible.map((l) => (
            <div key={l.id} className="flex gap-2 hover:bg-white/[0.03] rounded px-1 -mx-1 py-[1px]">
              <span className="text-white/25 shrink-0 tnum">{l.timestamp}</span>
              <span className={clsx("shrink-0 font-semibold", LEVEL_STYLE[l.level])}>{LEVEL_TAG[l.level]}</span>
              <span className={clsx("min-w-0 break-all", LEVEL_STYLE[l.level])}>
                {l.message}
                {l.detail && <span className="text-outline/70"> · {l.detail}</span>}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
