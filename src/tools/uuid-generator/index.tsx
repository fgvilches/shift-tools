import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bolt,
  Copy,
  Eraser,
  FileJson,
  Fingerprint,
  Hash,
  ListOrdered,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";
import { clsx } from "clsx";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/Feedback";
import { CONTROL, Checkbox, Input, SegmentedControl } from "@/components/ui/Form";
import { toast } from "@/components/ui/Toast";
import { clamp, ms, number, plural } from "@/lib/format";
import {
  collisionProbability,
  copyText,
  createId,
  DEFAULT_NANOID_ALPHABET,
  describeId,
  FORMAT_LABELS,
  FORMAT_TAGS,
  formatUuid,
  generateBatch,
  MAX_BATCH,
  NANOID_DEFAULT_LENGTH,
  type GeneratedId,
  type IdFormat,
  type UuidFormatOptions,
  uniqueChars,
  validateId,
} from "./lib/ids";

const FORMAT_OPTIONS: { value: IdFormat; label: string }[] = [
  { value: "uuid", label: "UUID v4" },
  { value: "ulid", label: "ULID" },
  { value: "nanoid", label: "NanoID" },
];

const SIZE_PRESETS = [1, 10, 25, 50, 100, 250, 500];

const DEFAULT_UUID_OPTIONS: UuidFormatOptions = { uppercase: false, braces: false, hyphens: true };

const INITIAL_COUNT = 100;

const FORMAT_META: Record<IdFormat, { tone: Tone; fact: string; note: string }> = {
  uuid: {
    tone: "primary",
    fact: "version nibble forced to 4 · 122 random bits",
    note: "Formatting rewrites the same 128-bit value — no new entropy is consumed.",
  },
  ulid: {
    tone: "tertiary",
    fact: "80-bit tail increments inside one millisecond",
    note: "Fixed 26-symbol Crockford base32 layout: 10 timestamp chars + 16 random chars.",
  },
  nanoid: {
    tone: "success",
    fact: "rejection sampling keeps every symbol equally likely",
    note: "No version, timestamp or checksum — length and alphabet define the keyspace.",
  },
};

const NANOID_ALPHABETS: { label: string; value: string }[] = [
  { label: "URL-safe", value: DEFAULT_NANOID_ALPHABET },
  { label: "Alnum", value: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" },
  { label: "Hex", value: "0123456789abcdef" },
];

const SUPERS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

const CELL_TONE: Record<string, string> = {
  neutral: "text-on-surface",
  primary: "text-primary-soft",
  success: "text-secondary",
  tertiary: "text-tertiary",
};

interface BatchRow {
  id: GeneratedId;
  ordinal: number;
}

function sci(value: number, digits = 2): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const [mantissa, exponent] = value.toExponential(digits).split("e");
  const raw = exponent ?? "+0";
  const sign = raw.startsWith("-") ? "⁻" : "";
  const digitsOnly = raw.replace(/^[+-]/, "");
  return `${mantissa} × 10${sign}${Array.from(digitsOnly)
    .map((d) => SUPERS[d] ?? d)
    .join("")}`;
}

function oneIn(probability: number): string {
  if (!(probability > 0)) return "never";
  const inverse = 1 / probability;
  return inverse >= 1e6 ? sci(inverse) : number(Math.round(inverse));
}

