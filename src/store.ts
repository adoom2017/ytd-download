import { create } from "zustand";
import type { AppView, ThemeMode } from "./types";

interface AppState {
  view: AppView;
  theme: ThemeMode;
  setView: (view: AppView) => void;
  setTheme: (theme: ThemeMode) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "search",
  theme: "system",
  setView: (view) => set({ view }),
  setTheme: (theme) => set({ theme }),
}));

