import { create } from "zustand";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "theme";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  syncFromDocument: () => void;
}

const applyTheme = (theme: Theme) => {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.style.colorScheme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "dark",
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
  syncFromDocument: () => {
    if (typeof window === "undefined") return;
    set({ theme: document.documentElement.classList.contains("light") ? "light" : "dark" });
  },
}));
