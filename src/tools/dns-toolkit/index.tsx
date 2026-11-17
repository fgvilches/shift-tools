import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Clock3,
  Copy,
  Globe2,
  History,
  ListTree,
  RefreshCw,
  Search,
  Server,
  Timer,
  X,
} from "lucide-react";
import { ToolView, type Telemetry } from "@/components/layout/ToolView";
import { Badge, Dot } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CodeArea";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState, ErrorNotice, InfoNotice, Progress, Spinner } from "@/components/ui/Feedback";
import { Input, SegmentedControl, Select } from "@/components/ui/Form";
import { Tabs } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { network } from "@/lib/api";
import { clockTime, dateTime, ms, plural } from "@/lib/format";
import { errorMessage } from "@/lib/ipc";
import type { DnsAnswer, DnsRecord } from "@/lib/types";

const DEFAULT_DOMAIN = "example.com";
const DOMAIN_INPUT_ID = "dns-domain-input";
const MAX_HISTORY = 8;

const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "PTR", "CAA"] as const;
type RecordType = (typeof RECORD_TYPES)[number];
type Mode = "lookup" | "propagation";
type ResolverKey = "system" | "cloudflare" | "google" | "quad9";

interface ResolverDefinition {
  key: ResolverKey;
  name: string;
  address: string | null;
}

const RESOLVERS: ResolverDefinition[] = [
  { key: "system", name: "System", address: null },
  { key: "cloudflare", name: "Cloudflare", address: "1.1.1.1" },
  { key: "google", name: "Google", address: "8.8.8.8" },
  { key: "quad9", name: "Quad9", address: "9.9.9.9" },
];

interface HistoryEntry {
  id: number;
  domain: string;
  type: RecordType;
  mode: Mode;
  at: string;
}

interface ResolverRun {
  definition: ResolverDefinition;
  answer: DnsAnswer;
}

interface ComparisonRow extends ResolverRun {
  values: string[];
  signature: string | null;
  matches: boolean;
  ttlText: string;
  ttls: number[];
}

interface Comparison {
  rows: ComparisonRow[];
  agreeing: number;
  total: number;
  failures: number;
  distinct: number;
  ttlDistinct: number;
  fastest: ComparisonRow | null;
  consistent: boolean;
}

function resolverFor(key: ResolverKey): ResolverDefinition {
  return RESOLVERS.find((r) => r.key === key) ?? { key: "system", name: "System", address: null };
}

function signatureOf(records: DnsRecord[]): string {
  return records
    .map((r) => `${r.recordType.toLowerCase()}|${r.value.trim().toLowerCase()}`)
    .sort()
    .join("\n");
}

function latencyTone(value: number): "success" | "primary" | "warning" {
  if (value < 80) return "success";
  if (value < 300) return "primary";
  return "warning";
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline shrink-0">{label}</dt>
      <dd className="font-mono text-[10.5px] text-on-variant text-right break-all min-w-0">{children}</dd>
    </div>
  );
}

