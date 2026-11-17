import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  Check,
  Contrast,
  Copy,
  Crosshair,
  History,
  Info,
  Palette,
  Pipette,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "@/components/ui/Card";
import { Input } from "@/components/ui/Form";
import { EmptyState, ErrorNotice, InfoNotice, Progress } from "@/components/ui/Feedback";
import { toast } from "@/components/ui/Toast";
import { util } from "@/lib/api";
import { errorMessage, isTauri } from "@/lib/ipc";
import {
  bestTextOn,
  clamp,
  contrastRatio,
  cssHsl,
  cssHsv,
  cssOklch,
  cssRgb,
  hexToRgb,
  hslToRgb,
  normalizeRgb,
  oklchToRgb,
  relativeLuminance,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
  rgbToOklch,
  tonalRamp,
  type RGB,
} from "./color";

const DEFAULT_RGB: RGB = { r: 10, g: 132, b: 255 };
const RECENT_LIMIT = 12;

type ContrastTargetId = "black" | "white" | "custom";

interface ContrastTarget {
  id: ContrastTargetId;
  label: string;
  hex: string;
  rgb: RGB;
}

type RatioTone = "success" | "warning" | "error";

function ratioTone(ratio: number): RatioTone {
  if (ratio >= 4.5) return "success";
  if (ratio >= 3) return "warning";
  return "error";
}

function formatNumber(value: number, decimals: number): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : "0";
}

/* ---------------------------- local controls ---------------------------- */

