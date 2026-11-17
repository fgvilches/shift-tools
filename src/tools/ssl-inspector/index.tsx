import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import {
  AlertTriangle,
  BadgeCheck,
  Clock3,
  Fingerprint,
  Info,
  KeyRound,
  ListTree,
  Lock,
  Network,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Timer,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot, type Tone } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CodeArea";
import { ErrorNotice, InfoNotice, Progress } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Form";
import { toast } from "@/components/ui/Toast";
import { security } from "@/lib/api";
import { clamp, plural, truncateMiddle } from "@/lib/format";
import { errorMessage, isTauri } from "@/lib/ipc";
import type { CertNode, TlsInfo } from "@/lib/types";

const PORT = 443;
const DAY_MS = 86_400_000;
const MAX_HISTORY = 5;
const INPUT_ID = "ssl-target-input";
const QUICK_TARGETS = ["github.com", "cloudflare.com", "apple.com"];

type ValidityTone = "success" | "warning" | "error";

interface AuditEntry {
  id: number;
  domain: string;
  grade: string;
  daysRemaining: number;
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-on-surface",
  primary: "text-primary-soft",
  success: "text-secondary",
  warning: "text-warning",
  error: "text-error",
  tertiary: "text-tertiary",
};

const VALIDITY_FILL: Record<ValidityTone, string> = {
  success: "bg-gradient-to-r from-secondary/50 to-secondary",
  warning: "bg-gradient-to-r from-warning/50 to-warning",
  error: "bg-gradient-to-r from-error/50 to-error",
};

const TLS_RFC: Record<string, string> = {
  "TLS 1.3": "RFC 8446",
  "TLS 1.2": "RFC 5246",
  "TLS 1.1": "RFC 4346",
  "TLS 1.0": "RFC 2246",
  "SSL 3.0": "RFC 6101",
};

const SIGNATURE_OIDS: Record<string, string> = {
  "1.2.840.113549.1.1.4": "md5WithRSAEncryption",
  "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
  "1.2.840.113549.1.1.10": "RSASSA-PSS",
  "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
  "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
  "1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
  "1.2.840.10045.4.3.1": "ecdsa-with-SHA224",
  "1.2.840.10045.4.3.2": "ecdsa-with-SHA256",
  "1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
  "1.2.840.10045.4.3.4": "ecdsa-with-SHA512",
  "1.3.101.112": "Ed25519",
  "1.3.101.113": "Ed448",
};

const CHECKS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Lock size={14} />,
    title: "Live handshake",
    body: "A real TCP connection and TLS negotiation; the certificate is read off the wire, not from a cache.",
  },
  {
    icon: <Timer size={14} />,
    title: "Validity window",
    body: "Not-before and not-after compared with this host's clock. Under 30 days remaining is flagged.",
  },
  {
    icon: <Network size={14} />,
    title: "Identities",
    body: "Subject, issuer, serial number and every DNS subject alternative name published in the leaf.",
  },
  {
    icon: <ListTree size={14} />,
    title: "Presented chain",
    body: "Each certificate the server included, leaf first, with self-signed nodes marked.",
  },
];

/* ------------------------------- helpers -------------------------------- */