function collisionText(probability: number, count: number): string {
  if (count < 2) return "—";
  if (probability >= 1) return "guaranteed";
  return `1 in ${oneIn(probability)}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let initialBatchMs = 0;

function buildInitialBatch(): GeneratedId[] {
  const started = performance.now();
  try {
    const batch = generateBatch({
      format: "uuid",
      count: INITIAL_COUNT,
      uuid: DEFAULT_UUID_OPTIONS,
      nanoLength: NANOID_DEFAULT_LENGTH,
      nanoAlphabet: DEFAULT_NANOID_ALPHABET,
    });
    initialBatchMs = performance.now() - started;
    return batch;
  } catch {
    initialBatchMs = 0;
    return [];
  }
}

export default function UuidGeneratorView() {
  const [format, setFormat] = useState<IdFormat>("uuid");
  const [countText, setCountText] = useState(String(INITIAL_COUNT));
  const [uuidOptions, setUuidOptions] = useState<UuidFormatOptions>(DEFAULT_UUID_OPTIONS);
  const [nanoLengthText, setNanoLengthText] = useState(String(NANOID_DEFAULT_LENGTH));
  const [nanoAlphabet, setNanoAlphabet] = useState(DEFAULT_NANOID_ALPHABET);
  const [ids, setIds] = useState<GeneratedId[]>(buildInitialBatch);
  const [selectedOrdinal, setSelectedOrdinal] = useState<number | null>(1);
  const [query, setQuery] = useState("");
  const [validatorInput, setValidatorInput] = useState("");
  const [session, setSession] = useState(() => ({
    batches: 1,
    generated: ids.length,
    lastMs: initialBatchMs,
    lastCount: ids.length,
  }));

  const count = clamp(Number.parseInt(countText, 10) || 1, 1, MAX_BATCH);
  const nanoLength = clamp(Number.parseInt(nanoLengthText, 10) || NANOID_DEFAULT_LENGTH, 1, 255);
  const alphabetChars = useMemo(() => uniqueChars(nanoAlphabet), [nanoAlphabet]);
  const alphabetError =
    format === "nanoid" && alphabetChars.length < 2
      ? "At least 2 unique characters are required. Duplicates collapse."
      : null;

  const entropyBits =
    format === "uuid"
      ? 122
      : format === "ulid"
        ? 80
        : Math.round(nanoLength * Math.log2(Math.max(2, alphabetChars.length)));
  const keyspace = Math.pow(2, entropyBits);

  const specFacts: { label: string; value: string; tone: string }[] =
    format === "uuid"
      ? [
          { label: "Version nibble", value: "v4 · forced", tone: "text-secondary" },
          { label: "Variant bits", value: "10xx · RFC", tone: "text-tertiary" },
          { label: "Random bits", value: "122", tone: "text-primary-soft" },
        ]
      : format === "ulid"
        ? [
            { label: "Time prefix", value: "48 bit · ms", tone: "text-primary-soft" },
            { label: "Random tail", value: "80 bit", tone: "text-secondary" },
            { label: "Encoding", value: "Base32 · 26", tone: "text-tertiary" },
          ]
        : [
            { label: "Length", value: `${nanoLength} symbols`, tone: "text-primary-soft" },
            { label: "Alphabet", value: `${alphabetChars.length} symbols`, tone: "text-secondary" },
            { label: "Entropy", value: `${entropyBits} bits`, tone: "text-tertiary" },
          ];

  const generate = useCallback(
    (overrides: { format?: IdFormat; count?: number; uuid?: UuidFormatOptions } = {}) => {
      const nextFormat = overrides.format ?? format;
      const nextCount = clamp(overrides.count ?? count, 1, MAX_BATCH);
      const nextUuid = overrides.uuid ?? uuidOptions;
      if (nextFormat === "nanoid" && uniqueChars(nanoAlphabet).length < 2) {
        toast.error("NanoID alphabet too small", "Provide at least two unique characters, then generate again.");
        return;
      }
      const started = performance.now();
      try {
        const batch = generateBatch({
          format: nextFormat,
          count: nextCount,
          uuid: nextUuid,
          nanoLength,
          nanoAlphabet,
        });
        const elapsed = performance.now() - started;
        setIds(batch);
        setSelectedOrdinal(batch.length > 0 ? 1 : null);
        setQuery("");
        setSession((prev) => ({
          batches: prev.batches + 1,
          generated: prev.generated + batch.length,
          lastMs: elapsed,
          lastCount: batch.length,
        }));
      } catch (err) {
        toast.error("Generation failed", errorText(err));
      }
    },
    [count, format, nanoAlphabet, nanoLength, uuidOptions],
  );

  const changeFormat = (next: IdFormat) => {
    if (next === format) return;
    setFormat(next);
    if (next === "nanoid" && alphabetChars.length < 2) {
      setIds([]);
      setSelectedOrdinal(null);
      return;
    }
    generate({ format: next });
  };

  const changeUuidOption = (patch: Partial<UuidFormatOptions>) => {
    const next = { ...uuidOptions, ...patch };
    setUuidOptions(next);
    if (format === "uuid") {
      setIds((prev) => prev.map((id) => ({ ...id, display: formatUuid(id.raw, next) })));
    }
  };

  const changeCount = (next: number) => setCountText(String(clamp(Math.round(next), 1, MAX_BATCH)));

  const rows = useMemo<BatchRow[]>(() => ids.map((id, index) => ({ id, ordinal: index + 1 })), [ids]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.id.display.toLowerCase().includes(q));
  }, [rows, query]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.ordinal === selectedOrdinal) ?? rows[0] ?? null,
    [rows, selectedOrdinal],
  );
  const breakdown = useMemo(() => (selectedRow ? describeId(selectedRow.id) : null), [selectedRow]);

  const copy = useCallback(async (text: string, detail: string) => {
    const ok = await copyText(text);
    if (ok) toast.success("Copied to clipboard", detail);
    else toast.error("Clipboard unavailable", "Select the identifier and copy it with ⌘C.");
  }, []);

  const copyAll = () => {
    if (ids.length === 0) return;
    void copy(ids.map((id) => id.display).join("\n"), `${plural(ids.length, "identifier")} · newline separated`);
  };

  const copyJson = () => {
    if (ids.length === 0) return;
    void copy(JSON.stringify(ids.map((id) => id.display), null, 2), `${ids.length} values · JSON array`);
  };

  const clearBatch = () => {
    setIds([]);
    setSelectedOrdinal(null);
    setQuery("");
  };

  const regenerateSelected = () => {
    if (!selectedRow) return;
    try {
      const fresh = createId(format, uuidOptions, nanoLength, nanoAlphabet);
      const target = selectedRow.ordinal - 1;
      setIds((prev) => prev.map((id, index) => (index === target ? fresh : id)));
      setSession((prev) => ({ ...prev, generated: prev.generated + 1 }));
    } catch (err) {
      toast.error("Could not mint an identifier", errorText(err));
    }
  };

  const validator = useMemo(() => validateId(validatorInput), [validatorInput]);

  const bufferCollision = collisionProbability(ids.length, entropyBits);
  const sessionCollision = collisionProbability(session.generated, entropyBits);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        const tag = active.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
        if (active.isContentEditable) return;
      }
      event.preventDefault();
      generate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [generate]);

  const columns: Column<BatchRow>[] = [
    {
      key: "ordinal",
      header: "#",
      width: 48,
      mono: true,
      render: (row) => (
        <span className="text-outline/80 tnum">{String(row.ordinal).padStart(3, "0")}</span>
      ),
    },
    {
      key: "display",
      header: "Identifier",
      render: (row) => (
        <span
          className="block font-mono text-[11.5px] leading-[16px] text-on-surface truncate select-all"
          title={row.id.display}
        >
          {row.id.display}
        </span>
      ),
    },
    {
      key: "format",
      header: "Type",
      width: 74,
      render: (row) => (
        <Badge tone={FORMAT_META[row.id.format].tone} mono className="h-[17px] px-1.5">
          {FORMAT_TAGS[row.id.format]}
        </Badge>
      ),
    },
    {
      key: "time",
      header: "Minted",
      width: 104,
      mono: true,
      hideBelow: "md",
      render: (row) => <span className="text-outline">{row.id.timeLabel}</span>,
    },
    {
      key: "entropy",
      header: "Entropy",
      width: 82,
      align: "right",
      mono: true,
      hideBelow: "lg",
      render: (row) => <span className="text-on-variant">{row.id.entropyBits} bit</span>,
    },
    {
      key: "actions",
      header: "",
      width: 40,
      align: "right",
      render: (row) => (
        <IconButton
          size="sm"
          label={`Copy identifier ${row.ordinal}`}
          icon={<Copy size={11} />}
          onClick={(event) => {
            event.stopPropagation();
            void copy(row.id.display, `Buffer index #${row.ordinal}`);
          }}
        />
      ),
    },
  ];

  const lastThroughput =
    session.lastMs > 0 ? `${number(session.lastCount / (session.lastMs / 1000))} ids/s` : "—";

  return (
    <ToolView
      eyebrow="IDENTIFIER FORGE"
      eyebrowTone="primary"
      eyebrowHint="CSPRNG · WEB CRYPTO"
      title="UUID Generator"
      description="Generate UUID v4, ULID, and NanoID identifiers in bulk with the right formatting."
      telemetry={[
        { label: "Generated", value: number(session.generated), tone: "success", icon: <Sparkles size={14} /> },
        { label: "Buffer", value: `${ids.length} / ${MAX_BATCH}`, tone: "primary", icon: <ListOrdered size={14} /> },
        { label: "Entropy", value: `${entropyBits} bit`, tone: "tertiary", icon: <ShieldCheck size={14} /> },
        {
          label: "Last batch",
          value: session.lastMs > 0 ? ms(session.lastMs, 1) : "—",
          tone: "neutral",
          icon: <Timer size={14} />,
        },
      ]}
      toolbar={
        <>
          <Button
            variant="primary"
            icon={<Bolt size={13} />}
            onClick={() => generate()}
            disabled={Boolean(alphabetError)}
            trailing={<Kbd>space</Kbd>}
          >
            Generate {count}
          </Button>
          <Button icon={<Copy size={13} />} onClick={copyAll} disabled={ids.length === 0}>
            Copy all
          </Button>
          <IconButton
            label="Copy batch as JSON array"
            icon={<FileJson size={13} />}
            onClick={copyJson}
            disabled={ids.length === 0}
          />
          <Button variant="ghost" icon={<Eraser size={13} />} onClick={clearBatch} disabled={ids.length === 0}>
            Clear
          </Button>
        </>
      }
      status={
        <>
          <Badge tone="success" dot pulse>
            Local CSPRNG
          </Badge>
          <Badge tone="neutral" mono>
            RFC 9562
          </Badge>
        </>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_312px] gap-3">
        <Card className="p-3 flex flex-col gap-2.5">
          <SectionLabel
            trailing={
              <span className="font-mono text-[10px] text-primary-soft">
                {entropyBits} bit entropy · 2^{entropyBits} keys
              </span>
            }
          >
            Algorithm &amp; bit architecture
          </SectionLabel>

          <SegmentedControl
            value={format}
            onChange={changeFormat}
            ariaLabel="Identifier format"
            size="md"
            options={FORMAT_OPTIONS}
          />

          {format === "uuid" && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Checkbox
                checked={uuidOptions.hyphens}
                onChange={(hyphens) => changeUuidOption({ hyphens })}
                label={<span className="font-mono text-[11.5px]">Hyphens</span>}
              />
              <span className="w-px h-3.5 bg-white/10 mx-1" aria-hidden />
              <Checkbox
                checked={uuidOptions.uppercase}
                onChange={(uppercase) => changeUuidOption({ uppercase })}
                label={<span className="font-mono text-[11.5px]">UPPERCASE</span>}
              />
              <span className="w-px h-3.5 bg-white/10 mx-1" aria-hidden />
              <Checkbox
                checked={uuidOptions.braces}
                onChange={(braces) => changeUuidOption({ braces })}
                label={<span className="font-mono text-[11.5px]">{"{ braces }"}</span>}
              />
              <span className="ml-auto font-mono text-[10px] text-outline">8-4-4-4-12 · 128 bit</span>
            </div>
          )}

          {format === "ulid" && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.055] bg-black/25 px-2.5 py-2">
              <span className="font-mono text-[10.5px] text-on-variant">
                TTTTTTTTTTRRRRRRRRRRRRRRRRRR
              </span>
              <span className="font-mono text-[10px] text-outline">10 time · 16 random · Crockford base32</span>
            </div>
          )}

          {format === "nanoid" && (
            <div className="grid grid-cols-1 sm:grid-cols-[112px_minmax(0,1fr)] gap-2">
              <div className="space-y-1">
                <label
                  htmlFor="nanoid-length"
                  className="text-[10px] font-semibold uppercase tracking-[0.08em] text-outline"
                >
                  Length
                </label>
                <Input
                  id="nanoid-length"
                  value={nanoLengthText}
                  onChange={(event) => setNanoLengthText(event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                  onBlur={() => setNanoLengthText(String(nanoLength))}
                  inputMode="numeric"
                  mono
                  sizeVariant="sm"
                  aria-label="NanoID length in symbols"
                  invalid={nanoLengthText.length > 0 && nanoLength < 1}
                />
              </div>
              <div className="space-y-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="nanoid-alphabet"
                    className="text-[10px] font-semibold uppercase tracking-[0.08em] text-outline"
                  >
                    Alphabet
                  </label>
                  <div className="flex items-center gap-1">
                    {NANOID_ALPHABETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setNanoAlphabet(preset.value)}
                        aria-pressed={nanoAlphabet === preset.value}
                        className={clsx(
                          "h-5 px-1.5 rounded-md border font-mono text-[9.5px] transition-colors",
                          nanoAlphabet === preset.value
                            ? "border-primary/40 bg-primary/15 text-primary-soft"
                            : "border-white/10 bg-white/[0.04] text-outline hover:text-on-surface",
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  id="nanoid-alphabet"
                  value={nanoAlphabet}
                  onChange={(event) => setNanoAlphabet(event.target.value.slice(0, 200))}
                  mono
                  sizeVariant="sm"
                  spellCheck={false}
                  aria-label="NanoID alphabet"
                  invalid={Boolean(alphabetError)}
                  trailingSlot={
                    <span className="font-mono text-[9.5px] text-outline tnum">{alphabetChars.length}</span>
                  }
                />
                {alphabetError && (
                  <p className="text-[10.5px] text-error leading-tight" role="alert">
                    {alphabetError}
                  </p>
                )}
              </div>
            </div>
          )}

          <p className="text-[10.5px] text-outline leading-relaxed border-t border-white/[0.05] pt-2">
            {FORMAT_META[format].note}
          </p>

          <div className="mt-auto grid grid-cols-3 gap-1.5">
            {specFacts.map((fact) => (
              <div
                key={fact.label}
                className="rounded-lg bg-black/25 border border-white/[0.05] px-2 py-1.5 min-w-0"
              >
                <div className="text-[9px] uppercase tracking-[0.08em] text-outline truncate">{fact.label}</div>
                <div className={clsx("font-mono text-[11px] truncate", fact.tone)} title={fact.value}>
                  {fact.value}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-3 flex flex-col gap-2.5">
          <SectionLabel
            trailing={
              <Badge tone="neutral" mono>
                1–500
              </Badge>
            }
          >
            Batch volume
          </SectionLabel>

          <div className="flex items-center gap-1.5">
            <IconButton
              label="Decrease batch size"
              icon={<Minus size={13} />}
              onClick={() => changeCount(count - 1)}
              disabled={count <= 1}
            />
            <input
              value={countText}
              onChange={(event) => setCountText(event.target.value.replace(/[^\d]/g, "").slice(0, 3))}
              onBlur={() => setCountText(String(count))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  generate();
                }
              }}
              inputMode="numeric"
              aria-label="Batch size, 1 to 500"
              className={clsx(CONTROL, "h-9 flex-1 min-w-0 text-center font-mono text-[15px] font-semibold tnum")}
            />
            <IconButton
              label="Increase batch size"
              icon={<Plus size={13} />}
              onClick={() => changeCount(count + 1)}
              disabled={count >= MAX_BATCH}
            />
          </div>

          <div className="grid grid-cols-4 gap-1">
            {SIZE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={count === preset}
                onClick={() => {
                  setCountText(String(preset));
                  generate({ count: preset });
                }}
                className={clsx(
                  "h-6 rounded-md border font-mono text-[10.5px] tnum transition-colors",
                  count === preset
                    ? "border-primary/40 bg-primary/15 text-primary-soft"
                    : "border-white/[0.07] bg-white/[0.035] text-on-variant hover:bg-white/[0.07] hover:text-on-surface",
                )}
              >
                {preset >= 1000 ? `${preset / 1000}k` : preset}
              </button>
            ))}
          </div>

          <div className="mt-auto space-y-1 border-t border-white/[0.05] pt-2 font-mono text-[10px] text-outline">
            <div className="flex items-center justify-between gap-2">
              <span>Throughput</span>
              <span className="text-on-variant">{lastThroughput}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Last batch</span>
              <span className="text-on-variant">
                {plural(session.lastCount, "id")} · {session.lastMs > 0 ? ms(session.lastMs, 2) : "warm"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Source</span>
              <span className="text-secondary">crypto.getRandomValues</span>
            </div>
          </div>
        </Card>
      </div>

      <Card className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
        />
        <CardHeader
          title="Selected identifier"
          hint={
            selectedRow && breakdown
              ? `${breakdown.kind} · buffer index #${selectedRow.ordinal}`
              : "Nothing selected"
          }
          icon={<Fingerprint size={13} />}
          actions={
            <>
              <Badge tone="success" mono>
                {entropyBits} bits
              </Badge>
              <Button
                size="xs"
                icon={<RefreshCw size={11} />}
                onClick={regenerateSelected}
                disabled={!selectedRow}
              >
                Remint
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Copy size={12} />}
                onClick={() => selectedRow && void copy(selectedRow.id.display, "Selected identifier")}
                disabled={!selectedRow}
              >
                Copy
              </Button>
            </>
          }
        />

        {selectedRow && breakdown ? (
          <div className="p-3 space-y-2.5">
            <div className="rounded-xl bg-black/40 border border-white/[0.06] px-3 py-2.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.55)] flex items-start gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.09em] text-outline">
                    Raw octets
                  </span>
                  <Badge tone={FORMAT_META[selectedRow.id.format].tone} mono className="h-4">
                    {FORMAT_LABELS[selectedRow.id.format]}
                  </Badge>
                  {selectedRow.id.display !== selectedRow.id.raw && (
                    <span className="font-mono text-[9.5px] text-outline">formatted view</span>
                  )}
                </div>
                <div className="font-mono text-[16px] leading-[24px] font-semibold tracking-tight text-primary-soft break-all select-all">
                  {selectedRow.id.display}
                </div>
              </div>
              <IconButton
                label="Copy selected identifier"
                icon={<Copy size={13} />}
                tone="primary"
                onClick={() => void copy(selectedRow.id.display, "Selected identifier")}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-1.5">
              {breakdown.cells.map((cell) => (
                <div
                  key={cell.label}
                  className="rounded-lg bg-white/[0.03] border border-white/[0.055] px-2 py-1.5 min-w-0"
                >
                  <div className="text-[9px] font-semibold uppercase tracking-[0.07em] text-outline truncate">
                    {cell.label}
                  </div>
                  <div className={clsx("font-mono text-[12px] font-semibold truncate", CELL_TONE[cell.tone])}>
                    {cell.value}
                  </div>
                  <div className="font-mono text-[9px] text-outline/80 truncate" title={cell.hint}>
                    {cell.hint}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-1">
              {breakdown.facts.map((fact) => (
                <div
                  key={fact.label}
                  className="flex items-baseline justify-between gap-2 border-t border-white/[0.05] pt-1 min-w-0"
                >
                  <span className="text-[10px] text-outline whitespace-nowrap">{fact.label}</span>
                  <span className="font-mono text-[10.5px] text-on-variant truncate" title={fact.value}>
                    {fact.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            compact
            icon={<Fingerprint size={16} />}
            title="No identifier selected"
            description="Generate a batch, then pick a row to inspect its version, variant and timestamp bits."
            action={
              <Button size="xs" variant="primary" icon={<Bolt size={11} />} onClick={() => generate()}>
                Generate {count}
              </Button>
            }
          />
        )}
      </Card>

      <Card className="flex flex-col min-h-0">
        <CardHeader
          title="Batch stream"
          hint={`${plural(ids.length, "identifier")} · ${FORMAT_LABELS[format]} · generated locally`}
          icon={<Hash size={13} />}
          actions={
            <>
              <span aria-live="polite" className="font-mono text-[10px] text-outline tnum">
                {query.trim() ? `${filtered.length} match` : `${ids.length} buffered`}
              </span>
              <div className="w-44">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter prefix…"
                  aria-label="Filter identifiers in the batch"
                  sizeVariant="sm"
                  mono
                  leading={<Search size={11} />}
                />
              </div>
            </>
          }
        />
        <DataTable<BatchRow>
          ariaLabel="Generated identifiers"
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.ordinal}
          activeKey={selectedRow?.ordinal ?? null}
          onRowClick={(row) => setSelectedOrdinal(row.ordinal)}
          maxHeight="404px"
          empty={
            <EmptyState
              compact
              icon={<Hash size={16} />}
              title={query.trim() ? "No identifier matches that prefix" : "Buffer is empty"}
              description={
                query.trim()
                  ? "Clear the filter to see the whole batch."
                  : "Generate a batch to fill the stream. Values live in memory only."
              }
              action={
                <Button
                  size="xs"
                  variant="primary"
                  icon={<Bolt size={11} />}
                  onClick={() => (query.trim() ? setQuery("") : generate())}
                >
                  {query.trim() ? "Clear filter" : "Generate"}
                </Button>
              }
            />
          }
          footer={
            <tr>
              <td colSpan={columns.length} className="px-2 h-7">
                <div className="flex items-center justify-between gap-3 font-mono text-[10px] text-outline">
                  <span>
                    {plural(filtered.length, "row")} · click a row to inspect · remint keeps entropy local
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <Kbd>space</Kbd> generate
                  </span>
                </div>
              </td>
            </tr>
          }
        />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-3">
        <Card className="p-3 space-y-2">
          <SectionLabel
            trailing={
              <Badge tone="neutral" mono>
                local check
              </Badge>
            }
          >
            Identifier validator
          </SectionLabel>
          <Input
            value={validatorInput}
            onChange={(event) => setValidatorInput(event.target.value)}
            placeholder="Paste a UUID, ULID or NanoID — e.g. 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
            aria-label="Identifier to validate"
            mono
            leading={<ShieldCheck size={12} />}
            invalid={validator ? !validator.valid : undefined}
            trailingSlot={
              validatorInput ? (
                <IconButton
                  size="sm"
                  label="Clear validator input"
                  icon={<Eraser size={11} />}
                  onClick={() => setValidatorInput("")}
                />
              ) : undefined
            }
          />

          <div aria-live="polite">
            {validator === null ? (
              <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-outline leading-relaxed">
                  Version and variant nibbles, ULID timestamp overflow and alphabet membership are checked
                  locally. Nothing leaves the app.
                </p>
                {ids.length > 0 && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setValidatorInput(ids[0]?.display ?? "")}
                    disabled={!ids[0]}
                  >
                    Use buffer sample
                  </Button>
                )}
              </div>
            ) : (
              <div
                className={clsx(
                  "rounded-lg border px-2.5 py-2 space-y-1.5",
                  validator.valid
                    ? "border-secondary/25 bg-secondary/[0.05]"
                    : "border-error/30 bg-error/[0.06]",
                )}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone={validator.valid ? "success" : "error"} dot mono>
                    {validator.valid ? "VALID" : "INVALID"}
                  </Badge>
                  <span className="font-mono text-[11px] text-on-surface">{validator.kind}</span>
                  {validator.canonical && (
                    <IconButton
                      size="sm"
                      label="Copy canonical identifier"
                      icon={<Copy size={11} />}
                      className="ml-auto"
                      onClick={() => void copy(validator.canonical ?? "", "Canonical form")}
                    />
                  )}
                </div>
                <p className="text-[11px] text-on-variant/85 leading-relaxed">{validator.reason}</p>
                {validator.canonical && (
                  <div className="font-mono text-[11px] text-on-surface break-all select-all">
                    {validator.canonical}
                  </div>
                )}
                {validator.details.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 pt-0.5">
                    {validator.details.map((detail) => (
                      <div key={detail.label} className="flex items-baseline justify-between gap-2 min-w-0">
                        <span className="text-[10px] text-outline whitespace-nowrap">{detail.label}</span>
                        <span className="font-mono text-[10.5px] text-on-variant truncate" title={detail.value}>
                          {detail.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-3 space-y-2">
          <SectionLabel
            trailing={
              <Badge tone="success" mono>
                nil risk
              </Badge>
            }
          >
            Entropy &amp; collision
          </SectionLabel>
          <div className="rounded-lg bg-black/30 border border-white/[0.055] divide-y divide-white/[0.05]">
            <div className="px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-[0.08em] text-outline">Keyspace</div>
              <div className="font-mono text-[12px] text-on-surface tnum">
                2^{entropyBits} ≈ {sci(keyspace)}
              </div>
              <div className="font-mono text-[9px] text-outline/80">states per identifier</div>
            </div>
            <div className="px-2.5 py-1.5 flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[9px] uppercase tracking-[0.08em] text-outline">Buffer collision</div>
                <div className="font-mono text-[9px] text-outline/80">{plural(ids.length, "id")} in memory</div>
              </div>
              <span className="font-mono text-[11.5px] text-primary-soft tnum shrink-0">
                {collisionText(bufferCollision, ids.length)}
              </span>
            </div>
            <div className="px-2.5 py-1.5 flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[9px] uppercase tracking-[0.08em] text-outline">Session collision</div>
                <div className="font-mono text-[9px] text-outline/80">{plural(session.generated, "id")} minted</div>
              </div>
              <span className="font-mono text-[11.5px] text-secondary tnum shrink-0">
                {collisionText(sessionCollision, session.generated)}
              </span>
            </div>
          </div>
          <div className="space-y-1 font-mono text-[10px] text-outline">
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0">Layout</span>
              <span className="text-on-variant text-right">{FORMAT_META[format].fact}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Formatting</span>
              <span className="text-on-variant">
                {format === "uuid"
                  ? [uuidOptions.hyphens ? "hyphens" : "compact", uuidOptions.uppercase ? "upper" : "lower", uuidOptions.braces ? "braces" : "bare"].join(" · ")
                  : format === "nanoid"
                    ? `${nanoLength} chars · ${alphabetChars.length} symbols`
                    : "fixed · 26 chars"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Batches</span>
              <span className="text-on-variant tnum">{number(session.batches)}</span>
            </div>
          </div>
        </Card>
      </div>
    </ToolView>
  );
}
