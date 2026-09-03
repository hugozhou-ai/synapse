import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const visualThemes = [
  { id: "native-calm", name: "Native Calm", description: "接近 macOS 与 ChatGPT 的克制、高效界面。" },
  { id: "editorial", name: "Editorial", description: "保留原有的编辑式网格、硬边框与强排版风格。" },
] as const;

export type VisualTheme = typeof visualThemes[number]["id"];

const storageKey = "synapse.visual-theme";
const defaultTheme: VisualTheme = "native-calm";

function isVisualTheme(value: unknown): value is VisualTheme {
  return visualThemes.some((theme) => theme.id === value);
}

export function readStoredTheme(storage: Pick<Storage, "getItem"> = localStorage): VisualTheme {
  try {
    const stored = storage.getItem(storageKey);
    return isVisualTheme(stored) ? stored : defaultTheme;
  } catch {
    return defaultTheme;
  }
}

export function applyTheme(theme: VisualTheme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
}

type ThemeContextValue = {
  readonly theme: VisualTheme;
  setTheme(theme: VisualTheme): void;
};

const ThemeContext = createContext<ThemeContextValue>({ theme: defaultTheme, setTheme: () => undefined });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<VisualTheme>(() => readStoredTheme());

  const setTheme = useCallback((nextTheme: VisualTheme) => {
    setThemeState(nextTheme);
    applyTheme(nextTheme);
    try { localStorage.setItem(storageKey, nextTheme); } catch { /* The active document still receives the theme. */ }
  }, []);

  useEffect(() => {
    applyTheme(theme);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || !isVisualTheme(event.newValue)) return;
      setThemeState(event.newValue);
      applyTheme(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