function normalizeHost(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  value = value.split(/[/?#]/)[0] ?? "";
  value = value.replace(/:\d+$/, "").trim();
  if (!value || /\s/.test(value)) return null;
  return value;
}

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function certDate(iso: string): string {
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? iso || "—" : DATE_FMT.format(ts);
}

function tlsLabel(version: string): string {
  if (/SSLV?3/i.test(version)) return "SSL 3.0";
  const normalized = version.replace(/_/g, ".").replace(/^TLSv/i, "TLS ");
  if (normalized.includes("1.3")) return "TLS 1.3";
  if (normalized.includes("1.2")) return "TLS 1.2";
  if (normalized.includes("1.1")) return "TLS 1.1";
  if (normalized.includes("1.0")) return "TLS 1.0";
  return version;
}

function tlsTone(version: string): Tone {
  const label = tlsLabel(version);
  if (label === "TLS 1.3") return "success";
  if (label === "TLS 1.2") return "primary";
  return "warning";
}

function gradeTone(grade: string): Tone {
  const first = grade.trim().charAt(0).toUpperCase();
  if (first === "A") return "success";
  if (first === "B") return "primary";
  if (first === "C") return "warning";
  return "error";
}

function signatureLabel(raw: string | null): string {
  if (!raw) return "not reported";
  return SIGNATURE_OIDS[raw] ?? raw;
}

function cipherTraits(cipher: string): string {
  const traits: string[] = [];
  if (/GCM/i.test(cipher)) traits.push("AES-GCM");
  if (/CHACHA20/i.test(cipher)) traits.push("ChaCha20-Poly1305");
  if (/CCM/i.test(cipher)) traits.push("AES-CCM");
  if (/CBC/i.test(cipher)) traits.push("CBC mode");
  if (/RC4/i.test(cipher)) traits.push("RC4");
  if (traits.length === 0) return "negotiated suite";
  return traits.join(" · ");
}

function alertIsError(alert: string): boolean {
  return /expired|mismatch|invalid|weak|deprecated|failed|untrusted/i.test(alert);
}

function validityStatus(days: number): { label: string; tone: ValidityTone; detail: string } {
  if (days < 0) {
    return {
      label: "Expired",
      tone: "error",
      detail: `${plural(Math.abs(days), "day")} ago`,
    };
  }
  if (days === 0) return { label: "Expires today", tone: "warning", detail: "0 days remaining" };
  if (days <= 30) return { label: "Expiring soon", tone: "warning", detail: `${plural(days, "day")} remaining` };
  return { label: "Valid", tone: "success", detail: `${plural(days, "day")} remaining` };
}

function validityMetrics(info: TlsInfo): {
  spanPercent: number;
  remainingPercent: number;
  lifetimeDays: number;
  elapsedPercent: number;
} {
  const from = Date.parse(info.validFrom);
  const to = Date.parse(info.validTo);
  const usable = Number.isFinite(from) && Number.isFinite(to) && to > from;
  const span = usable ? to - from : DAY_MS * 365;
  const elapsed = usable ? clamp(Date.now() - from, 0, span) : span;
  const lifetimeDays = Math.max(1, Math.floor(span / DAY_MS));
  const spanPercent = clamp((elapsed / span) * 100, 0, 100);
  const remainingPercent = clamp((info.daysRemaining / lifetimeDays) * 100, 0, 100);
  return { spanPercent, remainingPercent, lifetimeDays, elapsedPercent: Math.round(spanPercent) };
}

function buildReport(info: TlsInfo): string {
  const lines = [
    `SSL Inspector — ${info.domain}:${PORT}`,
    `Grade: ${info.grade}`,
    `Protocol: ${tlsLabel(info.tlsVersion)} (${TLS_RFC[tlsLabel(info.tlsVersion)] ?? "unknown RFC"})`,
    `Cipher suite: ${info.cipherSuite}`,
    `Subject: ${info.subject}`,
    `Issuer: ${info.issuer}`,
    `Valid from: ${certDate(info.validFrom)}`,
    `Valid to: ${certDate(info.validTo)} (${info.daysRemaining} days remaining)`,
    `Serial: ${info.serial || "—"}`,
    `SHA-256: ${info.fingerprintSha256}`,
    `Signature: ${signatureLabel(info.signatureAlgorithm)}`,
    `Key bits: ${info.keyBits === null ? "not reported" : info.keyBits}`,
    `SANs (${info.sans.length}): ${info.sans.join(", ") || "none"}`,
    `Alerts: ${info.alerts.length > 0 ? info.alerts.join("; ") : "none"}`,
    "Chain:",
    ...info.chain.map(
      (node, index) =>
        `  ${index}. ${node.subject} — issued by ${node.issuer}${node.selfSigned ? " (self-signed)" : ""}`,
    ),
    "",
    "Note: presented certificate only; the chain of trust is not verified.",
  ];
  return lines.join("\n");
}

/* ------------------------------ primitives ------------------------------ */

function SummaryCard({
  label,
  icon,
  value,
  hint,
  hintTitle,
  tone,
  mono = false,
  wrap = false,
  footer,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  hint: string;
  hintTitle?: string;
  tone: Tone;
  mono?: boolean;
  wrap?: boolean;
  footer?: ReactNode;
}) {
  return (
    <Card className="p-3 flex flex-col justify-between gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>{label}</SectionLabel>
        <span className={clsx("shrink-0", TONE_TEXT[tone])}>{icon}</span>
      </div>
      <div className="min-w-0">
        <div
          className={clsx(
            "text-[15px] font-semibold tracking-tight leading-tight",
            mono && "font-mono text-[12px]",
            wrap ? "break-all" : "truncate",
            TONE_TEXT[tone],
          )}
          title={value}
        >
          {value}
        </div>
        <div className="font-mono text-[10px] text-outline mt-1 truncate" title={hintTitle ?? hint}>
          {hint}
        </div>
      </div>
      {footer}
    </Card>
  );
}

function ParameterTile({
  label,
  value,
  hint,
  className,
  valueClassName,
  title,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
  valueClassName?: string;
  title?: string;
}) {
  return (
    <div className={clsx("rounded-lg border border-white/[0.055] bg-black/30 px-2 py-1.5 min-w-0", className)}>
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">{label}</div>
      <div
        className={clsx("font-mono text-[12px] leading-snug text-on-surface break-all mt-0.5", valueClassName)}
        title={title ?? value}
      >
        {value}
      </div>
      {hint && <div className="font-mono text-[9px] text-outline/85 mt-0.5 break-all">{hint}</div>}
    </div>
  );
}

function DetailRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline shrink-0">{label}</span>
      <span className="font-mono text-[10.5px] text-on-variant text-right break-all min-w-0" title={title ?? value}>
        {value}
      </span>
    </div>
  );
}

