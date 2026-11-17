import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  Binary,
  Check,
  Clipboard,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  HardDrive,
  KeyRound,
  Lightbulb,
  Lock,
  Network,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Timer,
  Wand2,
  X,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { Checkbox, Field, Input } from "@/components/ui/Form";
import { EmptyState, ErrorNotice, InfoNotice, Spinner } from "@/components/ui/Feedback";
import { ScoreRing } from "@/components/ui/Charts";
import { toast } from "@/components/ui/Toast";
import { security } from "@/lib/api";
import { errorMessage, isTauri } from "@/lib/ipc";
import { number, plural } from "@/lib/format";
import type { PasswordStrength, PwnedResult } from "@/lib/types";

const SCORE_META: Record<number, { tone: Tone; fill: string; text: string }> = {
  0: { tone: "neutral", fill: "bg-white/20", text: "text-outline" },
  1: { tone: "error", fill: "bg-error", text: "text-error" },
  2: { tone: "error", fill: "bg-error", text: "text-error" },
  3: { tone: "warning", fill: "bg-warning", text: "text-warning" },
  4: { tone: "primary", fill: "bg-primary", text: "text-primary-soft" },
  5: { tone: "success", fill: "bg-secondary", text: "text-secondary" },
};

function scoreMeta(score: number | undefined) {
  return SCORE_META[score ?? 0] ?? SCORE_META[0];
}

function charClassCount(value: string): number {
  if (!value) return 0;
  let count = 0;
  if (/[a-z]/.test(value)) count += 1;
  if (/[A-Z]/.test(value)) count += 1;
  if (/[0-9]/.test(value)) count += 1;
  if (/[^A-Za-z0-9]/.test(value)) count += 1;
  return count;
}

/** Five discrete cells, one per backend score point. */
function StrengthBar({ score, label }: { score: number; label: string }) {
  const meta = scoreMeta(score);
  return (
    <div
      role="img"
      aria-label={score > 0 ? `Strength ${score} of 5 — ${label}` : "Strength not measured"}
      className="flex items-center gap-1"
    >
      {[1, 2, 3, 4, 5].map((step) => (
        <span
          key={step}
          className={clsx(
            "h-1.5 flex-1 rounded-full transition-colors duration-150",
            step <= score ? meta.fill : "bg-white/[0.07]",
          )}
        />
      ))}
    </div>
  );
}

function ToggleCell({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div
      className={clsx(
        "flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-colors duration-150",
        checked ? "border-primary/25 bg-primary/[0.06]" : "border-white/[0.06] bg-black/25",
      )}
    >
      <Checkbox checked={checked} onChange={onChange} label={<span className="text-[11.5px]">{label}</span>} />
      <span className="ml-auto font-mono text-[9px] text-outline">{hint}</span>
    </div>
  );
}

