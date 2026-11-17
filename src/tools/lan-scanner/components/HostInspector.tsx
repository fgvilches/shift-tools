import { CopyButton } from "@/components/ui/CodeArea";
import { Badge, Dot } from "@/components/ui/Badge";
import { Card, SectionLabel } from "@/components/ui/Card";
import { EmptyState, InfoNotice } from "@/components/ui/Feedback";
import { ms } from "@/lib/format";
import type { LanHost } from "@/lib/types";
import type { ReactNode } from "react";
import { AlertTriangle, MousePointer2 } from "lucide-react";
import { insecureLabel, portTone } from "../lib/ports";

const PORT_TEXT: Record<ReturnType<typeof portTone>, string> = {
  neutral: "text-on-variant",
  primary: "text-primary-soft",
  success: "text-[#8ff0a4]",
  warning: "text-[#ffe066]",
  error: "text-[#ff8b81]",
  tertiary: "text-[#dda6ff]",
};

function DetailRow({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[10px] uppercase tracking-[0.07em] text-outline shrink-0">{label}</dt>
      <dd className={mono ? "font-mono text-[11px] text-on-surface tnum truncate" : "text-[11px] text-on-surface truncate"}>
        {value}
      </dd>
    </div>
  );
}

export function HostInspector({ host, scanning }: { host: LanHost | null; scanning: boolean }) {
  const flagged = host ? insecureLabel(host) : null;

  return (
    <Card className="p-3 space-y-2.5">
      <SectionLabel
        trailing={
          host ? (
            <Badge tone={flagged ? "error" : "success"} dot mono>
              {flagged ? "FLAGGED" : "ALIVE"}
            </Badge>
          ) : undefined
        }
      >
        Selected node
      </SectionLabel>

      {!host ? (
        <EmptyState
          compact
          icon={<MousePointer2 size={16} />}
          title={scanning ? "Awaiting responders" : "No host selected"}
          description={
            scanning
              ? "Rows appear as probes answer. The first responder auto-selects when the sweep ends."
              : "Select a row to inspect its address, hardware identity and exposed services."
          }
        />
      ) : (
        <>
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-[15px] font-semibold text-primary-soft tnum truncate">{host.ip}</span>
              <CopyButton text={host.ip} label="Copy IP" />
            </div>
            <div className="font-mono text-[10.5px] text-outline truncate" title={host.hostname ?? "No reverse DNS record"}>
              {host.hostname ?? "no reverse DNS"}
            </div>
          </div>

          <dl className="rounded-lg border border-white/[0.055] bg-black/30 px-2 py-1.5 space-y-1">
            <DetailRow label="MAC" value={host.mac ?? "not in ARP table"} />
            <DetailRow label="Vendor" value={host.vendor ?? "unresolved OUI"} />
            <DetailRow label="Latency" value={ms(host.latencyMs, 2)} />
            <DetailRow label="Open ports" value={host.openPorts.length} />
            <DetailRow
              label="Hostname"
              value={
                <span className="flex items-center gap-1 min-w-0">
                  <span className="truncate">{host.hostname ?? "—"}</span>
                  {host.hostname && <CopyButton text={host.hostname} label="Copy hostname" />}
                </span>
              }
            />
          </dl>

          {flagged && (
            <InfoNotice tone="warning" icon={<AlertTriangle size={12} />}>
              Cleartext or legacy remote-control service exposed — <span className="font-mono">{flagged}</span>. Treat this
              host as untrusted on the local segment.
            </InfoNotice>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">Responding services</span>
              <span className="font-mono text-[9.5px] text-outline tnum">{host.openPorts.length} open</span>
            </div>
            {host.openPorts.length === 0 ? (
              <p className="rounded-lg border border-white/[0.05] bg-black/25 px-2 py-1.5 text-[10.5px] text-outline leading-relaxed">
                No probed port answered. The host is likely visible through reverse DNS or ARP only.
              </p>
            ) : (
              <ul className="max-h-36 overflow-y-auto rounded-lg border border-white/[0.055] bg-black/25 divide-y divide-white/[0.04]">
                {host.openPorts.map((entry) => (
                  <li key={entry.port} className="flex items-center justify-between gap-2 px-2 py-1">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <Dot tone={portTone(entry.port)} />
                      <span className={`font-mono text-[11px] tnum ${PORT_TEXT[portTone(entry.port)]}`}>{entry.port}</span>
                      <span className="text-[10.5px] text-on-variant truncate">{entry.service}</span>
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-outline shrink-0">
                      {entry.port === 443 ? "tls" : "tcp"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
