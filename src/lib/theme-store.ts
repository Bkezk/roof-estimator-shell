/**
 * The theme context object and hook, apart from the provider component (lib/theme-context.tsx)
 * so a hot reload of the provider never mints a new context while the mounted tree holds the
 * old one — the same split as auth-store.ts / auth-context.tsx.
 */
import { createContext, useContext } from "react";

import type { ResolvedTheme, ThemePref } from "@/lib/theme";

export interface ThemeState {
  /** The saved preference ("system" until someone toggles). */
  pref: ThemePref;
  /** What the screen shows now. */
  resolved: ResolvedTheme;
  /** Flip between light and dark (cached in the browser and saved to the profile). */
  toggle: () => void;
}

const g = globalThis as { __jbkThemeContext?: ReturnType<typeof createThemeContext> };
function createThemeContext() {
  return createContext<ThemeState | null>(null);
}
export const ThemeContext = (g.__jbkThemeContext ??= createThemeContext());

const OUTSIDE: ThemeState = { pref: "system", resolved: "light", toggle: () => undefined };

/** The theme state; light and inert outside a ThemeProvider. */
export function useTheme(): ThemeState {
  return useContext(ThemeContext) ?? OUTSIDE;
}
