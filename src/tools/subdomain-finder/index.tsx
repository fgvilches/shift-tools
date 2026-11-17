import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Braces,
  Copy,
  FileSpreadsheet,
  Globe2,
  Layers,
  Network,
  RefreshCw,
  Search,
  Server,
  Timer,
  Waypoints,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState, ErrorNotice, InfoNotice, Meter, Progress, Spinner } from "@/components/ui/Feedback";
import { Input, SegmentedControl } from "@/components/ui/Form";
import { toast } from "@/components/ui/Toast";
import { network } from "@/lib/api";
import { errorMessage, isTauri } from "@/lib/ipc";
import { plural } from "@/lib/format";
import type { SubdomainFinding } from "@/lib/types";

type Scope = "apex" | "wildcard" | "subdomain";
type ScopeFilter = "all" | "apex" | "subdomain";

interface Row {
  host: string;
  source: SubdomainFinding["source"];
  ips: string[];
  scope: Scope;
}

interface WildcardProbe {
  host: string;
  /** Addresses answered for a random label, or null when the lookup failed. */
  ips: string[] | null;
  state: "pending" | "done" | "failed";
}

const MAX_IP_ROWS = 200;

/** Strip scheme, path, wildcard prefix and trailing dot; validate labels. */
function canonicalDomain(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0] ?? "";
  value = value.replace(/:\d+$/, "");
  value = value.replace(/^\*\./, "");
  value = value.replace(/\.$/, "");
  if (!value || value.length > 253) return null;
  const labels = value.split(".");
  if (labels.length < 2) return null;
  const labelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!labels.every((label) => labelPattern.test(label))) return null;
  if (!/[a-z]/.test(labels[labels.length - 1] ?? "")) return null;
  return value;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadFile(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isIpv6(ip: string): boolean {
  return ip.includes(":");
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline shrink-0">{label}</dt>
      <dd className="font-mono text-[10.5px] text-on-variant text-right truncate min-w-0">{children}</dd>
    </div>
  );
}

