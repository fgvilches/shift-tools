import { diffArrays, diffChars, diffWordsWithSpace, structuredPatch } from "diff";

/** Hard ceiling for a single pane. Beyond this the comparison is paused, not silently truncated. */
export const MAX_INPUT_CHARS = 200_000;
/** Unchanged runs longer than this are collapsed behind an expand control. */
export const COLLAPSE_THRESHOLD = 6;
/** Abort the Myers pass after this long so a pathological input cannot lock the view. */
const DIFF_TIMEOUT_MS = 2_500;
/** Leave this many context rows at each end of a collapsed run. */
const CONTEXT_ROWS = 2;

export type Granularity = "lines" | "words" | "chars";
export type RowKind = "equal" | "removed" | "added" | "modified";
export type ViewMode = "split" | "unified";

export interface Segment {
  text: string;
  changed: boolean;
}

export interface DiffRow {
  key: string;
  kind: RowKind;
  /** 1-based line number in the original, null when the row was inserted. */
  leftNo: number | null;
  /** 1-based line number in the modified text, null when the row was deleted. */
  rightNo: number | null;
  left: string;
  right: string;
  leftSeg: Segment[] | null;
  rightSeg: Segment[] | null;
  /** Index into DiffResult.chunks, -1 for unchanged rows. */
  chunk: number;
}

export interface Chunk {
  index: number;
  rowKey: string;
  leftStart: number;
  leftEnd: number;
  rightStart: number;
  rightEnd: number;
  removed: number;
  added: number;
}

export interface DiffStats {
  additions: number;
  deletions: number;
  unchanged: number;
  modified: number;
  chunks: number;
  similarity: number;
  leftLines: number;
  rightLines: number;
}

export interface DiffResult {
  rows: DiffRow[];
  chunks: Chunk[];
  stats: DiffStats;
  /** Wall-clock cost of the computation, in milliseconds. */
  elapsedMs: number;
}

export interface CompareOptions {
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
}

export interface GapItem {
  kind: "gap";
  hidden: number;
  run: number;
}

export interface RowItem {
  kind: "row";
  row: DiffRow;
}

export type DisplayItem = RowItem | GapItem;

/** Normalise line endings and drop the single trailing newline so "a\n" reads as one line. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

export function splitLines(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized.length === 0 ? [] : normalized.split("\n");
}

export function countLines(text: string): number {
  return splitLines(text).length;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function comparisonKey(line: string, options: CompareOptions): string {
  let key = line;
  if (options.ignoreWhitespace) key = key.replace(/\s+/g, " ").trim();
  if (options.ignoreCase) key = key.toLowerCase();
  return key;
}

function pushSegment(target: Segment[], text: string, changed: boolean): void {
  if (text.length === 0) return;
  const last = target[target.length - 1];
  if (last && last.changed === changed) last.text += text;
  else target.push({ text, changed });
}

/**
 * Intra-line highlight for a pair of modified lines. Boundaries come from the `diff`
 * package; the text is always sliced out of the originals so display never drifts
 * from the source when `ignoreCase` is on.
 */
