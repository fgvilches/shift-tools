import { useEffect, useState } from "react";
import { ArrowUpCircle, Check, Download, RotateCw, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Feedback";
import { useUpdater } from "@/stores/updaterStore";
import { isTauri } from "@/lib/ipc";

/**
 * Updates surface as a strip above the tool content, never as a modal: it must
 * not interrupt whatever the person is doing. The strip only exists when there
 * is something to do — an available version, a download in flight, or a
 * finished install waiting for a restart.
 */
export function UpdateBanner() {
  const { info, installing, progress, installed, dismissed, install, restart, dismiss } = useUpdater();
  const [notesOpen, setNotesOpen] = useState(false);

  // Nothing to say outside the native shell, or when the user said "later".
  if (!isTauri) return null;

  if (installed) {
    return (
      <Banner>
        <span className="flex items-center gap-2 text-secondary">
          <Check size={13} />
          <span className="text-[12px] font-medium">shift-tools {installed} installed</span>
        </span>
        <span className="text-[11.5px] text-on-variant">Restart to run the new version.</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="xs" icon={<RotateCw size={11} />} onClick={() => void restart()}>
            Restart now
          </Button>
        </div>
      </Banner>
    );
  }

  if (!info?.available || dismissed) return null;

  return (
    <Banner>
      <span className="flex items-center gap-2 text-primary">
        <ArrowUpCircle size={13} />
        <span className="text-[12px] font-medium">Version {info.version} is available</span>
      </span>
      <Badge tone="neutral" mono className="hidden sm:inline-flex">
        {info.currentVersion ?? "?"} → {info.version}
      </Badge>

      {installing ? (
        <div className="ml-auto flex items-center gap-3 min-w-[220px]">
          <Progress
            value={progress != null ? progress * 100 : undefined}
            indeterminate={progress == null}
            height={3}
            className="flex-1"
            label="Downloading the update"
          />
          <span className="text-[11px] text-outline tabular-nums shrink-0">
            {progress != null ? `${Math.round(progress * 100)}%` : "downloading"}
          </span>
        </div>
      ) : (
        <div className="ml-auto flex items-center gap-2">
          {info.notes && (
            <Button size="xs" variant="ghost" onClick={() => setNotesOpen((v) => !v)}>
              {notesOpen ? "Hide notes" : "What's new"}
            </Button>
          )}
          <Button size="xs" icon={<Download size={11} />} onClick={() => void install()}>
            Install update
          </Button>
          <IconButton size="sm" label="Remind me later" icon={<X size={12} />} onClick={dismiss} />
        </div>
      )}

      {notesOpen && info.notes && (
        <div className="basis-full mt-1 max-h-28 overflow-y-auto rounded-lg border border-white/[0.07] bg-black/30 px-3 py-2">
          <pre className="whitespace-pre-wrap font-sans text-[11.5px] leading-relaxed text-on-variant">
            {info.notes}
          </pre>
        </div>
      )}
    </Banner>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-primary/20 bg-primary/[0.06] px-4 py-2"
    >
      {children}
    </div>
  );
}

/** Checks once, a few seconds after the window settles. */
export function useStartupUpdateCheck() {
  const check = useUpdater((s) => s.check);
  useEffect(() => {
    if (!isTauri) return;
    const timer = window.setTimeout(() => void check(true), 4000);
    return () => window.clearTimeout(timer);
  }, [check]);
}
