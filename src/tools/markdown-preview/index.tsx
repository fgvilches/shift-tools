import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  Clock,
  ClipboardType,
  Copy,
  Download,
  Eye,
  FileText,
  Hash,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  ListTree,
  Minus,
  PenLine,
  ShieldCheck,
  Sparkles,
  SquareCode,
  Table2,
  TextQuote,
  Trash2,
  Code,
  Columns2,
} from "lucide-react";
import { clsx } from "clsx";
import { ToolView } from "@/components/layout/ToolView";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton, Kbd } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CodeArea, CopyButton } from "@/components/ui/CodeArea";
import { SegmentedControl } from "@/components/ui/Form";
import { ConfirmDialog } from "@/components/ui/Modal";
import { EmptyState, ErrorNotice } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { toast } from "@/components/ui/Toast";
import { isTauri } from "@/lib/ipc";
import { plural } from "@/lib/format";
import { applyFormat, type FormatAction } from "./lib/format";
import { buildStandaloneHtml, documentTitle, renderMarkdown, slugifyTitle } from "./lib/markdown";
import { SAMPLE_DOCUMENT } from "./lib/sample";
import "@/tools/markdown-preview/markdown.css";

type ViewMode = "split" | "editor" | "preview";
type SmallTab = "editor" | "preview";

const FORMAT_GROUPS: { action: FormatAction; label: string; icon: React.ReactNode }[][] = [
  [
    { action: "bold", label: "Bold", icon: <Bold size={13} /> },
    { action: "italic", label: "Italic", icon: <Italic size={13} /> },
  ],
  [
    { action: "heading", label: "Heading level 2", icon: <Heading2 size={13} /> },
    { action: "link", label: "Link", icon: <Link2 size={13} /> },
  ],
  [
    { action: "code", label: "Inline code", icon: <Code size={13} /> },
    { action: "codeblock", label: "Code block", icon: <SquareCode size={13} /> },
  ],
  [
    { action: "list", label: "Bullet list", icon: <List size={13} /> },
    { action: "quote", label: "Blockquote", icon: <TextQuote size={13} /> },
  ],
  [
    { action: "table", label: "Table", icon: <Table2 size={13} /> },
    { action: "hr", label: "Horizontal rule", icon: <Minus size={13} /> },
  ],
];

