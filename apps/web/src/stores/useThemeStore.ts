import { create } from "zustand";

interface ThemeState {
  theme: "dark" | "light";
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: "dark",
  toggleTheme: () =>
    set((state) => {
      const nextTheme = state.theme === "dark" ? "light" : "dark";
      if (typeof window !== "undefined") {
        document.documentElement.classList.toggle("dark", nextTheme === "dark");
      }
      return { theme: nextTheme };
    }),
}));
