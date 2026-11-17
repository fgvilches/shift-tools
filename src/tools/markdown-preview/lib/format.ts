/** Local text transforms behind the editor toolbar. Pure, so the selection maths stay testable. */

export type FormatAction =
  | "bold"
  | "italic"
  | "heading"
  | "link"
  | "code"
  | "codeblock"
  | "list"
  | "quote"
  | "table"
  | "hr";

export interface EditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

function wrap(source: string, start: number, end: number, before: string, after: string, placeholder: string): EditResult {
  const selection = source.slice(start, end);
  if (selection.length > 0) {
    return {
      value: source.slice(0, start) + before + selection + after + source.slice(end),
      selectionStart: start + before.length,
      selectionEnd: start + before.length + selection.length,
    };
  }
  return {
    value: source.slice(0, start) + before + placeholder + after + source.slice(end),
    selectionStart: start + before.length,
    selectionEnd: start + before.length + placeholder.length,
  };
}

/** Line range covering the selection, so block formatting never clobbers a partial line. */
function lineRange(source: string, start: number, end: number): { from: number; to: number } {
  const from = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = source.indexOf("\n", end);
  const to = nextBreak === -1 ? source.length : nextBreak;
  return { from, to };
}

function prefixLines(source: string, start: number, end: number, prefix: string, toggle: boolean): EditResult {
  const { from, to } = lineRange(source, start, end);
  const block = source.slice(from, to);
  const lines = block.split("\n");
  const alreadyPrefixed = toggle && lines.every((line) => line.length === 0 || line.startsWith(prefix));

  const nextLines = lines.map((line) => {
    if (alreadyPrefixed) return line.startsWith(prefix) ? line.slice(prefix.length) : line;
    return line.length === 0 ? prefix.trimEnd() : prefix + line;
  });
  const next = nextLines.join("\n");
  const delta = next.length - block.length;
  return {
    value: source.slice(0, from) + next + source.slice(to),
    selectionStart: start + prefix.length,
    selectionEnd: Math.max(start + prefix.length, end + delta),
  };
}

function applyHeading(source: string, start: number, end: number): EditResult {
  const { from, to } = lineRange(source, start, end);
  const block = source.slice(from, to);
  const lines = block.split("\n");
  const nextLines = lines.map((line) => `## ${line.replace(/^#{1,6}\s+/, "")}`);
  const next = nextLines.join("\n");
  const firstLength = (nextLines[0] ?? "").length;
  return {
    value: source.slice(0, from) + next + source.slice(to),
    selectionStart: from + 3,
    selectionEnd: from + Math.max(3, firstLength),
  };
}

function insertLink(source: string, start: number, end: number): EditResult {
  const selection = source.slice(start, end);
  const label = selection.length > 0 ? selection : "link text";
  const value = `${source.slice(0, start)}[${label}](https://)${source.slice(end)}`;
  const urlStart = start + label.length + 3;
  return { value, selectionStart: urlStart, selectionEnd: urlStart + 8 };
}

/** Insert a standalone block on its own lines. */
function insertBlock(source: string, start: number, end: number, block: string, select?: { from: number; to: number }): EditResult {
  const before = source.slice(0, start);
  const after = source.slice(end);
  const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after.length === 0 || after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = `${lead}${block}${trail}`;
  const offset = start + lead.length;
  return {
    value: before + inserted + after,
    selectionStart: offset + (select?.from ?? block.length),
    selectionEnd: offset + (select?.to ?? block.length),
  };
}

export function applyFormat(source: string, start: number, end: number, action: FormatAction): EditResult {
  const from = Math.min(start, end);
  const to = Math.max(start, end);

  switch (action) {
    case "bold":
      return wrap(source, from, to, "**", "**", "bold text");
    case "italic":
      return wrap(source, from, to, "_", "_", "emphasis");
    case "code":
      return wrap(source, from, to, "`", "`", "code");
    case "link":
      return insertLink(source, from, to);
    case "heading":
      return applyHeading(source, from, to);
    case "list":
      return prefixLines(source, from, to, "- ", true);
    case "quote":
      return prefixLines(source, from, to, "> ", true);
    case "codeblock": {
      const selection = source.slice(from, to);
      if (selection.length > 0) {
        const block = "```ts\n" + selection + "\n```";
        return {
          value: source.slice(0, from) + block + source.slice(to),
          selectionStart: from + 6,
          selectionEnd: from + 6 + selection.length,
        };
      }
      const block = "```ts\nconst value = 1;\n```";
      return insertBlock(source, from, to, block, { from: 6, to: 22 });
    }
    case "table":
      return insertBlock(
        source,
        from,
        to,
        ["| Column | Column | Column |", "| --- | --- | --- |", "| Value | Value | Value |", "| Value | Value | Value |"].join("\n"),
        { from: 0, to: 8 },
      );
    case "hr":
      return insertBlock(source, from, to, "---");
    default:
      return { value: source, selectionStart: from, selectionEnd: to };
  }
}
