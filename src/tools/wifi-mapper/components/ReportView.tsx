import { Download, FileText, Radar, Save, Sparkles, Trophy, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/Feedback";
import { rssiQuality } from "@/lib/format";
import type { MapPoint, WifiMapDoc } from "@/lib/types";
import {
  CHANNEL_HEURISTIC,
  rssiColor,
  type ChannelAnalysis,
  type ChannelCandidate,
  type NetworkStat,
  type PointSummary,
} from "../lib/analysis";

export interface CoverageRow {
  point: MapPoint;
  summary: PointSummary;
}

export interface ReportViewProps {
  doc: WifiMapDoc;
  coverage: CoverageRow[];
  networks: NetworkStat[];
  channels: ChannelAnalysis;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onSelectPoint: (id: string) => void;
}

const TONE_TEXT = {
  neutral: "text-on-surface",
  primary: "text-primary-soft",
  success: "text-secondary",
  warning: "text-warning",
  error: "text-error",
  tertiary: "text-tertiary",
} as const;

function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: ReactNode; detail?: string; tone?: keyof typeof TONE_TEXT }) {
  return (
    <div className="rounded-lg border border-white/[0.055] bg-black/30 px-2.5 py-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">{label}</div>
      <div className={`mt-0.5 font-mono text-[16px] font-semibold tnum ${TONE_TEXT[tone]}`}>{value}</div>
      {detail && <div className="truncate text-[10px] text-outline">{detail}</div>}
    </div>
  );
}

function Panel({ title, hint, actions, children }: { title: string; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/[0.18]">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.055] px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[11.5px] font-semibold text-on-surface">{title}</div>
          {hint && <div className="truncate text-[10px] text-outline">{hint}</div>}
        </div>
        {actions}
      </div>
      <div className="p-2">{children}</div>
    </section>
  );
}

function candidateTone(candidate: ChannelCandidate): "primary" | "success" | "neutral" | "error" {
  if (candidate.verdict === "recommended") return "primary";
  if (candidate.verdict === "clear") return "success";
  if (candidate.verdict === "congested") return "error";
  return "neutral";
}

