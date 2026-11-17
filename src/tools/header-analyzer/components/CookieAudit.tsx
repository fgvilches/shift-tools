import { clsx } from "clsx";
import { Check, Cookie, ShieldAlert, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState, Progress } from "@/components/ui/Feedback";
import type { CookieFinding } from "@/lib/types";
import { cookieIssues } from "../lib/analysis";

function Flag({ ok, yes = "Yes", no = "No" }: { ok: boolean; yes?: string; no?: string }) {
  return (
    <Badge tone={ok ? "success" : "error"} className="gap-1 font-mono">
      {ok ? <Check size={10} aria-hidden /> : <X size={10} aria-hidden />}
      {ok ? yes : no}
    </Badge>
  );
}

function sameSiteLabel(sameSite: string | null): string {
  if (!sameSite) return "Missing";
  return sameSite.charAt(0).toUpperCase() + sameSite.slice(1);
}

function FlagMeter({ label, count, total }: { label: string; count: number; total: number }) {
  const ok = count === total;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">{label}</span>
        <span className={clsx("font-mono text-[9.5px] tnum", ok ? "text-secondary" : "text-warning")}>
          {count}/{total}
        </span>
      </div>
      <Progress
        value={total > 0 ? (count / total) * 100 : 0}
        tone={ok ? "success" : "warning"}
        height={3}
        label={`${label} coverage across Set-Cookie headers`}
      />
    </div>
  );
}

export function CookieAudit({ cookies }: { cookies: CookieFinding[] }) {
  const withIssues = cookieIssues(cookies);
  const secure = cookies.filter((cookie) => cookie.secure).length;
  const httpOnly = cookies.filter((cookie) => cookie.httpOnly).length;
  const sameSite = cookies.filter((cookie) => cookie.sameSite !== null).length;

  const columns: Column<CookieFinding>[] = [
    {
      key: "name",
      header: "Identifier",
      width: 180,
      render: (cookie) => (
        <div className="font-mono text-[11.5px] font-medium text-on-surface truncate" title={cookie.name}>
          {cookie.name || "(unnamed)"}
        </div>
      ),
    },
    {
      key: "secure",
      header: "Secure",
      width: 68,
      render: (cookie) => <Flag ok={cookie.secure} />,
    },
    {
      key: "httpOnly",
      header: "HttpOnly",
      width: 80,
      render: (cookie) => <Flag ok={cookie.httpOnly} />,
    },
    {
      key: "sameSite",
      header: "SameSite",
      width: 86,
      render: (cookie) => {
        const value = cookie.sameSite;
        const tone = !value ? "error" : value === "none" ? "warning" : "success";
        return <Badge tone={tone}>{sameSiteLabel(value)}</Badge>;
      },
    },
    {
      key: "issues",
      header: "Issues",
      render: (cookie) =>
        cookie.issues.length === 0 ? (
          <span className="text-[10.5px] text-outline/60">—</span>
        ) : (
          <span
            className="block truncate text-[10.5px] text-error/90"
            title={cookie.issues.join(" · ")}
          >
            {cookie.issues.join(" · ")}
          </span>
        ),
    },
  ];

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader
        title="Cookie flag audit"
        hint={`${cookies.length} Set-Cookie ${cookies.length === 1 ? "header" : "headers"} on this response`}
        icon={<Cookie size={13} />}
        actions={
          cookies.length > 0 ? (
            <Badge tone={withIssues > 0 ? "error" : "success"} mono>
              {withIssues > 0 ? `${withIssues} weak` : "clean"}
            </Badge>
          ) : undefined
        }
      />
      <DataTable
        ariaLabel="Set-Cookie flags"
        columns={columns}
        rows={cookies}
        rowKey={(cookie, index) => `${cookie.name}-${index}`}
        dense
        empty={
          <EmptyState
            compact
            icon={<Cookie size={16} />}
            title="No cookies set"
            description="This response did not send any Set-Cookie headers, so there is nothing to flag."
          />
        }
      />
      {cookies.length > 0 && (
        <div className="mt-auto border-t border-white/[0.055] px-3 py-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[10.5px] text-outline min-w-0">
              <ShieldAlert size={11} className={withIssues > 0 ? "text-error" : "text-secondary"} aria-hidden />
              <span className="truncate">
                {withIssues > 0
                  ? `${withIssues} of ${cookies.length} cookies ${withIssues === 1 ? "needs" : "need"} stricter flags`
                  : "Every cookie is Secure, HttpOnly and SameSite-scoped"}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[9.5px] text-outline">{cookies.length} total</span>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <FlagMeter label="Secure" count={secure} total={cookies.length} />
            <FlagMeter label="HttpOnly" count={httpOnly} total={cookies.length} />
            <FlagMeter label="SameSite" count={sameSite} total={cookies.length} />
          </div>
        </div>
      )}
    </Card>
  );
}
