import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  activeTool: string;
  setActiveTool: (id: string) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  recentTools: string[];
  pushRecent: (id: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeTool: "process-killer",
      setActiveTool: (id) => set({ activeTool: id, paletteOpen: false }),
      paletteOpen: false,
      setPaletteOpen: (open) => set({ paletteOpen: open }),
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      recentTools: [],
      pushRecent: (id) =>
        set((s) => ({ recentTools: [id, ...s.recentTools.filter((t) => t !== id)].slice(0, 6) })),
    }),
    {
      name: "shift-tools.app",
      partialize: (state) => ({
        activeTool: state.activeTool,
        sidebarCollapsed: state.sidebarCollapsed,
        recentTools: state.recentTools,
      }),
    },
  ),
);
