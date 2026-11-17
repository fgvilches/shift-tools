/**
 * Line-level diff: common prefix/suffix trimming, then an LCS table on the
 * remaining middle. Cheap enough for editor-sized documents; refuses inputs
 * that would allocate a multi-megabyte table instead of freezing the UI.
 */

export type DiffKind = "equal" | "add" | "remove";

export interface DiffRow {
  kind: DiffKind;
  text: string;
  leftLine: number | null;
  rightLine: number | null;
}

export interface DiffSuccess {
  ok: true;
  rows: DiffRow[];
  added: number;
  removed: number;
  leftLines: number;
  rightLines: number;
}

export interface DiffFailure {
  ok: false;
  message: string;
}

export type DiffResult = DiffSuccess | DiffFailure;

const MAX_CELLS = 4_000_000;

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

export function diffLines(leftText: string, rightText: string): DiffResult {
  const left = splitLines(leftText);
  const right = splitLines(rightText);

  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;

  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > prefix && rightEnd > prefix && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd -= 1;
    rightEnd -= 1;
  }

  const middleLeft = left.slice(prefix, leftEnd);
  const middleRight = right.slice(prefix, rightEnd);

  if (middleLeft.length * middleRight.length > MAX_CELLS) {
    return {
      ok: false,
      message: `Too large to diff line by line (${middleLeft.length} × ${middleRight.length} changed lines). Compare a smaller slice.`,
    };
  }

  const rows: DiffRow[] = [];
  for (let index = 0; index < prefix; index += 1) {
    rows.push({ kind: "equal", text: left[index] ?? "", leftLine: index + 1, rightLine: index + 1 });
  }

  const width = middleRight.length + 1;
  const table = new Int32Array((middleLeft.length + 1) * width);
  for (let i = middleLeft.length - 1; i >= 0; i -= 1) {
    for (let j = middleRight.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        middleLeft[i] === middleRight[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }

  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < middleLeft.length && j < middleRight.length) {
    if (middleLeft[i] === middleRight[j]) {
      rows.push({ kind: "equal", text: middleLeft[i] ?? "", leftLine: prefix + i + 1, rightLine: prefix + j + 1 });
      i += 1;
      j += 1;
      continue;
    }
    if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      rows.push({ kind: "remove", text: middleLeft[i] ?? "", leftLine: prefix + i + 1, rightLine: null });
      removed += 1;
      i += 1;
    } else {
      rows.push({ kind: "add", text: middleRight[j] ?? "", leftLine: null, rightLine: prefix + j + 1 });
      added += 1;
      j += 1;
    }
  }
  while (i < middleLeft.length) {
    rows.push({ kind: "remove", text: middleLeft[i] ?? "", leftLine: prefix + i + 1, rightLine: null });
    removed += 1;
    i += 1;
  }
  while (j < middleRight.length) {
    rows.push({ kind: "add", text: middleRight[j] ?? "", leftLine: null, rightLine: prefix + j + 1 });
    added += 1;
    j += 1;
  }

  for (let index = 0; index < left.length - leftEnd; index += 1) {
    rows.push({
      kind: "equal",
      text: left[leftEnd + index] ?? "",
      leftLine: leftEnd + index + 1,
      rightLine: rightEnd + index + 1,
    });
  }

  return { ok: true, rows, added, removed, leftLines: left.length, rightLines: right.length };
}