export default function SubdomainFinderView() {
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [findings, setFindings] = useState<SubdomainFinding[]>([]);
  const [scanning, setScanning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [probe, setProbe] = useState<WildcardProbe | null>(null);

  const busyRef = useRef(false);
  const startedAtRef = useRef(0);
  const tickerRef = useRef<number | null>(null);

  const stopTicker = useCallback(() => {
    if (tickerRef.current !== null) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  useEffect(() => stopTicker, [stopTicker]);

  const copyText = useCallback((text: string, what = "Value") => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`${what} copied`, text.length > 72 ? `${text.slice(0, 69)}…` : text),
      () =>
        toast.error(
          "Clipboard unavailable",
          "The native app grants clipboard access; a browser preview may not.",
        ),
    );
  }, []);

  const runScan = useCallback(async () => {
    if (busyRef.current) return;
    const domain = canonicalDomain(input);
    if (!domain) {
      setInputError("Enter an apex domain such as example.com — no scheme, path or wildcard.");
      return;
    }
    setInputError(null);
    if (!isTauri) {
      setError("This tool needs the native app. Launch it with `npm run app`.");
      setFindings([]);
      setTarget(domain);
      setDurationMs(null);
      return;
    }

    busyRef.current = true;
    setScanning(true);
    setError(null);
    setFindings([]);
    setDurationMs(null);
    setFinishedAt(null);
    setProbe(null);
    setTarget(domain);
    setElapsedMs(0);

    startedAtRef.current = performance.now();
    stopTicker();
    tickerRef.current = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAtRef.current);
    }, 200);

    try {
      // Real wildcard check first: a random label must not resolve on a normal zone.
      const probeHost = `wildcard-probe-${Math.random().toString(36).slice(2, 10)}.${domain}`;
      setProbe({ host: probeHost, ips: null, state: "pending" });
      try {
        const answer = await network.dns(probeHost, "A", null);
        const addresses = answer.records.map((record) => record.value.trim()).filter(Boolean);
        setProbe({ host: probeHost, ips: addresses, state: "done" });
      } catch {
        setProbe({ host: probeHost, ips: null, state: "failed" });
      }

      const list = await network.subdomains(domain);
      const elapsed = performance.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      setFindings([...list].sort((a, b) => a.host.localeCompare(b.host)));
      setDurationMs(elapsed);
      setFinishedAt(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      setFindings([]);
      setDurationMs(null);
      setFinishedAt(null);
      toast.error("Scan failed", message);
    } finally {
      stopTicker();
      setScanning(false);
      busyRef.current = false;
    }
  }, [input, stopTicker]);

  const wildcardIps = useMemo(() => {
    if (!probe || !probe.ips || probe.ips.length === 0) return new Set<string>();
    return new Set(probe.ips);
  }, [probe]);

  const rows = useMemo<Row[]>(() => {
    const apex = target;
    return findings.map((finding) => {
      const host = finding.host.toLowerCase();
      const scope: Scope =
        apex !== null && host === apex
          ? "apex"
          : finding.ips.some((ip) => wildcardIps.has(ip))
            ? "wildcard"
            : "subdomain";
      return { host: finding.host, source: finding.source, ips: finding.ips, scope };
    });
  }, [findings, target, wildcardIps]);

  const counts = useMemo(() => {
    let resolved = 0;
    let apex = 0;
    let wildcard = 0;
    for (const row of rows) {
      if (row.ips.length > 0) resolved += 1;
      if (row.scope === "apex") apex += 1;
      if (row.scope === "wildcard") wildcard += 1;
    }
    return { resolved, apex, wildcard, subdomains: rows.length - apex - wildcard };
  }, [rows]);

  const ipIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      for (const ip of row.ips) map.set(ip, (map.get(ip) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en", { numeric: true }));
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (scopeFilter === "apex" && row.scope !== "apex") return false;
      if (scopeFilter === "subdomain" && row.scope === "apex") return false;
      if (!needle) return true;
      return row.host.toLowerCase().includes(needle) || row.ips.some((ip) => ip.includes(needle));
    });
  }, [rows, query, scopeFilter]);

  const filteredAddresses = useMemo(
    () => new Set(filtered.flatMap((row) => row.ips)).size,
    [filtered],
  );

  const ipv4Count = ipIndex.filter(([ip]) => !isIpv6(ip)).length;
  const ipv6Count = ipIndex.length - ipv4Count;

  const exportFindings = useCallback(
    (format: "csv" | "json") => {
      if (!target || filtered.length === 0) return;
      const stamp = fileStamp();
      if (format === "csv") {
        const lines = ["host,scope,source,ip_count,ips"];
        for (const row of filtered) {
          lines.push(
            [csvCell(row.host), csvCell(row.scope), csvCell(row.source), row.ips.length, csvCell(row.ips.join(" "))].join(","),
          );
        }
        downloadFile(`subdomains-${target}-${stamp}.csv`, "text/csv", `${lines.join("\n")}\n`);
      } else {
        const payload = {
          domain: target,
          generatedAt: new Date().toISOString(),
          scanDurationMs: durationMs === null ? null : Math.round(durationMs),
          hostCount: filtered.length,
          resolvedCount: filtered.filter((row) => row.ips.length > 0).length,
          uniqueIpCount: filteredAddresses,
          wildcardProbe: probe ? { host: probe.host, addresses: probe.ips } : null,
          findings: filtered.map((row) => ({
            host: row.host,
            scope: row.scope,
            source: row.source,
            ips: row.ips,
          })),
        };
        downloadFile(`subdomains-${target}-${stamp}.json`, "application/json", `${JSON.stringify(payload, null, 2)}\n`);
      }
      toast.success(`${format.toUpperCase()} exported`, `${plural(filtered.length, "host")} → subdomains-${target}`);
    },
    [durationMs, filtered, filteredAddresses, probe, target],
  );

  const columns: Column<Row>[] = useMemo(
    () => [
      {
        key: "host",
        header: "Host",
        sortable: true,
        sortValue: (row) => row.host.toLowerCase(),
        render: (row) => (
          <div className="flex items-center gap-1.5 min-w-0">
            <Dot tone={row.scope === "apex" ? "warning" : row.ips.length > 0 ? "success" : "neutral"} />
            <span
              className={`font-mono text-[11.5px] truncate ${row.scope === "apex" ? "text-primary-soft font-medium" : "text-on-surface"}`}
              title={row.host}
            >
              {row.host}
            </span>
            <IconButton
              size="sm"
              label={`Copy ${row.host}`}
              icon={<Copy size={10} />}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 shrink-0"
              onClick={() => copyText(row.host, "Host")}
            />
          </div>
        ),
      },
      {
        key: "scope",
        header: "Scope",
        width: 108,
        sortable: true,
        sortValue: (row) => row.scope,
        render: (row) =>
          row.scope === "apex" ? (
            <Badge tone="warning" title="Apex — the exact domain that was scanned">
              apex
            </Badge>
          ) : row.scope === "wildcard" ? (
            <Badge tone="tertiary" title="Answers with the same address as a random label, so the zone likely uses a wildcard record">
              wildcard
            </Badge>
          ) : (
            <Badge tone="neutral" title="Resolved host under the apex">
              subdomain
            </Badge>
          ),
      },
      {
        key: "source",
        header: "Source",
        width: 92,
        sortable: true,
        sortValue: (row) => row.source,
        render: (row) =>
          row.source === "dns" ? (
            <Badge tone="tertiary" mono title="Discovered by DNS enumeration">
              dns
            </Badge>
          ) : (
            <Badge tone="primary" mono title="Discovered in crt.sh certificate transparency logs">
              crt.sh
            </Badge>
          ),
      },
      {
        key: "ipCount",
        header: "IPs",
        width: 52,
        align: "right",
        mono: true,
        sortable: true,
        sortValue: (row) => row.ips.length,
        render: (row) => (
          <span className={row.ips.length === 0 ? "text-outline" : "text-on-surface"}>{row.ips.length}</span>
        ),
      },
      {
        key: "addresses",
        header: "Addresses",
        hideBelow: "md",
        render: (row) =>
          row.ips.length === 0 ? (
            <span className="flex items-center gap-1.5 text-[10.5px] text-outline">
              <AlertTriangle size={10} className="text-warning/70" />
              no A record
            </span>
          ) : (
            <div className="flex items-center gap-1 min-w-0 overflow-hidden">
              {row.ips.slice(0, 3).map((ip) => (
                <span
                  key={ip}
                  className="font-mono text-[10px] tnum px-1.5 rounded-md bg-white/[0.055] border border-white/[0.06] text-on-variant whitespace-nowrap"
                  title={ip}
                >
                  {ip}
                </span>
              ))}
              {row.ips.length > 3 && (
                <span className="font-mono text-[9.5px] text-outline">+{row.ips.length - 3}</span>
              )}
            </div>
          ),
      },
    ],
    [copyText],
  );

  const scanningTarget = target ?? "target";
  const canScan = canonicalDomain(input) !== null;
  const hasResults = rows.length > 0;

  return (
    <ToolView
      eyebrow="ATTACK SURFACE"
      eyebrowTone="warning"
      eyebrowHint="CRT.SH + SYSTEM RESOLVER"
      title="Subdomain Finder"
      description="Enumerate subdomains through crt.sh certificate transparency data and DNS resolution."
      telemetry={[
        {
          label: "Hosts",
          value: target ? String(rows.length) : "—",
          tone: "primary",
          icon: <Waypoints size={14} />,
        },
        {
          label: "With A records",
          value: target ? `${counts.resolved} / ${rows.length}` : "—",
          tone: counts.resolved > 0 ? "success" : "neutral",
          icon: <Server size={14} />,
        },
        {
          label: "Unique IPs",
          value: target ? String(ipIndex.length) : "—",
          tone: "tertiary",
          icon: <Network size={14} />,
        },
        {
          label: "Scan time",
          value: scanning ? formatDuration(elapsedMs) : formatDuration(durationMs),
          tone: scanning ? "warning" : durationMs === null ? "neutral" : "primary",
          icon: <Timer size={14} />,
        },
      ]}
      headerExtra={
        <div className="space-y-1.5">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void runScan();
            }}
          >
            <div className="max-w-[340px] w-full sm:w-[280px]">
              <Input
                mono
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  if (inputError) setInputError(null);
                }}
                placeholder="example.com"
                aria-label="Target domain"
                invalid={inputError !== null}
                leading={<Globe2 size={12} />}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                disabled={scanning}
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              icon={<Waypoints size={13} />}
              loading={scanning}
              disabled={!canScan}
              trailing={<Kbd>⏎</Kbd>}
            >
              {scanning ? "Scanning…" : "Run scan"}
            </Button>
            <span
              aria-live="polite"
              className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tnum text-outline h-6 px-2 rounded-md bg-black/30 border border-white/[0.055]"
            >
              {scanning ? (
                <>
                  <Spinner size={11} className="text-warning" />
                  <span className="text-warning">{formatDuration(elapsedMs)} elapsed</span>
                </>
              ) : durationMs !== null ? (
                <>
                  <Timer size={10} />
                  last scan {formatDuration(durationMs)}
                </>
              ) : (
                "idle · no scan run"
              )}
            </span>
            {inputError && <span className="text-[10.5px] text-error">{inputError}</span>}
          </form>
          <p className="flex items-center gap-1.5 text-[10px] text-outline">
            <AlertTriangle size={10} className="text-outline shrink-0" />
            Names come from certificate transparency (crt.sh), then every host is resolved over DNS. A scan usually takes
            20–60 s and cannot be cancelled — concurrent runs are blocked.
          </p>
        </div>
      }
      toolbar={
        <>
          <div className="w-52">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter host or IP…"
              aria-label="Filter hosts by name or address"
              sizeVariant="sm"
              leading={<Search size={11} />}
            />
          </div>
          <SegmentedControl
            value={scopeFilter}
            onChange={setScopeFilter}
            ariaLabel="Filter results by scope"
            options={[
              { value: "all", label: "All", count: rows.length },
              { value: "apex", label: "Apex", count: counts.apex },
              { value: "subdomain", label: "Subdomains", count: rows.length - counts.apex },
            ]}
          />
          <span className="font-mono text-[10px] text-outline tnum">
            {plural(filtered.length, "row")} shown
          </span>
        </>
      }
      status={
        <>
          <Badge
            tone={scanning ? "warning" : error ? "error" : hasResults ? "success" : "neutral"}
            dot
            pulse={scanning}
          >
            {scanning ? "running" : error ? "failed" : hasResults ? "results ready" : "idle"}
          </Badge>
          <IconButton
            label="Re-run subdomain scan"
            icon={<RefreshCw size={13} />}
            onClick={() => void runScan()}
            disabled={scanning || !canScan}
          />
        </>
      }
    >
      {error && (
        <ErrorNotice
          title="Subdomain scan failed"
          message={error}
          onRetry={() => void runScan()}
          retryLabel="Retry scan"
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_310px] gap-3 items-start">
        <Card className="min-w-0 flex flex-col overflow-hidden">
          <CardHeader
            title="Discovered hosts"
            hint={
              target
                ? `${plural(rows.length, "host")} · sort by host, scope, source or IP count · ${plural(filteredAddresses, "address")} in view`
                : "certificate transparency names resolved over DNS"
            }
            icon={<Waypoints size={13} />}
            actions={
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<FileSpreadsheet size={11} />}
                  onClick={() => exportFindings("csv")}
                  disabled={filtered.length === 0}
                  aria-label="Export filtered results as CSV"
                >
                  CSV
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  icon={<Braces size={11} />}
                  onClick={() => exportFindings("json")}
                  disabled={filtered.length === 0}
                  aria-label="Export filtered results as JSON"
                >
                  JSON
                </Button>
              </>
            }
          />
          {scanning && (
            <div className="px-3.5 py-2 border-b border-white/[0.055] space-y-1.5 bg-warning/[0.035]">
              <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                <span className="flex items-center gap-1.5 text-warning min-w-0 truncate">
                  <Spinner size={11} />
                  Enumerating {scanningTarget} — crt.sh query, then per-host DNS
                </span>
                <span className="text-on-variant shrink-0" aria-live="polite">
                  {formatDuration(elapsedMs)}
                </span>
              </div>
              <Progress indeterminate tone="warning" label="Subdomain scan in progress" />
            </div>
          )}
          <DataTable
            ariaLabel="Subdomain findings"
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.host}
            initialSort={{ key: "host", dir: "asc" }}
            maxHeight="min(58vh, 620px)"
            empty={
              scanning ? (
                <EmptyState
                  compact
                  icon={<Spinner size={16} />}
                  title={`Scanning ${scanningTarget}…`}
                  description={`${formatDuration(elapsedMs)} elapsed. crt.sh answers first, then every discovered host is resolved. This can take 20–60 s and cannot be cancelled.`}
                />
              ) : error ? (
                <EmptyState
                  compact
                  icon={<AlertTriangle size={16} className="text-error" />}
                  title="No hosts returned"
                  description="The backend rejected the request before any name was collected. The exact message is shown above."
                  action={
                    <Button size="sm" icon={<RefreshCw size={12} />} onClick={() => void runScan()} disabled={!canScan}>
                      Retry scan
                    </Button>
                  }
                />
              ) : !hasResults ? (
                <EmptyState
                  icon={<Waypoints size={18} />}
                  title="No scan yet"
                  description="Enter an apex domain and run the scan. crt.sh returns certificate names, then each host is resolved over DNS. Expect 20–60 seconds."
                  action={
                    <Button
                      variant="primary"
                      icon={<Waypoints size={13} />}
                      onClick={() => void runScan()}
                      disabled={!canScan || scanning}
                    >
                      Run scan
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  compact
                  icon={<Search size={16} />}
                  title="Nothing matches the filter"
                  description="No host or address in the current scan matches. Clear the filter or switch the scope back to All."
                  action={
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setQuery("");
                        setScopeFilter("all");
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              )
            }
            footer={
              <tr>
                <td colSpan={columns.length} className="px-2 h-7">
                  <div className="flex items-center justify-between gap-3 font-mono text-[10px] text-outline">
                    <span className="truncate">
                      {plural(filtered.length, "row")} · {plural(counts.resolved, "host")} resolved ·{" "}
                      {plural(ipIndex.length, "unique address", "unique addresses")}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <Kbd>⏎</Kbd> run
                      <span className="text-outline/60">·</span>
                      <span>apex rows are highlighted</span>
                    </span>
                  </div>
                </td>
              </tr>
            }
          />
        </Card>

        <div className="space-y-3 min-w-0">
          <Card>
            <CardHeader
              title="Distinct IPs"
              hint={`${ipv4Count} IPv4 · ${ipv6Count} IPv6`}
              icon={<Network size={13} />}
              actions={
                <IconButton
                  label="Copy all distinct IPs"
                  icon={<Copy size={12} />}
                  size="sm"
                  disabled={ipIndex.length === 0}
                  onClick={() => copyText(ipIndex.map(([ip]) => ip).join("\n"), "IP list")}
                />
              }
            />
            {ipIndex.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-outline leading-relaxed">
                No addresses yet. Every host is resolved after crt.sh answers; hosts without an A record stay in the
                table but add nothing here.
              </p>
            ) : (
              <div className="max-h-[196px] overflow-y-auto divide-y divide-white/[0.04]">
                {ipIndex.slice(0, MAX_IP_ROWS).map(([ip, hosts]) => (
                  <div key={ip} className="group flex items-center justify-between gap-2 h-7 px-3">
                    <span className="font-mono text-[10.5px] tnum text-on-variant truncate" title={ip}>
                      {ip}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono text-[9.5px] tnum text-outline" title={`${plural(hosts, "host")} on this address`}>
                        ×{hosts}
                      </span>
                      <IconButton
                        size="sm"
                        label={`Copy IP ${ip}`}
                        icon={<Copy size={10} />}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => copyText(ip, "IP")}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-3 space-y-2.5">
            <SectionLabel
              trailing={
                <Badge tone={counts.wildcard > 0 ? "tertiary" : "neutral"} mono>
                  {counts.wildcard > 0 ? `${counts.wildcard} wildcard` : "no wildcard hits"}
                </Badge>
              }
            >
              {/* Scope split */}
              <span className="flex items-center gap-1.5">
                <Layers size={11} className="text-outline" />
                Scope
              </span>
            </SectionLabel>
            <Meter
              ariaLabel="Share of apex, wildcard and regular subdomain rows"
              height={8}
              segments={[
                { label: "Apex", value: counts.apex, tone: "warning" },
                { label: "Wildcard", value: counts.wildcard, tone: "tertiary" },
                { label: "Subdomains", value: counts.subdomains, tone: "primary" },
              ]}
            />
            <dl className="space-y-1">
              <DetailRow label="Apex">{counts.apex > 0 ? target : "not returned"}</DetailRow>
              <DetailRow label="Subdomains">{counts.subdomains}</DetailRow>
              <DetailRow label="Wildcard hits">{counts.wildcard}</DetailRow>
              <DetailRow label="Unresolved">{rows.length - counts.resolved}</DetailRow>
            </dl>
            <div className="rounded-lg bg-black/30 border border-white/[0.05] px-2 py-1.5 space-y-1">
              <div className="text-[9px] uppercase tracking-[0.08em] text-outline">Wildcard probe</div>
              <div className="font-mono text-[10px] text-on-variant truncate" title={probe?.host ?? undefined}>
                {probe ? probe.host : "not run"}
              </div>
              <div className="text-[10px] leading-snug">
                {probe?.state === "pending" ? (
                  <span className="flex items-center gap-1.5 text-outline">
                    <Spinner size={10} /> resolving random label…
                  </span>
                ) : probe?.state === "failed" ? (
                  <span className="text-outline">lookup failed — wildcard state unknown</span>
                ) : probe && probe.ips && probe.ips.length > 0 ? (
                  <span className="text-[#dda6ff]">
                    answered {plural(probe.ips.length, "address", "addresses")} — zone likely wildcarded
                  </span>
                ) : probe ? (
                  <span className="text-on-variant/75">no answer — wildcard rows are not expected</span>
                ) : (
                  <span className="text-outline">runs at the start of each scan</span>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-3 space-y-2">
            <SectionLabel trailing={<Badge tone="neutral" mono>crt.sh → DNS</Badge>}>Pipeline</SectionLabel>
            <InfoNotice tone="neutral" icon={<AlertTriangle size={11} />}>
              crt.sh names are deduplicated and capped at 400 per scan by the backend, then resolved through the
              system resolver. Wildcard certificates (<span className="font-mono">*.domain</span>) are collapsed to
              their base host, so they surface as ordinary rows — the probe above is the only wildcard signal.
            </InfoNotice>
            <dl className="space-y-1">
              <DetailRow label="Scanner">crt.sh CT + trust-dns</DetailRow>
              <DetailRow label="Scanned">{target ?? "—"}</DetailRow>
              <DetailRow label="Duration">{formatDuration(durationMs)}</DetailRow>
              <DetailRow label="Finished">{finishedAt ?? "—"}</DetailRow>
            </dl>
          </Card>
        </div>
      </div>
    </ToolView>
  );
}