/** Wraps or inserts Markdown at the current selection; selection maths live in lib/format. */
function FormatToolbar({
  onFormat,
  disabled,
}: {
  onFormat: (action: FormatAction) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Markdown formatting"
      aria-disabled={disabled}
      // Keeping the textarea focused preserves its selection when a button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      className="flex flex-wrap items-center gap-0.5"
    >
      {FORMAT_GROUPS.map((group, index) => (
        <div key={index} className="flex items-center gap-0.5">
          {index > 0 && <span aria-hidden className="w-px h-4 bg-white/[0.08] mx-1" />}
          {group.map((item) => (
            <IconButton
              key={item.action}
              label={item.label}
              icon={item.icon}
              size="sm"
              disabled={disabled}
              onClick={() => onFormat(item.action)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function MarkdownPreviewView() {
  const [source, setSource] = useState(SAMPLE_DOCUMENT);
  const [mode, setMode] = useState<ViewMode>("split");
  const [smallTab, setSmallTab] = useState<SmallTab>("editor");
  const [confirmClear, setConfirmClear] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);

  const render = useMemo(() => renderMarkdown(source), [source]);
  const title = useMemo(() => documentTitle(source, render.stats.outline), [source, render.stats.outline]);
  const stats = render.stats;
  const hasContent = source.trim().length > 0;

  useEffect(() => {
    textareaRef.current = editorRef.current?.querySelector("textarea") ?? null;
  }, []);

  /** Restore the caret after a toolbar edit replaced the textarea value. */
  useEffect(() => {
    const pending = pendingSelection.current;
    if (!pending) return;
    pendingSelection.current = null;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(pending.start, pending.end);
  }, [source]);

  const runFormat = useCallback(
    (action: FormatAction) => {
      const textarea = textareaRef.current;
      const start = textarea ? textarea.selectionStart : source.length;
      const end = textarea ? textarea.selectionEnd : source.length;
      const result = applyFormat(source, start, end, action);
      if (result.value === source) return;
      pendingSelection.current = { start: result.selectionStart, end: result.selectionEnd };
      setSource(result.value);
      if (mode === "preview") setMode("split");
    },
    [mode, source],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      const action: FormatAction | null = key === "b" ? "bold" : key === "i" ? "italic" : key === "k" ? "link" : null;
      if (!action) return;
      const active = document.activeElement as HTMLElement | null;
      const textarea = textareaRef.current;
      const insideEditor = textarea !== null && (active === textarea || editorRef.current?.contains(active) === true);
      if (!insideEditor) return;
      event.preventDefault();
      runFormat(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runFormat]);

  const copyText = useCallback(async (text: string, label: string) => {
    if (text.length === 0) {
      toast.warning(`Nothing to copy`, `The ${label.toLowerCase()} is empty.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`, `${text.length.toLocaleString("en-US")} characters on the clipboard.`);
    } catch (error) {
      toast.error("Clipboard rejected the write", error instanceof Error ? error.message : "Clipboard access was denied.");
    }
  }, []);

  const exportHtml = useCallback(() => {
    if (render.html.length === 0) {
      toast.warning("Nothing to export", "The document renders to an empty body.");
      return;
    }
    const html = buildStandaloneHtml(title, render.html);
    const filename = `${slugifyTitle(title)}.html`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast.success("Standalone HTML exported", `${filename} · ${(html.length / 1024).toFixed(1)} KB with the dark theme inlined.`);
  }, [render.html, title]);

  const loadSample = useCallback(() => {
    pendingSelection.current = { start: 0, end: 0 };
    setSource(SAMPLE_DOCUMENT);
    setConfirmClear(false);
    toast.success("Sample document loaded", "Every supported GFM block is in the source pane.");
  }, []);

  const openLink = useCallback(async (href: string) => {
    try {
      if (isTauri) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(href);
        return;
      }
      const opened = window.open(href, "_blank", "noopener,noreferrer");
      if (!opened) toast.warning("Popup blocked", href);
    } catch (error) {
      toast.error("Could not open the link", error instanceof Error ? error.message : href);
    }
  }, []);

  const onPreviewClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (href.length === 0 || href.startsWith("#")) return;
    // The preview must never navigate the app shell away.
    event.preventDefault();
    void openLink(href);
  };

  const editorVisibleSmall = mode === "editor" || (mode === "split" && smallTab === "editor");
  const previewVisibleSmall = mode === "preview" || (mode === "split" && smallTab === "preview");

  return (
    <>
      <ToolView
        eyebrow="RENDERER"
        eyebrowTone="success"
        eyebrowHint="MARKED 18 · DOMPURIFY 3"
        title="Markdown Preview"
        description="Write Markdown on the left, read rendered output on the right, export to HTML."
        className="h-full"
        telemetry={[
          { label: "Words", value: stats.words.toLocaleString("en-US"), tone: "primary", icon: <Hash size={14} /> },
          {
            label: "Characters",
            value: stats.characters.toLocaleString("en-US"),
            tone: "neutral",
            icon: <FileText size={14} />,
          },
          {
            label: "Reading time",
            value: stats.readingMinutes === 0 ? "—" : `${stats.readingMinutes} min`,
            tone: "tertiary",
            icon: <Clock size={14} />,
          },
          { label: "Headings", value: String(stats.headings), tone: "success", icon: <ListTree size={14} /> },
        ]}
        toolbar={
          <>
            <Button variant="primary" icon={<Download size={13} />} onClick={exportHtml} disabled={!hasContent}>
              Export HTML
            </Button>
            <Button icon={<Copy size={13} />} onClick={() => void copyText(render.html, "HTML")} disabled={!hasContent}>
              Copy HTML
            </Button>
            <Button
              icon={<ClipboardType size={13} />}
              onClick={() => void copyText(render.plain, "Plain text")}
              disabled={!hasContent}
            >
              Copy text
            </Button>
            <Button variant="ghost" icon={<Sparkles size={13} />} onClick={loadSample}>
              Load sample
            </Button>
            <IconButton
              label="Clear the document"
              icon={<Trash2 size={13} />}
              tone="danger"
              onClick={() => setConfirmClear(true)}
              disabled={!hasContent}
            />
          </>
        }
        status={
          <SegmentedControl
            value={mode}
            onChange={setMode}
            ariaLabel="Change the pane layout"
            options={[
              { value: "split", label: "Split", icon: <Columns2 size={11} /> },
              { value: "editor", label: "Editor", icon: <PenLine size={11} /> },
              { value: "preview", label: "Preview", icon: <Eye size={11} /> },
            ]}
          />
        }
      >
        <div className="xl:hidden">
          <Tabs
            value={smallTab}
            onChange={setSmallTab}
            ariaLabel="Switch between the editor and the preview"
            items={[
              { value: "editor", label: "Editor", icon: <PenLine size={12} />, count: stats.lines },
              { value: "preview", label: "Preview", icon: <Eye size={12} /> },
            ]}
          />
        </div>

        <div className={clsx("grid flex-1 min-h-[320px] gap-3", mode === "split" && "xl:grid-cols-2")}>
          <Card
            className={clsx(
              "min-h-0 min-w-0 flex-col overflow-hidden",
              mode === "preview" ? "xl:hidden" : "xl:flex",
              editorVisibleSmall ? "flex" : "hidden",
            )}
          >
            <CardHeader
              title="Markdown source"
              hint={`${plural(stats.lines, "line")} · UTF-8 · LF · GFM`}
              icon={<FileText size={13} />}
              actions={
                <>
                  <span className="hidden 2xl:flex items-center gap-1 text-[10px] text-outline">
                    <Kbd>⌘B</Kbd>
                    <Kbd>⌘I</Kbd>
                    <Kbd>⌘K</Kbd>
                  </span>
                  <Badge tone="primary" mono>
                    GFM
                  </Badge>
                  <CopyButton text={source} label="Source" />
                </>
              }
            />
            <div ref={editorRef} className="flex flex-1 min-h-0 p-2">
              <CodeArea
                value={source}
                onChange={setSource}
                ariaLabel="Markdown source editor"
                placeholder="# Start writing"
                minHeight={0}
                wrap
                className="flex-1 min-h-0"
                toolbar={
                  <>
                    <FormatToolbar onFormat={runFormat} disabled={false} />
                    <span className="hidden 2xl:flex items-center gap-1 shrink-0 text-[9.5px] uppercase tracking-[0.08em] text-outline">
                      <Kbd>⇥</Kbd> indent
                    </span>
                  </>
                }
              />
            </div>
          </Card>

          <Card
            className={clsx(
              "min-h-0 min-w-0 flex-col overflow-hidden",
              mode === "editor" ? "xl:hidden" : "xl:flex",
              previewVisibleSmall ? "flex" : "hidden",
            )}
          >
            <CardHeader
              title="Rendered preview"
              hint={`${title} · ${plural(stats.words, "word")}`}
              icon={<Eye size={13} />}
              actions={
                <>
                  <Badge tone="success" dot>
                    Sanitized
                  </Badge>
                  <CopyButton text={render.html} label="HTML" />
                </>
              }
            />
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3.5">
              {render.error ? (
                <ErrorNotice title="Render failed" message={render.error} />
              ) : !hasContent ? (
                <EmptyState
                  icon={<FileText size={16} />}
                  title="Nothing to render"
                  description="Type Markdown in the editor, or load the sample document to see every supported block."
                  action={
                    <Button size="xs" icon={<Sparkles size={12} />} onClick={loadSample}>
                      Load sample
                    </Button>
                  }
                />
              ) : (
                /*
                 * The only innerHTML sink in this view. `render.html` is produced by
                 * DOMPurify.sanitize() in lib/markdown.ts — sanitize first, insert second.
                 */
                <div
                  role="document"
                  aria-label="Rendered Markdown preview"
                  onClick={onPreviewClick}
                  className="md-body anim-rise mx-auto w-full max-w-[760px]"
                  dangerouslySetInnerHTML={{ __html: render.html }}
                />
              )}
            </div>
          </Card>
        </div>

        <Card className="shrink-0 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-[10px] text-outline">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 min-w-0">
              <span className="flex items-center gap-1.5 text-on-variant">
                <ListChecks size={11} className="text-outline" />
                {stats.tasks > 0 ? `${stats.tasksDone}/${stats.tasks} tasks` : "no tasks"}
              </span>
              <span>{plural(stats.codeBlocks, "code block")}</span>
              <span>{plural(stats.tables, "table")}</span>
              <span>{plural(stats.links, "link")}</span>
              <span>{plural(stats.images, "image")}</span>
              <span className="text-outline/70">{stats.charactersNoSpaces.toLocaleString("en-US")} non-space chars</span>
            </div>
            <span className="flex items-center gap-1.5 shrink-0">
              <ShieldCheck size={11} className="text-secondary" />
              DOMPurify pass · nothing leaves the app
            </span>
          </div>
        </Card>
      </ToolView>

      <ConfirmDialog
        open={confirmClear}
        destructive
        title="Clear the document?"
        message={`The ${plural(stats.lines, "line")} in the source pane and the rendered preview are discarded. Files you already exported are untouched.`}
        confirmLabel="Clear document"
        onConfirm={() => {
          pendingSelection.current = { start: 0, end: 0 };
          setSource("");
          setConfirmClear(false);
          toast.info("Document cleared", "The preview is empty until you type again.");
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </>
  );
}