function MiniMetric({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className="rounded-lg border border-white/[0.055] bg-black/30 px-2 py-1.5 min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline truncate">{label}</div>
      <div className={clsx("font-mono text-[12px] mt-0.5 tnum", TONE_TEXT[tone])}>{value}</div>
    </div>
  );
}

function chainLevel(node: CertNode, index: number): { label: string; tone: Tone } {
  if (index === 0) return { label: "Leaf", tone: "primary" };
  if (node.selfSigned) return { label: "Root", tone: "tertiary" };
  return { label: "Intermediate", tone: "neutral" };
}

/* -------------------------------- report -------------------------------- */

function CertificateReport({ info }: { info: TlsInfo }) {
  const status = validityStatus(info.daysRemaining);
  const metrics = validityMetrics(info);
  const protocol = tlsLabel(info.tlsVersion);
  const signatureName = signatureLabel(info.signatureAlgorithm);
  const signatureHint =
    info.signatureAlgorithm && info.signatureAlgorithm !== signatureName
      ? info.signatureAlgorithm
      : "from the leaf certificate";
  const wildcards = info.sans.filter((sans) => sans.startsWith("*.")).length;
  const selfSigned = info.chain.filter((node) => node.selfSigned).length;

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {`${info.domain}: grade ${info.grade}, ${info.daysRemaining} days remaining, ${plural(
          info.sans.length,
          "subject alternative name",
        )}, ${plural(info.chain.length, "chain certificate")}.`}
      </span>

      {info.alerts.length > 0 && (
        <div className="space-y-1.5">
          {info.alerts.map((alert) =>
            alertIsError(alert) ? (
              <ErrorNotice key={alert} title="Certificate alert" message={alert} />
            ) : (
              <InfoNotice key={alert} tone="warning" icon={<AlertTriangle size={12} />}>
                {alert}
              </InfoNotice>
            ),
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <SummaryCard
          label="Certificate status"
          icon={
            status.tone === "error" ? (
              <ShieldX size={14} />
            ) : status.tone === "warning" ? (
              <ShieldAlert size={14} />
            ) : (
              <ShieldCheck size={14} />
            )
          }
          value={status.label}
          hint={`not after ${certDate(info.validTo)}`}
          hintTitle={info.validTo}
          tone={status.tone}
          footer={
            <Progress
              value={metrics.remainingPercent}
              tone={status.tone}
              height={3}
              label="Certificate lifetime remaining"
            />
          }
        />
        <SummaryCard
          label="Negotiated protocol"
          icon={<Lock size={14} />}
          value={protocol}
          hint={TLS_RFC[protocol] ?? "unknown specification"}
          tone={tlsTone(info.tlsVersion)}
        />
        <SummaryCard
          label="Cipher suite"
          icon={<KeyRound size={14} />}
          value={info.cipherSuite}
          hint={cipherTraits(info.cipherSuite)}
          tone="tertiary"
          mono
          wrap
        />
        <SummaryCard
          label="Heuristic grade"
          icon={<BadgeCheck size={14} />}
          value={`Grade ${info.grade}`}
          hint="expiry · protocol · cipher"
          tone={gradeTone(info.grade)}
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Validity window"
          hint={`${certDate(info.validFrom)} → ${certDate(info.validTo)} · ${plural(
            metrics.lifetimeDays,
            "day",
          )} lifetime`}
          icon={<Timer size={13} />}
          actions={
            <Badge tone={status.tone} mono dot>
              {status.detail}
            </Badge>
          }
        />
        <div className="p-3 space-y-2">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">Not before</div>
              <div className="font-mono text-[11.5px] text-on-variant tnum">{certDate(info.validFrom)}</div>
            </div>
            <div className="text-center shrink-0">
              <div className={clsx("text-[13px] font-semibold leading-tight tnum", TONE_TEXT[status.tone])}>
                {status.label}
              </div>
              <div className="font-mono text-[10px] text-outline">{status.detail}</div>
            </div>
            <div className="text-right min-w-0">
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">Not after</div>
              <div className="font-mono text-[11.5px] text-on-variant tnum">{certDate(info.validTo)}</div>
            </div>
          </div>
          <div
            role="img"
            aria-label={`Validity timeline: valid from ${certDate(info.validFrom)} to ${certDate(
              info.validTo,
            )}, ${status.detail}, ${metrics.elapsedPercent}% of the lifetime elapsed`}
            className="relative h-2.5 rounded-full bg-black/45 border border-white/[0.05] overflow-hidden"
          >
            <div
              className={clsx("h-full rounded-full transition-[width] duration-300", VALIDITY_FILL[status.tone])}
              style={{ width: `${metrics.spanPercent}%` }}
            />
            <span
              aria-hidden
              className="absolute inset-y-0 w-px bg-white/85 shadow-[0_0_6px_rgba(255,255,255,0.6)]"
              style={{ left: `${metrics.spanPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between font-mono text-[9.5px] text-outline">
            <span>{plural(metrics.lifetimeDays, "day")} total</span>
            <span>{metrics.elapsedPercent}% of lifetime elapsed</span>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-3 items-start">
        <div className="min-w-0 flex flex-col gap-3">
          <Card className="overflow-hidden">
            <CardHeader
              title="Subject & issuer"
              hint={`${info.domain}:${PORT} · X.509 v3 leaf`}
              icon={<BadgeCheck size={13} />}
              actions={
                <CopyButton
                  text={`Subject: ${info.subject}\nIssuer: ${info.issuer}`}
                  label="Copy DN"
                  size="sm"
                />
              }
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.055]">
              <div className="p-3 space-y-1.5 min-w-0">
                <SectionLabel>Subject DN</SectionLabel>
                <p className="font-mono text-[11.5px] leading-relaxed text-on-surface break-words">
                  {info.subject || "—"}
                </p>
              </div>
              <div className="p-3 space-y-1.5 min-w-0">
                <SectionLabel>Issuer DN</SectionLabel>
                <p className="font-mono text-[11.5px] leading-relaxed text-on-variant break-words">
                  {info.issuer || "—"}
                </p>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title="Subject alternative names"
              hint={
                info.sans.length > 0
                  ? `${plural(wildcards, "wildcard")} · ${plural(info.sans.length, "DNS name")}`
                  : "no DNS SANs presented"
              }
              icon={<Network size={13} />}
              actions={
                <>
                  <Badge tone="neutral" mono>
                    {plural(info.sans.length, "entry", "entries")}
                  </Badge>
                  <CopyButton text={info.sans.join("\n")} label="Copy all" size="sm" disabled={info.sans.length === 0} />
                </>
              }
            />
            <div className="p-3">
              {info.sans.length > 0 ? (
                <ul
                  aria-label="Subject alternative names"
                  className="flex flex-wrap gap-1 max-h-[156px] overflow-y-auto pr-1"
                >
                  {info.sans.map((san) => (
                    <li key={san} className="min-w-0 max-w-full">
                      <span
                        title={san}
                        className={clsx(
                          "inline-flex max-w-full rounded-md border px-1.5 py-0.5 font-mono text-[10px] leading-relaxed break-all",
                          san.startsWith("*.")
                            ? "border-primary/25 bg-primary/10 text-primary-soft"
                            : "border-white/[0.07] bg-white/[0.04] text-on-variant",
                        )}
                      >
                        {san}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] leading-relaxed text-outline">
                  The leaf carries no subject alternative names. Modern clients ignore the CN and will reject this
                  certificate for hostname matching.
                </p>
              )}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title="Presented chain"
              hint="leaf first — trust is not verified"
              icon={<ListTree size={13} />}
              actions={
                <>
                  <Badge tone="neutral" mono>
                    {plural(info.chain.length, "certificate")}
                  </Badge>
                  {selfSigned > 0 && (
                    <Badge tone="tertiary" mono>
                      {selfSigned} self-signed
                    </Badge>
                  )}
                </>
              }
            />
            <ol
              aria-label="Presented certificate chain, leaf first"
              className="divide-y divide-white/[0.05] max-h-[340px] overflow-y-auto"
            >
              {info.chain.map((node, index) => {
                const level = chainLevel(node, index);
                return (
                  <li key={`${index}-${node.subject}`} className="flex items-start gap-2.5 px-3 py-2 min-w-0">
                    <span className="w-4 shrink-0 pt-0.5 text-right font-mono text-[10px] text-outline tnum">
                      {index}
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge tone={level.tone}>{level.label}</Badge>
                        {node.selfSigned && (
                          <Badge tone="tertiary" mono title="Subject DN equals issuer DN">
                            self-signed
                          </Badge>
                        )}
                        {index === 0 && <span className="text-[9.5px] uppercase tracking-[0.08em] text-outline">in use</span>}
                      </div>
                      <div className="font-mono text-[11px] leading-snug text-on-surface break-words">{node.subject}</div>
                      <div className="font-mono text-[9.5px] leading-snug text-outline break-words">
                        issued by {node.issuer}
                      </div>
                      <div className="font-mono text-[9.5px] text-on-variant tnum">
                        {certDate(node.validFrom)} → {certDate(node.validTo)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="flex items-start gap-2 border-t border-white/[0.055] px-3 py-2 text-[10px] leading-relaxed text-outline">
              <Info size={11} className="mt-[1px] shrink-0" />
              <span>
                Parsed from the handshake only. A self-signed node has an identical subject and issuer; nothing here is
                checked against a local trust store.
              </span>
            </div>
          </Card>
        </div>

        <div className="min-w-0 flex flex-col gap-3">
          <Card className="overflow-hidden">
            <CardHeader
              title="Negotiated parameters"
              hint="read from the live session"
              icon={<KeyRound size={13} />}
              actions={
                <Badge tone={tlsTone(info.tlsVersion)} mono>
                  {protocol}
                </Badge>
              }
            />
            <div className="p-2.5 grid grid-cols-2 gap-1.5">
              <ParameterTile label="Protocol" value={protocol} hint={TLS_RFC[protocol] ?? "unknown RFC"} />
              <ParameterTile
                label="Key bits"
                value={info.keyBits === null ? "not reported" : `${info.keyBits} bit`}
                hint={info.keyBits === null ? "EC sizes not parsed" : "public key"}
              />
              <ParameterTile
                label="Cipher suite"
                value={info.cipherSuite}
                hint={cipherTraits(info.cipherSuite)}
                className="col-span-2"
                valueClassName="text-[11px]"
              />
              <ParameterTile
                label="Signature algorithm"
                value={signatureName}
                hint={signatureHint}
                className="col-span-2"
                valueClassName="text-[11px]"
                title={info.signatureAlgorithm ?? signatureName}
              />
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title="Leaf fingerprint"
              hint="SHA-256 · colon-separated hex"
              icon={<Fingerprint size={13} />}
              actions={<CopyButton text={info.fingerprintSha256} label="Copy" size="sm" />}
            />
            <div className="p-2.5 space-y-2">
              <div className="rounded-lg border border-white/[0.055] bg-black/35 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-on-surface break-all select-all">
                {info.fingerprintSha256 || "—"}
              </div>
              <div className="space-y-1.5">
                <DetailRow label="Serial" value={info.serial || "—"} />
                <DetailRow label="Host" value={`${info.domain}:${PORT}`} />
                <DetailRow label="Chain" value={plural(info.chain.length, "certificate")} />
              </div>
            </div>
          </Card>

          <Card className="p-2.5 space-y-2">
            <SectionLabel trailing={<Badge tone="neutral" mono>read-only</Badge>}>Inspection scope</SectionLabel>
            <InfoNotice tone="neutral" icon={<Info size={12} />}>
              Inspects the certificate the server presents. It does <span className="text-on-surface">not</span> verify
              the chain of trust, hostname binding or revocation status.
            </InfoNotice>
            <div className="grid grid-cols-3 gap-1.5">
              <MiniMetric
                label="Alerts"
                value={String(info.alerts.length)}
                tone={info.alerts.length > 0 ? "warning" : "success"}
              />
              <MiniMetric label="Self-signed" value={String(selfSigned)} tone={selfSigned > 0 ? "tertiary" : "neutral"} />
              <MiniMetric label="Wildcards" value={String(wildcards)} tone="neutral" />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/* --------------------------------- view --------------------------------- */

export default function SslInspectorView() {
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<TlsInfo | null>(null);
  const [queriedHost, setQueriedHost] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const requestRef = useRef(0);
  const historySeq = useRef(0);

  useEffect(
    () => () => {
      requestRef.current += 1;
    },
    [],
  );

  const inspect = useCallback(async (raw: string) => {
    const host = normalizeHost(raw);
    if (!host) {
      setFault(
        "Enter a hostname to inspect — a bare domain such as github.com or a URL such as https://github.com.",
      );
      return;
    }

    if (!isTauri) {
      setQueriedHost(host);
      setResult(null);
      setFault("This tool needs the native app: the handshake runs in the Rust core. Launch it with `npm run app`.");
      setLoading(false);
      return;
    }

    requestRef.current += 1;
    const requestId = requestRef.current;
    setLoading(true);
    setFault(null);
    setTarget(host);

    try {
      const info = await security.tls(host, PORT);
      if (requestRef.current !== requestId) return;

      setResult(info);
      setQueriedHost(info.domain || host);
      setFault(null);

      historySeq.current += 1;
      const entry: AuditEntry = {
        id: historySeq.current,
        domain: info.domain || host,
        grade: info.grade,
        daysRemaining: info.daysRemaining,
      };
      setHistory((prev) => [
        entry,
        ...prev.filter((item) => item.domain.toLowerCase() !== entry.domain.toLowerCase()),
      ].slice(0, MAX_HISTORY));

      toast.success(
        `${info.domain || host} inspected`,
        `Grade ${info.grade} · ${tlsLabel(info.tlsVersion)} · ${plural(info.sans.length, "SAN")}`,
      );
    } catch (err) {
      if (requestRef.current !== requestId) return;
      const message = errorMessage(err);
      setResult(null);
      setQueriedHost(host);
      setFault(message);
      toast.error("Handshake failed", message);
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, []);

  const report = useMemo(() => (result ? buildReport(result) : ""), [result]);
  const resultStatus = result ? validityStatus(result.daysRemaining) : null;
  const retryHost = queriedHost ?? target;

  return (
    <ToolView
      eyebrow="TLS HANDSHAKE"
      eyebrowTone="tertiary"
      eyebrowHint="RUSTLS · X.509 · PORT 443"
      title="SSL Inspector"
      description="Inspect a live TLS certificate: chain, validity, SANs, cipher suite, and expiry alerts."
      telemetry={[
        {
          label: "Grade",
          value: result ? result.grade : "—",
          tone: result ? gradeTone(result.grade) : "neutral",
          icon: <ShieldCheck size={14} />,
        },
        {
          label: result && result.daysRemaining < 0 ? "Expired" : "Expires in",
          value: result
            ? result.daysRemaining < 0
              ? `${Math.abs(result.daysRemaining)}d ago`
              : `${result.daysRemaining}d`
            : "—",
          tone: result ? (resultStatus ? resultStatus.tone : "neutral") : "neutral",
          icon: <Clock3 size={14} />,
        },
        {
          label: "SAN entries",
          value: result ? String(result.sans.length) : "—",
          tone: "neutral",
          icon: <Network size={14} />,
        },
        {
          label: "Protocol",
          value: result ? tlsLabel(result.tlsVersion) : "—",
          tone: result ? tlsTone(result.tlsVersion) : "neutral",
          icon: <Lock size={14} />,
        },
      ]}
      headerExtra={
        result ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px]">
            <span className="flex items-center gap-1.5 text-on-variant">
              <Dot tone={resultStatus ? resultStatus.tone : "neutral"} />
              {result.domain}:{PORT}
            </span>
            <span className="text-outline">
              subject <span className="text-on-surface">{truncateMiddle(result.subject, 46)}</span>
            </span>
            <span className="text-outline">
              issuer <span className="text-on-variant">{truncateMiddle(result.issuer, 46)}</span>
            </span>
            <span className="text-outline/80">presented certificate only · chain of trust not verified</span>
          </div>
        ) : undefined
      }
      status={
        <>
          {result && <CopyButton text={report} label="Copy report" size="sm" />}
          <Badge tone="neutral" mono dot>
            direct · :{PORT}
          </Badge>
          <IconButton
            label="Re-inspect current host"
            icon={<RefreshCw size={13} />}
            onClick={() => void inspect(retryHost)}
            disabled={loading || (!queriedHost && !target)}
          />
        </>
      }
    >
      <Card className="p-2.5 space-y-2">
        <form
          className="flex flex-col sm:flex-row sm:items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void inspect(target);
          }}
        >
          <div className="flex-1 min-w-0">
            <Input
              id={INPUT_ID}
              mono
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="github.com or https://github.com"
              aria-label="Domain or URL to inspect"
              spellCheck={false}
              autoComplete="off"
              leading={<Lock size={12} />}
              trailingSlot={<span className="font-mono text-[10px] text-outline px-1">:443</span>}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={loading}
            icon={<ShieldCheck size={13} />}
            trailing={<Kbd>↵</Kbd>}
          >
            Analyze certificate
          </Button>
        </form>

        {loading && <Progress indeterminate height={2} label="TLS handshake in progress" />}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">
            {history.length > 0 ? "Recent audits" : "Try"}
          </span>
          {history.length > 0
            ? history.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => void inspect(entry.domain)}
                  aria-label={`Inspect ${entry.domain} again`}
                  className="inline-flex items-center gap-1.5 h-5 px-2 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.09] font-mono text-[10.5px] text-on-variant hover:text-on-surface transition-colors"
                >
                  <span className="max-w-[180px] truncate">{entry.domain}</span>
                  <span className={clsx("text-[9px] font-semibold", TONE_TEXT[gradeTone(entry.grade)])}>
                    {entry.grade}
                  </span>
                  <span className="text-[9px] text-outline tnum">{entry.daysRemaining}d</span>
                </button>
              ))
            : QUICK_TARGETS.map((domain) => (
                <button
                  key={domain}
                  type="button"
                  onClick={() => void inspect(domain)}
                  aria-label={`Inspect ${domain}`}
                  className="inline-flex items-center h-5 px-2 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.09] font-mono text-[10.5px] text-on-variant hover:text-on-surface transition-colors"
                >
                  {domain}
                </button>
              ))}
          <span className="ml-auto hidden sm:inline font-mono text-[9.5px] text-outline">
            Handshake runs in the Rust core · no proxy · no cache
          </span>
        </div>
      </Card>

      {fault && (
        <ErrorNotice
          title="Handshake failed"
          message={fault}
          onRetry={() => void inspect(retryHost)}
          retryLabel="Retry handshake"
        />
      )}

      {!result && (
        <Card className="overflow-hidden">
          <CardHeader
            title={loading ? "Opening a TLS session…" : "No certificate inspected yet"}
            hint={
              loading
                ? `Handshaking with ${target || "target"}:${PORT}`
                : "Enter a hostname above or pick a target to open a live session"
            }
            icon={<Lock size={13} />}
            actions={<Badge tone="neutral" mono>{`port ${PORT}`}</Badge>}
          />
          {loading && <Progress indeterminate height={2} label="TLS handshake in progress" />}
          <div className="p-3">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
              {CHECKS.map((item) => (
                <div
                  key={item.title}
                  className="rounded-lg border border-white/[0.055] bg-black/25 p-2.5 space-y-1 min-w-0"
                >
                  <div className="flex items-center gap-1.5 text-primary-soft">
                    {item.icon}
                    <span className="text-[11px] font-medium text-on-surface">{item.title}</span>
                  </div>
                  <p className="text-[10.5px] leading-relaxed text-outline">{item.body}</p>
                </div>
              ))}
            </div>
            {!loading && (
              <div className="mt-2">
                <InfoNotice tone="neutral" icon={<Info size={12} />}>
                  This inspector reads the certificate the server presents. It does not verify the chain of trust,
                  hostname binding or revocation — use it to audit what a host actually sends, not to bless it.
                </InfoNotice>
              </div>
            )}
          </div>
        </Card>
      )}

      {result && <CertificateReport info={result} />}
    </ToolView>
  );
}
