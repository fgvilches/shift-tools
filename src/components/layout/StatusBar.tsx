import { useEffect, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { findTool } from "@/tools/registry";
import { isTauri } from "@/lib/ipc";
import { Dot } from "@/components/ui/Badge";

export function StatusBar() {
  const activeTool = useAppStore((s) => s.activeTool);
  const tool = findTool(activeTool);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <footer
      className="h-[26px] shrink-0 flex items-center justify-between gap-3 px-3 border-t border-white/[0.06] bg-surface-lowest/80 backdrop-blur-xl font-mono text-[9.5px] text-outline"
      role="status"
      aria-live="off"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex items-center gap-1.5">
          <Dot tone={isTauri ? "success" : "warning"} pulse={isTauri} />
          <span className={isTauri ? "text-secondary" : "text-warning"}>{isTauri ? "CONNECTED" : "PREVIEW"}</span>
        </span>
        <span className="text-white/12">|</span>
        <span className="text-on-variant truncate">{tool?.title ?? "—"}</span>
        <span className="text-white/12">|</span>
        <span className="truncate hidden sm:inline">{tool?.category ?? ""}</span>
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        <span className="hidden md:inline text-outline/70">⌘K dispatch · ⌘1–5 category · Esc dismiss</span>
        <span className="text-white/12">|</span>
        <span className="text-on-variant tnum">{now.toLocaleTimeString("en-GB", { hour12: false })}</span>
        <span className="text-white/12">|</span>
        <span className="text-outline/70">v1.0.0</span>
      </div>
    </footer>
  );
}
