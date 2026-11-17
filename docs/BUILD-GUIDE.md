# shift-tools — build guide for view agents

Read this before touching any file. It is the contract between the app shell and every tool view.

## 1. Stack and commands

- React 18 + TypeScript (strict) + Vite 6 + Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first `@theme` tokens).
- Backend: Rust + Tauri 2. Every privileged action goes through `invoke`.
- Path alias `@/` → `src/`.

```bash
npx tsc --noEmit          # the only verification you run. Must be clean.
# NEVER run `npm run build`, `npm run app` or `cargo build`: other agents share this checkout.
```

## 2. What a view owns

Your file is `src/tools/<tool-id>/index.tsx` and you may add files inside that folder
(`components/`, `lib/`). Do **not** edit anything outside it — no changes to
`src/components/ui/*`, `src/components/layout/*`, `src/lib/*`, `src/tools/registry.ts`.
If a shared primitive is missing, compose it locally inside your folder and mention it in your
final summary.

Each view exports `default function XView()`. The registry already lazy-loads it; no registration
work is needed.

## 3. Visual language (non-negotiable)

Source of truth: `docs/ui/shift_tools_native_desktop/DESIGN.md`. In short:

- Canvas `#0a0a0f`; panes `glass-pane`; cards `glass-card`; overlays `glass-overlay` (classes already in `src/index.css`).
- Accent `text-primary` (#0a84ff) / `text-primary-soft` (#aac7ff). Success `secondary`, warnings `warning`, destructive `error`, signatures `tertiary`.
- Type: `text-[12px]/[13px]` for UI, `font-mono` + `tnum` for every PID, byte count, IP, hash, latency, header value.
- Uppercase micro-labels: `text-[10px] font-semibold uppercase tracking-[0.08em] text-outline`.
- Data rows are 28px tall (`dense` on `DataTable`). Cards radius 16px, controls 8px, badges pill.
- Icons: `lucide-react` only, 12–18px, `text-outline`/`text-on-variant` unless semantic. Never emoji.
- Motion: 120–160ms. No bouncing, no long easing.
- Density over emptiness: this is a pro tool, not a landing page. Use the full width.

Copy is **English**. Tone is terse and technical ("Scanned 128 hosts · 6 responders"), not marketing.

## 4. Reusable UI kit (import from `@/components/ui`)

```ts
import {
  Button, IconButton, Kbd,                 // Button: variant default|primary|destructive|success|warning|ghost, size xs|sm|md, icon, trailing, loading, block
  Card, CardHeader, SectionLabel, StatTile, Divider,
  Badge, Dot, Eyebrow,                     // Badge: tone neutral|primary|success|warning|error|tertiary, mono, dot, pulse
  Field, Input, Textarea, Select, Checkbox, Switch, SegmentedControl, // Input: mono, sizeVariant, leading, invalid, trailingSlot
  DataTable, type Column,                  // columns/rows/rowKey/selected/onSelectedChange/onRowClick/empty/footer/initialSort/dense/maxHeight/ariaLabel
  EmptyState, Spinner, Progress, Meter, Skeleton, ErrorNotice, InfoNotice,
  Modal, ConfirmDialog,                    // ConfirmDialog: open/title/message/confirmLabel/destructive/onConfirm/onCancel/detail/busy
  toast, Toaster,                          // toast.success | toast.error | toast.warning | toast.info
  CodeArea, CopyButton,                    // CodeArea: value/onChange/readOnly/minHeight/ariaLabel/toolbar/wrap
  DropZone,                                // onPaths(paths: string[]), accept, multiple, title, description
  LogViewer, type LogEntry,                // logs, autoScroll, onClear, height, title
  Sparkline, ScoreRing, BarSeries, ColumnChart,
  Tabs, type TabItem,
} from "@/components/ui";
```

Layout shell (`@/components/layout/ToolView`):

```tsx
<ToolView
  eyebrow="PASSIVE SCAN"            // short uppercase chip
  eyebrowTone="primary"             // neutral|primary|success|warning|error|tertiary
  eyebrowHint="802.11 + BLE"        // optional mono hint next to the chip
  title="Network Observer"
  description="One sentence, same wording as the registry entry."
  telemetry={[{ label: "Access points", value: "12", tone: "primary", icon: <Radar size={14} /> }]}  // 2–4 tiles
  toolbar={<>…primary actions, inputs, filters…</>}
  status={<>…right-aligned switches/badges…</>}
  headerExtra={/* optional meter or summary strip under the title */}
>
  {/* body: Cards, workbenches, tables */}
</ToolView>
```

`Workbench` (also exported from ToolView.tsx) gives you `sidebar + flexible canvas`.

## 5. Data access — real backend only

`import { system, network, security, testing, util } from "@/lib/api";`
`import { errorMessage, isTauri } from "@/lib/ipc";`
Types: `import type { … } from "@/lib/types";`

| Tool | Call |
|---|---|
| Process Killer | `system.processes()`, `system.kill(pids, force)`, `system.stats()` |
| Quarantine | `system.inspectBundle(path)`, `system.clearQuarantine(path)` |
| Ports | `system.ports()`, `system.killPort(port, proto, force)` |
| Disk | `system.diskTargets()`, `system.cleanDisk(ids)` |
| RAM | `system.ram()`, `system.stats()` |
| Network Observer | `network.wifiScan()`, `network.bluetooth()` |
| WiFi Mapper | `network.wifiScan()`, `network.capturePointScans()`, `network.maps()`, `network.loadMap(id)`, `network.saveMap(doc)`, `network.deleteMap(id)` |
| LAN Scanner | `network.lanScan(cidr, ports)` + `network.onLanProgress(cb)` (returns unsubscribe) |
| DNS | `network.dns(domain, recordType, resolver \| null)` |
| Ping/Traceroute | `network.ping(host, count)` + `network.onPing(cb)`; `network.traceroute(host, maxHops)` |
| Speed Test | `network.speedTest()` |
| Subdomains | `network.subdomains(domain)` |
| Headers | `security.headers(url, followRedirects)` |
| TLS | `security.tls(domain, 443)` |
| Hash | `security.hashText(text, algos)`, `security.hashFile(path, algos)` |
| Passwords | `security.password(pw)`, `security.generatePassword(len, sym, num, upper)`, `security.pwned(pw)` |
| API Tester | `testing.send(spec)` |
| Color Picker | `util.samplePixel(x, y)` (macOS screen capture; needs Screen Recording permission) |
| Reveal | `util.reveal(path)` |

Rules:

- Never invent results. If a call fails, render the real message with `ErrorNotice` (offer retry).
- If not running in Tauri (`isTauri === false`), the API throws a clear "needs the native app" error — show it, do not fake data.
- Every async action needs a loading state (`Button loading`, `Progress indeterminate`, `Skeleton`).
- Long-running work streams events; always unsubscribe in the effect cleanup.

Generic request shape for the API Tester (`ApiRequestSpec` in types):

```ts
{ method: "GET", url, headers: [["Accept","application/json"]], body: null,
  bodyKind: "none", auth: { kind: "none", username: null, password: null, token: null, headerName: null, inQuery: false },
  timeoutMs: 30000, followRedirects: true, insecure: false }
```

## 6. Interaction and accessibility

- `aria-label` on every icon-only control; `aria-current="page"` not needed (the shell handles nav).
- `role="log"` comes from `LogViewer`; use `aria-live="polite"` for counters that change on action.
- Keyboard: `Enter` submits the primary form action, `Escape` closes modals (Modal handles it), `Tab` order follows visual order.
- Destructive actions always go through `ConfirmDialog` and name the exact target + consequence.
- Selection state and filters must survive a refresh of the underlying data (prune stale ids only).
- Empty and error states are part of the design: never show a blank panel.

## 7. Design references

Each view has a hi-fi mockup:

- `docs/ui/<snake_case_tool>/code.html` — the actual layout (Tailwind CDN classes; read the markup, ignore the CDN script/config).
- `docs/ui/<snake_case_tool>/screen.png` — rendered screenshot. Load it with `vision_analyze` to check composition, density and hierarchy.

Follow the mockup's information architecture (what is on screen, in which order, at what density).
Transpose its utility classes to the kit above; do not copy the CDN config or Google-Fonts links,
and do not copy placeholder numbers — the app renders live data.

Golden example already built: `src/tools/process-killer/index.tsx`. Match its structure, state
handling and polish.

## 8. Definition of done

1. `npx tsc --noEmit` passes with zero errors.
2. Every control is wired to a real call or to local computation that genuinely works.
3. Loading, empty, error and success states all exist.
4. Layout holds at 1120px and 1600px window widths without horizontal scroll or clipping.
5. No `any`, no `console.log`, no TODOs left in the file.
