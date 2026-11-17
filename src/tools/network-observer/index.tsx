import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  Activity,
  Bluetooth,
  BluetoothSearching,
  Clock,
  Crosshair,
  Download,
  Eye,
  Info,
  Lock,
  Radar,
  Radio,
  RefreshCw,
  Router,
  Search,
  Settings2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { ToolView } from "@/components/layout/ToolView";
import {
  Badge,
  BarSeries,
  Button,
  Card,
  CardHeader,
  ColumnChart,
  CopyButton,
  DataTable,
  Dot,
  EmptyState,
  ErrorNotice,
  IconButton,
  InfoNotice,
  Input,
  Progress,
  SegmentedControl,
  Select,
  Spinner,
  Sparkline,
  StatTile,
  Switch,
  Tabs,
  toast,
  type Column,
  type TabItem,
} from "@/components/ui";
import { network, util } from "@/lib/api";
import { errorMessage } from "@/lib/ipc";
import { clockTime, plural, rssiQuality } from "@/lib/format";
import type { BluetoothDevice, WifiAp, WifiScanResult } from "@/lib/types";

/* ------------------------------- Constants ------------------------------- */

const AUTO_REFRESH_MS = 15_000;
const HISTORY_LIMIT = 24;

type Tab = "wifi" | "bluetooth";
type BandFilter = "all" | "2.4" | "5" | "6";
type BandKey = "2.4" | "5" | "6" | "unknown";
type MinSignal = "all" | "-50" | "-60" | "-70" | "-80";
type SecurityFilter = "all" | "open" | "wep" | "wpa2" | "wpa3" | "enterprise";
type BadgeTone = "neutral" | "primary" | "success" | "warning" | "error" | "tertiary";
type RssiTone = "success" | "primary" | "warning" | "error";

const BAND_OPTIONS: { value: BandFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "2.4", label: "2.4" },
  { value: "5", label: "5" },
  { value: "6", label: "6" },
];

const MIN_SIGNAL_OPTIONS: { value: MinSignal; label: string }[] = [
  { value: "all", label: "Any signal" },
  { value: "-50", label: "≥ -50 dBm" },
  { value: "-60", label: "≥ -60 dBm" },
  { value: "-70", label: "≥ -70 dBm" },
  { value: "-80", label: "≥ -80 dBm" },
];

const SECURITY_OPTIONS: { value: SecurityFilter; label: string }[] = [
  { value: "all", label: "Any security" },
  { value: "open", label: "Open / none" },
  { value: "wep", label: "WEP" },
  { value: "wpa2", label: "WPA2" },
  { value: "wpa3", label: "WPA3" },
  { value: "enterprise", label: "Enterprise" },
];

const RSSI_TEXT: Record<RssiTone, string> = {
  success: "text-[#8ff0a4]",
  primary: "text-primary-soft",
  warning: "text-[#ffe066]",
  error: "text-[#ff8b81]",
};

const RSSI_BAR: Record<RssiTone, string> = {
  success: "#30d158",
  primary: "#0a84ff",
  warning: "#ffd60a",
  error: "#ff453a",
};

/* -------------------------------- Helpers -------------------------------- */

function apBand(ap: WifiAp): BandKey {
  const raw = (ap.band ?? "").toLowerCase();
  if (raw.includes("6")) return "6";
  if (raw.includes("5")) return "5";
  if (raw.includes("2")) return "2.4";
  if (ap.channel !== null) {
    if (ap.channel <= 14) return "2.4";
    if (ap.channel <= 196) return "5";
    return "6";
  }
  return "unknown";
}

function bandTone(key: BandKey): BadgeTone {
  if (key === "6") return "tertiary";
  if (key === "5") return "primary";
  return "neutral";
}

function bandLabel(key: BandKey): string {
  return key === "unknown" ? "—" : `${key} GHz`;
}

function securityTone(security: string | null): BadgeTone {
  if (!security) return "neutral";
  const s = security.toLowerCase();
  if (s.includes("open") || s.includes("none") || s.includes("wep")) return "error";
  if (s.includes("wpa3")) return "success";
  if (s.includes("wpa2")) return "primary";
  if (s.includes("enterprise") || s.includes("802.1x")) return "primary";
  if (s.includes("wpa")) return "warning";
  return "neutral";
}

function securityMatches(security: string | null, filter: SecurityFilter): boolean {
  if (filter === "all") return true;
  const s = (security ?? "").toLowerCase();
  switch (filter) {
    case "open":
      return !security || s.includes("open") || s.includes("none");
    case "wep":
      return s.includes("wep");
    case "wpa2":
      return s.includes("wpa2");
    case "wpa3":
      return s.includes("wpa3");
    case "enterprise":
      return s.includes("enterprise") || s.includes("802.1x") || s.includes("eap");
    default:
      return true;
  }
}

/** Stable row identity: BSSID when present, otherwise a composite fingerprint. */
function apKey(ap: WifiAp): string {
  return ap.bssid ?? `${ap.ssid ?? "hidden"}|${ap.channel ?? "?"}|${ap.vendor ?? "?"}`;
}

/** RSSI trend is tracked per network name so mesh BSSIDs share one series. */
function historyKey(ap: WifiAp): string {
  return ap.ssid ?? ap.bssid ?? "unknown";
}

