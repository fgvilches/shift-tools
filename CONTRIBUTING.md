# Contributing to shift-tools

## Setup

```bash
npm install
npm run app      # native window + Vite, hot reload on the frontend
```

Rust changes need a restart (`npm run app`); the Tauri watcher rebuilds the binary.

## Before opening a pull request

```bash
npm run typecheck    # tsc --noEmit, strict, no `any`
npm run build        # production bundle must succeed
npm run test:rust    # live probes + deletion guards
npm run lint:rust    # clippy with -D warnings
```

All four run in CI on macOS; a red check blocks the merge.

## Conventions

- **No mock data.** Every view reads from the Rust core. If a value does not exist on the platform,
  show that it does not exist — never a plausible placeholder.
- **Types mirror the wire.** Rust response structs carry `#[serde(rename_all = "camelCase")]`;
  `src/lib/types.ts` is the TypeScript side of the same contract. Change both together.
- **Views stay in their folder.** A tool owns `src/tools/<tool>/`; shared primitives live in
  `src/components/ui/` and are changed deliberately, not per view.
- **UI copy is English.** Commits are English, imperative mood.
- **Destructive actions** need a confirmation dialog, a bounded scope, and a backend guard that
  re-validates what the frontend asked for.

## Adding a tool

1. Backend: a `#[tauri::command]` in the right `src-tauri/src/commands/*.rs`, registered in `lib.rs`.
2. Types: the interface in `src/lib/types.ts`, the call in `src/lib/api.ts`.
3. View: `src/tools/<tool>/index.tsx`, registered in `src/tools/registry.ts` with a category and icon.
4. Verify against the real machine, then run the four checks above.
