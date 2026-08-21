import { create } from "zustand";
import type { AppView, DownloadPreset, ThemeMode, VideoSummary } from "./types";

export interface SearchSession {
  query: string;
  results: VideoSummary[];
  selected: Set<string>;
  loading: boolean;
  error: string | null;
  hasSearched: boolean;
  preset: DownloadPreset;
}

const createInitialSearchSession = (): SearchSession => ({
  query: "",
  results: [],
  selected: new Set(),
  loading: false,
  error: null,
  hasSearched: false,
  preset: "video1080",
});

interface AppState {
  view: AppView;
  theme: ThemeMode;
  searchSession: SearchSession;
  setView: (view: AppView) => void;
  setTheme: (theme: ThemeMode) => void;
  updateSearchSession: (update: Partial<SearchSession> | ((current: SearchSession) => Partial<SearchSession>)) => void;
  resetSearchSession: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "search",
  theme: "system",
  searchSession: createInitialSearchSession(),
  setView: (view) => set({ view }),
  setTheme: (theme) => set({ theme }),
  updateSearchSession: (update) => set((state) => ({
    searchSession: {
      ...state.searchSession,
      ...(typeof update === "function" ? update(state.searchSession) : update),
    },
  })),
  resetSearchSession: () => set({ searchSession: createInitialSearchSession() }),
}));
