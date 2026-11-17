import { Component, Suspense, useCallback, useEffect } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { TitleBar } from "@/components/layout/TitleBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { StatusBar } from "@/components/layout/StatusBar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { Toaster } from "@/components/ui/Toast";
import { EmptyState, ErrorNotice } from "@/components/ui/Feedback";
import { useAppStore } from "@/stores/appStore";
import { CATEGORIES, TOOLS, findTool, toolsByCategory } from "@/tools/registry";

class ViewBoundary extends Component<{ children: ReactNode; toolId: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[view:${this.props.toolId}]`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4">
          <ErrorNotice
            title="This view failed to render"
            message={this.state.error.message}
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

function ViewFallback({ title }: { title: string }) {
  return (
    <div className="p-4 space-y-3">
      <div className="skeleton h-[92px] rounded-2xl" />
      <div className="skeleton h-8 w-52 rounded-lg" />
      <div className="skeleton h-[280px] rounded-xl" />
      <span className="sr-only">Loading {title}</span>
    </div>
  );
}

export default function App() {
  const activeTool = useAppStore((s) => s.activeTool);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);
  const paletteOpen = useAppStore((s) => s.paletteOpen);
  const pushRecent = useAppStore((s) => s.pushRecent);
  const tool = findTool(activeTool) ?? TOOLS[0]!;
  const Component = tool.component;

  const activate = useCallback(
    (id: string) => {
      setActiveTool(id);
      pushRecent(id);
    },
    [setActiveTool, pushRecent],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      if (meta && /^[1-5]$/.test(e.key)) {
        const category = CATEGORIES[Number(e.key) - 1];
        if (!category) return;
        const first = toolsByCategory(category.id)[0];
        if (first) {
          e.preventDefault();
          activate(first.id);
        }
      }
      if (e.key === "Escape" && paletteOpen) setPaletteOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activate, paletteOpen, setPaletteOpen]);

  return (
    <div className="h-screen flex flex-col overflow-hidden text-on-surface">
      <TitleBar />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main id="main-content" className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden" aria-label={`${tool.title} workspace`}>
          <ViewBoundary key={tool.id} toolId={tool.id}>
            <Suspense fallback={<ViewFallback title={tool.title} />}>
              <Component />
            </Suspense>
          </ViewBoundary>
          {!findTool(activeTool) && (
            <EmptyState title="Tool not found" description={`No view is registered for "${activeTool}".`} />
          )}
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
      <Toaster />
    </div>
  );
}
