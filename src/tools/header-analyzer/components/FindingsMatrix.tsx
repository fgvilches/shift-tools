import { Fragment, useMemo, useState } from "react";
import { ChevronDown, Maximize2, Minimize2, ShieldCheck, Wrench } from "lucide-react";
import { clsx } from "clsx";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CodeArea";
import { EmptyState } from "@/components/ui/Feedback";
import type { HeaderAnalysis, HeaderFinding } from "@/lib/types";
import {
  buildReport,
  findingKey,
  groupFindings,
  statusMeta,
  summarize,
  type FindingGroup,
} from "../lib/analysis";

function GroupSummary({ group }: { group: FindingGroup }) {
  const { summary } = group;
  return (
    <div className="flex items-center gap-2.5 font-mono text-[9.5px] text-outline">
      {summary.pass > 0 && (
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary" aria-hidden />
          {summary.pass} pass
        </span>
      )}
      {summary.warn > 0 && (
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-warning" aria-hidden />
          {summary.warn} warn
        </span>
      )}
      {summary.fail > 0 && (
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-error" aria-hidden />
          {summary.fail} missing
        </span>
      )}
      {summary.info > 0 && (
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden />
          {summary.info} info
        </span>
      )}
      <span className="text-outline/70">weight {summary.weightTotal}</span>
    </div>
  );
}

function FindingRow({
  finding,
  open,
  onToggle,
}: {
  finding: HeaderFinding;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = statusMeta(finding.status);
  const Icon = meta.Icon;

  return (
    <Fragment>
      <tr
        onClick={onToggle}
        className={clsx(
          "h-7 cursor-pointer transition-colors duration-150",
          open ? "bg-white/[0.035]" : "hover:bg-white/[0.03]",
        )}
      >
        <td className="px-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon size={13} className={clsx(meta.text, "shrink-0")} aria-hidden />
            <span className="text-[12px] font-medium text-on-surface truncate">{finding.name}</span>
          </div>
        </td>
        <td className="px-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </td>
        <td className="px-2">
          {finding.value ? (
            <span className="block truncate font-mono text-[11px] text-on-variant" title={finding.value}>
              {finding.value}
            </span>
          ) : (
            <span className="font-mono text-[11px] italic text-outline/70">missing</span>
          )}
        </td>
        <td className="px-2 text-right">
          <span className="font-mono text-[10.5px] text-outline tnum" title="Relative weight in the hardening score">
            {finding.weight}
          </span>
        </td>
        <td className="px-2 text-right">
          <IconButton
            size="sm"
            label={`${open ? "Hide" : "Show"} recommendation for ${finding.name}`}
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            icon={
              <ChevronDown
                size={13}
                className={clsx("transition-transform duration-150", open && "rotate-180")}
              />
            }
          />
        </td>
      </tr>
      {open && (
        <tr className="bg-black/25">
          <td colSpan={5} className="px-3 pb-2.5">
            <div className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-black/30 px-2.5 py-2">
              <Wrench size={12} className="mt-0.5 shrink-0 text-primary-soft" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">Recommendation</div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-on-variant">{finding.recommendation}</p>
              </div>
              <CopyButton text={finding.recommendation} label="Copy fix" />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function FindingsMatrix({ analysis }: { analysis: HeaderAnalysis }) {
  const groups = useMemo(() => groupFindings(analysis.findings), [analysis.findings]);
  const summary = useMemo(() => summarize(analysis.findings), [analysis.findings]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const allOpen = analysis.findings.length > 0 && expanded.size === analysis.findings.length;

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Header compliance matrix"
        hint={`${summary.pass}/${summary.total} hardened · ${summary.weightAtRisk} weight at risk`}
        icon={<ShieldCheck size={13} />}
        actions={
          <>
            <Badge tone={summary.fail > 0 ? "error" : summary.warn > 0 ? "warning" : "success"} mono>
              {summary.fail > 0 ? `${summary.fail} missing` : summary.warn > 0 ? `${summary.warn} partial` : "all hardened"}
            </Badge>
            <Button
              size="xs"
              variant="ghost"
              icon={allOpen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
              onClick={() =>
                setExpanded(allOpen ? new Set() : new Set(analysis.findings.map((finding) => findingKey(finding))))
              }
              aria-label={allOpen ? "Collapse all recommendations" : "Expand all recommendations"}
            >
              {allOpen ? "Collapse" : "Expand"} all
            </Button>
            <CopyButton text={buildReport(analysis)} label="Copy report" />
          </>
        }
      />
      {analysis.findings.length === 0 ? (
        <div className="p-4">
          <EmptyState
            compact
            icon={<ShieldCheck size={16} />}
            title="No findings returned"
            description="The response carried no gradeable security headers."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-[12px]" aria-label="Security header compliance findings">
            <colgroup>
              <col className="w-[252px]" />
              <col className="w-[104px]" />
              <col />
              <col className="w-[52px]" />
              <col className="w-[34px]" />
            </colgroup>
            <thead>
              <tr className="dt-head">
                <th scope="col" className="h-7 px-3 text-left text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">
                  Check
                </th>
                <th scope="col" className="h-7 px-2 text-left text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">
                  Assessment
                </th>
                <th scope="col" className="h-7 px-2 text-left text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">
                  Resolved value
                </th>
                <th scope="col" className="h-7 px-2 text-right text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">
                  Wt
                </th>
                <th scope="col" className="h-7 px-2">
                  <span className="sr-only">Recommendation</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.name}>
                  <tr className="border-y border-white/[0.05] bg-white/[0.022]">
                    <th scope="colgroup" colSpan={5} className="h-7 px-3 text-left font-normal">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-on-variant">
                            {group.name}
                          </span>
                          <span className="font-mono text-[9px] text-outline/70 truncate">
                            {group.findings.length} {group.findings.length === 1 ? "check" : "checks"}
                          </span>
                        </div>
                        <GroupSummary group={group} />
                      </div>
                    </th>
                  </tr>
                  {group.findings.map((finding) => {
                    const key = findingKey(finding);
                    return (
                      <FindingRow
                        key={key}
                        finding={finding}
                        open={expanded.has(key)}
                        onToggle={() => toggle(key)}
                      />
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
