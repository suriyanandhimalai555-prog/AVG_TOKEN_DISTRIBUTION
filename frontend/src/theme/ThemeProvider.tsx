import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyThemeClassToDocument,
  readStoredTheme,
  writeStoredTheme,
  type ThemeMode,
} from "./themeStorage";

/** Match `<html class="dark">` from `index.html` inline script (source of truth before React). */
function themeFromDocumentClass(): ThemeMode {
  if (typeof document === "undefined") return readStoredTheme();
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => themeFromDocumentClass());

  useLayoutEffect(() => {
    applyThemeClassToDocument(theme);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    writeStoredTheme(mode);
    applyThemeClassToDocument(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((t) => {
      const next: ThemeMode = t === "dark" ? "light" : "dark";
      writeStoredTheme(next);
      applyThemeClassToDocument(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
