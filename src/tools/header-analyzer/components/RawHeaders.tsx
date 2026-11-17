import { useMemo, useState } from "react";
import { Search, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CodeArea";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input } from "@/components/ui/Form";
import { EmptyState } from "@/components/ui/Feedback";
import { headersToText } from "../lib/analysis";
import { CopyIconButton } from "./CopyIconButton";

interface RawHeaderRow {
  id: number;
  name: string;
  value: string;
}

export function RawHeaders({ headers }: { headers: [string, string][] }) {
  const [query, setQuery] = useState("");

  const rows = useMemo<RawHeaderRow[]>(
    () => headers.map(([name, value], id) => ({ id, name, value })),
    [headers],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(q) || row.value.toLowerCase().includes(q));
  }, [rows, query]);

  const rawText = useMemo(() => headersToText(headers), [headers]);

  const columns: Column<RawHeaderRow>[] = [
    {
      key: "name",
      header: "Header",
      width: 214,
      mono: true,
      render: (row) => (
        <span className="block truncate text-primary-soft" title={row.name}>
          {row.name}
        </span>
      ),
    },
    {
      key: "value",
      header: "Value",
      mono: true,
      render: (row) => (
        <span className="block truncate text-on-variant" title={row.value}>
          {row.value || "—"}
        </span>
      ),
    },
    {
      key: "copy",
      header: <span className="sr-only">Copy</span>,
      width: 34,
      align: "right",
      render: (row) => (
        <CopyIconButton text={`${row.name}: ${row.value}`} label={`Copy ${row.name} header`} />
      ),
    },
  ];

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader
        title="Raw response headers"
        hint={`${headers.length} lines · exactly as received`}
        icon={<Terminal size={13} />}
        actions={
          <>
            <div className="w-40">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter headers…"
                aria-label="Filter raw headers"
                sizeVariant="sm"
                leading={<Search size={11} />}
              />
            </div>
            <Badge tone="neutral" mono>
              {filtered.length}/{headers.length}
            </Badge>
            <CopyButton text={rawText} label="Copy all" />
          </>
        }
      />
      <div className="flex-1 min-h-0 [&_table]:table-fixed">
        <DataTable
          ariaLabel="Raw HTTP response headers"
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.id}
          dense
          maxHeight="320px"
          initialSort={{ key: "name", dir: "asc" }}
          empty={
            <EmptyState
              compact
              icon={<Terminal size={16} />}
              title={headers.length === 0 ? "No headers captured" : "No header matches"}
              description={
                headers.length === 0
                  ? "The response did not expose any headers."
                  : `Nothing contains “${query.trim()}”. Clear the filter to see all ${headers.length} headers.`
              }
            />
          }
          footer={
            headers.length > 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-2 h-7">
                  <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                    <span>Sorted by name · duplicates preserved</span>
                    <span>{headers.length} headers</span>
                  </div>
                </td>
              </tr>
            ) : undefined
          }
        />
      </div>
    </Card>
  );
}
