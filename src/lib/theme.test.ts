/**
 * Dark mode (owner, Oct 2), the pure theme logic in lib/theme.ts: resolving a preference,
 * the toggle, the browser cache, light-only captures, and the boot script inlined in the root
 * document — run here against stand-ins for window, localStorage, matchMedia and <html>.
 */
import { describe, expect, it } from "vitest";

import {
  DARK_CLASS,
  DARK_QUERY,
  THEME_BOOT_SCRIPT,
  THEME_PREFS,
  THEME_STORAGE_KEY,
  applyTheme,
  isThemePref,
  nextTheme,
  readStoredTheme,
  resolveTheme,
  toggleLabel,
  withLightTheme,
  writeStoredTheme,
} from "@/lib/theme";

/** A <html> stand-in with a real class list semantics. */
function fakeRoot(initial: string[] = []) {
  const set = new Set(initial);
  return {
    set,
    classList: {
      add: (c: string) => void set.add(c),
      remove: (c: string) => void set.delete(c),
      contains: (c: string) => set.has(c),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !set.has(c);
        if (on) set.add(c);
        else set.delete(c);
        return on;
      },
    },
  };
}

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe("resolveTheme / nextTheme / toggleLabel", () => {
  it("an explicit choice wins over the OS", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("system (and nothing saved) follows the OS", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(undefined, false)).toBe("light");
  });
  it("the toggle flips what is showing, never back to system", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });
  it("labels name the mode you switch to", () => {
    expect(toggleLabel("light")).toBe("Switch to dark mode");
    expect(toggleLabel("dark")).toBe("Switch to light mode");
  });
  it("the three preferences, nothing else", () => {
    expect([...THEME_PREFS]).toEqual(["light", "dark", "system"]);
    for (const v of THEME_PREFS) expect(isThemePref(v)).toBe(true);
    for (const v of ["", "Dark", "auto", null, undefined, 1]) expect(isThemePref(v)).toBe(false);
  });
});

describe("the browser cache", () => {
  it("reads a saved choice; anything else is system", () => {
    expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("dark");
    expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: "light" }))).toBe("light");
    expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: "purple" }))).toBe("system");
    expect(readStoredTheme(memoryStorage())).toBe("system");
    expect(readStoredTheme(null)).toBe("system");
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };
    expect(readStoredTheme(throwing)).toBe("system");
  });
  it("writes under the key, and a blocked store does not throw", () => {
    const s = memoryStorage();
    writeStoredTheme(s, "dark");
    expect(s.m.get(THEME_STORAGE_KEY)).toBe("dark");
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeStoredTheme(throwing, "light")).not.toThrow();
  });
});

describe("applyTheme / withLightTheme", () => {
  it("puts the dark class on and takes it off", () => {
    const r = fakeRoot();
    applyTheme(r, "dark");
    expect(r.set.has(DARK_CLASS)).toBe(true);
    applyTheme(r, "light");
    expect(r.set.has(DARK_CLASS)).toBe(false);
  });
  it("runs a capture in light mode and puts dark back after, even on failure", async () => {
    const r = fakeRoot([DARK_CLASS]);
    const seen = await withLightTheme(r, async () => r.set.has(DARK_CLASS));
    expect(seen).toBe(false);
    expect(r.set.has(DARK_CLASS)).toBe(true);
    await expect(
      withLightTheme(r, async () => {
        throw new Error("capture failed");
      }),
    ).rejects.toThrow("capture failed");
    expect(r.set.has(DARK_CLASS)).toBe(true);
  });
  it("leaves a light page light", async () => {
    const r = fakeRoot();
    await withLightTheme(r, async () => undefined);
    expect(r.set.has(DARK_CLASS)).toBe(false);
  });
});

describe("THEME_BOOT_SCRIPT (inlined before first paint)", () => {
  /** Run the script string with stand-in globals; returns whether <html> ended up dark. */
  function boot(opts: {
    stored?: string | null;
    osDark?: boolean;
    noMatchMedia?: boolean;
    storageThrows?: boolean;
  }) {
    const root = fakeRoot();
    const queries: string[] = [];
    const window = {
      localStorage: {
        getItem: (k: string) => {
          if (opts.storageThrows) throw new Error("SecurityError");
          return k === THEME_STORAGE_KEY ? (opts.stored ?? null) : null;
        },
      },
      matchMedia: opts.noMatchMedia
        ? undefined
        : (q: string) => {
            queries.push(q);
            return { matches: !!opts.osDark };
          },
    };
    const document = { documentElement: root };
    new Function("window", "document", THEME_BOOT_SCRIPT)(window, document);
    return { dark: root.set.has(DARK_CLASS), queries };
  }

  it("a saved dark is dark, whatever the OS", () => {
    expect(boot({ stored: "dark", osDark: false }).dark).toBe(true);
  });
  it("a saved light is light, whatever the OS (and the OS is not asked)", () => {
    const r = boot({ stored: "light", osDark: true });
    expect(r.dark).toBe(false);
    expect(r.queries).toEqual([]);
  });
  it("system or nothing saved follows prefers-color-scheme", () => {
    expect(boot({ stored: "system", osDark: true })).toEqual({ dark: true, queries: [DARK_QUERY] });
    expect(boot({ stored: null, osDark: true }).dark).toBe(true);
    expect(boot({ stored: null, osDark: false }).dark).toBe(false);
    expect(boot({ stored: "nonsense", osDark: true }).dark).toBe(true);
  });
  it("no matchMedia or a blocked localStorage leaves the page light and never throws", () => {
    expect(boot({ stored: null, noMatchMedia: true }).dark).toBe(false);
    expect(boot({ storageThrows: true, osDark: true }).dark).toBe(false);
  });
  it("is self-contained ES5 that reads the same key the app writes", () => {
    expect(THEME_BOOT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(THEME_BOOT_SCRIPT).toContain(JSON.stringify(DARK_QUERY));
    expect(THEME_BOOT_SCRIPT).not.toMatch(/\b(import|export|const|let)\b/);
    expect(THEME_BOOT_SCRIPT).not.toContain("=>");
    expect(THEME_BOOT_SCRIPT.startsWith("(function(){try{")).toBe(true);
  });
});
