import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  BookOpen,
  Check,
  Clock3,
  Copy,
  Eraser,
  FileText,
  FileUp,
  FolderOpen,
  Hash,
  Info,
  Layers,
  Play,
  X,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge, Dot, type Tone } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { CodeArea } from "@/components/ui/CodeArea";
import { DropZone } from "@/components/ui/DropZone";
import { EmptyState, ErrorNotice, InfoNotice, Skeleton, Spinner } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Form";
import { Tabs } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { security, system, util } from "@/lib/api";
import { errorMessage, isTauri } from "@/lib/ipc";
import { bytes, ms, number } from "@/lib/format";
import type { HashResult } from "@/lib/types";

type Mode = "text" | "file";

const ALGORITHMS = [
  {
    id: "md5",
    name: "MD5",
    short: "MD5",
    bits: 128,
    bytes: 16,
    tag: "Legacy",
    tone: "error",
    use: "Non-security checksums and old mirror manifests.",
  },
  {
    id: "sha1",
    name: "SHA-1",
    short: "1",
    bits: 160,
    bytes: 20,
    tag: "Deprecated",
    tone: "warning",
    use: "Git object IDs and legacy release manifests.",
  },
  {
    id: "sha256",
    name: "SHA-256",
    short: "256",
    bits: 256,
    bytes: 32,
    tag: "Recommended",
    tone: "primary",
    use: "Release checksums, signatures, API payloads.",
  },
  {
    id: "sha512",
    name: "SHA-512",
    short: "512",
    bits: 512,
    bytes: 64,
    tag: "High entropy",
    tone: "neutral",
    use: "Long-lived archives and high-assurance integrity.",
  },
  {
    id: "blake3",
    name: "BLAKE3",
    short: "B3",
    bits: 256,
    bytes: 32,
    tag: "Fastest",
    tone: "success",
    use: "Fast local integrity checks on large files.",
  },
] as const;

type AlgoId = (typeof ALGORITHMS)[number]["id"];
type AlgoTone = (typeof ALGORITHMS)[number]["tone"];

const SAMPLE_TEXT = "The quick brown fox jumps over the lazy dog";
const DEFAULT_ALGOS: AlgoId[] = ["sha256", "sha512"];
const DEBOUNCE_MS = 250;

const TONE_SWATCH: Record<AlgoTone, string> = {
  error: "bg-error/12 text-error border-error/25",
  warning: "bg-warning/12 text-[#ffe066] border-warning/25",
  primary: "bg-primary/14 text-primary-soft border-primary/30",
  neutral: "bg-white/[0.06] text-on-variant border-white/12",
  success: "bg-secondary/12 text-[#8ff0a4] border-secondary/25",
};

const BADGE_TONE: Record<AlgoTone, Tone> = {
  error: "error",
  warning: "warning",
  primary: "primary",
  neutral: "neutral",
  success: "success",
};

