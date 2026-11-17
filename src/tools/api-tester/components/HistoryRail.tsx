import { History, Search, Trash2, Inbox } from "lucide-react";
import { clsx } from "clsx";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { IconButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/Feedback";
import type { ApiHistoryEntry } from "@/lib/types";
import { relative } from "@/lib/format";
import { METHOD_TEXT, statusTone } from "../lib/request";

export function HistoryRail({
  entries,
  activeId,
  onLoad,
  onDelete,
  onClear,
}: {
  entries: ApiHistoryEntry[];
  activeId: string | null;
  onLoad: (entry: ApiHistoryEntry) => void;
  onDelete: (entry: ApiHistoryEntry) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.spec.method.toLowerCase().includes(needle) ||
        entry.spec.url.toLowerCase().includes(needle),
    );
  }, [entries, query]);

  return (
    <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <CardHeader
        title="Request history"
        hint={`${entries.length} saved on this machine`}
        icon={<History size={13} />}
        actions={
          <IconButton
            size="sm"
            tone="danger"
            label="Clear request history"
            icon={<Trash2 size={12} />}
            disabled={entries.length === 0}
            onClick={onClear}
          />
        }
      />

      <div className="px-2.5 py-2 border-b border-white/[0.055]">
        <Input
          sizeVariant="sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter history…"
          aria-label="Filter request history"
          leading={<Search size={11} />}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <div className="px-2 py-4">
            <EmptyState
              compact
              icon={<Inbox size={15} />}
              title={entries.length === 0 ? "No requests yet" : "Nothing matches"}
              description={
                entries.length === 0
                  ? "Send a request and it lands here with its method, URL and last status."
                  : "Try a different path, host or method."
              }
            />
          </div>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((entry) => {
              const active = entry.id === activeId;
              return (
                <div
                  key={entry.id}
                  className={clsx(
                    "group flex items-start gap-1 rounded-lg border px-1.5 py-1 transition-colors duration-150",
                    active
                      ? "bg-primary/[0.12] border-primary/30"
                      : "border-transparent hover:bg-white/[0.045]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onLoad(entry)}
                    aria-label={`Load ${entry.spec.method} ${entry.name}`}
                    aria-current={active ? "true" : undefined}
                    className="min-w-0 flex-1 text-left rounded focus-visible:outline-2 focus-visible:outline-primary-soft"
                  >
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span
                        className={clsx(
                          "shrink-0 font-mono text-[8.5px] font-bold tracking-tight w-[34px]",
                          METHOD_TEXT[entry.spec.method],
                        )}
                      >
                        {entry.spec.method}
                      </span>
                      <span className="truncate text-[11.5px] text-on-surface">{entry.name}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 font-mono text-[9.5px] text-outline">
                      <Badge tone={statusTone(entry.lastStatus)} mono>
                        {entry.lastStatus ?? "—"}
                      </Badge>
                      <span className="truncate">{relative(entry.createdAt)}</span>
                    </div>
                  </button>
                  <IconButton
                    size="sm"
                    tone="danger"
                    label={`Delete ${entry.name} from history`}
                    icon={<Trash2 size={11} />}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 shrink-0"
                    onClick={() => onDelete(entry)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-2.5 py-1.5 border-t border-white/[0.055] flex items-center justify-between font-mono text-[9.5px] text-outline">
        <span className="tnum">{filtered.length} / {entries.length}</span>
        <span>localStorage</span>
      </div>
    </Card>
  );
}
