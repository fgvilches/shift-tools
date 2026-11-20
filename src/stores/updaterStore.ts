import { create } from "zustand";
import { app } from "@/lib/api";
import { errorMessage } from "@/lib/ipc";
import type { UpdateCheck } from "@/lib/types";

interface UpdaterState {
  /** Installed version, read once at startup. */
  current: string | null;
  info: UpdateCheck | null;
  checking: boolean;
  installing: boolean;
  /** 0..1 while downloading, null when the total is unknown. */
  progress: number | null;
  installed: string | null;
  /** The user chose "later" for this exact version. */
  dismissed: boolean;
  check: (silent?: boolean) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdater = create<UpdaterState>()((set, get) => ({
  current: null,
  info: null,
  checking: false,
  installing: false,
  progress: null,
  installed: null,
  dismissed: false,

  check: async (silent = false) => {
    if (get().checking || get().installing) return;
    set({ checking: true });
    try {
      const version = await app.currentVersion();
      const info = await app.checkUpdates();
      set((state) => ({
        current: version.version,
        info,
        checking: false,
        // A version newer than the one dismissed is worth surfacing again.
        dismissed: info.version === state.info?.version ? state.dismissed : false,
      }));
    } catch (err) {
      set({
        checking: false,
        info: silent ? get().info : { available: false, error: errorMessage(err) },
      });
    }
  },

  install: async () => {
    if (get().installing) return;
    set({ installing: true, progress: 0 });
    const unsubscribe = app.onUpdateProgress(({ chunk, total }) => {
      set({ progress: total && total > 0 ? Math.min(1, chunk / total) : null });
    });
    try {
      const result = await app.installUpdate();
      set({ installing: false, installed: result.installed ? (result.version ?? null) : null });
    } catch (err) {
      const message = errorMessage(err);
      // A failed install must say why: silence here reads as a dead button.
      console.error("[updater] install failed:", message);
      set({
        installing: false,
        progress: null,
        info: { available: true, version: get().info?.version, error: message },
      });
    } finally {
      unsubscribe();
    }
  },

  restart: async () => {
    await app.restartApp();
  },

  dismiss: () => set({ dismissed: true }),
}));
