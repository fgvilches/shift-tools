import { ListPlus, Plus, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { SectionLabel } from "@/components/ui/Card";
import { Input } from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/Feedback";
import { COMMON_HEADERS, HEADER_NAMES_ID, newHeaderRow, type HeaderRow } from "../lib/request";

export function HeadersEditor({
  rows,
  onChange,
}: {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
}) {
  const update = (id: string, patch: Partial<HeaderRow>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const remove = (id: string) => {
    onChange(rows.filter((row) => row.id !== id));
  };

  const add = () => {
    onChange([...rows, newHeaderRow()]);
  };

  const named = rows.filter((row) => row.key.trim().length > 0).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel trailing={<span className="font-mono text-[10px] text-outline tnum">{named} active</span>}>
          Request headers
        </SectionLabel>
        <Button size="xs" icon={<Plus size={11} />} onClick={add}>
          Add header
        </Button>
      </div>

      <datalist id={HEADER_NAMES_ID}>
        {COMMON_HEADERS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={<ListPlus size={15} />}
          title="No custom headers"
          description="The Rust core fills in Content-Type from the body kind. Add a header to override or extend it."
        />
      ) : (
        <div className="space-y-1.5">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_26px] items-center gap-1.5"
            >
              <Input
                sizeVariant="sm"
                mono
                value={row.key}
                list={HEADER_NAMES_ID}
                spellCheck={false}
                placeholder={index === 0 ? "Accept" : "Header name"}
                aria-label={`Header ${index + 1} name`}
                onChange={(e) => update(row.id, { key: e.target.value })}
              />
              <Input
                sizeVariant="sm"
                mono
                value={row.value}
                spellCheck={false}
                placeholder="value"
                aria-label={`Header ${index + 1} value`}
                onChange={(e) => update(row.id, { value: e.target.value })}
              />
              <IconButton
                size="sm"
                tone="danger"
                label={`Remove header ${row.key.trim() || index + 1}`}
                icon={<X size={12} />}
                onClick={() => remove(row.id)}
              />
            </div>
          ))}
        </div>
      )}

      <p className="text-[10.5px] leading-tight text-outline">
        Names autocomplete from the common set; empty names are dropped on send. A Content-Type you set here wins over
        the body-kind default.
      </p>
    </div>
  );
}
