/** Seed document: a compact GFM tour so every renderer style is visible on first load. */
export const SAMPLE_DOCUMENT = `# Markdown Preview

A dual-pane GFM workbench for shift-tools. Type on the left, read the rendered
result on the right, then export a standalone HTML file.

> Parsing runs locally through \`marked\`, and every rendered node passes through
> DOMPurify before it reaches the preview pane. Nothing leaves the app.

## Why this exists

Drafting a README or a spec should not require a browser tab, a login, or a
network round trip. This view keeps the loop tight:

- **Live render** on every keystroke, no save step
- **Sanitized output** — scripts, inline handlers and iframes are stripped
- **Export** to a self-contained \`.html\` file with the dark theme baked in

### Formatting reach

GFM covers what technical writing actually needs: *emphasis*, **strong**,
~~strikethrough~~, \`inline code\`, [links](https://commonmark.org), tables,
task lists and fenced code. Line breaks stay where you put them.

#### Keyboard shortcuts

| Shortcut | Action | Scope |
| --- | --- | --- |
| ⌘B | Bold | Selection or cursor |
| ⌘I | Italic | Selection or cursor |
| ⌘K | Link | Selection becomes the label |
| Tab | Indent two spaces | Editor only |

## Task list

- [x] Split / editor / preview modes
- [x] Formatting toolbar with selection wrapping
- [x] Word, character and reading-time metrics
- [ ] Math typesetting (not part of GFM)

## A code sample

\`\`\`ts
import { renderMarkdown } from "./lib/markdown";

export function preview(source: string): string {
  const { html, error } = renderMarkdown(source);
  if (error) return \`<p class="error">\${error}</p>\`;
  return html;
}
\`\`\`

## Sanitization rules

The preview never trusts the parser output. The pipeline is:

1. \`marked.parse(source, { gfm: true, breaks: true })\`
2. \`DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })\`
3. Only the sanitized string reaches \`dangerouslySetInnerHTML\`

That ordering matters — sanitize first, insert second.

---

Everything below the rule is plain prose so you can check paragraph rhythm and
line height. Resize the window: below 1280px the panes collapse into tabs and
the preview takes the full width, which is the width most people actually read
at.

> Good documentation is a sequence of small, verifiable claims.
`;