export function ReportView({
  doc,
  coverage,
  networks,
  channels,
  saving,
  dirty,
  onSave,
  onExportJson,
  onExportCsv,
  onSelectPoint,
}: ReportViewProps) {
  const scanned = coverage.filter((row) => row.summary.strongest !== null);
  const beacons = coverage.reduce((sum, row) => sum + row.summary.beacons, 0);
  const averageValues = scanned
    .map((row) => row.summary.averageRssi)
    .filter((value): value is number => value !== null);
  const siteAverage =
    averageValues.length > 0 ? averageValues.reduce((sum, value) => sum + value, 0) / averageValues.length : null;
  const coveragePercent = coverage.length > 0 ? (scanned.length / coverage.length) * 100 : 0;
  const best = networks[0] ?? null;
  const hasSamples = scanned.length > 0;

  const coverageColumns: Column<CoverageRow>[] = [
    {
      key: "point",
      header: "Point",
      width: 116,
      sortable: true,
      sortValue: (row) => row.point.label,
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: rssiColor(row.summary.strongest?.rssi ?? null) }}
          />
          <span className="truncate font-mono text-[11px] text-on-surface">{row.point.label}</span>
        </div>
      ),
    },
    {
      key: "position",
      header: "Position",
      width: 104,
      mono: true,
      hideBelow: "lg",
      render: (row) => (
        <span className="text-outline">
          {row.point.x.toFixed(1)}, {row.point.y.toFixed(1)}
        </span>
      ),
    },
    {
      key: "beacons",
      header: "Beacons",
      width: 66,
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (row) => row.summary.beacons,
      render: (row) => <span className="text-on-variant">{row.summary.beacons}</span>,
    },
    {
      key: "strongest",
      header: "Strongest network",
      render: (row) =>
        row.summary.strongestName ? (
          <span className="block max-w-[170px] truncate text-[11px] text-on-variant" title={row.summary.strongestName}>
            {row.summary.strongestName}
          </span>
        ) : (
          <span className="text-[11px] text-outline">No sample</span>
        ),
    },
    {
      key: "rssi",
      header: "RSSI",
      width: 68,
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (row) => row.summary.strongest?.rssi ?? null,
      render: (row) => {
        const value = row.summary.strongest?.rssi ?? null;
        return (
          <span style={{ color: rssiColor(value) }}>{value === null ? "—" : `${value}`}</span>
        );
      },
    },
    {
      key: "average",
      header: "Avg",
      width: 62,
      align: "right",
      mono: true,
      hideBelow: "lg",
      render: (row) => (
        <span className="text-on-variant">
          {row.summary.averageRssi === null ? "—" : row.summary.averageRssi.toFixed(0)}
        </span>
      ),
    },
    {
      key: "channels",
      header: "Ch",
      width: 74,
      mono: true,
      hideBelow: "md",
      render: (row) => (
        <span className="text-primary-soft">{row.summary.channels.length > 0 ? row.summary.channels.join("/") : "—"}</span>
      ),
    },
    {
      key: "quality",
      header: "Quality",
      width: 82,
      render: (row) => (
        <Badge tone={row.summary.quality.tone}>{row.summary.quality.label}</Badge>
      ),
    },
  ];

  const networkColumns: Column<NetworkStat>[] = [
    {
      key: "network",
      header: "Network",
      render: (row) => (
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-1.5">
            <Wifi size={10} className="shrink-0 text-outline" />
            <span className="truncate text-[11.5px] text-on-surface">{row.ssid}</span>
          </div>
          <div className="font-mono text-[9.5px] text-outline">{row.bssid ?? "no BSSID"}</div>
        </div>
      ),
    },
    {
      key: "radio",
      header: "Radio",
      width: 96,
      mono: true,
      render: (row) => (
        <span className="text-primary-soft">
          {row.channel === null ? "—" : `Ch ${row.channel}`}
          <span className="ml-1 text-outline">{row.band}</span>
        </span>
      ),
    },
    {
      key: "points",
      header: "Points",
      width: 58,
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (row) => row.points,
      render: (row) => <span className="text-on-variant">{row.points}</span>,
    },
    {
      key: "best",
      header: "Best",
      width: 62,
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (row) => row.bestRssi,
      render: (row) => <span style={{ color: rssiColor(row.bestRssi) }}>{row.bestRssi}</span>,
    },
    {
      key: "worst",
      header: "Worst",
      width: 62,
      align: "right",
      mono: true,
      hideBelow: "md",
      render: (row) => <span style={{ color: rssiColor(row.worstRssi) }}>{row.worstRssi}</span>,
    },
    {
      key: "average",
      header: "Average",
      width: 74,
      align: "right",
      mono: true,
      render: (row) => <span className="text-on-variant">{row.averageRssi.toFixed(1)}</span>,
    },
  ];

  const channelColumns: Column<ChannelCandidate>[] = [
    {
      key: "channel",
      header: "Channel",
      width: 92,
      mono: true,
      render: (row) => (
        <span className="text-on-surface">
          Ch {row.channel}
          <span className="ml-1 text-[9.5px] text-outline">{row.band}</span>
        </span>
      ),
    },
    {
      key: "bssids",
      header: "BSSIDs",
      width: 58,
      align: "right",
      mono: true,
      render: (row) => <span className="text-on-variant">{row.bssids}</span>,
    },
    {
      key: "networks",
      header: "Networks",
      render: (row) => (
        <span className="block max-w-[210px] truncate text-[11px] text-on-variant" title={row.networks.join(", ")}>
          {row.networks.length > 0 ? row.networks.join(", ") : "clear"}
        </span>
      ),
    },
    {
      key: "avg",
      header: "Avg",
      width: 56,
      align: "right",
      mono: true,
      hideBelow: "lg",
      render: (row) => (
        <span style={{ color: rssiColor(row.averageRssi) }}>
          {row.averageRssi === null ? "—" : row.averageRssi.toFixed(0)}
        </span>
      ),
    },
    {
      key: "score",
      header: "Load",
      width: 54,
      align: "right",
      mono: true,
      sortable: true,
      sortValue: (row) => row.score,
      render: (row) => <span className="text-outline">{row.score.toFixed(2)}</span>,
    },
    {
      key: "verdict",
      header: "Verdict",
      width: 96,
      render: (row) => <Badge tone={candidateTone(row)}>{row.verdict}</Badge>,
    },
  ];

  return (
    <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CardHeader
        title="Coverage report"
        hint={`${doc.name} · ${coverage.length} points · ${beacons} beacons in latest samples`}
        icon={<FileText size={13} />}
        actions={
          <>
            <Button size="xs" icon={<Download size={12} />} onClick={onExportJson}>
              JSON
            </Button>
            <Button size="xs" icon={<Download size={12} />} onClick={onExportCsv} disabled={coverage.length === 0}>
              CSV
            </Button>
            <Button
              size="xs"
              variant="primary"
              icon={<Save size={12} />}
              loading={saving}
              disabled={!dirty}
              onClick={onSave}
            >
              Save map
            </Button>
          </>
        }
      />

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric label="Points sampled" value={`${scanned.length}/${coverage.length}`} detail={`${Math.round(coveragePercent)}% of the plan`} tone={coveragePercent === 100 ? "success" : "warning"} />
          <Metric label="Site average" value={siteAverage === null ? "—" : `${siteAverage.toFixed(0)} dBm`} detail="mean of point averages" tone={siteAverage === null ? "neutral" : rssiQuality(siteAverage).tone} />
          <Metric label="Strongest network" value={best ? `${best.bestRssi}` : "—"} detail={best?.ssid ?? "no beacons captured"} tone="success" />
          <Metric label="Channels seen" value={String(channels.observedChannels)} detail={`${channels.observedBssids} BSSIDs`} tone="primary" />
        </div>

        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Panel title="Per-point coverage" hint="Click a row to inspect the point on the plan" actions={<Badge tone="neutral" mono>{coverage.length} rows</Badge>}>
            <DataTable
              ariaLabel="Coverage per measurement point"
              columns={coverageColumns}
              rows={coverage}
              rowKey={(row) => row.point.id}
              onRowClick={(row) => onSelectPoint(row.point.id)}
              activeKey={null}
              maxHeight="330px"
              empty={
                <EmptyState
                  compact
                  icon={<Radar size={16} />}
                  title="No measurement points"
                  description="Drop points on the floor plan and capture a scan at each one."
                />
              }
            />
          </Panel>

          <div className="space-y-3">
            <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/[0.18]">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.055] px-3 py-2">
                <SectionLabel>Channel recommendation</SectionLabel>
                <Sparkles size={12} className="text-primary-soft" />
              </div>
              <div className="space-y-2 p-3">
                {channels.recommended ? (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[24px] font-semibold leading-none text-primary-soft tnum">
                        Ch {channels.recommended.channel}
                      </span>
                      <Badge tone="primary" mono>
                        {channels.recommended.band}
                      </Badge>
                      <span className="ml-auto font-mono text-[10px] text-outline">
                        load {channels.recommended.score.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-on-variant">{channels.reason}</p>
                    <p className="text-[10px] leading-relaxed text-outline">{CHANNEL_HEURISTIC}</p>
                  </>
                ) : (
                  <div className="space-y-1">
                    <p className="text-[11.5px] text-on-surface">No channel data yet</p>
                    <p className="text-[10.5px] leading-relaxed text-outline">
                      Capture at least one sample. Channels are ranked from the beacons visible at each point.
                    </p>
                  </div>
                )}
              </div>
            </section>

            <Panel title="Channel overlap" hint="Observed occupancy, weakest neighbours first" actions={<Badge tone={hasSamples ? "warning" : "neutral"} mono>{channels.observedChannels} ch</Badge>}>
              <DataTable
                ariaLabel="Channel overlap analysis"
                columns={channelColumns}
                rows={channels.rows}
                rowKey={(row) => `${row.band}-${row.channel}-${row.verdict}`}
                maxHeight="250px"
                empty={
                  <EmptyState
                    compact
                    icon={<Wifi size={16} />}
                    title="No channels observed"
                    description="Beacon channel data appears after the first capture."
                  />
                }
              />
            </Panel>
          </div>
        </div>

        <Panel
          title="Per-network signal range"
          hint="Best, worst and mean RSSI across the latest sample of every point"
          actions={
            <Badge tone="neutral" mono>
              {networks.length} BSSIDs
            </Badge>
          }
        >
          <DataTable
            ariaLabel="Per-network best and worst RSSI"
            columns={networkColumns}
            rows={networks}
            rowKey={(row) => row.key}
            initialSort={{ key: "best", dir: "desc" }}
            maxHeight="280px"
            empty={
              <EmptyState
                compact
                icon={<Trophy size={16} />}
                title="No networks recorded"
                description="Scan a measurement point to populate the network table."
              />
            }
          />
        </Panel>
      </div>
    </Card>
  );
}