export default function PasswordAuditorView() {
  /* ------------------------------- auditor ------------------------------- */
  const [password, setPassword] = useState("");
  const [showTarget, setShowTarget] = useState(false);
  const [strength, setStrength] = useState<PasswordStrength | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const auditSeq = useRef(0);

  /* -------------------------------- breach -------------------------------- */
  const [pwned, setPwned] = useState<PwnedResult | null>(null);
  const [pwnedError, setPwnedError] = useState<string | null>(null);
  const [pwnedBusy, setPwnedBusy] = useState(false);
  const pwnedSeq = useRef(0);

  /* ------------------------------- generator ------------------------------ */
  const [length, setLength] = useState(24);
  const [symbols, setSymbols] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [uppercase, setUppercase] = useState(true);
  const [generated, setGenerated] = useState("");
  const [showGenerated, setShowGenerated] = useState(true);
  const [genStrength, setGenStrength] = useState<PasswordStrength | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const genSeq = useRef(0);
  const genStarted = useRef(false);

  /* Debounced audit. Any change of target also invalidates the breach result. */
  useEffect(() => {
    const seq = ++auditSeq.current;
    pwnedSeq.current += 1;
    setPwned(null);
    setPwnedError(null);
    setPwnedBusy(false);

    if (!password) {
      setStrength(null);
      setAuditError(null);
      setAuditing(false);
      return;
    }

    setAuditing(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const next = await security.password(password);
          if (seq !== auditSeq.current) return;
          setStrength(next);
          setAuditError(null);
        } catch (err) {
          if (seq !== auditSeq.current) return;
          setStrength(null);
          setAuditError(errorMessage(err));
        } finally {
          if (seq === auditSeq.current) setAuditing(false);
        }
      })();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [password, retryTick]);

  const generate = useCallback(async () => {
    const seq = ++genSeq.current;
    setGenBusy(true);
    setGenError(null);

    let next: string;
    try {
      next = await security.generatePassword(length, symbols, numbers, uppercase);
    } catch (err) {
      if (seq === genSeq.current) {
        setGenError(errorMessage(err));
        setGenStrength(null);
        setGenBusy(false);
      }
      return;
    }

    if (seq !== genSeq.current) return;
    setGenerated(next);
    setShowGenerated(true);

    try {
      const measured = await security.password(next);
      if (seq === genSeq.current) setGenStrength(measured);
    } catch (err) {
      if (seq === genSeq.current) {
        setGenStrength(null);
        setGenError(errorMessage(err));
      }
    } finally {
      if (seq === genSeq.current) setGenBusy(false);
    }
  }, [length, symbols, numbers, uppercase]);

  /* First mount generates immediately; later option changes regenerate after 180 ms. */
  useEffect(() => {
    const delay = genStarted.current ? 180 : 0;
    const timer = window.setTimeout(() => {
      genStarted.current = true;
      void generate();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [generate]);

  const checkBreach = useCallback(async () => {
    const target = password;
    if (!target) return;
    const seq = ++pwnedSeq.current;
    setPwnedBusy(true);
    setPwnedError(null);
    setPwned(null);
    try {
      const result = await security.pwned(target);
      if (seq !== pwnedSeq.current) return;
      setPwned(result);
    } catch (err) {
      if (seq !== pwnedSeq.current) return;
      setPwnedError(errorMessage(err));
    } finally {
      if (seq === pwnedSeq.current) setPwnedBusy(false);
    }
  }, [password]);

  const copyGenerated = useCallback(async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated);
      toast.success("Password copied", "Clear the clipboard once you have pasted it.");
    } catch (err) {
      toast.error("Copy failed", errorMessage(err));
    }
  }, [generated]);

  const meta = scoreMeta(strength?.score);
  const breachConfirmed = Boolean(pwned && !pwned.error && pwned.breached);

  return (
    <ToolView
      eyebrow="CREDENTIAL AUDIT"
      eyebrowTone="warning"
      eyebrowHint="LOCAL ENTROPY · K-ANONYMITY"
      title="Password Auditor"
      description="Generate strong passwords, measure entropy and crack time, and check breach exposure privately."
      telemetry={[
        {
          label: "Score",
          value: strength ? `${strength.score} / 5` : "—",
          tone: meta.tone,
          icon: <Gauge size={14} />,
        },
        {
          label: "Entropy",
          value: strength ? `${strength.entropyBits.toFixed(1)} bits` : "—",
          tone: "primary",
          icon: <Binary size={14} />,
        },
        {
          label: "Crack time",
          value: strength?.crackTime ?? "—",
          tone: "neutral",
          icon: <Timer size={14} />,
        },
      ]}
      toolbar={
        <>
          <Button
            variant="primary"
            icon={<RefreshCw size={13} />}
            onClick={() => void generate()}
            loading={genBusy}
          >
            Generate password
          </Button>
          <Button
            icon={<X size={13} />}
            onClick={() => setPassword("")}
            disabled={!password}
          >
            Clear target
          </Button>
        </>
      }
      status={
        <>
          <Badge tone={isTauri ? "success" : "warning"} dot>
            {isTauri ? "Native IPC" : "Preview — no IPC"}
          </Badge>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-outline">memory only</span>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-3 items-start">
        {/* ---------------------------- left column ---------------------------- */}
        <div className="flex flex-col gap-3 min-w-0">
          <Card className="min-w-0">
            <CardHeader
              title="Target candidate"
              hint="Audited in the Rust core · 250 ms debounce"
              icon={<KeyRound size={13} />}
              actions={
                <>
                  <Badge tone="neutral" mono>
                    {plural(password.length, "char")}
                  </Badge>
                  <Badge tone="neutral" mono title="Character classes present">
                    {charClassCount(password)} classes
                  </Badge>
                </>
              }
            />
            <div className="p-3.5 space-y-3">
              <Field
                label="Password to audit"
                htmlFor="audit-password"
                hint="Never stored. The value lives in this view's memory and is discarded when you leave."
              >
                <Input
                  id="audit-password"
                  type={showTarget ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Type or paste a password"
                  aria-label="Password to audit"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  mono
                  leading={<Lock size={12} />}
                  trailingSlot={
                    <IconButton
                      label={showTarget ? "Hide password" : "Show password"}
                      icon={showTarget ? <EyeOff size={13} /> : <Eye size={13} />}
                      size="sm"
                      onClick={() => setShowTarget((prev) => !prev)}
                    />
                  }
                />
              </Field>

              {auditError && (
                <ErrorNotice
                  title="Audit failed"
                  message={auditError}
                  retryLabel="Retry"
                  onRetry={() => setRetryTick((tick) => tick + 1)}
                />
              )}

              {!password ? (
                <EmptyState
                  compact
                  icon={<ShieldQuestion size={16} />}
                  title="Nothing audited yet"
                  description="Paste a password above to measure entropy, crack time and weak patterns. The analysis never leaves this machine."
                />
              ) : (
                <>
                  <div
                    className="rounded-xl border border-white/[0.06] bg-black/25 p-3 space-y-3"
                    aria-busy={auditing}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <ScoreRing
                          value={strength?.score ?? 0}
                          max={5}
                          tone={meta.tone}
                          size={62}
                          label={strength ? String(strength.score) : "0"}
                          sublabel="/ 5"
                        />
                        <div className="min-w-0 space-y-0.5" aria-live="polite">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">
                            Entropy assessment
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={clsx(
                                "text-[16px] font-semibold capitalize truncate",
                                strength ? meta.text : "text-outline",
                              )}
                            >
                              {strength?.label ?? (auditing ? "analyzing" : "not audited")}
                            </span>
                            {auditing && <Spinner size={11} />}
                          </div>
                          <div className="font-mono text-[10px] text-on-variant tnum">
                            {strength ? `${strength.entropyBits.toFixed(1)} bits of entropy` : "no measurement"}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">
                          Crack time
                        </div>
                        <div className="font-mono text-[11.5px] text-on-surface tnum">
                          {strength?.crackTime ?? "—"}
                        </div>
                        <div className="font-mono text-[9px] text-outline">10B guesses/s offline</div>
                      </div>
                    </div>

                    <StrengthBar score={strength?.score ?? 0} label={strength?.label ?? "unmeasured"} />

                    <div className="flex items-center justify-between font-mono text-[9px] text-outline">
                      <span>1 · critical</span>
                      <span>3 · fair</span>
                      <span>5 · excellent</span>
                    </div>
                  </div>

                  {strength && (
                    <>
                      <div className="space-y-1.5">
                        <SectionLabel
                          trailing={
                            <span className="font-mono text-[10px] text-outline">
                              {strength.issues.length === 0
                                ? "0 flaws"
                                : plural(strength.issues.length, "flaw")}
                            </span>
                          }
                        >
                          Weaknesses
                        </SectionLabel>
                        {strength.issues.length === 0 ? (
                          <p className="flex items-start gap-1.5 text-[11px] leading-[15px] text-[#8ff0a4]">
                            <Check size={11} className="mt-[2px] shrink-0" aria-hidden />
                            No length, class or pattern weaknesses detected.
                          </p>
                        ) : (
                          <ul className="space-y-1">
                            {strength.issues.map((issue, index) => (
                              <li
                                key={`${issue}-${index}`}
                                className="flex items-start gap-1.5 text-[11px] leading-[15px] text-on-variant"
                              >
                                <X size={11} className="mt-[2px] shrink-0 text-error" aria-hidden />
                                <span>{issue}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {strength.suggestions.length > 0 && (
                        <div className="space-y-1.5">
                          <SectionLabel>Recommendations</SectionLabel>
                          <ul className="space-y-1">
                            {strength.suggestions.map((suggestion, index) => (
                              <li
                                key={`${suggestion}-${index}`}
                                className="flex items-start gap-1.5 text-[11px] leading-[15px] text-on-variant/85"
                              >
                                <Lightbulb size={11} className="mt-[2px] shrink-0 text-warning" aria-hidden />
                                <span>{suggestion}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </Card>

          <Card className="min-w-0">
            <CardHeader
              title="Breach exposure"
              hint="Have I Been Pwned range API · manual opt-in"
              icon={<ShieldAlert size={13} />}
              actions={
                <Badge tone="primary" mono>
                  k-anonymity
                </Badge>
              }
            />
            <div className="p-3.5 space-y-3">
              <p className="text-[11px] leading-relaxed text-on-variant/80">
                Optional network check. Only the{" "}
                <span className="font-mono text-primary-soft">first 5 characters</span> of the password&apos;s SHA-1
                hash are sent to{" "}
                <span className="font-mono text-on-surface">api.pwnedpasswords.com</span>. The remaining 35 are
                matched against the returned range on this machine — the password itself never leaves.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  icon={<ShieldCheck size={13} />}
                  onClick={() => void checkBreach()}
                  disabled={!password || pwnedBusy}
                  loading={pwnedBusy}
                >
                  Check breach exposure
                </Button>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.07em] text-outline">
                  {password ? "sends 5 hash chars" : "needs a target password"}
                </span>
              </div>

              {pwnedError && (
                <ErrorNotice
                  title="Breach lookup failed"
                  message={pwnedError}
                  retryLabel="Retry"
                  onRetry={() => void checkBreach()}
                />
              )}

              {pwned?.error && !pwnedError && (
                <ErrorNotice
                  title="Breach lookup unavailable"
                  message={pwned.error}
                  retryLabel="Retry"
                  onRetry={() => void checkBreach()}
                />
              )}

              <div aria-live="polite">
                {pwned && !pwned.error && breachConfirmed && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-error/30 bg-error/[0.07] px-3 py-2.5">
                    <ShieldX size={16} className="mt-0.5 shrink-0 text-error" aria-hidden />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-[#ffb4ab]">Exposed in known breaches</span>
                        <Badge tone="error" mono>
                          {number(pwned.count)}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-on-variant/80">
                        Seen {number(pwned.count)} times in public breach corpora. Retire it everywhere it is used and
                        rotate to a generated replacement.
                      </p>
                    </div>
                  </div>
                )}

                {pwned && !pwned.error && !pwned.breached && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-secondary/25 bg-secondary/[0.05] px-3 py-2.5">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-secondary" aria-hidden />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-[#8ff0a4]">No breach matches</span>
                        <Badge tone="success" mono>
                          clear
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-on-variant/80">
                        This exact string does not appear in the queried range. Absence is not proof of safety —
                        reuse is still the risk.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-lg border border-white/[0.05] bg-black/30 px-2.5 py-2">
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">Prefix sent</div>
                  <div className="font-mono text-[10.5px] text-primary-soft tnum">5 chars</div>
                </div>
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">Suffix local</div>
                  <div className="font-mono text-[10.5px] text-on-surface tnum">35 chars</div>
                </div>
                <div>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">Range matches</div>
                  <div
                    className={clsx(
                      "font-mono text-[10.5px] tnum",
                      breachConfirmed ? "text-error" : "text-on-surface",
                    )}
                  >
                    {pwned && !pwned.error ? number(pwned.count) : "—"}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ---------------------------- right column --------------------------- */}
        <div className="flex flex-col gap-3 min-w-0">
          <Card className="min-w-0">
            <CardHeader
              title="Generator"
              hint="CSPRNG · ambiguous glyphs excluded"
              icon={<Wand2 size={13} />}
              actions={
                <Badge tone="neutral" mono>
                  {generated ? `${generated.length} chars` : "idle"}
                </Badge>
              }
            />
            <div className="p-3.5 space-y-3">
              <div className="rounded-xl border border-white/[0.07] bg-black/40 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.08em] text-outline">
                  <span>csprng output</span>
                  <span className="text-primary-soft">
                    {generated ? `${generated.length} chars` : "no output"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 min-h-[32px]">
                  <div
                    className="flex-1 min-w-0 font-mono text-[15px] leading-[20px] tracking-[0.02em] text-primary-soft break-all select-all"
                    aria-live="polite"
                    aria-label={generated ? "Generated password" : "No generated password"}
                  >
                    {generated ? (
                      showGenerated ? (
                        generated
                      ) : (
                        <span className="text-outline">{"•".repeat(generated.length)}</span>
                      )
                    ) : (
                      <span className="font-sans text-[11px] text-outline">
                        {genBusy ? "Generating…" : "Nothing generated yet"}
                      </span>
                    )}
                  </div>
                  <IconButton
                    label={showGenerated ? "Hide generated password" : "Show generated password"}
                    icon={showGenerated ? <EyeOff size={13} /> : <Eye size={13} />}
                    size="sm"
                    onClick={() => setShowGenerated((prev) => !prev)}
                    disabled={!generated}
                  />
                  <IconButton
                    label="Copy generated password"
                    icon={<Copy size={13} />}
                    size="sm"
                    onClick={() => void copyGenerated()}
                    disabled={!generated}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <label
                    htmlFor="generator-length"
                    className="text-[10px] font-semibold uppercase tracking-[0.08em] text-outline"
                  >
                    Length
                  </label>
                  <span className="font-mono text-[11px] text-primary-soft tnum">{length} characters</span>
                </div>
                <input
                  id="generator-length"
                  type="range"
                  min={8}
                  max={64}
                  step={1}
                  value={length}
                  onChange={(event) => setLength(Number(event.target.value))}
                  className={clsx(
                    "w-full h-1.5 rounded-full appearance-none cursor-pointer bg-white/[0.12]",
                    "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5",
                    "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary",
                    "[&::-webkit-slider-thumb]:shadow-[0_0_0_1px_rgba(255,255,255,0.22)]",
                    "focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-4",
                  )}
                  style={{ accentColor: "#0a84ff" }}
                />
                <div className="flex justify-between font-mono text-[9px] text-outline">
                  <span>8 min</span>
                  <span>24 recommended</span>
                  <span>64 max</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <ToggleCell checked={uppercase} onChange={setUppercase} label="A–Z upper" hint="26" />
                <ToggleCell checked={numbers} onChange={setNumbers} label="0–9 digits" hint="8" />
                <ToggleCell checked={symbols} onChange={setSymbols} label="!@# symbols" hint="24" />
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-white/[0.06] bg-black/15">
                  <Lock size={10} className="text-outline" aria-hidden />
                  <span className="text-[11px] text-outline">a–z lower</span>
                  <span className="ml-auto font-mono text-[9px] text-outline">always</span>
                </div>
              </div>

              <Button variant="primary" block icon={<RefreshCw size={13} />} onClick={() => void generate()} loading={genBusy}>
                Generate
              </Button>

              {genError && (
                <ErrorNotice
                  title="Generator failed"
                  message={genError}
                  retryLabel="Retry"
                  onRetry={() => void generate()}
                />
              )}

              <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">
                    Generated strength
                  </span>
                  {genStrength ? (
                    <Badge tone={scoreMeta(genStrength.score).tone} mono>
                      {genStrength.label}
                    </Badge>
                  ) : (
                    <span className="font-mono text-[9.5px] text-outline">unrated</span>
                  )}
                </div>
                <StrengthBar
                  score={genStrength?.score ?? 0}
                  label={genStrength?.label ?? "unmeasured"}
                />
                <div className="flex items-center justify-between font-mono text-[9.5px] text-outline tnum">
                  <span>{genStrength ? `${genStrength.entropyBits.toFixed(1)} bits` : "—"}</span>
                  <span>{genStrength?.crackTime ?? "—"}</span>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-3 space-y-2">
            <SectionLabel trailing={<Badge tone="success" dot>no disk write</Badge>}>Privacy model</SectionLabel>
            <ul className="space-y-1.5 text-[11px] leading-[15px] text-on-variant/80">
              <li className="flex items-start gap-2">
                <HardDrive size={11} className="mt-[1px] shrink-0 text-outline" aria-hidden />
                <span>Passwords stay in this view&apos;s memory. No localStorage, no log line, no file.</span>
              </li>
              <li className="flex items-start gap-2">
                <Network size={11} className="mt-[1px] shrink-0 text-outline" aria-hidden />
                <span>Nothing is transmitted unless you press the breach check; then only 5 SHA-1 hex characters go out.</span>
              </li>
              <li className="flex items-start gap-2">
                <Clipboard size={11} className="mt-[1px] shrink-0 text-outline" aria-hidden />
                <span>Copying is user-initiated, but the clipboard is outside the app&apos;s control — clear it after pasting.</span>
              </li>
            </ul>
            <InfoNotice icon={<Lock size={12} />} tone="neutral">
              Weakness detection and entropy math run in the bundled Rust core, so the audit works offline.
            </InfoNotice>
          </Card>
        </div>
      </div>
    </ToolView>
  );
}
