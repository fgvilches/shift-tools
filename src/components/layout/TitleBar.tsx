import { ChevronRight, Command, PanelsTopLeft, Search, Settings2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { CATEGORIES, findTool } from "@/tools/registry";
import { useSystemStats } from "@/hooks/useSystemStats";
import { bytes, duration, percent } from "@/lib/format";
import { Kbd } from "@/components/ui/Button";

export function TitleBar() {
  const activeTool = useAppStore((s) => s.activeTool);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const stats = useSystemStats();
  const tool = findTool(activeTool);
  const category = CATEGORIES.find((c) => c.id === tool?.category);

  return (
    <header
      data-tauri-drag-region
      className="relative z-40 h-[52px] shrink-0 drag-region flex items-center justify-between gap-3 pl-[86px] pr-3
                 bg-surface-low/70 backdrop-blur-2xl border-b border-white/[0.06] shadow-[0_1px_0_rgba(255,255,255,0.05),0_8px_20px_-16px_rgba(0,0,0,0.9)]"
    >
      <div className="flex items-center gap-2 min-w-0 no-drag">
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          className="w-6 h-6 flex items-center justify-center rounded-md text-outline hover:text-on-surface hover:bg-white/[0.07] transition-colors"
        >
          <PanelsTopLeft size={13} />
        </button>
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 font-mono text-[10.5px] text-outline min-w-0">
          <span className="text-on-variant font-semibold">shift-tools</span>
          <ChevronRight size={10} className="opacity-50" />
          <span className="truncate max-w-[130px]">{category?.label ?? "Tools"}</span>
          <ChevronRight size={10} className="opacity-50" />
          <span className="text-on-surface truncate max-w-[180px]">{tool?.title ?? "—"}</span>
        </nav>
      </div>

      <div className="flex items-center gap-2 shrink-0 no-drag">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="group flex items-center gap-2 h-7 pl-2 pr-1.5 rounded-lg bg-black/40 border border-white/[0.07]
                     shadow-[inset_0_1px_2px_rgba(0,0,0,0.55)] hover:border-white/15 transition-colors"
          aria-label="Open quick dispatch command palette"
        >
          <Search size={12} className="text-outline group-hover:text-on-variant" />
          <span className="text-[11px] text-outline group-hover:text-on-variant w-[126px] text-left">Quick dispatch…</span>
          <Kbd>
            <span className="inline-flex items-center gap-0.5">
              <Command size={8} />K
            </span>
          </Kbd>
        </button>

        <div className="hidden md:flex items-center gap-2 h-7 px-2.5 rounded-full bg-black/30 border border-white/[0.06] font-mono text-[10px] text-outline">
          <span className="flex items-center gap-1">
            RAM
            <span className="text-primary-soft tnum">{stats ? bytes(stats.usedMemoryBytes) : "—"}</span>
            <span className="text-outline/50">/ {stats ? bytes(stats.totalMemoryBytes, 0) : "—"}</span>
          </span>
          <span className="text-white/15">•</span>
          <span className="flex items-center gap-1">
            CPU <span className={stats && stats.cpuUsagePercent > 70 ? "text-warning tnum" : "text-secondary tnum"}>{stats ? percent(stats.cpuUsagePercent) : "—"}</span>
          </span>
          <span className="text-white/15">•</span>
          <span className="flex items-center gap-1">
            UP <span className="text-on-variant tnum">{stats ? duration(stats.uptimeSecs) : "—"}</span>
          </span>
        </div>

        <button
          type="button"
          aria-label="Preferences"
          title="Preferences"
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.06] text-on-variant hover:text-on-surface hover:bg-white/[0.09] transition-colors"
        >
          <Settings2 size={14} />
        </button>
      </div>
    </header>
  );
}