export default function DnsToolkitView() {
  const [domain, setDomain] = useState(DEFAULT_DOMAIN);
  const [recordType, setRecordType] = useState<RecordType>("A");
  const [resolver, setResolver] = useState<ResolverKey>("system");
  const [mode, setMode] = useState<Mode>("lookup");
  const [answer, setAnswer] = useState<DnsAnswer | null>(null);
  const [propResults, setPropResults] = useState<ResolverRun[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const requestRef = useRef(0);
  const historySeq = useRef(0);
  const copiedTimer = useRef<number | null>(null);
  const bootRef = useRef(false);

  const pushHistory = useCallback((host: string, type: RecordType, queryMode: Mode) => {
    historySeq.current += 1;
    const entry: HistoryEntry = {
      id: historySeq.current,
      domain: host,
      type,
      mode: queryMode,
      at: new Date().toISOString(),
    };
    setHistory((prev) => {
      const rest = prev.filter(
        (h) => !(h.type === entry.type && h.mode === entry.mode && h.domain.toLowerCase() === host.toLowerCase()),
      );
      return [entry, ...rest].slice(0, MAX_HISTORY);
    });
  }, []);

  const execute = useCallback(
    async (spec: { domain: string; type: RecordType; resolver: ResolverKey; mode: Mode }) => {
      const host = spec.domain.trim();
      if (!host) return;
      requestRef.current += 1;
      const token = requestRef.current;
      setLoading(true);
      setFault(null);

      try {
        if (spec.mode === "lookup") {
          const result = await network.dns(host, spec.type, resolverFor(spec.resolver).address);
          if (token !== requestRef.current) return;
          setAnswer(result);
        } else {
          const runs = await Promise.all(
            RESOLVERS.map(async (definition): Promise<ResolverRun> => {
              try {
                const result = await network.dns(host, spec.type, definition.address);
                return { definition, answer: result };
              } catch (err) {
                return {
                  definition,
                  answer: {
                    resolver: definition.address ?? "system",
                    domain: host,
                    recordType: spec.type,
                    records: [],
                    durationMs: 0,
                    error: errorMessage(err),
                  },
                };
              }
            }),
          );
          if (token !== requestRef.current) return;
          setPropResults(runs);
        }
        if (token === requestRef.current) pushHistory(host, spec.type, spec.mode);
      } catch (err) {
        if (token === requestRef.current) setFault(errorMessage(err));
      } finally {
        if (token === requestRef.current) setLoading(false);
      }
    },
    [pushHistory],
  );

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    void execute({ domain: DEFAULT_DOMAIN, type: "A", resolver: "system", mode: "lookup" });
  }, [execute]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const lookupResolver = resolverFor(resolver);
  const records = answer?.records ?? [];
  const firstRecord = records[0] ?? null;
  const hasResult = answer !== null || propResults !== null;

  const submit = useCallback(() => {
    const host = domain.trim();
    if (!host) {
      toast.warning("Enter a domain", "A hostname or IP address is required.");
      document.getElementById(DOMAIN_INPUT_ID)?.focus();
      return;
    }
    if (/\s/.test(host)) {
      toast.warning("Invalid target", "Hostnames cannot contain spaces.");
      return;
    }
    setDomain(host);
    void execute({ domain: host, type: recordType, resolver, mode });
  }, [domain, recordType, resolver, mode, execute]);

  const changeRecordType = (next: RecordType) => {
    if (next === recordType) return;
    setRecordType(next);
    if (hasResult) {
      const host = domain.trim();
      if (host) void execute({ domain: host, type: next, resolver, mode });
    }
  };

  const changeResolver = (next: ResolverKey) => {
    if (next === resolver) return;
    setResolver(next);
    if (mode === "lookup" && hasResult) {
      const host = domain.trim();
      if (host) void execute({ domain: host, type: recordType, resolver: next, mode });
    }
  };

  const changeMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    const host = domain.trim();
    if (host) void execute({ domain: host, type: recordType, resolver, mode: next });
  };

  const rerun = (entry: HistoryEntry) => {
    setDomain(entry.domain);
    setRecordType(entry.type);
    setMode(entry.mode);
    void execute({ domain: entry.domain, type: entry.type, resolver, mode: entry.mode });
  };

  const copyText = useCallback(async (text: string, key: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(null), 1400);
    } catch (err) {
      toast.error("Clipboard unavailable", errorMessage(err));
    }
  }, []);

  const comparison = useMemo<Comparison | null>(() => {
    if (!propResults) return null;

    const base = propResults.map((run) => {
      const values = run.answer.error ? [] : run.answer.records.map((r) => r.value);
      const signature = run.answer.error ? null : signatureOf(run.answer.records);
      const ttls = [
        ...new Set(
          run.answer.records
            .map((r) => r.ttl)
            .filter((ttl): ttl is number => ttl !== null),
        ),
      ].sort((a, b) => a - b);
      const ttlText = ttls.length > 0 ? ttls.map((ttl) => `${ttl}s`).join(" / ") : "—";
      return { definition: run.definition, answer: run.answer, values, signature, matches: false, ttlText, ttls };
    });

    const counts = new Map<string, number>();
    for (const row of base) {
      if (row.signature === null) continue;
      counts.set(row.signature, (counts.get(row.signature) ?? 0) + 1);
    }

    let majority: string | null = null;
    let best = 0;
    counts.forEach((count, signature) => {
      if (count > best) {
        best = count;
        majority = signature;
      }
    });

    const total = base.length;
    const agreeing = base.filter((row) => row.signature !== null && row.signature === majority).length;
    const failures = base.filter((row) => row.answer.error !== null).length;
    const ttlDistinct = new Set(base.flatMap((row) => row.ttls)).size;
    const rows = base.map((row) => ({ ...row, matches: row.signature !== null && row.signature === majority }));
    const fastest =
      rows
        .filter((row) => row.answer.error === null)
        .sort((a, b) => a.answer.durationMs - b.answer.durationMs)[0] ?? null;

    return {
      rows,
      agreeing,
      total,
      failures,
      distinct: counts.size,
      ttlDistinct,
      fastest,
      consistent: failures === 0 && agreeing === total,
    };
  }, [propResults]);

  const zoneText = useMemo(() => {
    if (!answer || answer.error || answer.records.length === 0) return "";
    return [
      `; ${answer.domain} ${answer.recordType} via ${answer.resolver}`,
      `; ${plural(answer.records.length, "record")} · ${ms(answer.durationMs)} · ${new Date().toISOString()}`,
      "",
      ...answer.records.map((r) => `${answer.domain}.\t${r.ttl ?? ""}\tIN\t${r.recordType}\t${r.value}`),
    ].join("\n");
  }, [answer]);

  const propText = useMemo(() => {
    if (!comparison) return "";
    return [
      `; ${domain} ${recordType} · propagation across ${comparison.total} resolvers`,
      ...comparison.rows.map((row) => {
        const head = `${row.definition.name} (${row.definition.address ?? "system"}) · ${ms(row.answer.durationMs)}`;
        const body = row.answer.error
          ? `ERROR: ${row.answer.error}`
          : row.values.length > 0
            ? row.values.join("\n  ")
            : "(no records)";
        return `${head}\n  ${body}`;
      }),
    ].join("\n\n");
  }, [comparison, domain, recordType]);

  const telemetry: Telemetry[] =
    mode === "lookup"
      ? [
          {
            label: "Records",
            value: answer && !answer.error ? String(records.length) : "—",
            tone: "primary",
            icon: <ListTree size={14} />,
          },
          {
            label: "Roundtrip",
            value: answer ? ms(answer.durationMs) : "—",
            tone: answer ? latencyTone(answer.durationMs) : "neutral",
            icon: <Timer size={14} />,
          },
          { label: "Resolver", value: lookupResolver.name, tone: "neutral", icon: <Server size={14} /> },
          {
            label: "Status",
            value: answer ? (answer.error ? "ERROR" : "OK") : loading ? "QUERYING" : "IDLE",
            tone: answer ? (answer.error ? "error" : "success") : "neutral",
            icon: <Dot tone={answer ? (answer.error ? "error" : "success") : "neutral"} />,
          },
        ]
      : [
          {
            label: "Agreement",
            value: comparison ? `${comparison.agreeing}/${comparison.total}` : "—",
            tone: comparison ? (comparison.consistent ? "success" : "warning") : "neutral",
            icon: <Globe2 size={14} />,
          },
          {
            label: "Fastest",
            value: comparison?.fastest ? ms(comparison.fastest.answer.durationMs) : "—",
            tone: "primary",
            icon: <Timer size={14} />,
          },
          {
            label: "Answers",
            value: comparison ? `${comparison.distinct} distinct` : "—",
            tone: "neutral",
            icon: <ListTree size={14} />,
          },
          {
            label: "Failures",
            value: comparison ? String(comparison.failures) : "—",
            tone: comparison && comparison.failures > 0 ? "error" : "success",
            icon: <AlertTriangle size={14} />,
          },
        ];

  const canCopyZone = zoneText.length > 0;

  const recordColumns: Column<DnsRecord>[] = [
    {
      key: "recordType",
      header: "Type",
      width: 74,
      render: (record) => (
        <Badge tone="primary" mono className="h-[18px] px-1.5 text-[9.5px]">
          {record.recordType}
        </Badge>
      ),
    },
    {
      key: "value",
      header: "Value",
      render: (record) => (
        <span className="font-mono text-[11px] leading-snug text-on-surface break-all whitespace-pre-wrap">
          {record.value}
        </span>
      ),
    },
    {
      key: "ttl",
      header: "TTL",
      width: 68,
      align: "right",
      mono: true,
      render: (record) => (
        <span className="text-on-variant">{record.ttl === null ? "—" : `${record.ttl}s`}</span>
      ),
    },
    {
      key: "copy",
      header: "Copy",
      width: 48,
      align: "center",
      render: (record) => {
        const key = `record-${record.recordType}-${record.value}`;
        const isCopied = copied === key;
        return (
          <IconButton
            size="sm"
            label={`Copy ${record.recordType} record value`}
            icon={isCopied ? <Check size={11} className="text-secondary" /> : <Copy size={11} />}
            onClick={() => void copyText(record.value, key)}
          />
        );
      },
    },
  ];

  const comparisonColumns: Column<ComparisonRow>[] = [
    {
      key: "resolver",
      header: "Resolver",
      width: 156,
      render: (row) => (
        <div className="flex items-center gap-2 py-0.5 min-w-0">
          <Dot tone={row.answer.error ? "error" : row.matches ? "success" : "warning"} />
          <div className="min-w-0 leading-tight">
            <div className="text-[11.5px] text-on-surface">{row.definition.name}</div>
            <div className="font-mono text-[9.5px] text-outline">{row.definition.address ?? "OS default"}</div>
          </div>
        </div>
      ),
    },
    {
      key: "answer",
      header: "Answer",
      render: (row) => {
        if (row.answer.error) {
          return <span className="text-[10.5px] leading-snug text-error break-words">{row.answer.error}</span>;
        }
        if (row.values.length === 0) {
          return <span className="text-[10.5px] italic text-outline">No records</span>;
        }
        return (
          <div className="space-y-0.5 py-1">
            {row.values.slice(0, 6).map((value, index) => (
              <div
                key={`${index}-${value}`}
                className={`font-mono text-[10.5px] leading-snug break-all ${row.matches ? "text-on-surface" : "text-warning"}`}
              >
                {value}
              </div>
            ))}
            {row.values.length > 6 && (
              <div className="text-[9.5px] text-outline">+{row.values.length - 6} more</div>
            )}
          </div>
        );
      },
    },
    {
      key: "ttl",
      header: "TTL",
      width: 86,
      align: "right",
      mono: true,
      render: (row) => (
        <span className={comparison && comparison.ttlDistinct > 1 ? "text-warning" : "text-on-variant"}>
          {row.ttlText}
        </span>
      ),
    },
    {
      key: "latency",
      header: "Latency",
      width: 76,
      align: "right",
      mono: true,
      render: (row) =>
        row.answer.error ? (
          <span className="text-outline">—</span>
        ) : (
          <span
            className={
              row.answer.durationMs < 100
                ? "text-secondary"
                : row.answer.durationMs < 300
                  ? "text-on-variant"
                  : "text-warning"
            }
          >
            {ms(row.answer.durationMs)}
          </span>
        ),
    },
    {
      key: "status",
      header: "Status",
      width: 82,
      render: (row) =>
        row.answer.error ? (
          <Badge tone="error" mono>
            Failed
          </Badge>
        ) : row.matches ? (
          <Badge tone="success" mono>
            Match
          </Badge>
        ) : (
          <Badge tone="warning" mono>
            Differs
          </Badge>
        ),
    },
    {
      key: "copy",
      header: "Copy",
      width: 48,
      align: "center",
      render: (row) => {
        const key = `resolver-${row.definition.key}`;
        if (row.values.length === 0) return <span className="text-[10px] text-outline">—</span>;
        return (
          <IconButton
            size="sm"
            label={`Copy ${row.definition.name} answer`}
            icon={copied === key ? <Check size={11} className="text-secondary" /> : <Copy size={11} />}
            onClick={() => void copyText(row.values.join("\n"), key)}
          />
        );
      },
    },
  ];

  const lookupEmpty = loading ? (
    <EmptyState
      compact
      icon={<Spinner size={16} />}
      title={`Querying ${lookupResolver.name}…`}
      description={`${recordType} for ${domain || "the target"} over port 53.`}
    />
  ) : answer?.error ? (
    <EmptyState
      compact
      icon={<AlertTriangle size={16} />}
      title="No records returned"
      description="The resolver failed before an answer arrived. The error is shown above."
    />
  ) : answer ? (
    <EmptyState
      compact
      icon={<Globe2 size={16} />}
      title={`No ${recordType} records`}
      description={`${answer.domain} resolved successfully but returned an empty ${recordType} answer set.`}
    />
  ) : (
    <EmptyState
      compact
      icon={<Search size={16} />}
      title="No query yet"
      description="Enter a hostname and press Enter to resolve it."
    />
  );

  const propagationEmpty = loading ? (
    <EmptyState
      compact
      icon={<Spinner size={16} />}
      title="Querying 4 resolvers…"
      description="System, Cloudflare, Google and Quad9 are being asked in parallel."
    />
  ) : comparison ? (
    <EmptyState compact icon={<Globe2 size={16} />} title="No comparison data" description="All four resolvers returned empty answer sets." />
  ) : (
    <EmptyState
      compact
      icon={<Globe2 size={16} />}
      title="Run a propagation check"
      description="The same question is sent to four resolvers at once to find disagreement."
      action={
        <Button variant="primary" size="sm" icon={<Search size={12} />} onClick={submit}>
          Query 4 resolvers
        </Button>
      }
    />
  );

  return (
    <ToolView
      eyebrow="RESOLVER PROBE"
      eyebrowTone="tertiary"
      eyebrowHint="UDP/TCP · 53 · 9 RECORD TYPES"
      title="DNS Toolkit"
      description="Query A, AAAA, MX, TXT, NS, and CNAME records and compare answers across resolvers."
      telemetry={telemetry}
      status={
        <>
          <Badge tone="neutral" mono dot>
            System + 3 public
          </Badge>
          <IconButton
            label="Re-run current query"
            icon={<RefreshCw size={13} />}
            onClick={() => submit()}
            disabled={loading}
          />
        </>
      }
      headerExtra={
        mode === "propagation" && comparison ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
              <span className="flex items-center gap-1.5 text-on-variant min-w-0 truncate">
                <span className="text-on-surface font-medium">Agreement</span>
                <span className={comparison.consistent ? "text-secondary font-semibold" : "text-warning font-semibold"}>
                  {comparison.agreeing}/{comparison.total}
                </span>
                <span className="text-outline">resolvers return the same answer</span>
              </span>
              <span className="text-outline shrink-0">
                {comparison.fastest
                  ? `fastest ${comparison.fastest.definition.name} · ${ms(comparison.fastest.answer.durationMs)}`
                  : ""}
              </span>
            </div>
            <Progress
              value={(comparison.agreeing / Math.max(1, comparison.total)) * 100}
              tone={comparison.consistent ? "success" : "warning"}
              height={3}
              label="Resolver agreement"
            />
          </div>
        ) : undefined
      }
    >
      {fault && <ErrorNotice title="Query failed" message={fault} onRetry={() => submit()} />}

      <Card className="p-2.5 space-y-2">
        <form
          className="flex flex-col lg:flex-row lg:items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex-1 min-w-0">
            <Input
              id={DOMAIN_INPUT_ID}
              mono
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="example.com or 1.1.1.1"
              aria-label="Domain or IP to resolve"
              spellCheck={false}
              autoComplete="off"
              leading={<Globe2 size={12} />}
              trailingSlot={
                domain ? (
                  <IconButton
                    size="sm"
                    label="Clear domain"
                    icon={<X size={11} />}
                    onClick={() => {
                      setDomain("");
                      document.getElementById(DOMAIN_INPUT_ID)?.focus();
                    }}
                  />
                ) : undefined
              }
            />
          </div>
          <div className="w-full sm:w-[190px] shrink-0">
            <Select
              sizeVariant="md"
              value={resolver}
              onChange={(event) => changeResolver(event.target.value as ResolverKey)}
              disabled={mode === "propagation"}
              title={
                mode === "propagation" ? "Propagation always queries all four resolvers" : "Resolver used for lookups"
              }
              options={RESOLVERS.map((r) => ({
                value: r.key,
                label: r.address ? `${r.name} · ${r.address}` : `${r.name} · OS default`,
              }))}
              aria-label="Resolver"
            />
          </div>
          <Button type="submit" variant="primary" size="md" loading={loading} icon={<Search size={13} />} trailing={<Kbd>↵</Kbd>}>
            Resolve
          </Button>
        </form>

        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-outline shrink-0">
              Record type
            </span>
            <SegmentedControl
              value={recordType}
              onChange={changeRecordType}
              options={RECORD_TYPES.map((type) => ({ value: type, label: type }))}
              ariaLabel="DNS record type"
            />
          </div>
          <Tabs<Mode>
            value={mode}
            onChange={changeMode}
            ariaLabel="DNS toolkit mode"
            className="shrink-0"
            items={[
              { value: "lookup", label: "Lookup", icon: <Search size={11} /> },
              { value: "propagation", label: "Propagation", icon: <Globe2 size={11} />, count: 4 },
            ]}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_292px] gap-3 items-start">
        <div className="min-w-0 flex flex-col gap-3">
          {mode === "lookup" ? (
            <>
              <Card className="overflow-hidden">
                <CardHeader
                  title="Answer records"
                  hint={`${answer?.domain ?? (domain || "no target")} · ${recordType} · ${lookupResolver.name}`}
                  icon={<ListTree size={13} />}
                  actions={
                    <>
                      {answer && (
                        <Badge tone={answer.error ? "error" : latencyTone(answer.durationMs)} mono>
                          {answer.error ? "failed" : ms(answer.durationMs)}
                        </Badge>
                      )}
                      <Badge tone="neutral" mono>
                        {plural(records.length, "record")}
                      </Badge>
                      <CopyButton text={zoneText} label="Copy all" size="sm" />
                    </>
                  }
                />
                {loading && <Progress indeterminate height={2} label="DNS query in flight" />}
                {answer?.error && (
                  <div className="px-3 pt-2.5">
                    <ErrorNotice title="Resolver returned an error" message={answer.error} onRetry={() => submit()} />
                  </div>
                )}
                <DataTable
                  ariaLabel={`${recordType} records for ${answer?.domain ?? domain}`}
                  columns={recordColumns}
                  rows={records}
                  rowKey={(record, index) => `${index}-${record.recordType}-${record.value}`}
                  empty={lookupEmpty}
                  footer={
                    records.length > 0 ? (
                      <tr>
                        <td colSpan={recordColumns.length} className="px-2 h-7">
                          <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                            <span>
                              {plural(records.length, "record")} ·{" "}
                              {firstRecord?.ttl === null || firstRecord?.ttl === undefined
                                ? "TTL —"
                                : `TTL ${firstRecord.ttl}s`}
                              {answer?.resolver ? ` · ${answer.resolver}` : ""}
                            </span>
                            <span className="flex items-center gap-1">
                              <Kbd>↵</Kbd> re-run
                            </span>
                          </div>
                        </td>
                      </tr>
                    ) : undefined
                  }
                />
              </Card>

              {canCopyZone && (
                <Card className="overflow-hidden">
                  <CardHeader
                    title="Zone export"
                    hint={`dig ${answer?.domain ?? domain} ${recordType}${
                      lookupResolver.address ? ` @${lookupResolver.address}` : ""
                    }`}
                    icon={<Copy size={13} />}
                    actions={<CopyButton text={zoneText} label="Copy zone" size="sm" />}
                  />
                  <pre className="max-h-[172px] overflow-auto px-3.5 py-2.5 font-mono text-[10.5px] leading-relaxed text-on-variant whitespace-pre-wrap break-all">
                    {zoneText}
                  </pre>
                </Card>
              )}
            </>
          ) : (
            <Card className="overflow-hidden">
              <CardHeader
                title="Resolver comparison"
                hint={`${domain || "no target"} · ${recordType} · 4 resolvers in parallel`}
                icon={<Globe2 size={13} />}
                actions={
                  <>
                    {comparison && (
                      <Badge tone={comparison.consistent ? "success" : "warning"} dot>
                        {comparison.consistent
                          ? `Consistent across ${comparison.agreeing}/${comparison.total}`
                          : `${comparison.agreeing}/${comparison.total} agree`}
                      </Badge>
                    )}
                    {comparison && (
                      <Badge tone="neutral" mono>
                        TTL {comparison.ttlDistinct} variant{comparison.ttlDistinct === 1 ? "" : "s"}
                      </Badge>
                    )}
                    <CopyButton text={propText} label="Copy answers" size="sm" />
                  </>
                }
              />
              {loading && <Progress indeterminate height={2} label="Propagation query in flight" />}
              {comparison && !comparison.consistent && (
                <div className="px-3 pt-2.5">
                  <InfoMismatch comparison={comparison} />
                </div>
              )}
              <DataTable
                ariaLabel="Propagation matrix across resolvers"
                columns={comparisonColumns}
                rows={comparison?.rows ?? []}
                rowKey={(row) => row.definition.key}
                rowTone={(row) => (row.answer.error ? "error" : row.matches ? null : "warning")}
                empty={propagationEmpty}
                footer={
                  comparison ? (
                    <tr>
                      <td colSpan={comparisonColumns.length} className="px-2 h-7">
                        <div className="flex items-center justify-between font-mono text-[10px] text-outline">
                          <span>
                            {plural(comparison.total, "resolver")} · {comparison.distinct} distinct answer{" "}
                            {comparison.distinct === 1 ? "set" : "sets"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Kbd>↵</Kbd> re-run
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : undefined
                }
              />
            </Card>
          )}
        </div>

        <div className="min-w-0 flex flex-col gap-3">
          <Card className="overflow-hidden">
            <CardHeader
              title={mode === "lookup" ? "Primary resolution" : "Propagation summary"}
              hint={mode === "lookup" ? lookupResolver.name : `${recordType} · ${comparison?.total ?? 4} resolvers`}
              icon={mode === "lookup" ? <Server size={13} /> : <Globe2 size={13} />}
              actions={
                mode === "lookup" ? (
                  <Badge tone="primary" mono>
                    {recordType}
                  </Badge>
                ) : comparison ? (
                  <Badge tone={comparison.consistent ? "success" : "warning"} mono>
                    {comparison.consistent ? "consistent" : "divergent"}
                  </Badge>
                ) : undefined
              }
            />
            <div className="p-3">
              {mode === "lookup" ? (
                !answer || answer.error ? (
                  <EmptyState
                    compact
                    icon={<Server size={15} />}
                    title={answer?.error ? "No resolution" : "Awaiting query"}
                    description={answer?.error ?? "Run a lookup to see the primary answer."}
                  />
                ) : (
                  <div className="space-y-2.5">
                    <div className="min-w-0">
                      <div className="font-mono text-[15px] font-semibold leading-tight text-on-surface tnum break-all">
                        {firstRecord?.value ?? "No records"}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-outline">
                        <span>{plural(answer.records.length, "record")}</span>
                        <span>·</span>
                        <span className="font-mono">{answer.recordType}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-md bg-black/30 border border-white/[0.05] px-2 py-1.5 font-mono text-[10px]">
                      <span className="text-outline">
                        TTL{" "}
                        <strong className="text-on-surface">
                          {firstRecord?.ttl === null || firstRecord?.ttl === undefined ? "—" : `${firstRecord.ttl}s`}
                        </strong>
                      </span>
                      <span className="text-outline">
                        RTT <strong className={latencyTone(answer.durationMs) === "warning" ? "text-warning" : "text-secondary"}>
                          {ms(answer.durationMs)}
                        </strong>
                      </span>
                    </div>
                    <dl className="space-y-1">
                      <Detail label="Domain">{answer.domain}</Detail>
                      <Detail label="Resolver">{answer.resolver}</Detail>
                      <Detail label="Type">{answer.recordType}</Detail>
                    </dl>
                  </div>
                )
              ) : !comparison ? (
                <EmptyState
                  compact
                  icon={<Globe2 size={15} />}
                  title="No comparison yet"
                  description="Run a propagation check to compare four resolvers."
                />
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`font-mono text-[24px] font-semibold leading-none tnum ${
                        comparison.consistent ? "text-secondary" : "text-warning"
                      }`}
                    >
                      {comparison.agreeing}
                      <span className="text-[13px] text-outline">/{comparison.total}</span>
                    </span>
                    <span className="text-[9.5px] uppercase tracking-[0.08em] text-outline">resolvers</span>
                  </div>
                  <p className="text-[11px] leading-snug text-on-variant">
                    {comparison.consistent
                      ? `Consistent across ${comparison.agreeing}/${comparison.total} resolvers.`
                      : `${comparison.agreeing}/${comparison.total} resolvers agree on the same answer set.`}
                  </p>
                  <dl className="space-y-1">
                    <Detail label="Distinct sets">{comparison.distinct}</Detail>
                    <Detail label="TTL values">{comparison.ttlDistinct > 0 ? comparison.ttlDistinct : "—"}</Detail>
                    <Detail label="Fastest">
                      {comparison.fastest
                        ? `${comparison.fastest.definition.name} · ${ms(comparison.fastest.answer.durationMs)}`
                        : "—"}
                    </Detail>
                    <Detail label="Failures">{comparison.failures}</Detail>
                  </dl>
                </div>
              )}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title="Recent queries"
              hint={`Last ${MAX_HISTORY} · click to re-run`}
              icon={<History size={13} />}
              actions={
                <Badge tone="neutral" mono>
                  {history.length}
                </Badge>
              }
            />
            {history.length === 0 ? (
              <EmptyState
                compact
                icon={<Clock3 size={15} />}
                title="No queries yet"
                description="Every run is parked here for one-click replay."
              />
            ) : (
              <div className="divide-y divide-white/[0.045]">
                {history.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => rerun(entry)}
                    aria-label={`Re-run ${entry.mode} query for ${entry.domain} ${entry.type}`}
                    title={dateTime(entry.at)}
                    className="w-full h-7 px-2 flex items-center gap-2 text-left transition-colors hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-[-2px]"
                  >
                    <Badge
                      tone={entry.mode === "lookup" ? "primary" : "tertiary"}
                      mono
                      className="h-[16px] px-1.5 text-[9px] shrink-0"
                    >
                      {entry.type}
                    </Badge>
                    <span className="min-w-0 flex-1 font-mono text-[10.5px] text-on-variant truncate">
                      {entry.domain}
                    </span>
                    {entry.mode === "propagation" ? (
                      <Globe2 size={9} className="text-tertiary shrink-0" aria-hidden />
                    ) : (
                      <Search size={9} className="text-outline shrink-0" aria-hidden />
                    )}
                    <span className="font-mono text-[9.5px] text-outline tnum shrink-0">{clockTime(entry.at)}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </ToolView>
  );
}

function InfoMismatch({ comparison }: { comparison: Comparison }) {
  const differing = comparison.total - comparison.agreeing;
  return (
    <InfoNotice tone="warning" icon={<AlertTriangle size={12} />}>
      <span className="font-medium">{plural(differing, "resolver")} returned a different answer set.</span>{" "}
      <span className="text-on-variant/80">
        {comparison.ttlDistinct > 1
          ? `TTLs differ across resolvers (${comparison.ttlDistinct} distinct values). Caches may still be converging.`
          : "TTLs match; the record values diverge. Check for split-horizon or stale caches."}
      </span>
    </InfoNotice>
  );
}