function NumField({
  label,
  ariaLabel,
  value,
  decimals,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  decimals: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatNumber(value, decimals);

  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="flex items-baseline justify-between gap-1 min-w-0">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline truncate">{label}</span>
        {suffix && <span className="font-mono text-[8.5px] text-outline/70 shrink-0">{suffix}</span>}
      </span>
      <Input
        type="number"
        mono
        sizeVariant="sm"
        aria-label={ariaLabel}
        value={shown}
        min={min}
        max={max}
        step={step}
        inputMode="decimal"
        className="tnum"
        onFocus={() => setDraft(formatNumber(value, decimals))}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          const parsed = Number.parseFloat(raw);
          if (!Number.isFinite(parsed)) return;
          onChange(clamp(parsed, min ?? Number.NEGATIVE_INFINITY, max ?? Number.POSITIVE_INFINITY));
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function HexInput({
  value,
  ariaLabel,
  onChange,
  className,
}: {
  value: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Input
      mono
      sizeVariant="sm"
      aria-label={ariaLabel}
      value={draft ?? value}
      spellCheck={false}
      autoComplete="off"
      className={clsx("tnum", className)}
      onFocus={() => setDraft(value)}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        const parsed = hexToRgb(raw);
        if (parsed) onChange(rgbToHex(parsed));
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ColorSlider({
  label,
  ariaLabel,
  value,
  max,
  step,
  gradient,
  display,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: number;
  max: number;
  step: number;
  gradient: string;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">{label}</span>
        <span className="font-mono text-[10.5px] text-on-surface tnum">{display}</span>
      </div>
      <div className="relative flex items-center h-4">
        <div
          aria-hidden
          className="absolute inset-x-0 h-3 rounded-full border border-white/12 shadow-[inset_0_1px_2px_rgba(0,0,0,0.55)]"
          style={{ background: gradient }}
        />
        <input
          type="range"
          aria-label={ariaLabel}
          min={0}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className={clsx(
            "relative w-full h-4 appearance-none bg-transparent cursor-pointer",
            "[&::-webkit-slider-runnable-track]:h-3 [&::-webkit-slider-runnable-track]:bg-transparent",
            "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5",
            "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2",
            "[&::-webkit-slider-thumb]:border-[#0a0a0f] [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.8)]",
            "[&::-moz-range-track]:h-3 [&::-moz-range-track]:bg-transparent",
            "[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#0a0a0f]",
            "focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-2",
          )}
        />
      </div>
    </div>
  );
}

function PassPill({ label, threshold, pass, describe }: { label: string; threshold: string; pass: boolean; describe: string }) {
  return (
    <span
      title={`${describe}: ${pass ? "pass" : "fail"} at ${threshold}:1`}
      className={clsx(
        "inline-flex items-center gap-0.5 rounded px-1 h-[18px] font-mono text-[9.5px] border tnum",
        pass ? "text-[#8ff0a4] bg-secondary/10 border-secondary/25" : "text-[#ff8b81] bg-error/10 border-error/25",
      )}
    >
      {pass ? <Check size={8} aria-hidden /> : <X size={8} aria-hidden />}
      <span>{label}</span>
      <span className="opacity-60">{threshold}</span>
    </span>
  );
}

/* --------------------------------- view --------------------------------- */

export default function ColorPickerView() {
  const [rgb, setRgb] = useState<RGB>(DEFAULT_RGB);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [x, setX] = useState(760);
  const [y, setY] = useState(420);
  const [picking, setPicking] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [sample, setSample] = useState<{ hex: string; x: number; y: number; at: string } | null>(null);
  const [target, setTarget] = useState<ContrastTargetId>("black");
  const [customHex, setCustomHex] = useState("#131319");

  const hex = rgbToHex(rgb);
  const hsl = rgbToHsl(rgb);
  const hsv = rgbToHsv(rgb);
  const oklch = rgbToOklch(rgb);
  const luminance = relativeLuminance(rgb);
  const swatchText = bestTextOn(rgb);

  // Achromatic colors have no measurable hue; keep the last meaningful one so
  // the hue slider does not snap to 0 when saturation or chroma reaches zero.
  const hueAnchor = useRef(hsl.h);
  useEffect(() => {
    if (hsl.s > 0.5) hueAnchor.current = hsl.h;
  }, [hsl.h, hsl.s]);
  const hue = hsl.s > 0.5 ? hsl.h : hueAnchor.current;

  const ramp = useMemo(() => tonalRamp(rgb), [rgb]);

  const contrastTargets = useMemo<ContrastTarget[]>(() => {
    const customRgb = hexToRgb(customHex) ?? { r: 19, g: 19, b: 25 };
    return [
      { id: "black", label: "Black", hex: "#000000", rgb: { r: 0, g: 0, b: 0 } },
      { id: "white", label: "White", hex: "#FFFFFF", rgb: { r: 255, g: 255, b: 255 } },
      { id: "custom", label: "Custom", hex: customHex, rgb: customRgb },
    ];
  }, [customHex]);

  const activeTarget = contrastTargets.find((entry) => entry.id === target) ?? contrastTargets[0];
  const activeRatio = contrastRatio(rgb, activeTarget.rgb);
  const activeTone = ratioTone(activeRatio);

  const remember = useCallback((value: string) => {
    setRecent((previous) => [value, ...previous.filter((entry) => entry !== value)].slice(0, RECENT_LIMIT));
  }, []);

  const selectRgb = useCallback(
    (next: RGB, rememberIt = true) => {
      const normalized = normalizeRgb(next);
      setRgb(normalized);
      setHexDraft(null);
      if (rememberIt) remember(rgbToHex(normalized));
    },
    [remember],
  );

  const editHex = (raw: string) => {
    setHexDraft(raw);
    const parsed = hexToRgb(raw);
    if (parsed) setRgb(parsed);
  };

  const settleHex = () => {
    if (hexDraft !== null && hexToRgb(hexDraft) === null) {
      toast.warning("Invalid hex", "Expected #RGB or #RRGGBB — the previous color is kept.");
    }
    setHexDraft(null);
    remember(hex);
  };

  const copy = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`, value);
    } catch {
      toast.error("Clipboard unavailable", "The system clipboard rejected the write.");
    }
  }, []);

  const pick = useCallback(async () => {
    if (!isTauri) {
      setSampleError("This tool needs the native app. Launch it with `npm run app`.");
      return;
    }
    const px = Math.round(x);
    const py = Math.round(y);
    setPicking(true);
    setSampleError(null);
    try {
      const pixel = await util.samplePixel(px, py);
      const next = normalizeRgb({ r: pixel.r, g: pixel.g, b: pixel.b });
      const sampledHex = rgbToHex(next);
      setRgb(next);
      setHexDraft(null);
      setSample({
        hex: sampledHex,
        x: px,
        y: py,
        at: new Date().toLocaleTimeString("en-GB", { hour12: false }),
      });
      remember(sampledHex);
      toast.success(`Sampled ${sampledHex}`, `x ${px} · y ${py}`);
    } catch (err) {
      setSampleError(errorMessage(err));
    } finally {
      setPicking(false);
    }
  }, [remember, x, y]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        void pick();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick]);

  const formats = useMemo(
    () => [
      { label: "HEX", value: hex },
      { label: "RGB", value: cssRgb(rgb) },
      { label: "HSL", value: cssHsl(rgb) },
      { label: "OKLCH", value: cssOklch(rgb) },
      { label: "HSV", value: cssHsv(rgb) },
    ],
    [hex, rgb],
  );

  const hueGradient = useMemo(
    () =>
      `linear-gradient(to right, ${Array.from({ length: 13 }, (_, index) => `hsl(${index * 30} 88% ${clamp(hsl.l, 42, 62)}%)`).join(", ")})`,
    [hsl.l],
  );
  const saturationGradient = `linear-gradient(to right, hsl(${hue} 0% ${hsl.l}%), hsl(${hue} 100% ${hsl.l}%))`;
  const lightnessGradient = `linear-gradient(to right, #000000, hsl(${hue} ${hsl.s}% 50%), #FFFFFF)`;

  return (
    <ToolView
      eyebrow="COLOR SPACE"
      eyebrowTone="tertiary"
      eyebrowHint="sRGB · OKLCH · WCAG 2.2"
      title="Color Picker"
      description="Sample any pixel on screen and convert between HEX, RGB, HSL, and OKLCH."
      telemetry={[
        {
          label: "Active",
          value: hex,
          tone: "primary",
          icon: (
            <span
              aria-hidden
              className="block w-3 h-3 rounded-full ring-1 ring-white/35"
              style={{ background: hex }}
            />
          ),
        },
        {
          label: `vs ${activeTarget.label}`,
          value: `${activeRatio.toFixed(2)}:1`,
          tone: activeTone,
          icon: <Contrast size={14} />,
        },
        {
          label: "Session swatches",
          value: `${recent.length}/${RECENT_LIMIT}`,
          tone: "neutral",
          icon: <History size={14} />,
        },
      ]}
      toolbar={
        <>
          <Button
            variant="primary"
            icon={<Pipette size={13} />}
            loading={picking}
            onClick={() => void pick()}
            trailing={<Kbd>⌥P</Kbd>}
          >
            Pick screen color
          </Button>
          <Button icon={<Copy size={13} />} onClick={() => void copy("HEX", hex)}>
            Copy HEX
          </Button>
        </>
      }
      status={
        <>
          <Badge tone={isTauri ? "success" : "warning"} mono dot>
            {isTauri ? "screen capture ready" : "native app required"}
          </Badge>
          <IconButton label="Copy current hex value" icon={<Copy size={13} />} onClick={() => void copy("HEX", hex)} />
        </>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-start">
        {/* ------------------------------- inspector ------------------------------ */}
        <div className="xl:col-span-7 flex flex-col gap-3 min-w-0">
          <Card>
            <CardHeader
              title="Active color"
              hint="Editing any channel re-derives every other space"
              icon={<Palette size={13} />}
              actions={
                <Badge tone="primary" mono>
                  {hex}
                </Badge>
              }
            />
            <div className="p-3 flex flex-col sm:flex-row gap-3">
              <div className="sm:w-[236px] shrink-0 space-y-1.5">
                <div
                  className="relative aspect-square rounded-xl border border-white/12 overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                  style={{ background: hex }}
                >
                  <div className="absolute inset-0 flex flex-col justify-between p-2.5">
                    <div className="flex items-center justify-between gap-1 font-mono text-[9px]">
                      <span className="px-1.5 py-0.5 rounded-full bg-black/35 backdrop-blur-sm text-white/85">sRGB</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-black/35 backdrop-blur-sm text-white/85 tnum">
                        Y {luminance.toFixed(3)}
                      </span>
                    </div>
                    <div className="space-y-1">
                      <input
                        aria-label="Hex color value"
                        value={hexDraft ?? hex}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(event) => editHex(event.target.value)}
                        onFocus={(event) => {
                          setHexDraft(hex);
                          event.currentTarget.select();
                        }}
                        onBlur={settleHex}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                        className="w-full rounded-md bg-black/20 px-2 py-1 font-mono text-[19px] font-semibold leading-7 tracking-tight outline-none focus:ring-1 focus:ring-white/45 tnum"
                        style={{ color: swatchText }}
                      />
                      <div
                        className="px-0.5 font-mono text-[9.5px] leading-tight opacity-80 tnum"
                        style={{ color: swatchText }}
                      >
                        {cssOklch(rgb)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 font-mono text-[9.5px] text-outline">
                  <span className="tnum">
                    HSV {hsv.h.toFixed(0)}° {hsv.s.toFixed(0)}% {hsv.v.toFixed(0)}%
                  </span>
                  <span className="truncate">{hsl.s < 0.5 ? "achromatic" : `${hsl.s.toFixed(0)}% sat`}</span>
                </div>
              </div>

              <div className="flex-1 min-w-0 space-y-2.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-outline">Hex</span>
                  <Input
                    mono
                    aria-label="Hex color input"
                    value={hexDraft ?? hex}
                    spellCheck={false}
                    autoComplete="off"
                    className="tnum"
                    onFocus={(event) => {
                      setHexDraft(hex);
                      event.currentTarget.select();
                    }}
                    onChange={(event) => editHex(event.target.value)}
                    onBlur={settleHex}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </label>

                <div role="group" aria-label="RGB channels">
                  <SectionLabel trailing={<span className="font-mono text-[9px] text-outline">0 – 255</span>}>RGB</SectionLabel>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <NumField
                      label="R"
                      ariaLabel="Red channel 0 to 255"
                      value={rgb.r}
                      decimals={0}
                      min={0}
                      max={255}
                      onChange={(value) => selectRgb({ ...rgb, r: value }, false)}
                    />
                    <NumField
                      label="G"
                      ariaLabel="Green channel 0 to 255"
                      value={rgb.g}
                      decimals={0}
                      min={0}
                      max={255}
                      onChange={(value) => selectRgb({ ...rgb, g: value }, false)}
                    />
                    <NumField
                      label="B"
                      ariaLabel="Blue channel 0 to 255"
                      value={rgb.b}
                      decimals={0}
                      min={0}
                      max={255}
                      onChange={(value) => selectRgb({ ...rgb, b: value }, false)}
                    />
                  </div>
                </div>

                <div role="group" aria-label="HSL channels">
                  <SectionLabel trailing={<span className="font-mono text-[9px] text-outline">degrees · %</span>}>
                    HSL
                  </SectionLabel>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <NumField
                      label="H"
                      ariaLabel="HSL hue degrees"
                      value={hue}
                      decimals={0}
                      min={0}
                      max={360}
                      onChange={(value) => selectRgb(hslToRgb({ h: value, s: hsl.s, l: hsl.l }), false)}
                    />
                    <NumField
                      label="S"
                      ariaLabel="HSL saturation percent"
                      value={hsl.s}
                      decimals={1}
                      min={0}
                      max={100}
                      step={0.5}
                      onChange={(value) => selectRgb(hslToRgb({ h: hue, s: value, l: hsl.l }), false)}
                    />
                    <NumField
                      label="L"
                      ariaLabel="HSL lightness percent"
                      value={hsl.l}
                      decimals={1}
                      min={0}
                      max={100}
                      step={0.5}
                      onChange={(value) => selectRgb(hslToRgb({ h: hue, s: hsl.s, l: value }), false)}
                    />
                  </div>
                </div>

                <div role="group" aria-label="OKLCH channels">
                  <SectionLabel trailing={<span className="font-mono text-[9px] text-outline">perceptual</span>}>
                    OKLCH
                  </SectionLabel>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <NumField
                      label="L"
                      ariaLabel="OKLCH lightness percent"
                      value={oklch.l * 100}
                      decimals={1}
                      min={0}
                      max={100}
                      step={0.5}
                      suffix="%"
                      onChange={(value) => selectRgb(oklchToRgb({ l: value / 100, c: oklch.c, h: oklch.h }), false)}
                    />
                    <NumField
                      label="C"
                      ariaLabel="OKLCH chroma"
                      value={oklch.c}
                      decimals={3}
                      min={0}
                      max={0.4}
                      step={0.005}
                      onChange={(value) => selectRgb(oklchToRgb({ l: oklch.l, c: value, h: oklch.h }), false)}
                    />
                    <NumField
                      label="H"
                      ariaLabel="OKLCH hue degrees"
                      value={oklch.h}
                      decimals={1}
                      min={0}
                      max={360}
                      onChange={(value) => selectRgb(oklchToRgb({ l: oklch.l, c: oklch.c, h: value }), false)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="HSL controls"
              hint="Continuous hue, saturation and lightness"
              icon={<SlidersHorizontal size={13} />}
              actions={
                <Badge tone="neutral" mono>
                  h {hue.toFixed(0)}° · s {hsl.s.toFixed(0)}% · l {hsl.l.toFixed(0)}%
                </Badge>
              }
            />
            <div className="p-3 space-y-2.5">
              <ColorSlider
                label="Hue"
                ariaLabel="Hue in degrees"
                value={hue}
                max={360}
                step={1}
                gradient={hueGradient}
                display={`${hue.toFixed(1)}°`}
                onChange={(value) => selectRgb(hslToRgb({ h: value, s: hsl.s, l: hsl.l }), false)}
              />
              <ColorSlider
                label="Saturation"
                ariaLabel="Saturation percent"
                value={hsl.s}
                max={100}
                step={0.5}
                gradient={saturationGradient}
                display={`${hsl.s.toFixed(1)}%`}
                onChange={(value) => selectRgb(hslToRgb({ h: hue, s: value, l: hsl.l }), false)}
              />
              <ColorSlider
                label="Lightness"
                ariaLabel="Lightness percent"
                value={hsl.l}
                max={100}
                step={0.5}
                gradient={lightnessGradient}
                display={`${hsl.l.toFixed(1)}%`}
                onChange={(value) => selectRgb(hslToRgb({ h: hue, s: hsl.s, l: value }), false)}
              />
              <div className="flex items-center justify-between gap-2 pt-0.5 font-mono text-[10px] text-outline">
                <span>Clamped once, at the 8-bit sRGB boundary</span>
                <span className="tnum">Y {luminance.toFixed(4)}</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Tint &amp; shade ramp"
              hint="9 OKLCH steps · hue held, chroma tapered"
              icon={<SlidersHorizontal size={13} />}
              actions={
                <Badge tone="tertiary" mono>
                  {hex}
                </Badge>
              }
            />
            <div className="p-3">
              <div className="grid grid-cols-9 gap-1.5" role="group" aria-label="Tint and shade ramp generated from the active color">
                {ramp.map((step) => {
                  const selected = step.hex === hex;
                  return (
                    <button
                      key={step.step}
                      type="button"
                      aria-label={`Select step ${step.step} ${step.hex}`}
                      aria-pressed={selected}
                      title={`${step.step} · ${step.hex} · L ${(step.l * 100).toFixed(1)}%`}
                      onClick={() => selectRgb(step.rgb)}
                      className="group flex flex-col items-center gap-1 min-w-0 focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-2 rounded-lg"
                    >
                      <span
                        className={clsx(
                          "block w-full h-12 rounded-lg border transition-transform duration-150 group-hover:scale-[1.04]",
                          selected ? "border-primary-soft ring-1 ring-primary/60" : "border-white/[0.08]",
                        )}
                        style={{ background: step.hex }}
                      />
                      <span
                        className={clsx(
                          "font-mono text-[9px] tnum transition-colors",
                          selected ? "text-primary-soft" : "text-outline group-hover:text-on-variant",
                        )}
                      >
                        {step.step}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Encodings"
              hint="Click a row to copy"
              icon={<Copy size={13} />}
              actions={
                <Badge tone="tertiary" mono>
                  CSS Color 4
                </Badge>
              }
            />
            <div className="p-3 space-y-1.5">
              {formats.map((format) => (
                <button
                  key={format.label}
                  type="button"
                  aria-label={`Copy ${format.label} value ${format.value}`}
                  onClick={() => void copy(format.label, format.value)}
                  className="group w-full flex items-center justify-between gap-3 h-9 px-2.5 rounded-lg bg-black/25 border border-white/[0.05] hover:bg-white/[0.06] hover:border-white/12 transition-colors focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-1"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className="w-12 shrink-0 text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">
                      {format.label}
                    </span>
                    <span className="font-mono text-[11.5px] text-on-surface truncate tnum">{format.value}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0 font-mono text-[9.5px] text-outline opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                    <Copy size={11} />
                    copy
                  </span>
                </button>
              ))}
              <div className="flex items-center justify-between gap-2 pt-0.5 font-mono text-[10px] text-outline">
                <span>oklch() is gamut-mapped into sRGB by chroma, never by clipping</span>
                <span className="tnum">{hsv.s.toFixed(0)}% HSV sat</span>
              </div>
            </div>
          </Card>
        </div>

        {/* -------------------------------- tooling ------------------------------- */}
        <div className="xl:col-span-5 flex flex-col gap-3 min-w-0">
          <Card>
            <CardHeader
              title="Pick from screen"
              hint="Absolute screen points · origin top-left"
              icon={<Crosshair size={13} />}
              actions={
                <Badge tone={isTauri ? "success" : "warning"} mono>
                  {isTauri ? "native capture" : "browser"}
                </Badge>
              }
            />
            <div className="p-3 space-y-2.5">
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <NumField
                  label="X"
                  ariaLabel="Screen X coordinate in points"
                  value={x}
                  decimals={0}
                  step={1}
                  suffix="pt"
                  onChange={setX}
                />
                <NumField
                  label="Y"
                  ariaLabel="Screen Y coordinate in points"
                  value={y}
                  decimals={0}
                  step={1}
                  suffix="pt"
                  onChange={setY}
                />
                <Button
                  variant="primary"
                  icon={<Crosshair size={13} />}
                  loading={picking}
                  onClick={() => void pick()}
                >
                  Pick pixel
                </Button>
              </div>

              <InfoNotice tone="warning" icon={<Info size={12} />}>
                macOS requires <span className="font-mono">Screen Recording</span> permission (System Settings → Privacy
                &amp; Security → Screen Recording). Coordinates are absolute points from the top-left of the main display;
                displays placed left of or above it use negative values.
              </InfoNotice>

              {picking && <Progress indeterminate label="Capturing a 1×1 screen pixel" />}

              {sampleError && (
                <ErrorNotice title="Pixel sample failed" message={sampleError} onRetry={() => void pick()} />
              )}

              {sample ? (
                <div className="flex items-center gap-2.5 rounded-lg border border-white/[0.07] bg-black/30 px-2.5 py-2">
                  <span
                    aria-hidden
                    className="w-9 h-9 rounded-md border border-white/15 shrink-0"
                    style={{ background: sample.hex }}
                  />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="font-mono text-[11.5px] text-on-surface tnum">{sample.hex}</div>
                    <div className="font-mono text-[9.5px] text-outline tnum">
                      x {sample.x} · y {sample.y} · {sample.at}
                    </div>
                  </div>
                  <IconButton
                    label={`Copy sampled hex ${sample.hex}`}
                    icon={<Copy size={12} />}
                    size="sm"
                    onClick={() => void copy("Sampled hex", sample.hex)}
                  />
                </div>
              ) : (
                !sampleError && (
                  <p className="text-[10.5px] leading-relaxed text-outline">
                    No sample yet. Enter a point and pick — the Rust core captures that 1×1 rect and returns sRGB.
                  </p>
                )
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Contrast checker"
              hint="WCAG 2.2 relative luminance"
              icon={<Contrast size={13} />}
              actions={
                <Badge tone={activeTone} mono>
                  <span aria-live="polite">{activeRatio.toFixed(2)}:1</span>
                </Badge>
              }
            />
            <div className="p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <SectionLabel>Targets</SectionLabel>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">Custom</span>
                  <div className="w-[92px]">
                    <HexInput
                      value={customHex}
                      ariaLabel="Custom contrast color hex"
                      onChange={setCustomHex}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                {contrastTargets.map((entry) => {
                  const ratio = contrastRatio(rgb, entry.rgb);
                  const tone = ratioTone(ratio);
                  const isActive = entry.id === target;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      aria-pressed={isActive}
                      aria-label={`Check contrast against ${entry.label} ${entry.hex}, ${ratio.toFixed(2)} to 1`}
                      onClick={() => setTarget(entry.id)}
                      className={clsx(
                        "w-full text-left rounded-lg border px-2.5 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-1",
                        isActive
                          ? "border-primary/45 bg-primary/[0.07]"
                          : "border-white/[0.06] bg-black/25 hover:bg-white/[0.04]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            aria-hidden
                            className="w-4 h-4 rounded border border-white/20 shrink-0"
                            style={{ background: entry.hex }}
                          />
                          <span className="font-mono text-[10.5px] text-on-surface truncate tnum">{entry.hex}</span>
                          <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">
                            {entry.label}
                          </span>
                        </span>
                        <span
                          className={clsx(
                            "font-mono text-[13px] font-semibold shrink-0 tnum",
                            tone === "success" ? "text-secondary" : tone === "warning" ? "text-warning" : "text-error",
                          )}
                        >
                          {ratio.toFixed(2)}:1
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <PassPill label="AA" threshold="4.5" pass={ratio >= 4.5} describe="AA normal text" />
                        <PassPill label="AAA" threshold="7" pass={ratio >= 7} describe="AAA normal text" />
                        <PassPill label="AA-L" threshold="3" pass={ratio >= 3} describe="AA large text" />
                        <PassPill label="AAA-L" threshold="4.5" pass={ratio >= 4.5} describe="AAA large text" />
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-lg border border-white/[0.08] overflow-hidden" style={{ background: activeTarget.hex }}>
                <div className="p-3" style={{ color: hex }}>
                  <p className="text-[15px] font-semibold leading-tight">Aa · Legible on this surface</p>
                  <p className="mt-0.5 text-[11px] leading-snug">
                    Body copy in {hex} measures {activeRatio.toFixed(2)}:1 against {activeTarget.hex}.
                  </p>
                  <span
                    className="mt-1.5 inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[9.5px]"
                    style={{ background: hex, color: swatchText }}
                  >
                    chip on {activeTarget.label.toLowerCase()}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Recent colors"
              hint="Session memory · max 12"
              icon={<History size={13} />}
              actions={
                <>
                  <IconButton
                    label="Save current color to recents"
                    icon={<Plus size={13} />}
                    size="sm"
                    onClick={() => remember(hex)}
                  />
                  <IconButton
                    label="Clear recent colors"
                    icon={<Trash2 size={13} />}
                    size="sm"
                    tone="danger"
                    disabled={recent.length === 0}
                    onClick={() => setRecent([])}
                  />
                </>
              }
            />
            <div className="p-3">
              {recent.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Palette size={16} />}
                  title="No colors yet"
                  description="Picked pixels, ramp steps and saved swatches land here."
                />
              ) : (
                <div className="grid grid-cols-6 gap-1.5">
                  {recent.map((value) => {
                    const current = value === hex;
                    return (
                      <button
                        key={value}
                        type="button"
                        title={value}
                        aria-label={`Use recent color ${value}`}
                        aria-pressed={current}
                        onClick={() => {
                          const parsed = hexToRgb(value);
                          if (parsed) selectRgb(parsed, false);
                        }}
                        className={clsx(
                          "h-8 rounded-md border transition-transform duration-150 hover:scale-[1.05] focus-visible:outline-2 focus-visible:outline-primary-soft focus-visible:outline-offset-2",
                          current ? "border-primary-soft ring-1 ring-primary/50" : "border-white/12",
                        )}
                        style={{ background: value }}
                      />
                    );
                  })}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[10px] text-outline">
                <span className="tnum">{recent.length}/12 in this session</span>
                <span>{recent.length > 0 ? "click to re-select" : "newest first"}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </ToolView>
  );
}
