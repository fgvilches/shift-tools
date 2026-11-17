import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { CornerDownLeft, Search } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { CATEGORIES, searchTools } from "@/tools/registry";
import { Kbd } from "@/components/ui/Button";

export function CommandPalette() {
  const open = useAppStore((s) => s.paletteOpen);
  const setOpen = useAppStore((s) => s.setPaletteOpen);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const pushRecent = useAppStore((s) => s.pushRecent);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchTools(query).slice(0, 40), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!open) return null;

  const choose = (index: number) => {
    const tool = results[index];
    if (!tool) return;
    setActiveTool(tool.id);
    pushRecent(tool.id);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(results.length - 1, c + 1));
      scrollIntoView(cursor + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
      scrollIntoView(cursor - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(cursor);
    }
  };

  const scrollIntoView = (index: number) => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    node?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh]" role="presentation">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={() => setOpen(false)} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick dispatch"
        className="glass-overlay relative w-[560px] max-w-[calc(100vw-48px)] rounded-2xl overflow-hidden anim-rise"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 px-3 h-11 border-b border-white/[0.07]">
          <Search size={14} className="text-outline shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools, keywords, categories…"
            aria-label="Search tools"
            className="flex-1 bg-transparent text-[13px] text-on-surface placeholder:text-outline/60 focus:outline-none"
          />
          <Kbd>esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1.5" role="listbox" aria-label="Matching tools">
          {results.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-outline">No tool matches “{query}”.</div>
          )}
          {results.map((tool, i) => {
            const Icon = tool.icon;
            const category = CATEGORIES.find((c) => c.id === tool.category);
            return (
              <div
                key={tool.id}
                role="option"
                aria-selected={i === cursor}
                data-index={i}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(i)}
                className={clsx(
                  "mx-1.5 px-2 py-1.5 rounded-lg flex items-center gap-2.5 cursor-pointer transition-colors",
                  i === cursor ? "bg-primary/18 text-on-surface" : "text-on-variant hover:bg-white/[0.05]",
                )}
              >
                <span
                  className={clsx(
                    "w-6 h-6 rounded-md flex items-center justify-center shrink-0 border",
                    i === cursor ? "bg-primary/25 border-primary/40 text-primary-soft" : "bg-white/[0.04] border-white/[0.07] text-outline",
                  )}
                >
                  <Icon size={12} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-medium truncate">{tool.title}</span>
                  <span className="block text-[10px] text-outline truncate">{tool.description}</span>
                </span>
                <span className="text-[9px] uppercase tracking-wider text-outline/70 shrink-0">{category?.label.split(" ")[0]}</span>
                {i === cursor && <CornerDownLeft size={11} className="text-primary-soft shrink-0" />}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-3 h-8 border-t border-white/[0.07] bg-black/25 text-[9.5px] font-mono text-outline">
          <span>{results.length} tools</span>
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> open
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
