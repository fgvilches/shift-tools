import { useEffect, useState } from "react";
import { system } from "@/lib/api";
import { isTauri } from "@/lib/ipc";
import type { SystemStats } from "@/lib/types";

/** Polls host telemetry. Returns null until the first successful read. */
export function useSystemStats(intervalMs = 5000): SystemStats | null {
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    const read = async () => {
      try {
        const next = await system.stats();
        if (!cancelled) setStats(next);
      } catch {
        /* telemetry is best-effort; views surface their own errors */
      }
    };
    void read();
    const timer = window.setInterval(read, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return stats;
}