function fileStamp(iso: string | null): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return String(Date.now());
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(result: WifiScanResult): string {
  const header = [
    "ssid",
    "bssid",
    "rssi_dbm",
    "noise_dbm",
    "snr_db",
    "channel",
    "band",
    "width_mhz",
    "phy_mode",
    "security",
    "vendor",
    "hidden",
  ];
  const rows = result.aps.map((ap) =>
    [
      ap.ssid ?? "",
      ap.bssid ?? "",
      ap.rssi,
      ap.noise,
      ap.snr,
      ap.channel,
      ap.band ?? "",
      ap.widthMhz,
      ap.phyMode ?? "",
      ap.security ?? "",
      ap.vendor ?? "",
      ap.hidden,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

function downloadFile(filename: string, mime: string, contents: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function SignalMeter({ rssi }: { rssi: number | null }) {
  if (rssi === null) {
    return (
      <span className="font-mono text-[11px] text-outline" title="Signal strength unavailable">
        —
      </span>
    );
  }
  const quality = rssiQuality(rssi);
  const width = Math.max(4, Math.min(100, ((rssi + 100) / 70) * 100));
  return (
    <div className="flex items-center justify-end gap-2" title={`${Math.round(rssi)} dBm · ${quality.label}`}>
      <span className={clsx("font-mono text-[11px] font-semibold tnum", RSSI_TEXT[quality.tone])}>
        {Math.round(rssi)} dBm
      </span>
      <span className="h-1 w-9 shrink-0 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <span
          className="block h-full rounded-full transition-[width] duration-200"
          style={{ width: `${width}%`, backgroundColor: RSSI_BAR[quality.tone] }}
        />
      </span>
    </div>
  );
}

/* --------------------------------- View ---------------------------------- */

export default function NetworkObserverView() {
  const [tab, setTab] = useState<Tab>("wifi");

  const [wifi, setWifi] = useState<WifiScanResult | null>(null);
  const [history, setHistory] = useState<Record<string, number[]>>({});
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [devices, setDevices] = useState<BluetoothDevice[] | null>(null);
  const [btScanning, setBtScanning] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);
  const [btScannedAt, setBtScannedAt] = useState<string | null>(null);

  const [band, setBand] = useState<BandFilter>("all");
  const [minSignal, setMinSignal] = useState<MinSignal>("all");
  const [security, setSecurity] = useState<SecurityFilter>("all");
  const [query, setQuery] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const inFlight = useRef(false);
  const btRequested = useRef(false);

  const scanWifi = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setScanning(true);
    setError(null);
    try {
      const result = await network.wifiScan();
      setWifi(result);
      setHistory((prev) => {
        const samples = new Map<string, number>();
        for (const ap of result.aps) {
          if (ap.rssi === null) continue;
          const key = historyKey(ap);
          const current = samples.get(key);
          if (current === undefined || ap.rssi > current) samples.set(key, ap.rssi);
        }
        const next: Record<string, number[]> = {};
        for (const [key, rssi] of samples) {
          next[key] = [...(prev[key] ?? []), rssi].slice(-HISTORY_LIMIT);
        }
        return next;
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setScanning(false);
      setLoading(false);
    }
  }, []);

  // macOS gates the neighbour-AP list behind Location Services. This opens the
  // exact Privacy pane so the user can grant it without hunting through Settings.
  const openLocationSettings = useCallback(async () => {
    try {
      await util.openPrivacySettings("location");
      toast.info(
        "Location settings opened",
        "Enable shift-tools under Location Services, then quit and reopen the app for the change to apply.",
      );
    } catch (err) {
      toast.error("Could not open System Settings", errorMessage(err));
    }
  }, []);

  // Ask CoreLocation for permission (this is what makes macOS list shift-tools
  // under Location Services). If the decision was already made, no prompt is
  // shown, so fall back to opening the pane where it can be flipped.
  const grantLocation = useCallback(async () => {
    try {
      const status = await util.requestLocationPermission();
      if (status.startsWith("denied") || status.startsWith("restricted")) {
        await util.openPrivacySettings("location");
        toast.warning(
          "Location access was previously refused",
          `macOS reports "${status}". Toggle shift-tools on in the pane that just opened, then quit and reopen the app.`,
        );
        return;
      }
      toast.info(
        "Location permission requested",
        "Allow shift-tools in the macOS prompt, then quit and reopen the app so the next scan can read SSIDs.",
      );
    } catch (err) {
      toast.error("Could not request Location permission", errorMessage(err));
    }
  }, []);

  const scanBluetooth = useCallback(async () => {
    btRequested.current = true;
    setBtScanning(true);
    setBtError(null);
    try {
      const list = await network.bluetooth();
      setDevices(list);
      setBtScannedAt(new Date().toISOString());
    } catch (err) {
      setBtError(errorMessage(err));
    } finally {
      setBtScanning(false);
    }
  }, []);

  useEffect(() => {
    void scanWifi();
  }, [scanWifi]);

  useEffect(() => {
    if (tab !== "bluetooth" || devices !== null || btRequested.current) return;
    btRequested.current = true;
    void scanBluetooth();
  }, [tab, devices, scanBluetooth]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      if (tab === "wifi") void scanWifi();
      else void scanBluetooth();
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, tab, scanWifi, scanBluetooth]);

  const aps = useMemo(() => wifi?.aps ?? [], [wifi]);
  const btDevices = useMemo(() => devices ?? [], [devices]);

  useEffect(() => {
    if (selectedKey === null) return;
    if (!aps.some((ap) => apKey(ap) === selectedKey)) setSelectedKey(null);
  }, [aps, selectedKey]);

  const strongest = useMemo(
    () =>
      aps.reduce<number | null>(
        (best, ap) => (ap.rssi === null ? best : best === null || ap.rssi > best ? ap.rssi : best),
        null,
      ),
    [aps],
  );

  const channelCount = useMemo(() => {
    const channels = new Set<number>();
    for (const ap of aps) if (ap.channel !== null) channels.add(ap.channel);
    return channels.size;
  }, [aps]);

  const hiddenCount = useMemo(() => aps.filter((ap) => ap.hidden || ap.ssid === null).length, [aps]);

  const avgSnr = useMemo(() => {
    const values = aps.map((ap) => ap.snr).filter((snr): snr is number => snr !== null);
    if (values.length === 0) return null;
    return Math.round(values.reduce((sum, snr) => sum + snr, 0) / values.length);
  }, [aps]);

  const bandSplit = useMemo(() => {
    const counts: Record<BandKey, number> = { "2.4": 0, "5": 0, "6": 0, unknown: 0 };
    for (const ap of aps) counts[apBand(ap)] += 1;
    return counts;
  }, [aps]);

  const channelBars = useMemo(() => {
    const counts = new Map<number, number>();
    for (const ap of aps) {
      if (ap.channel === null) continue;
      counts.set(ap.channel, (counts.get(ap.channel) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([channel, count]) => ({
        label: String(channel),
        value: count,
        tone: (count >= 5 ? "error" : count >= 3 ? "warning" : "primary") as "error" | "warning" | "primary",
      }));
  }, [aps]);

  const busiest = useMemo(
    () => channelBars.reduce<{ label: string; value: number } | null>((best, bar) => (!best || bar.value > best.value ? bar : best), null),
    [channelBars],
  );
  const busiestIndex = busiest ? channelBars.findIndex((bar) => bar.label === busiest.label) : null;

  const filteredAps = useMemo(() => {
    const q = query.trim().toLowerCase();
    const floor = minSignal === "all" ? null : Number(minSignal);
    return aps.filter((ap) => {
      if (band !== "all" && apBand(ap) !== band) return false;
      if (floor !== null && (ap.rssi === null || ap.rssi < floor)) return false;
      if (!securityMatches(ap.security, security)) return false;
      if (!q) return true;
      const fields = [ap.ssid, ap.bssid, ap.vendor, ap.security, ap.phyMode, ap.channel !== null ? String(ap.channel) : null];
      return fields.some((value) => value !== null && value.toLowerCase().includes(q));
    });
  }, [aps, band, minSignal, security, query]);

  const filteredDevices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return btDevices;
    return btDevices.filter((device) =>
      [device.name, device.address, device.vendor, device.kind].some(
        (value) => value !== null && value.toLowerCase().includes(q),
      ),
    );
  }, [btDevices, query]);

  const connectedCount = useMemo(() => btDevices.filter((device) => device.connected).length, [btDevices]);
  const btStrongest = useMemo(
    () =>
      btDevices.reduce<number | null>(
        (best, device) =>
          device.rssi === null ? best : best === null || device.rssi > best ? device.rssi : best,
        null,
      ),
    [btDevices],
  );
  const vendorCount = useMemo(
    () => new Set(btDevices.map((device) => device.vendor).filter((vendor): vendor is string => vendor !== null)).size,
    [btDevices],
  );

  const kindItems = useMemo(() => {
    const counts = new Map<string, number>();
    for (const device of btDevices) {
      const kind = device.kind?.trim() || "Unclassified";
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value]) => ({ label, value }));
  }, [btDevices]);

  const selectedAp = useMemo(
    () => (selectedKey === null ? null : (aps.find((ap) => apKey(ap) === selectedKey) ?? null)),
    [aps, selectedKey],
  );
  const selectedHistory = selectedAp ? (history[historyKey(selectedAp)] ?? []) : [];

  const hasFilters = query.trim() !== "" || band !== "all" || minSignal !== "all" || security !== "all";

  const resetFilters = () => {
    setQuery("");
    setBand("all");
    setMinSignal("all");
    setSecurity("all");
  };

  const handleScan = () => {
    if (tab === "wifi") void scanWifi();
    else void scanBluetooth();
  };

  const exportScan = useCallback(
    (format: "csv" | "json") => {
      if (!wifi) {
        toast.warning("Nothing to export", "Run a Wi-Fi scan first.");
        return;
      }
      const stamp = fileStamp(wifi.scannedAt);
      const filename = `wifi-scan-${stamp}.${format}`;
      if (format === "csv") {
        downloadFile(filename, "text/csv;charset=utf-8", buildCsv(wifi));
      } else {
        downloadFile(filename, "application/json;charset=utf-8", JSON.stringify(wifi, null, 2));
      }
      toast.success(`Exported ${plural(wifi.aps.length, "access point")}`, `${format.toUpperCase()} · ${filename}`);
    },
    [wifi],
  );

  const scanActive = tab === "wifi" ? scanning : btScanning;
  const lastScanIso = tab === "wifi" ? (wifi?.scannedAt ?? null) : btScannedAt;

  const tabItems: TabItem<Tab>[] = [
    { value: "wifi", label: "Wi-Fi", icon: <Wifi size={12} />, count: aps.length },
    { value: "bluetooth", label: "Bluetooth", icon: <Bluetooth size={12} />, count: btDevices.length },
  ];

  const wifiColumns: Column<WifiAp>[] = [
    {
      key: "ssid",
      header: "SSID",
      sortable: true,
      sortValue: (ap) => ap.ssid ?? "",
      render: (ap) => (
        <div className="flex min-w-0 items-center gap-2 py-0.5">
          <Wifi
            size={12}
            className={clsx(
              "shrink-0",
              ap.rssi === null ? "text-outline" : RSSI_TEXT[rssiQuality(ap.rssi).tone],
            )}
          />
          <span
            className={clsx(
              "max-w-[210px] truncate text-[12px]",
              ap.ssid ? "text-on-surface" : "italic text-outline",
            )}
            title={ap.ssid ?? "Hidden network"}
          >
            {ap.ssid ?? "Hidden network"}
          </span>
          {(ap.hidden || ap.ssid === null) && (
            <Badge tone="warning" className="h-4 px-1.5">
              Hidden
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "rssi",
      header: "Signal",
      align: "right",
      width: 126,
      sortable: true,
      sortValue: (ap) => ap.rssi ?? -999,
      render: (ap) => <SignalMeter rssi={ap.rssi} />,
    },
    {
      key: "snr",
      header: "SNR",
      align: "right",
      mono: true,
      width: 58,
      hideBelow: "md",
      sortable: true,
      sortValue: (ap) => ap.snr ?? -999,
      render: (ap) =>
        ap.snr === null ? (
          <span className="text-outline">—</span>
        ) : (
          <span
            className={clsx(
              ap.snr >= 25 ? "text-[#8ff0a4]" : ap.snr >= 15 ? "text-[#ffe066]" : "text-[#ff8b81]",
            )}
          >
            {Math.round(ap.snr)} dB
          </span>
        ),
    },
    {
      key: "channel",
      header: "Channel",
      width: 106,
      sortable: true,
      sortValue: (ap) => ap.channel ?? -1,
      render: (ap) => (
        <div className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="font-mono text-[11px] text-on-surface tnum">
            {ap.channel === null ? "—" : `Ch ${ap.channel}`}
          </span>
          <span className="font-mono text-[9.5px] text-outline tnum">
            {ap.widthMhz === null ? "" : `${ap.widthMhz} MHz`}
          </span>
        </div>
      ),
    },
    {
      key: "band",
      header: "Band",
      width: 82,
      hideBelow: "md",
      render: (ap) => {
        const key = apBand(ap);
        return (
          <Badge tone={bandTone(key)} mono>
            {bandLabel(key)}
          </Badge>
        );
      },
    },
    {
      key: "security",
      header: "Security",
      width: 112,
      render: (ap) =>
        ap.security ? (
          <Badge tone={securityTone(ap.security)} title={ap.security}>
            <span className="max-w-[104px] truncate">{ap.security}</span>
          </Badge>
        ) : (
          <Badge tone="neutral">Unknown</Badge>
        ),
    },
    {
      key: "phyMode",
      header: "PHY",
      width: 96,
      hideBelow: "xl",
      render: (ap) => (
        <span className="block max-w-[110px] truncate font-mono text-[10.5px] text-on-variant" title={ap.phyMode ?? undefined}>
          {ap.phyMode ?? "—"}
        </span>
      ),
    },
    {
      key: "vendor",
      header: "Vendor",
      hideBelow: "lg",
      sortable: true,
      sortValue: (ap) => ap.vendor ?? "",
      render: (ap) => (
        <span className="block max-w-[142px] truncate text-[11px] text-on-variant" title={ap.vendor ?? undefined}>
          {ap.vendor ?? "—"}
        </span>
      ),
    },
    {
      key: "inspect",
      header: "",
      width: 34,
      align: "right",
      render: (ap) => (
        <IconButton
          label={`Inspect ${ap.ssid ?? "hidden network"}`}
          size="sm"
          icon={<Eye size={12} />}
          onClick={(event) => {
            event.stopPropagation();
            setSelectedKey(apKey(ap));
          }}
        />
      ),
    },
  ];

  const btColumns: Column<BluetoothDevice>[] = [
    {
      key: "name",
      header: "Device",
      sortable: true,
      sortValue: (device) => (device.name ?? "").toLowerCase(),
      render: (device) => (
        <div className="flex min-w-0 items-center gap-2 py-0.5">
          <Bluetooth size={12} className={device.connected ? "shrink-0 text-secondary" : "shrink-0 text-outline"} />
          <div className="min-w-0 leading-tight">
            <div className="max-w-[230px] truncate text-[12px] text-on-surface" title={device.name ?? undefined}>
              {device.name ?? "Unnamed device"}
            </div>
            <div className="max-w-[230px] truncate font-mono text-[9.5px] text-outline">
              {device.kind ?? "Class unknown"}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "address",
      header: "Address",
      mono: true,
      width: 150,
      sortable: true,
      sortValue: (device) => (device.address ?? "").toLowerCase(),
      render: (device) => <span className="text-on-variant">{device.address ?? "—"}</span>,
    },
    {
      key: "rssi",
      header: "Signal",
      align: "right",
      width: 126,
      sortable: true,
      sortValue: (device) => device.rssi ?? -999,
      render: (device) => <SignalMeter rssi={device.rssi} />,
    },
    {
      key: "vendor",
      header: "Vendor",
      hideBelow: "lg",
      sortable: true,
      sortValue: (device) => (device.vendor ?? "").toLowerCase(),
      render: (device) => (
        <span className="block max-w-[170px] truncate text-[11px] text-on-variant" title={device.vendor ?? undefined}>
          {device.vendor ?? "—"}
        </span>
      ),
    },
    {
      key: "state",
      header: "State",
      width: 104,
      align: "right",
      render: (device) => (
        <Badge tone={device.connected ? "success" : "neutral"} dot={device.connected}>
          {device.connected ? "Connected" : "Idle"}
        </Badge>
      ),
    },
  ];

  const metaRows = [
    { label: "Source", value: wifi?.source ?? "—" },
    { label: "Interface", value: wifi?.interface ?? "—" },
    { label: "Scanned at", value: wifi ? clockTime(wifi.scannedAt) : "—" },
    { label: "Access points", value: String(aps.length) },
    { label: "Hidden SSIDs", value: String(hiddenCount) },
    { label: "SSIDs redacted", value: wifi ? (wifi.redacted ? "Yes" : "No") : "—" },
    { label: "Average SNR", value: avgSnr === null ? "—" : `${avgSnr} dB` },
    { label: "Strongest", value: strongest === null ? "—" : `${Math.round(strongest)} dBm` },
  ];

  return (
    <ToolView
      eyebrow="PASSIVE SCAN"
      eyebrowTone="primary"
      eyebrowHint="COREWLAN · COREBLUETOOTH"
      title="Network Observer"
      description="Passive survey of nearby Wi-Fi access points and Bluetooth devices with vendor and channel analysis."
      telemetry={[
        { label: "Access points", value: aps.length, tone: "primary", icon: <Router size={14} /> },
        {
          label: "Strongest",
          value: strongest === null ? "—" : `${Math.round(strongest)} dBm`,
          tone: strongest === null ? "neutral" : rssiQuality(strongest).tone,
          icon: <Activity size={14} />,
        },
        { label: "Channels", value: channelCount, tone: "tertiary", icon: <Radio size={14} /> },
        { label: "Last scan", value: clockTime(wifi?.scannedAt ?? null), tone: "neutral", icon: <Clock size={14} /> },
      ]}
      toolbar={
        <>
          <Button
            variant="primary"
            icon={<Radar size={13} />}
            loading={scanActive}
            onClick={handleScan}
          >
            {tab === "wifi" ? "Scan Wi-Fi" : "Scan Bluetooth"}
          </Button>
          {tab === "wifi" && (
            <>
              <SegmentedControl<BandFilter>
                value={band}
                onChange={setBand}
                options={BAND_OPTIONS}
                ariaLabel="Filter access points by band"
              />
              <div className="w-[112px]">
                <Select
                  sizeVariant="sm"
                  value={minSignal}
                  onChange={(event) => setMinSignal(event.target.value as MinSignal)}
                  options={MIN_SIGNAL_OPTIONS}
                  aria-label="Minimum signal strength"
                />
              </div>
              <div className="w-[126px]">
                <Select
                  sizeVariant="sm"
                  value={security}
                  onChange={(event) => setSecurity(event.target.value as SecurityFilter)}
                  options={SECURITY_OPTIONS}
                  aria-label="Filter by security type"
                />
              </div>
            </>
          )}
          <div className="w-52">
            <Input
              sizeVariant="sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === "wifi" ? "Filter SSID, BSSID, vendor…" : "Filter name, address, vendor…"}
              aria-label="Filter devices"
              leading={<Search size={11} />}
            />
          </div>
          <span className="flex items-center gap-1.5 pl-1 text-[10.5px] text-outline">
            Auto 15s
            <Switch checked={autoRefresh} onChange={setAutoRefresh} label="Toggle 15 second auto refresh" size="sm" />
          </span>
        </>
      }
      status={
        <>
          <span aria-live="polite" className="flex items-center gap-1.5 font-mono text-[10px] text-outline">
            {scanActive ? (
              <>
                <Spinner size={10} /> scanning…
              </>
            ) : (
              <>last scan {clockTime(lastScanIso)}</>
            )}
          </span>
          <Badge tone="neutral" mono title="Wireless interface reported by the backend">
            {wifi?.interface ?? "—"}
          </Badge>
        </>
      }
    >
      {error && (
        <div className="space-y-2">
          <ErrorNotice title="Wi-Fi scan failed" message={error} onRetry={() => void scanWifi()} />
          {(/location|permission|privacy|not authorized|denied/i.test(error)) && (
            <div className="flex items-center justify-end gap-1.5">
              <Button size="xs" variant="ghost" onClick={() => void openLocationSettings()}>
                Open settings
              </Button>
              <Button size="xs" variant="warning" icon={<Settings2 size={11} />} onClick={() => void grantLocation()}>
                Grant Location access
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs<Tab> value={tab} onChange={setTab} items={tabItems} ariaLabel="Network observer data source" />
        <div className="flex items-center gap-1.5">
          <span aria-live="polite" className="font-mono text-[10px] text-outline">
            {tab === "wifi"
              ? `${plural(aps.length, "AP")} · ${plural(channelCount, "channel")}`
              : `${plural(btDevices.length, "device")} · ${connectedCount} connected`}
          </span>
        </div>
      </div>

      {tab === "wifi" ? (
        <>
          {wifi?.redacted && (
            <div className="flex flex-col gap-2 rounded-lg border border-warning/25 bg-warning/[0.06] px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between">
              <InfoNotice tone="warning" icon={<Lock size={12} />} className="border-0 bg-transparent p-0">
                macOS hides SSID names unless shift-tools has Location permission. Access points still appear by
                BSSID. Grant access in System Settings → Privacy &amp; Security → Location Services, then quit and
                reopen the app.
              </InfoNotice>
              <div className="flex shrink-0 items-center gap-1.5 self-start sm:self-auto">
                <Button size="xs" variant="warning" icon={<Settings2 size={11} />} onClick={() => void grantLocation()}>
                  Grant Location access
                </Button>
                <Button size="xs" variant="ghost" onClick={() => void openLocationSettings()}>
                  Open settings
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-w-0 flex-col gap-3">
              <Card className="overflow-hidden">
                <CardHeader
                  title="Access points"
                  hint={`${plural(filteredAps.length, "match", "matches")} · sorted by signal`}
                  icon={<Wifi size={13} />}
                  actions={
                    <>
                      <Badge tone="neutral" mono>
                        {filteredAps.length} / {aps.length}
                      </Badge>
                      <Button
                        size="xs"
                        icon={<Download size={11} />}
                        onClick={() => exportScan("csv")}
                        disabled={!wifi}
                        aria-label="Export current Wi-Fi scan as CSV"
                      >
                        CSV
                      </Button>
                      <Button
                        size="xs"
                        icon={<Download size={11} />}
                        onClick={() => exportScan("json")}
                        disabled={!wifi}
                        aria-label="Export current Wi-Fi scan as JSON"
                      >
                        JSON
                      </Button>
                    </>
                  }
                />
                {scanning && <Progress indeterminate label="Scanning Wi-Fi channels" height={2} />}
                <DataTable
                  ariaLabel="Nearby Wi-Fi access points"
                  columns={wifiColumns}
                  rows={filteredAps}
                  rowKey={(ap) => apKey(ap)}
                  activeKey={selectedKey}
                  onRowClick={(ap) => setSelectedKey(apKey(ap))}
                  initialSort={{ key: "rssi", dir: "desc" }}
                  maxHeight="560px"
                  empty={
                    <EmptyState
                      compact
                      icon={loading ? <Spinner size={16} /> : <WifiOff size={16} />}
                      title={
                        loading
                          ? "Scanning for access points…"
                          : aps.length === 0
                            ? error
                              ? "Survey unavailable"
                              : "No access points found"
                            : "No access point matches the filters"
                      }
                      description={
                        loading
                          ? "CoreWLAN is sweeping nearby 2.4, 5 and 6 GHz channels."
                          : aps.length === 0
                            ? error
                              ? "The backend did not return a survey. Retry above."
                              : "The scan returned an empty survey. Move closer to an access point and scan again."
                            : "Loosen the band, signal or security filters to widen the result."
                      }
                      action={
                        hasFilters ? (
                          <Button size="xs" onClick={resetFilters}>
                            Reset filters
                          </Button>
                        ) : undefined
                      }
                    />
                  }
                  footer={
                    <tr>
                      <td colSpan={wifiColumns.length} className="h-7 px-2">
                        <div className="flex items-center justify-between gap-3 font-mono text-[10px] text-outline">
                          <span className="truncate">
                            {plural(filteredAps.length, "access point")} · {plural(hiddenCount, "hidden SSID")} ·{" "}
                            {plural(channelBars.length, "channel")} in use
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <Dot tone={scanning ? "warning" : "success"} pulse={scanning} />
                            {scanning ? "sweeping channels" : "survey idle"}
                          </span>
                        </div>
                      </td>
                    </tr>
                  }
                />
              </Card>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
                <Card className="overflow-hidden">
                  <CardHeader
                    title="Channel congestion"
                    hint={`${plural(channelBars.length, "channel")} in use · 2.4 / 5 / 6 GHz`}
                    icon={<Radio size={13} />}
                    actions={
                      busiest ? (
                        <Badge tone={busiest.value >= 5 ? "error" : busiest.value >= 3 ? "warning" : "neutral"} mono>
                          Ch {busiest.label} · {plural(busiest.value, "AP")}
                        </Badge>
                      ) : (
                        <Badge tone="neutral" mono>
                          no data
                        </Badge>
                      )
                    }
                  />
                  <div className="space-y-3 p-3">
                    {channelBars.length > 0 ? (
                      <ColumnChart
                        bars={channelBars}
                        height={104}
                        highlightIndex={busiestIndex}
                        ariaLabel="Access points per Wi-Fi channel"
                      />
                    ) : (
                      <EmptyState
                        compact
                        icon={<Radio size={16} />}
                        title="No channel occupancy"
                        description="Channel distribution appears once a scan returns access points."
                      />
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-outline">
                      <span className="flex items-center gap-1.5">
                        <Dot tone="neutral" /> 2.4 GHz{" "}
                        <span className="text-on-variant tnum">{bandSplit["2.4"]}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Dot tone="primary" /> 5 GHz <span className="text-on-variant tnum">{bandSplit["5"]}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Dot tone="tertiary" /> 6 GHz <span className="text-on-variant tnum">{bandSplit["6"]}</span>
                      </span>
                      {bandSplit.unknown > 0 && (
                        <span className="flex items-center gap-1.5">
                          <Dot tone="neutral" /> unknown{" "}
                          <span className="text-on-variant tnum">{bandSplit.unknown}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </Card>

                <Card className="overflow-hidden">
                  <CardHeader
                    title="Scan metadata"
                    hint="CoreWLAN survey"
                    icon={<Info size={13} />}
                  />
                  <dl className="grid grid-cols-2 gap-2 p-3">
                    {metaRows.map((row) => (
                      <div
                        key={row.label}
                        className="min-w-0 rounded-lg border border-white/[0.05] bg-black/25 px-2 py-1.5"
                      >
                        <dt className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">
                          {row.label}
                        </dt>
                        <dd className="truncate font-mono text-[11px] text-on-surface tnum" title={row.value}>
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="px-3 pb-3">
                    <InfoNotice tone="neutral" icon={<Info size={12} />}>
                      Scans run locally through CoreWLAN. SSID redaction is a macOS privacy policy, not a scan failure.
                    </InfoNotice>
                  </div>
                </Card>
              </div>
            </div>

            <Card className="overflow-hidden xl:sticky xl:top-3">
              <CardHeader
                title="Access point"
                hint={selectedAp ? "Inspect RF telemetry" : "No selection"}
                icon={<Crosshair size={13} />}
                actions={
                  selectedAp ? (
                    <IconButton
                      label="Clear access point selection"
                      size="sm"
                      icon={<X size={12} />}
                      onClick={() => setSelectedKey(null)}
                    />
                  ) : undefined
                }
              />
              {selectedAp ? (
                <div className="space-y-3 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div
                        className={clsx(
                          "truncate text-[14px] font-semibold text-on-surface",
                          !selectedAp.ssid && "italic text-outline",
                        )}
                        title={selectedAp.ssid ?? "Hidden network"}
                      >
                        {selectedAp.ssid ?? "Hidden network"}
                      </div>
                      <div className="truncate font-mono text-[10px] text-outline">
                        {selectedAp.bssid ?? "BSSID unavailable"}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <Badge tone={bandTone(apBand(selectedAp))} mono>
                          {bandLabel(apBand(selectedAp))}
                        </Badge>
                        <Badge tone={securityTone(selectedAp.security)}>
                          <span className="max-w-[140px] truncate">{selectedAp.security ?? "Unknown"}</span>
                        </Badge>
                        {(selectedAp.hidden || selectedAp.ssid === null) && <Badge tone="warning">Hidden</Badge>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className={clsx(
                          "font-mono text-[24px] font-semibold leading-none tnum",
                          selectedAp.rssi === null ? "text-outline" : RSSI_TEXT[rssiQuality(selectedAp.rssi).tone],
                        )}
                      >
                        {selectedAp.rssi === null ? "—" : Math.round(selectedAp.rssi)}
                      </div>
                      <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">
                        dBm · {rssiQuality(selectedAp.rssi).label}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">
                        RSSI history
                      </span>
                      <span className="font-mono text-[10px] text-outline tnum">
                        {selectedHistory.length} / {HISTORY_LIMIT} samples
                      </span>
                    </div>
                    <div className="rounded-lg border border-white/[0.06] bg-black/30 p-2">
                      {selectedHistory.length >= 2 ? (
                        <Sparkline
                          data={selectedHistory}
                          height={44}
                          min={-100}
                          max={-30}
                          tone={rssiQuality(selectedAp.rssi).tone}
                          className="w-full"
                          ariaLabel={`RSSI history for ${selectedAp.ssid ?? "hidden network"}`}
                        />
                      ) : (
                        <p className="py-3 text-center text-[10.5px] leading-relaxed text-outline">
                          One sample recorded. Auto-refresh or rescan to build the trend.
                        </p>
                      )}
                    </div>
                    <p className="font-mono text-[9.5px] text-outline/80">
                      Per-network trend · last {HISTORY_LIMIT} scans · dBm
                    </p>
                  </div>

                  <dl className="grid grid-cols-2 gap-2">
                    {[
                      { label: "BSSID", value: selectedAp.bssid ?? "—" },
                      { label: "Channel", value: selectedAp.channel === null ? "—" : String(selectedAp.channel) },
                      { label: "Band", value: selectedAp.band ?? bandLabel(apBand(selectedAp)) },
                      {
                        label: "Width",
                        value: selectedAp.widthMhz === null ? "—" : `${selectedAp.widthMhz} MHz`,
                      },
                      { label: "PHY mode", value: selectedAp.phyMode ?? "—" },
                      { label: "Security", value: selectedAp.security ?? "—" },
                      { label: "Noise", value: selectedAp.noise === null ? "—" : `${Math.round(selectedAp.noise)} dBm` },
                      { label: "SNR", value: selectedAp.snr === null ? "—" : `${Math.round(selectedAp.snr)} dB` },
                      { label: "Vendor", value: selectedAp.vendor ?? "—" },
                      { label: "Hidden", value: selectedAp.hidden ? "Yes" : "No" },
                    ].map((field) => (
                      <div
                        key={field.label}
                        className="min-w-0 rounded-lg border border-white/[0.05] bg-black/25 px-2 py-1.5"
                      >
                        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">
                          {field.label}
                        </div>
                        <div className="truncate font-mono text-[11px] text-on-surface" title={field.value}>
                          {field.value}
                        </div>
                      </div>
                    ))}
                  </dl>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <CopyButton text={selectedAp.bssid ?? ""} label="BSSID" />
                    <CopyButton text={selectedAp.ssid ?? ""} label="SSID" />
                    <CopyButton text={JSON.stringify(selectedAp, null, 2)} label="JSON" />
                  </div>
                </div>
              ) : (
                <EmptyState
                  compact
                  icon={<Crosshair size={16} />}
                  title="No access point selected"
                  description="Pick a table row to inspect RF metrics, identifiers and the RSSI trend."
                />
              )}
            </Card>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="overflow-hidden">
            <CardHeader
              title="Bluetooth devices"
              hint={`${plural(btDevices.length, "peripheral")} · ${connectedCount} connected`}
              icon={<Bluetooth size={13} />}
              actions={
                <Button
                  size="xs"
                  icon={<RefreshCw size={11} />}
                  loading={btScanning}
                  onClick={() => void scanBluetooth()}
                >
                  Rescan
                </Button>
              }
            />
            {btScanning && <Progress indeterminate label="Scanning Bluetooth peripherals" height={2} />}
            {btError && (
              <div className="p-3">
                <ErrorNotice
                  title="Bluetooth scan failed"
                  message={btError}
                  onRetry={() => void scanBluetooth()}
                  retryLabel="Retry scan"
                />
              </div>
            )}
            {(!btError || devices !== null) && (
              <DataTable
                ariaLabel="Nearby Bluetooth devices"
                columns={btColumns}
                rows={filteredDevices}
                rowKey={(device, index) => device.address ?? `${device.name ?? "device"}-${index}`}
                initialSort={{ key: "rssi", dir: "desc" }}
                maxHeight="560px"
                empty={
                  <EmptyState
                    compact
                    icon={btScanning ? <Spinner size={16} /> : <Bluetooth size={16} />}
                    title={
                      btScanning
                        ? "Scanning Bluetooth…"
                        : btError
                          ? "Bluetooth unavailable"
                          : btDevices.length === 0
                            ? "No Bluetooth devices"
                            : "No device matches the filter"
                    }
                    description={
                      btScanning
                        ? "CoreBluetooth is collecting peripheral advertisements."
                        : btError
                          ? "The scan reported an error above. Turn Bluetooth on, then rescan."
                          : btDevices.length === 0
                            ? "No peripheral is advertising. Turn Bluetooth on and rescan."
                            : "Clear the text filter to see every discovered peripheral."
                    }
                    action={
                      !btScanning ? (
                        <Button size="xs" icon={<RefreshCw size={11} />} onClick={() => void scanBluetooth()}>
                          Rescan
                        </Button>
                      ) : undefined
                    }
                  />
                }
                footer={
                  <tr>
                    <td colSpan={btColumns.length} className="h-7 px-2">
                      <div className="flex items-center justify-between gap-3 font-mono text-[10px] text-outline">
                        <span className="truncate">
                          {plural(filteredDevices.length, "peripheral")} · {connectedCount} connected
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <Dot tone={btScanning ? "warning" : "success"} pulse={btScanning} />
                          {btScanning ? "discovering" : "idle"}
                        </span>
                      </div>
                    </td>
                  </tr>
                }
              />
            )}
          </Card>

          <Card className="overflow-hidden xl:sticky xl:top-3">
            <CardHeader
              title="Bluetooth summary"
              hint="CoreBluetooth advertisements"
              icon={<BluetoothSearching size={13} />}
            />
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-2 gap-1.5">
                <StatTile label="Devices" value={btDevices.length} tone="primary" icon={<Bluetooth size={13} />} />
                <StatTile
                  label="Connected"
                  value={connectedCount}
                  tone={connectedCount > 0 ? "success" : "neutral"}
                  icon={<Activity size={13} />}
                />
                <StatTile label="Vendors" value={vendorCount} tone="tertiary" icon={<Router size={13} />} />
                <StatTile
                  label="Strongest"
                  value={btStrongest === null ? "—" : `${Math.round(btStrongest)} dBm`}
                  tone={btStrongest === null ? "neutral" : rssiQuality(btStrongest).tone}
                  icon={<Radio size={13} />}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">
                    Device classes
                  </span>
                  <span className="font-mono text-[10px] text-outline tnum">{kindItems.length}</span>
                </div>
                {kindItems.length > 0 ? (
                  <BarSeries items={kindItems} tone="tertiary" rowHeight={18} />
                ) : (
                  <p className="text-[10.5px] text-outline">No device classes to chart yet.</p>
                )}
              </div>

              <InfoNotice tone="neutral" icon={<Info size={12} />}>
                macOS exposes peripherals that are actively advertising. Silent paired devices may not appear in the
                list.
              </InfoNotice>
            </div>
          </Card>
        </div>
      )}
    </ToolView>
  );
}
