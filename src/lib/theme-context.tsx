/**
 * The app's light / dark state (dark mode, owner Oct 2). The `dark` class on <html> is first set
 * by THEME_BOOT_SCRIPT before paint; this provider takes over once React runs:
 *
 * - The browser's cached choice (localStorage) is the starting point; "system" follows the OS
 *   and updates live when the OS setting changes.
 * - After sign-in the profile's saved value wins and is written back to the browser's copy.
 * - The toggle flips light <-> dark, caches it, and saves it to the profile.
 * - Printing is always light (the proposal prints from the browser): the class comes off for
 *   the print and goes back after.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth-store";
import {
  DARK_CLASS,
  DARK_QUERY,
  applyTheme,
  nextTheme,
  readStoredTheme,
  resolveTheme,
  writeStoredTheme,
  type ThemePref,
} from "@/lib/theme";
import { getMyTheme, setMyTheme } from "@/lib/theme.functions";
import { ThemeContext } from "@/lib/theme-store";

const browser = typeof window !== "undefined";
const storage = () => {
  try {
    return browser ? window.localStorage : null;
  } catch {
    return null;
  }
};
const systemDarkNow = () => browser && !!window.matchMedia && window.matchMedia(DARK_QUERY).matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [pref, setPref] = useState<ThemePref>(() => readStoredTheme(storage()));
  const [systemDark, setSystemDark] = useState<boolean>(systemDarkNow);
  const resolved = resolveTheme(pref, systemDark);

  // Put it on <html> whenever it changes (the boot script already did the first one).
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;
  useEffect(() => {
    applyTheme(document.documentElement, resolved);
  }, [resolved]);

  // "System" follows the OS live.
  useEffect(() => {
    if (pref !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystemDark(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  // Paper is white: print in light mode, then put the theme back.
  useEffect(() => {
    const before = () => document.documentElement.classList.remove(DARK_CLASS);
    const after = () => applyTheme(document.documentElement, resolvedRef.current);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  // After sign-in the profile's value wins (unless the user toggled while it was loading).
  const toggles = useRef(0);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    const at = toggles.current;
    getMyTheme()
      .then(({ theme }) => {
        if (!live || !theme || toggles.current !== at) return;
        setPref(theme);
        writeStoredTheme(storage(), theme);
      })
      .catch((e: unknown) => console.warn("Could not read the saved theme", e));
    return () => {
      live = false;
    };
  }, [userId]);

  const toggle = useCallback(() => {
    const next = nextTheme(resolvedRef.current);
    toggles.current += 1;
    setPref(next);
    writeStoredTheme(storage(), next);
    if (!userId) return;
    // Best effort: the browser's copy already holds the choice.
    setMyTheme({ data: { theme: next } })
      .then((r) => {
        if (!r.saved) console.warn("The theme was not saved to the profile:", r.error);
      })
      .catch((e: unknown) => console.warn("The theme was not saved to the profile", e));
  }, [userId]);

  return (
    <ThemeContext.Provider value={{ pref, resolved, toggle }}>{children}</ThemeContext.Provider>
  );
}
