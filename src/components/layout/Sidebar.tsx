import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, Cpu } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { CATEGORIES, TOOLS } from "@/tools/registry";
import { Logo } from "./Logo";
import { Dot } from "@/components/ui/Badge";
import { useSystemStats } from "@/hooks/useSystemStats";
import { isTauri } from "@/lib/ipc";
import { useUpdater } from "@/stores/updaterStore";

export function Sidebar() {
  const activeTool = useAppStore((s) => s.activeTool);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const pushRecent = useAppStore((s) => s.pushRecent);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const appVersion = useUpdater((s) => s.current);
  const toggle = useAppStore((s) => s.toggleSidebar);
  const stats = useSystemStats(8000);
  const activeCategory = TOOLS.find((t) => t.id === activeTool)?.category;
  const [closedGroups, setClosedGroups] = useState<Set<string>>(
    () => new Set(CATEGORIES.filter((c) => c.id !== activeCategory).map((c) => c.id)),
  );

  // Keep the group of the active tool open when navigation happens from the palette.
  useEffect(() => {
    if (!activeCategory) return;
    setClosedGroups((prev) => {
      if (!prev.has(activeCategory)) return prev;
      const next = new Set(prev);
      next.delete(activeCategory);
      return next;
    });
  }, [activeCategory]);

  const toggleGroup = (id: string) =>
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const grouped = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        tools: TOOLS.filter((t) => t.category === category.id),
      })),
    [],
  );

  if (collapsed) {
    return (
      <aside className="w-[52px] shrink-0 glass-pane flex flex-col items-center py-2 gap-1 border-r border-white/[0.06]">
        <button
          type="button"
          onClick={toggle}
          aria-label="Expand sidebar"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-outline hover:text-on-surface hover:bg-white/[0.07] mb-1"
        >
          <ChevronLeft size={14} className="rotate-180" />
        </button>
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const active = tool.id === activeTool;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => {
                setActiveTool(tool.id);
                pushRecent(tool.id);
              }}
              title={tool.title}
              aria-label={tool.title}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "w-8 h-8 flex items-center justify-center rounded-lg transition-colors",
                active
                  ? "bg-primary-container text-on-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                  : "text-on-variant hover:text-on-surface hover:bg-white/[0.07]",
              )}
            >
              <Icon size={14} />
            </button>
          );
        })}
      </aside>
    );
  }

  return (
    <aside className="w-[232px] shrink-0 glass-pane flex flex-col justify-between border-r border-white/[0.06]">
      <div className="flex flex-col min-h-0">
        <div className="shrink-0 pl-3 pr-2 py-2 flex items-center gap-2.5 min-h-[52px]">
          <Logo size={26} />
          <div className="min-w-0 flex-1 flex flex-col gap-[3px]">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-[13px] font-semibold tracking-tight text-on-surface leading-none whitespace-nowrap">
                shift-tools
              </span>
              <span className="shrink-0 text-[8.5px] font-mono leading-none px-1 py-[2px] rounded bg-primary/15 text-primary-soft border border-primary/25">
                v{appVersion ?? "1.0"}
              </span>
            </div>
            <span
              className="block truncate font-mono text-[9.5px] leading-none text-outline"
              title="macOS native · Rust core"
            >
              macOS native · Rust core
            </span>
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-outline hover:text-on-surface hover:bg-white/[0.07] transition-colors"
          >
            <ChevronLeft size={13} />
          </button>
        </div>

        <div className="h-px bg-white/[0.06] mx-2" />

        <nav aria-label="Tool categories" className="flex-1 overflow-y-auto px-2 py-1.5 space-y-1.5">
          {grouped.map(({ category, tools }) => {
            const Icon = category.icon;
            const open = !closedGroups.has(category.id);
            return (
              <div key={category.id} className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => toggleGroup(category.id)}
                  aria-expanded={open}
                  className="w-full flex items-center gap-1.5 px-1.5 pt-1 pb-1 rounded-md hover:bg-white/[0.04] transition-colors group/sec"
                >
                  <Icon size={10} className="text-outline/70" />
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-outline text-left">
                    {category.label}
                  </span>
                  <span className="ml-auto font-mono text-[9px] text-outline/50 tnum">{tools.length}</span>
                  <ChevronRight
                    size={9}
                    className={clsx("text-outline/60 transition-transform duration-150", open && "rotate-90")}
                  />
                </button>
                {open && tools.map((tool) => {
                  const ToolIcon = tool.icon;
                  const active = tool.id === activeTool;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => {
                        setActiveTool(tool.id);
                        pushRecent(tool.id);
                      }}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "group w-full flex items-center gap-2 px-1.5 h-[26px] rounded-md text-left transition-colors",
                        active
                          ? "bg-primary-container/95 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_10px_-4px_rgba(62,144,255,0.7)]"
                          : "text-on-variant hover:bg-white/[0.06] hover:text-on-surface",
                      )}
                    >
                      <ToolIcon size={12} className={active ? "text-white" : "text-outline group-hover:text-on-variant"} />
                      <span className="text-[11.5px] truncate flex-1">{tool.title}</span>
                      {active && <Dot tone="success" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </div>

      <div className="p-2">
        <div className="rounded-xl bg-black/35 border border-white/[0.055] px-2.5 py-2 space-y-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-outline">Host node</span>
            <span className="font-mono text-[9.5px] px-1.5 py-[1px] rounded bg-white/[0.07] text-primary-soft border border-white/[0.06] truncate max-w-[110px]">
              {stats?.cpuBrand ? stats.cpuBrand.replace(/\(R\)|\(TM\)|CPU|@.*/g, "").trim().slice(0, 18) : "Apple Silicon"}
            </span>
          </div>
          <div className="flex items-center justify-between font-mono text-[9.5px] text-outline">
            <span className="flex items-center gap-1.5">
              <Dot tone={isTauri ? "success" : "warning"} pulse={isTauri} />
              {isTauri ? "Rust core" : "Browser preview"}
            </span>
            <span className={isTauri ? "text-secondary" : "text-warning"}>
              {isTauri ? "IPC ready" : "no IPC"}
            </span>
          </div>
          <div className="flex items-center justify-between font-mono text-[9.5px] text-outline">
            <span className="flex items-center gap-1.5">
              <Cpu size={9} />
              {stats ? `${stats.cpuCores} cores` : "—"}
            </span>
            <span className="text-on-variant tnum">{stats?.arch ?? "—"}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
