# Changelog

Notable changes to shift-tools. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] — 2026-11-20

### Fixed
- The sidebar version chip was hard-coded to `v1.0`; it now follows the running build, so an
  updated app never shows two different versions at once.
- A failed update install now says why in the strip instead of leaving the button looking dead.

## [1.1.0] — 2026-11-20

### Added
- **Auto-update**: signed updates from the GitHub release. The app checks on launch and from the
  version chip in the status bar; a strip inside the window offers the install and a restart.
  `npm run app:build` now signs the updater artifacts with `~/.tauri/shift-tools.key`.
- **Largest files** ranks the biggest files on disk across every folder, each top-level folder
  walked on its own thread, build trees skipped, partial results after 40 s.
- **Universal cache sweep** measures every cache directory on the Mac in parallel.
- Repository is public: CI runs typecheck, the frontend bundle, the Rust tests and clippy on a
  macOS runner, and a tag publishes signed artifacts plus `latest.json`.
- **Identity**: the *Leaned S* mark — the letter S leaned 9°, graphite tile with accent blue.
  Ships as `.icns`/`.ico`/PNG ladder for the app, plus a favicon set and an outlined
  `shift-tools` lockup. Guidelines in `docs/brand/BRAND.md`; `npm run icons` regenerates
  every size from `docs/brand/master/logo-1024.png`.
- Three evaluated concept directions kept under `docs/brand/concepts/` for the record.

## [1.0.0] — 2026-11-11

First working build: 26 tools across five categories, 34 Rust commands, single-window shell.

### Added
- **Process Killer** — every process with dev ones flagged; sort by RAM, CPU, uptime, name, PID;
  host GPU utilisation from `IOAccelerator`; SIGTERM → SIGKILL with a grace window.
- **Disk Cleaner** — curated caches, a universal sweep of all user/app/dev/system caches, and a
  ranking of the largest files on disk (moved to the Trash, never deleted).
- **Network Observer** — CoreWLAN survey with real SSIDs, IEEE MA-L vendor lookup, signal history.
- **WiFi Mapper**, **LAN Scanner**, **DNS Toolkit**, **Speed Test**, **Ping / Traceroute**.
- **Header Analyzer**, **SSL Inspector** (real TLS handshake + `x509-parser`), **Subdomain Finder**,
  **Hash Generator**, **Password Auditor** (offline k-anonymity).
- **API Tester**, **JSON Toolkit**, **Base64 / URL Encoder**, **Regex Tester**.
- **Color Picker**, **Text Diff**, **Timestamp Converter**, **Markdown Preview**, **Cron Validator**,
  **UUID Generator**, **Quarantine Remover**, **Port Manager**, **RAM Monitor**.
- Command palette (`⌘K`), category shortcuts (`⌘1`–`⌘5`), glass design system, keyboard focus states.

### Fixed
- Tauri serialised structs as `snake_case`, so every metric reached the WebView as `undefined`;
  all response structs now carry `#[serde(rename_all = "camelCase")]`.
- `expand_home("~")` returned a literal `~`, so the largest-files scan rejected its own default root.
- The disk deletion guard checked depth but not shape — `~/Documents` was accepted. It now requires
  a cache-shaped directory name (regression test included).

### Known limitations
- Not notarised: first launch needs right-click → Open.
- Bluetooth lists devices macOS reports, not raw BLE advertisements.
- No per-process GPU figure exists on macOS without `powermetrics` and sudo; the UI shows host-wide
  utilisation instead of a fabricated column.
