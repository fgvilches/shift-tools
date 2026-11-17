import { marked } from "marked";
import DOMPurify from "dompurify";

/** One heading in the document outline. */
export interface OutlineEntry {
  level: number;
  text: string;
}

export interface MarkdownStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  lines: number;
  readingMinutes: number;
  headings: number;
  maxHeadingLevel: number;
  outline: OutlineEntry[];
  codeBlocks: number;
  tables: number;
  links: number;
  images: number;
  tasks: number;
  tasksDone: number;
}

export interface MarkdownRender {
  /** Sanitized HTML — the only string this view ever inserts into the DOM. */
  html: string;
  /** Block-aware plain text of the rendered document. */
  plain: string;
  stats: MarkdownStats;
  /** Set only when the parser itself fails; marked usually recovers from malformed input. */
  error: string | null;
}

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
  "ul",
]);

function emptyStats(characters: number, lines: number): MarkdownStats {
  return {
    words: 0,
    characters,
    charactersNoSpaces: 0,
    lines,
    readingMinutes: 0,
    headings: 0,
    maxHeadingLevel: 0,
    outline: [],
    codeBlocks: 0,
    tables: 0,
    links: 0,
    images: 0,
    tasks: 0,
    tasksDone: 0,
  };
}

function toPlainText(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push((node.textContent ?? "").replace(/\s+/g, " "));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "br") {
    out.push("\n");
    return;
  }
  if (tag === "hr") {
    out.push("\n\n---\n\n");
    return;
  }
  if (tag === "pre") {
    out.push(`\n\n${(el.textContent ?? "").replace(/^\n+|\n+$/g, "")}\n\n`);
    return;
  }
  if (tag === "img") {
    out.push(el.getAttribute("alt") ?? "");
    return;
  }
  if (tag === "tr") {
    const cells = Array.from(el.querySelectorAll("th,td")).map((cell) =>
      (cell.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    out.push(`\n${cells.join("  |  ")}`);
    return;
  }
  if (tag === "li") out.push("\n• ");

  const block = BLOCK_TAGS.has(tag);
  if (block) out.push("\n");
  for (const child of Array.from(el.childNodes)) toPlainText(child, out);
  if (block) out.push("\n");
}

function plainTextOf(html: string): string {
  if (typeof DOMParser === "undefined") {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const chunks: string[] = [];
  for (const child of Array.from(doc.body.childNodes)) toPlainText(child, chunks);
  return chunks
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectStats(source: string, html: string): MarkdownStats {
  const stats = emptyStats(source.length, source.length === 0 ? 1 : source.split("\n").length);
  stats.charactersNoSpaces = source.replace(/\s/g, "").length;
  if (!html) return stats;

  if (typeof DOMParser === "undefined") return stats;

  const body = new DOMParser().parseFromString(html, "text/html").body;

  const text = (body.textContent ?? "").replace(/\s+/g, " ").trim();
  stats.words = text.length > 0 ? text.split(" ").length : 0;
  stats.readingMinutes = stats.words === 0 ? 0 : Math.max(1, Math.round(stats.words / 220));

  const headings = Array.from(body.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  stats.headings = headings.length;
  stats.outline = headings
    .map((heading) => ({
      level: Number(heading.tagName.slice(1)),
      text: (heading.textContent ?? "").replace(/\s+/g, " ").trim(),
    }))
    .filter((heading) => heading.text.length > 0);
  stats.maxHeadingLevel = stats.outline.reduce((max, heading) => Math.max(max, heading.level), 0);

  stats.codeBlocks = body.querySelectorAll("pre").length;
  stats.tables = body.querySelectorAll("table").length;
  stats.links = body.querySelectorAll("a[href]").length;
  stats.images = body.querySelectorAll("img").length;

  const tasks = Array.from(body.querySelectorAll('input[type="checkbox"]'));
  stats.tasks = tasks.length;
  stats.tasksDone = tasks.filter((task) => task.hasAttribute("checked")).length;

  return stats;
}

/**
 * Render GFM source to HTML, then sanitize it with DOMPurify.
 *
 * marked never throws on malformed Markdown, but a broken extension or an
 * exotic token could — the try/catch keeps the view alive and surfaces the
 * real message instead of a blank pane.
 */
export function renderMarkdown(source: string): MarkdownRender {
  const stats = emptyStats(source.length, source.length === 0 ? 1 : source.split("\n").length);
  if (source.trim().length === 0) {
    return { html: "", plain: "", stats, error: null };
  }

  try {
    const raw = marked.parse(source, { gfm: true, breaks: true, async: false, silent: true });
    const html = DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "iframe", "form", "object", "embed"],
      FORBID_ATTR: ["style", "onerror", "onload"],
    });
    return { html, plain: plainTextOf(html), stats: collectStats(source, html), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "The parser rejected this document.";
    return { html: "", plain: "", stats: collectStats(source, ""), error: message };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const EXPORT_STYLES = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 40px 22px 64px;
  background: #0a0a0f; color: #c0c6d6;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  font-size: 14px; line-height: 1.68;
  -webkit-font-smoothing: antialiased;
}
main { max-width: 760px; margin: 0 auto; }
h1, h2, h3, h4, h5, h6 { color: #e4e1ea; font-weight: 600; letter-spacing: -0.012em; margin: 26px 0 10px; }
h1 { font-size: 26px; line-height: 34px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); }
h2 { font-size: 20px; line-height: 27px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.07); }
h3 { font-size: 16px; line-height: 22px; }
h4, h5, h6 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: #8b91a0; }
p { margin: 0 0 11px; }
a { color: #aac7ff; text-decoration: underline; text-underline-offset: 2px; }
strong { color: #e4e1ea; font-weight: 600; }
em { color: #e4e1ea; }
del { color: #8b91a0; }
code {
  font-family: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 4px; padding: 1px 4px; color: #aac7ff;
}
pre {
  background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
  padding: 12px 14px; overflow-x: auto; margin: 0 0 14px;
}
pre code { background: none; border: 0; padding: 0; font-size: 12.5px; color: #d6e3ff; line-height: 1.55; }
blockquote {
  margin: 0 0 14px; padding: 9px 14px; border-left: 2px solid #0a84ff;
  background: rgba(10,132,255,0.08); border-radius: 0 8px 8px 0; color: #c0c6d6;
}
blockquote p:last-child { margin-bottom: 0; }
ul, ol { margin: 0 0 12px; padding-left: 20px; }
li { margin: 3px 0; }
li::marker { color: #8b91a0; }
ul.contains-task-list { list-style: none; padding-left: 2px; }
li.task-list-item { display: flex; gap: 7px; align-items: flex-start; }
input[type="checkbox"] { margin: 5px 0 0; accent-color: #0a84ff; }
table { border-collapse: collapse; width: 100%; margin: 0 0 16px; font-size: 13px; }
th {
  text-align: left; padding: 7px 10px; background: rgba(255,255,255,0.05);
  color: #e4e1ea; font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em;
  border-bottom: 1px solid rgba(255,255,255,0.12);
}
td { padding: 7px 10px; border-bottom: 1px solid rgba(255,255,255,0.06); vertical-align: top; }
hr { border: 0; height: 1px; background: rgba(255,255,255,0.11); margin: 22px 0; }
img { max-width: 100%; border-radius: 10px; }
kbd {
  font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 4px; padding: 1px 5px;
}
footer { max-width: 760px; margin: 40px auto 0; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.07);
  color: #6b7280; font-size: 11px; font-family: "JetBrains Mono", ui-monospace, monospace; }
`.trim();

export function buildStandaloneHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
${EXPORT_STYLES}
</style>
</head>
<body>
<main>
${bodyHtml}
</main>
<footer>Rendered with shift-tools · Markdown Preview</footer>
</body>
</html>`;
}

/** First heading becomes the file name, falling back to a stable slug. */
export function documentTitle(source: string, outline: OutlineEntry[]): string {
  const heading = outline.find((entry) => entry.level === 1) ?? outline[0];
  if (heading) return heading.text;
  // Raw HTML or a stray tag is not a usable document name — skip those lines.
  const firstLine = source
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("<") && !line.startsWith("!["));
  if (!firstLine) return "Untitled document";
  const stripped = firstLine.replace(/[#>*_`~-]/g, "").trim();
  return stripped.length > 0 ? stripped.slice(0, 80) : "Untitled document";
}

export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : "markdown-preview";
}