function canonicalDigest(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeAlgorithm(value: string): string {
  return value.toLowerCase().replace(/[-_\s]/g, "");
}

function resultFor(results: HashResult[], id: string): HashResult | undefined {
  return results.find((entry) => normalizeAlgorithm(entry.algorithm) === normalizeAlgorithm(id));
}

function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function CopyDigest({ value, name }: { value: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Copy failed", "Clipboard access was denied.");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? `${name} digest copied` : `Copy ${name} digest`}
      className={clsx(
        "inline-flex items-center gap-1 h-6 px-1.5 rounded-md border text-[10px] font-medium shrink-0 transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-2",
        copied
          ? "border-secondary/35 bg-secondary/12 text-secondary"
          : "border-white/10 bg-white/[0.05] text-on-variant hover:text-on-surface hover:bg-white/[0.1]",
      )}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function DigestRow({
  meta,
  value,
  expected,
  onExpected,
}: {
  meta: (typeof ALGORITHMS)[number];
  value: string;
  expected: string;
  onExpected: (value: string) => void;
}) {
  const match = expected.trim().length > 0 ? canonicalDigest(expected) === canonicalDigest(value) : null;

  return (
    <div className="flex flex-col xl:flex-row xl:items-start gap-2.5 px-3.5 py-2.5 border-b border-white/[0.045] last:border-b-0">
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <span
          className={clsx(
            "w-10 h-10 rounded-lg border flex items-center justify-center font-mono text-[10.5px] font-semibold shrink-0",
            TONE_SWATCH[meta.tone],
          )}
          aria-hidden
        >
          {meta.short}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] font-semibold text-on-surface">{meta.name}</span>
            <Badge tone={BADGE_TONE[meta.tone]}>{meta.tag}</Badge>
            <span className="font-mono text-[9.5px] text-outline">
              {meta.bits} bits · {meta.bytes} bytes
            </span>
          </div>
          <div className="flex items-start gap-1.5 min-w-0">
            <code
              className="flex-1 min-w-0 rounded-lg border border-white/[0.06] bg-black/35 px-2 py-1.5 font-mono text-[10.5px] leading-[16px] text-on-surface break-all select-all"
              title={value}
            >
              {value}
            </code>
            <CopyDigest value={value} name={meta.name} />
          </div>
        </div>
      </div>
      <div className="xl:w-[250px] shrink-0 space-y-1 xl:pl-1">
        <div className="flex items-center justify-between gap-2 h-4">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">Verify against</span>
          <span aria-live="polite">
            {match !== null && <Badge tone={match ? "success" : "error"} mono>{match ? "MATCH" : "MISMATCH"}</Badge>}
          </span>
        </div>
        <Input
          mono
          sizeVariant="sm"
          value={expected}
          onChange={(e) => onExpected(e.target.value)}
          placeholder="Paste expected digest"
          aria-label={`Expected ${meta.name} digest`}
          autoComplete="off"
          spellCheck={false}
          invalid={match === false}
          trailingSlot={
            expected.length > 0 ? (
              <IconButton
                size="sm"
                label={`Clear expected ${meta.name} digest`}
                icon={<X size={11} />}
                onClick={() => onExpected("")}
              />
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

export default function HashGeneratorView() {
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [probing, setProbing] = useState(false);
  const [selected, setSelected] = useState<Set<AlgoId>>(() => new Set(DEFAULT_ALGOS));
  const [results, setResults] = useState<HashResult[]>([]);
  const [verify, setVerify] = useState<Record<string, string>>({});
  const [hashing, setHashing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const requestSeq = useRef(0);
  const probeSeq = useRef(0);

  const selectedList = useMemo(() => ALGORITHMS.filter((meta) => selected.has(meta.id)), [selected]);
  const algorithmKey = selectedList.map((meta) => meta.id).join(",");
  const textBytes = useMemo(() => new TextEncoder().encode(text).length, [text]);
  const lineCount = text.length > 0 ? text.split("\n").length : 0;
  const hasInput = mode === "text" ? text.length > 0 : filePath !== null;

  const rows = useMemo(
    () =>
      selectedList
        .map((meta) => ({ meta, result: resultFor(results, meta.id) }))
        .filter((row): row is { meta: (typeof ALGORITHMS)[number]; result: HashResult } => row.result !== undefined),
    [selectedList, results],
  );

  useEffect(() => {
    if (mode !== "text") return;
    if (text.length === 0 || algorithmKey === "") {
      setResults([]);
      setHashing(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const seq = ++requestSeq.current;
    setHashing(true);
    setError(null);

    const timer = window.setTimeout(() => {
      const started = performance.now();
      void (async () => {
        try {
          const list = await security.hashText(text, algorithmKey.split(","));
          if (cancelled || seq !== requestSeq.current) return;
          setResults(list);
          setElapsedMs(performance.now() - started);
          setError(null);
        } catch (err) {
          if (cancelled || seq !== requestSeq.current) return;
          setResults([]);
          setError(errorMessage(err));
        } finally {
          if (!cancelled && seq === requestSeq.current) setHashing(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text, mode, algorithmKey, retryTick]);

  const toggleAlgorithm = (id: AlgoId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    requestSeq.current += 1;
    setHashing(false);
    setResults([]);
    setVerify({});
    setElapsedMs(null);
  };

  const changeMode = (next: Mode) => {
    if (next === mode) return;
    requestSeq.current += 1;
    setMode(next);
    setResults([]);
    setVerify({});
    setError(null);
    setHashing(false);
    setElapsedMs(null);
  };

  const selectFile = useCallback((paths: string[]) => {
    const path = paths[0];
    if (!path) return;
    setFilePath(path);
    setFileSize(null);
    setResults([]);
    setVerify({});
    setError(null);
    setElapsedMs(null);
    setProbing(true);

    const seq = ++probeSeq.current;
    void system
      .inspectBundle(path)
      .then((info) => {
        if (seq !== probeSeq.current) return;
        setFileSize(info.exists ? info.sizeBytes : null);
      })
      .catch(() => {
        if (seq === probeSeq.current) setFileSize(null);
      })
      .finally(() => {
        if (seq === probeSeq.current) setProbing(false);
      });
  }, []);

  const computeFile = useCallback(async () => {
    if (!filePath || algorithmKey === "") return;
    const seq = ++requestSeq.current;
    setHashing(true);
    setError(null);
    const started = performance.now();
    try {
      const list = await security.hashFile(filePath, algorithmKey.split(","));
      if (seq !== requestSeq.current) return;
      setResults(list);
      setElapsedMs(performance.now() - started);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setResults([]);
      setError(errorMessage(err));
    } finally {
      if (seq === requestSeq.current) setHashing(false);
    }
  }, [filePath, algorithmKey]);

  const clearFile = () => {
    requestSeq.current += 1;
    probeSeq.current += 1;
    setFilePath(null);
    setFileSize(null);
    setProbing(false);
    setResults([]);
    setVerify({});
    setError(null);
    setHashing(false);
    setElapsedMs(null);
  };

  const clearAll = () => {
    requestSeq.current += 1;
    probeSeq.current += 1;
    setText("");
    setFilePath(null);
    setFileSize(null);
    setProbing(false);
    setResults([]);
    setVerify({});
    setError(null);
    setHashing(false);
    setElapsedMs(null);
  };

  const revealFile = async () => {
    if (!filePath) return;
    try {
      await util.reveal(filePath);
    } catch (err) {
      toast.error("Reveal failed", errorMessage(err));
    }
  };

  const copyAll = async () => {
    if (rows.length === 0) return;
    const payload = rows.map((row) => `${row.meta.name}  ${row.result.value}`).join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      toast.success("Digests copied", `${rows.length} ${rows.length === 1 ? "line" : "lines"} on the clipboard`);
    } catch {
      toast.error("Copy failed", "Clipboard access was denied.");
    }
  };

  const canClear = hasInput || Object.values(verify).some((value) => value.length > 0);
  const verifyCount = Object.values(verify).filter((value) => value.trim().length > 0).length;

  return (
    <ToolView
      eyebrow="DIGEST ENGINE"
      eyebrowTone="tertiary"
      eyebrowHint="MD5 · SHA-1 · SHA-2 · BLAKE3"
      title="Hash Generator"
      description="Compute and verify MD5, SHA-1, SHA-256, SHA-512, and BLAKE3 digests for text or files."
      telemetry={[
        {
          label: "Input",
          value: mode === "text" ? bytes(textBytes, 0) : probing ? "…" : fileSize !== null ? bytes(fileSize) : "—",
          tone: "neutral",
          icon: <FileText size={14} />,
        },
        {
          label: "Algorithms",
          value: `${selectedList.length} / ${ALGORITHMS.length}`,
          tone: "primary",
          icon: <Layers size={14} />,
        },
        {
          label: "Round trip",
          value: elapsedMs !== null ? ms(elapsedMs, 2) : "—",
          tone: "success",
          icon: <Clock3 size={14} />,
        },
      ]}
      toolbar={
        <>
          {mode === "file" && (
            <Button
              variant="primary"
              icon={<Play size={13} />}
              loading={hashing}
              onClick={() => void computeFile()}
              disabled={!filePath || selectedList.length === 0}
            >
              {hashing ? "Hashing file…" : "Hash file"}
            </Button>
          )}
          <Button icon={<Eraser size={13} />} onClick={clearAll} disabled={!canClear}>
            Clear buffers
          </Button>
        </>
      }
      status={
        <>
          <Badge tone={mode === "text" ? "primary" : "tertiary"} dot>
            {mode === "text" ? "Text · live" : "File · explicit"}
          </Badge>
          <Badge tone="neutral" mono>
            {verifyCount > 0 ? `${verifyCount} verifying` : `${selectedList.length} of ${ALGORITHMS.length} selected`}
          </Badge>
        </>
      }
    >
      {!isTauri && (
        <InfoNotice tone="warning" icon={<Info size={12} />}>
          Browser preview: digest computation runs in the Rust core. Launch the native app to hash.
        </InfoNotice>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-3">
        <Card className="flex flex-col overflow-hidden min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2">
            <Tabs
              value={mode}
              onChange={changeMode}
              ariaLabel="Hash input source"
              className="border-b-0"
              items={[
                { value: "text", label: "Text", icon: <FileText size={12} /> },
                { value: "file", label: "File", icon: <FileUp size={12} /> },
              ]}
            />
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-outline pb-1">
              <Dot tone={mode === "text" ? "primary" : "neutral"} pulse={mode === "text"} />
              {mode === "text" ? "auto · 250 ms debounce" : "explicit run"}
            </span>
          </div>

          <div className="p-3.5 space-y-3">
            {mode === "text" ? (
              <div className="space-y-2">
                <CodeArea
                  value={text}
                  onChange={(value) => {
                    setText(value);
                    setResults([]);
                    setError(null);
                    setElapsedMs(null);
                  }}
                  minHeight={188}
                  ariaLabel="Text to hash"
                  wrap
                  placeholder="Paste or type the text buffer to digest…"
                  toolbar={
                    <>
                      <span className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">
                        <FileText size={11} /> UTF-8 input
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setText(SAMPLE_TEXT);
                          setResults([]);
                          setError(null);
                          setElapsedMs(null);
                        }}
                        className="text-[10px] font-mono text-primary-soft hover:text-primary transition-colors rounded px-1 focus-visible:outline-2 focus-visible:outline-primary-soft"
                      >
                        Load sample
                      </button>
                    </>
                  }
                />
                <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 font-mono text-[10.5px] text-outline" aria-live="polite">
                  <div className="flex items-center gap-3">
                    <span>
                      Chars <strong className="text-on-surface font-semibold tnum">{number(text.length)}</strong>
                    </span>
                    <span>
                      Lines <strong className="text-on-surface font-semibold tnum">{number(lineCount)}</strong>
                    </span>
                    <span>
                      Bytes <strong className="text-on-surface font-semibold tnum">{bytes(textBytes, 0)}</strong>
                    </span>
                  </div>
                  <span className="flex items-center gap-1.5">
                    <Dot tone={hashing ? "primary" : text.length > 0 ? "success" : "neutral"} pulse={hashing} />
                    {hashing ? "recomputing" : text.length > 0 ? "digested" : "idle"}
                  </span>
                </div>
              </div>
            ) : filePath ? (
              <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3 space-y-2.5">
                <div className="flex items-start gap-2.5 min-w-0">
                  <span className="w-9 h-9 rounded-lg bg-primary/12 border border-primary/25 text-primary-soft flex items-center justify-center shrink-0">
                    <FileText size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[12.5px] font-medium text-on-surface truncate">{fileName(filePath)}</span>
                      {probing ? (
                        <Spinner size={11} />
                      ) : fileSize !== null ? (
                        <Badge tone="neutral" mono>
                          {bytes(fileSize)}
                        </Badge>
                      ) : (
                        <Badge tone="warning" mono>
                          size unknown
                        </Badge>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-outline truncate" title={filePath}>
                      {filePath}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button icon={<FolderOpen size={12} />} size="sm" onClick={() => void revealFile()}>
                    Reveal in Finder
                  </Button>
                  <Button variant="ghost" icon={<X size={12} />} size="sm" onClick={clearFile} aria-label="Clear selected file">
                    Clear
                  </Button>
                  <span className="ml-auto font-mono text-[10px] text-outline">
                    {selectedList.length === 0 ? "no algorithms" : `${selectedList.length} algorithms · streamed in 128 KiB chunks`}
                  </span>
                </div>
              </div>
            ) : (
              <DropZone
                onPaths={selectFile}
                multiple={false}
                title="Drop any file to checksum"
                description="The Rust core streams the file in 128 KiB chunks — the UI never loads it into memory."
                icon={<FileUp size={18} />}
                className="min-h-[188px]"
              />
            )}

            <div className="space-y-1.5">
              <SectionLabel
                trailing={
                  <span className="font-mono text-[10px] text-outline">
                    {selectedList.length} / {ALGORITHMS.length} selected
                  </span>
                }
              >
                Algorithms
              </SectionLabel>
              <div role="group" aria-label="Hash algorithms" className="flex flex-wrap gap-1.5">
                {ALGORITHMS.map((meta) => {
                  const on = selected.has(meta.id);
                  return (
                    <label
                      key={meta.id}
                      className={clsx(
                        "inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full border text-[11px] font-medium cursor-pointer select-none transition-colors duration-150",
                        "focus-within:outline-2 focus-within:outline-primary-soft focus-within:outline-offset-2",
                        on
                          ? "bg-primary/12 border-primary/35 text-primary-soft"
                          : "bg-white/[0.04] border-white/10 text-on-variant hover:border-white/20",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleAlgorithm(meta.id)}
                        aria-label={`${on ? "Disable" : "Enable"} ${meta.name}`}
                        className="sr-only"
                      />
                      <span
                        aria-hidden
                        className={clsx(
                          "w-3 h-3 rounded-[3px] border flex items-center justify-center shrink-0",
                          on ? "bg-primary border-primary text-white" : "bg-black/30 border-white/25",
                        )}
                      >
                        {on && <Check size={9} strokeWidth={3} />}
                      </span>
                      <span className="font-mono">{meta.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-3 min-w-0">
          <Card className="flex flex-col overflow-hidden">
            <CardHeader title="Algorithm reference" hint="Which digest for which job" icon={<BookOpen size={13} />} />
            <div className="divide-y divide-white/[0.05]">
              {ALGORITHMS.map((meta) => (
                <div key={meta.id} className="flex items-start gap-2.5 px-3.5 py-2">
                  <span className={clsx("font-mono text-[10px] w-[58px] shrink-0 mt-0.5", meta.tone === "error" ? "text-error" : meta.tone === "warning" ? "text-warning" : meta.tone === "success" ? "text-secondary" : "text-on-variant")}>
                    {meta.name}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] leading-snug text-on-variant">{meta.use}</p>
                    <p className="font-mono text-[9.5px] text-outline mt-0.5">
                      {meta.bits} bits · {meta.bytes} bytes · {meta.tag}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-3 space-y-2">
            <SectionLabel trailing={<Badge tone="neutral" mono>{verifyCount > 0 ? `${verifyCount} set` : "none"}</Badge>}>
              Verification
            </SectionLabel>
            <InfoNotice tone="neutral" icon={<Info size={12} />}>
              Paste an expected digest beside any result. Comparison ignores case and whitespace; a match means the bytes
              are identical.
            </InfoNotice>
            <div className="rounded-lg bg-black/30 border border-white/[0.05] px-2.5 py-2 space-y-1 font-mono text-[10px] tnum">
              <div className="flex items-center justify-between gap-2">
                <span className="text-outline">Input</span>
                <span className="text-on-surface">
                  {mode === "text" ? `${number(textBytes)} B` : fileSize !== null ? bytes(fileSize) : "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-outline">Digests</span>
                <span className="text-on-surface">
                  {rows.length} of {selectedList.length}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-outline">Round trip</span>
                <span className={elapsedMs !== null ? "text-secondary" : "text-outline"}>
                  {elapsedMs !== null ? ms(elapsedMs, 2) : "—"}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card className="flex flex-col overflow-hidden">
        <CardHeader
          title="Cryptographic digests"
          hint={
            rows.length > 0
              ? `${rows.length} algorithms · ${mode === "text" ? "text input" : "file input"}`
              : mode === "text"
                ? "Updates 250 ms after the last keystroke"
                : "Run the selected file through the digester"
          }
          icon={<Hash size={13} />}
          actions={
            <>
              <Badge tone={hashing ? "primary" : "neutral"} dot pulse={hashing}>
                {hashing ? "Computing" : "Idle"}
              </Badge>
              <Button size="xs" icon={<Copy size={11} />} onClick={() => void copyAll()} disabled={rows.length === 0}>
                Copy all
              </Button>
            </>
          }
        />

        {error ? (
          <div className="p-3">
            <ErrorNotice
              title="Hashing failed"
              message={error}
              onRetry={() => {
                if (mode === "text") setRetryTick((tick) => tick + 1);
                else void computeFile();
              }}
            />
          </div>
        ) : !hasInput ? (
          <EmptyState
            compact
            icon={<Hash size={16} />}
            title="No input yet"
            description={
              mode === "text"
                ? "Type or paste text — digests appear 250 ms after the last keystroke."
                : "Drop a file above, then run it through the selected algorithms."
            }
          />
        ) : selectedList.length === 0 ? (
          <EmptyState
            compact
            icon={<Layers size={16} />}
            title="No algorithms selected"
            description="Enable at least one digest algorithm above to compute a hash."
          />
        ) : hashing && rows.length === 0 ? (
          <div className="p-3 space-y-2" aria-busy="true" aria-live="polite">
            <span className="sr-only">Computing digests…</span>
            <Skeleton className="h-[52px] w-full" />
            <Skeleton className="h-[52px] w-full" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={<Play size={16} />}
            title={mode === "file" ? "No digests for this file yet" : "Nothing computed"}
            description={
              mode === "file"
                ? "Press Hash file to stream the file through the Rust core."
                : "Add input to compute digests."
            }
            action={
              mode === "file" ? (
                <Button variant="primary" icon={<Play size={12} />} loading={hashing} onClick={() => void computeFile()}>
                  Hash file
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div aria-busy={hashing} className={clsx("transition-opacity duration-150", hashing && "opacity-55")}>
            {rows.map((row) => (
              <DigestRow
                key={row.meta.id}
                meta={row.meta}
                value={row.result.value}
                expected={verify[row.meta.id] ?? ""}
                onExpected={(value) => setVerify((prev) => ({ ...prev, [row.meta.id]: value }))}
              />
            ))}
          </div>
        )}
      </Card>
    </ToolView>
  );
}