function pairSegments(
  a: string,
  b: string,
  granularity: Granularity,
  options: CompareOptions,
): { left: Segment[]; right: Segment[] } | null {
  if (granularity === "lines") return null;

  const unchangedPair = { left: [{ text: a, changed: false }], right: [{ text: b, changed: false }] };
  if (a === b) return unchangedPair;

  const caseSafe = a.toLowerCase().length === a.length && b.toLowerCase().length === b.length;
  const ignoreCase = options.ignoreCase && caseSafe;
  const ignoreWhitespace = options.ignoreWhitespace;

  if (ignoreCase && a.toLowerCase() === b.toLowerCase()) return unchangedPair;
  if (ignoreWhitespace && a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim()) return unchangedPair;

  const changes =
    granularity === "words" ? diffWordsWithSpace(a, b, { ignoreCase }) : diffChars(a, b, { ignoreCase });

  const left: Segment[] = [];
  const right: Segment[] = [];
  let lp = 0;
  let rp = 0;

  for (const change of changes) {
    const len = change.value.length;
    const whitespaceOnly = ignoreWhitespace && /^\s+$/.test(change.value);
    if (change.added) {
      pushSegment(right, b.slice(rp, rp + len) || change.value, !whitespaceOnly);
      rp += len;
    } else if (change.removed) {
      pushSegment(left, a.slice(lp, lp + len) || change.value, !whitespaceOnly);
      lp += len;
    } else {
      pushSegment(left, a.slice(lp, lp + len), false);
      pushSegment(right, b.slice(rp, rp + len), false);
      lp += len;
      rp += len;
    }
  }

  if (lp < a.length) pushSegment(left, a.slice(lp), true);
  if (rp < b.length) pushSegment(right, b.slice(rp), true);

  if (left.length === 0) left.push({ text: a, changed: false });
  if (right.length === 0) right.push({ text: b, changed: false });

  // Two unrelated lines get paired by position; token marks would be noise, so fall
  // back to a whole-line tint when almost nothing survives.
  const changedChars = left.reduce((sum, s) => sum + (s.changed ? s.text.length : 0), 0);
  const longest = Math.max(1, a.length, b.length);
  if (changedChars / longest > 0.65) return null;

  return { left, right };
}

/**
 * Align both texts into one row model using `diff`'s Myers implementation on the
 * line arrays. Returns null when the algorithm hits the timeout budget.
 */
export function computeDiff(
  leftText: string,
  rightText: string,
  granularity: Granularity,
  options: CompareOptions,
): DiffResult | null {
  const started = performance.now();
  const leftLines = splitLines(leftText);
  const rightLines = splitLines(rightText);

  const changes = diffArrays(leftLines, rightLines, {
    comparator: (a: string, b: string) => comparisonKey(a, options) === comparisonKey(b, options),
    timeout: DIFF_TIMEOUT_MS,
  });
  if (!changes) return null;

  const rows: DiffRow[] = [];
  const chunks: Chunk[] = [];
  let li = 0;
  let ri = 0;
  let seq = 0;
  let pairsTotal = 0;
  let addedOnly = 0;
  let removedOnly = 0;
  let unchanged = 0;
  let index = 0;

  while (index < changes.length) {
    const change = changes[index];

    if (!change.added && !change.removed) {
      for (let n = 0; n < change.value.length; n += 1) {
        li += 1;
        ri += 1;
        unchanged += 1;
        rows.push({
          key: `r${seq++}`,
          kind: "equal",
          leftNo: li,
          rightNo: ri,
          left: leftLines[li - 1] ?? "",
          right: rightLines[ri - 1] ?? "",
          leftSeg: null,
          rightSeg: null,
          chunk: -1,
        });
      }
      index += 1;
      continue;
    }

    const removedLines: string[] = [];
    const addedLines: string[] = [];
    while (index < changes.length && (changes[index].added || changes[index].removed)) {
      const block = changes[index];
      if (block.removed) removedLines.push(...block.value);
      else addedLines.push(...block.value);
      index += 1;
    }

    const chunkIndex = chunks.length;
    const blockStart = rows.length;
    const leftStart = li + 1;
    const rightStart = ri + 1;
    const pairs = Math.min(removedLines.length, addedLines.length);

    for (let p = 0; p < pairs; p += 1) {
      const leftLine = removedLines[p] ?? "";
      const rightLine = addedLines[p] ?? "";
      const segments = pairSegments(leftLine, rightLine, granularity, options);
      li += 1;
      ri += 1;
      pairsTotal += 1;
      rows.push({
        key: `r${seq++}`,
        kind: "modified",
        leftNo: li,
        rightNo: ri,
        left: leftLine,
        right: rightLine,
        leftSeg: segments?.left ?? null,
        rightSeg: segments?.right ?? null,
        chunk: chunkIndex,
      });
    }

    for (let p = pairs; p < removedLines.length; p += 1) {
      li += 1;
      removedOnly += 1;
      rows.push({
        key: `r${seq++}`,
        kind: "removed",
        leftNo: li,
        rightNo: null,
        left: removedLines[p] ?? "",
        right: "",
        leftSeg: null,
        rightSeg: null,
        chunk: chunkIndex,
      });
    }

    for (let p = pairs; p < addedLines.length; p += 1) {
      ri += 1;
      addedOnly += 1;
      rows.push({
        key: `r${seq++}`,
        kind: "added",
        leftNo: null,
        rightNo: ri,
        left: "",
        right: addedLines[p] ?? "",
        leftSeg: null,
        rightSeg: null,
        chunk: chunkIndex,
      });
    }

    const firstRow = rows[blockStart];
    chunks.push({
      index: chunkIndex,
      rowKey: firstRow?.key ?? `r${seq}`,
      leftStart,
      leftEnd: li,
      rightStart,
      rightEnd: ri,
      removed: removedLines.length,
      added: addedLines.length,
    });
  }

  const totalLines = leftLines.length + rightLines.length;
  const similarity =
    totalLines === 0 ? 100 : Math.round(((2 * unchanged) / totalLines) * 1000) / 10;

  return {
    rows,
    chunks,
    stats: {
      additions: pairsTotal + addedOnly,
      deletions: pairsTotal + removedOnly,
      unchanged,
      modified: pairsTotal,
      chunks: chunks.length,
      similarity,
      leftLines: leftLines.length,
      rightLines: rightLines.length,
    },
    elapsedMs: Math.max(0.1, Math.round((performance.now() - started) * 10) / 10),
  };
}

/**
 * Collapse long unchanged runs into two context rows per edge plus a gap item.
 * Run numbering is positional, so callers must reset expansion state when the diff changes.
 */
export function buildDisplayItems(rows: DiffRow[], expanded: Set<number>, expandAll: boolean): DisplayItem[] {
  const items: DisplayItem[] = [];
  let run = 0;
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];
    if (!row) break;
    if (row.kind !== "equal") {
      items.push({ kind: "row", row });
      i += 1;
      continue;
    }

    let end = i;
    while (end < rows.length && rows[end]?.kind === "equal") end += 1;
    const length = end - i;
    const hidden = length - CONTEXT_ROWS * 2;
    const isOpen = expandAll || expanded.has(run);

    if (length > COLLAPSE_THRESHOLD && hidden > 0 && !isOpen) {
      for (let k = 0; k < CONTEXT_ROWS; k += 1) {
        const head = rows[i + k];
        if (head) items.push({ kind: "row", row: head });
      }
      items.push({ kind: "gap", hidden, run });
      for (let k = end - CONTEXT_ROWS; k < end; k += 1) {
        const tail = rows[k];
        if (tail) items.push({ kind: "row", row: tail });
      }
    } else {
      for (let k = i; k < end; k += 1) {
        const equalRow = rows[k];
        if (equalRow) items.push({ kind: "row", row: equalRow });
      }
    }

    run += 1;
    i = end;
  }

  return items;
}

function ensureTrailingNewline(text: string): string {
  return text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
}

/** Git-style unified patch built from the same line alignment the view renders. */
export function buildPatch(leftText: string, rightText: string): string {
  const oldName = "original.txt";
  const newName = "modified.txt";
  const patch = structuredPatch(
    `a/${oldName}`,
    `b/${newName}`,
    ensureTrailingNewline(normalizeText(leftText)),
    ensureTrailingNewline(normalizeText(rightText)),
    undefined,
    undefined,
    { context: 3 },
  );

  const lines = [`diff --git a/${oldName} b/${newName}`, `--- a/${oldName}`, `+++ b/${newName}`];
  for (const hunk of patch.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    lines.push(...hunk.lines);
  }
  return lines.join("\n");
}

export function patchLineCount(patch: string): number {
  return patch.length === 0 ? 0 : patch.split("\n").length;
}
