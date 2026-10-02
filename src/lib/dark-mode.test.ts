/**
 * Dark mode (owner, Oct 2): "a toggle to the right of the Collapse menu button with a sun and
 * moon symbol", "a grey, not a black, so the JBK logo can still be legible", "make sure not to
 * miss any pop-up windows", "red status colours can stay".
 *
 * 1. The token block: `.dark` in styles.css is charcoal (background 10–20% lightness), cards
 *    lighter than the page, near-white text, every light token redefined, red unchanged.
 * 2. Hard-coded light colours: no class from the denylist in src/components / src/routes
 *    without a `dark:` counterpart in the same class string (allowlist: the paper and image
 *    grounds that must stay fixed, each with its reason). Also the dark text colours (700+)
 *    that vanish on charcoal; red is exempt (owner).
 * 3. The toggle: rendered markup (sun / moon, aria-label, tooltip, the collapsed sidebar's
 *    icon-only row), its place after Collapse menu, the Account page control, the Toaster's
 *    theme, the boot script in the root document, the logo plate.
 * 6. Pop-ups: every floating-layer primitive in components/ui uses token colours only.
 * Plus: paper and exported surfaces do not read the theme, and the bid summary screenshots are
 * taken in light mode.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeToggle } from "@/components/theme-toggle";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeContext, type ThemeState } from "@/lib/theme-store";

const read = (p: string) => readFileSync(p, "utf8");

// ── 1. Tokens ──────────────────────────────────────────────────────────────────────────────

function block(css: string, selector: string): Record<string, string> {
  const re = new RegExp(
    `(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const m = re.exec(css);
  if (!m) throw new Error(`no ${selector} block in styles.css`);
  const body = m[2]!.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim();
  return out;
}

/** HSL lightness (0–100) of an oklch(), hsl() or #hex colour, through sRGB. */
function lightness(value: string): number {
  let rgb: [number, number, number];
  const ok = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  const hsl = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(value);
  if (ok) {
    const L = Number(ok[1]);
    const C = Number(ok[2]);
    const h = (Number(ok[3]) * Math.PI) / 180;
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    const enc = (c: number) => {
      const x = Math.min(1, Math.max(0, c));
      return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    };
    rgb = [enc(lin[0]!), enc(lin[1]!), enc(lin[2]!)];
  } else if (hsl) {
    return Number(hsl[3]);
  } else {
    throw new Error(`cannot read the colour ${value}`);
  }
  return ((Math.max(...rgb) + Math.min(...rgb)) / 2) * 100;
}

describe("1. the dark token block is charcoal, not black", () => {
  const css = read("src/styles.css");
  const light = block(css, ":root");
  const dark = block(css, ".dark");

  it("dark mode keys on a class (the toggle sets it on <html>)", () => {
    expect(css).toMatch(/@custom-variant dark \(&:is\(\.dark \*\)\);/);
  });
  it("redefines every colour token the light theme defines", () => {
    const colourTokens = Object.keys(light).filter((k) => k !== "--radius");
    expect(colourTokens.length).toBeGreaterThan(30);
    expect(colourTokens.filter((k) => !(k in dark))).toEqual([]);
  });
  it("the page is a grey between 10% and 20% lightness", () => {
    const l = lightness(dark["--background"]!);
    expect(l).toBeGreaterThanOrEqual(10);
    expect(l).toBeLessThanOrEqual(20);
  });
  it("cards and pop-ups are lighter than the page; the sidebar is grey too", () => {
    const bg = lightness(dark["--background"]!);
    expect(lightness(dark["--card"]!)).toBeGreaterThan(bg);
    expect(lightness(dark["--popover"]!)).toBeGreaterThan(bg);
    expect(lightness(dark["--sidebar"]!)).toBeGreaterThanOrEqual(10);
    expect(lightness(dark["--border"]!)).toBeGreaterThan(lightness(dark["--card"]!));
  });
  it("text is near-white (85%+), muted text still readable (60%+)", () => {
    expect(lightness(dark["--foreground"]!)).toBeGreaterThanOrEqual(85);
    expect(lightness(dark["--card-foreground"]!)).toBeGreaterThanOrEqual(85);
    expect(lightness(dark["--popover-foreground"]!)).toBeGreaterThanOrEqual(85);
    expect(lightness(dark["--muted-foreground"]!)).toBeGreaterThanOrEqual(60);
  });
  it("red is present in both and unchanged (owner: red status colours can stay)", () => {
    expect(light["--destructive"]).toBeTruthy();
    expect(dark["--destructive"]).toBe(light["--destructive"]);
  });
  it("native controls and scrollbars go dark with it", () => {
    expect(/\.dark\s*\{[^}]*color-scheme:\s*dark/.test(css)).toBe(true);
  });
  it("the image plate: none in light mode, a lighter grey than the sidebar in dark", () => {
    expect(light["--image-plate"]).toBe("transparent");
    expect(lightness(dark["--image-plate"]!)).toBeGreaterThan(lightness(dark["--sidebar"]!) + 25);
    expect(css).toContain("--color-image-plate: var(--image-plate);");
  });
});

// ── 2. Hard-coded light colours ────────────────────────────────────────────────────────────

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Every string literal ("…", '…', `…`) in a file, with its line. */
function literals(src: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  for (const m of src.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g))
    out.push({ text: m[0], line: src.slice(0, m.index).split("\n").length });
  return out;
}

// The owner's denylist. A class only counts as written (not as `dark:x` / `hover:x`).
const DENY =
  /(?<![\w:-])(bg-white|text-black|bg-gray-\d|bg-slate-\d|bg-zinc-\d|bg-neutral-\d|bg-blue-50(?!\d)|bg-green-50(?!\d)|bg-amber-50(?!\d)|bg-yellow-50(?!\d)|bg-\[#|text-\[#|border-gray-\d)/;
// Text that is dark on purpose in light mode and disappears on charcoal (red/rose exempt).
const DARK_TEXT =
  /(?<![\w:-])text-(?:orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|slate|gray|zinc|neutral|stone)-(?:700|800|900|950)\b/;

/** Fixed colours that stay fixed: file, a piece of the class string, and why. */
const ALLOW: { file: string; has: string; why: string }[] = [
  {
    file: "src/routes/proposal.tsx",
    has: "proposal-sheet",
    why: "the printed proposal: a white sheet with its own dark ink, it is paper in both themes",
  },
  {
    file: "src/components/takeoff/viewer.tsx",
    has: "absolute left-0 top-0 bg-white shadow-md",
    why: "the plan sheet under the PDF canvas: drawings are white paper",
  },
  {
    file: "src/components/service/signature-pad.tsx",
    has: "border-dashed border-muted-foreground/40 bg-white",
    why: "the signature canvas: ink #111 on white, saved as that PNG",
  },
  {
    file: "src/components/service/closeout.tsx",
    has: "overflow-hidden rounded-md border bg-white",
    why: "shows the saved signature PNG (black ink): it needs its white ground",
  },
  {
    file: "src/components/service/ticket-field-sections.tsx",
    has: "inline-block max-w-full overflow-hidden rounded-md border bg-white p-1",
    why: "shows the saved signature PNG (black ink): it needs its white ground",
  },
  {
    file: "src/components/service/photo-markup.tsx",
    has: "rounded-md border bg-neutral-900",
    why: "the photo lightbox / mark-up stage: a dark letterbox around the photo in both themes",
  },
  {
    file: "src/components/service/aerial-markup.tsx",
    has: "rounded-md border bg-neutral-800",
    why: "the aerial imagery stage: a dark letterbox around the tiles in both themes",
  },
];

let sources: { f: string; lits: { text: string; line: number }[] }[] | null = null;
const allLiterals = () =>
  (sources ??= [...tsxFiles("src/components"), ...tsxFiles("src/routes")].map((f) => ({
    f,
    lits: literals(read(f)),
  })));

function scan(re: RegExp) {
  const hits: string[] = [];
  const used = new Set<number>();
  for (const { f, lits } of allLiterals()) {
    for (const { text, line } of lits) {
      if (!re.test(text) || text.includes("dark:")) continue;
      const allowed = ALLOW.findIndex((a) => a.file === f && text.includes(a.has));
      if (allowed >= 0) {
        used.add(allowed);
        continue;
      }
      hits.push(`${f}:${line} ${re.exec(text)![1] ?? re.exec(text)![0]} in ${text.slice(0, 90)}`);
    }
  }
  return { hits, used };
}

describe("2. no hard-coded light colour without a dark: counterpart", () => {
  it("the owner's denylist: every hit has dark: in the same class string, or is allowlisted", () => {
    const { hits } = scan(DENY);
    expect(hits).toEqual([]);
  });
  it("dark text colours (700+) carry a dark: counterpart (red exempt: it stays)", () => {
    const { hits } = scan(DARK_TEXT);
    expect(hits).toEqual([]);
  });
  it("every allowlist entry still matches something (no stale exemptions)", () => {
    const a = scan(DENY).used;
    const b = scan(DARK_TEXT).used;
    const unused = ALLOW.filter((_, i) => !a.has(i) && !b.has(i)).map((x) => x.file);
    expect(unused).toEqual([]);
  });
  it("the layer-stack glyphs draw their black in a theme-aware colour", () => {
    const src = read("src/components/layer-stack.tsx");
    const screw = src.slice(src.indexOf("export function ScrewGlyph"));
    const screwBody = screw.slice(0, screw.indexOf("\n}\n"));
    expect(screwBody).not.toMatch(/(fill|stroke)="#000"/);
    expect(screwBody).toContain("text-black dark:text-neutral-300");
    const board = src.slice(src.indexOf("export function BoardGlyph"));
    const boardBody = board.slice(0, board.indexOf("\n}\n"));
    expect(boardBody).not.toContain('fill="#000"');
    expect(boardBody.match(/fill-black dark:fill-neutral-200/g)?.length).toBe(2);
  });
  it("transparent line art drawn in black sits on the image plate", () => {
    expect(read("src/components/curbs-screen.tsx").match(/bg-image-plate/g)?.length).toBe(2);
    expect(read("src/components/nondl-screens.tsx")).toContain(
      'className="h-12 w-16 rounded-sm bg-image-plate object-contain"',
    );
    // The metals pictures already invert in dark mode.
    expect(read("src/components/metals-screens.tsx")).toContain("dark:invert");
  });
});

// ── 3. The toggle ──────────────────────────────────────────────────────────────────────────

function render(resolved: "light" | "dark", node: ReactNode) {
  const value: ThemeState = { pref: resolved, resolved, toggle: () => undefined };
  return renderToStaticMarkup(
    createElement(
      ThemeContext.Provider,
      { value },
      createElement(SidebarProvider, null, createElement(TooltipProvider, null, node)),
    ),
  );
}

describe("3. the sun / moon toggle", () => {
  it("open sidebar: a ghost icon button, moon in light mode, labelled for dark", () => {
    const html = render("light", createElement(ThemeToggle, { variant: "sidebar" }));
    expect(html).toContain('aria-label="Switch to dark mode"');
    expect(html).toContain("lucide-moon");
    expect(html).not.toContain("lucide-sun");
    expect(html).toContain('data-state="closed"'); // the tooltip trigger
  });
  it("open sidebar in dark mode: a sun, labelled for light", () => {
    const html = render("dark", createElement(ThemeToggle, { variant: "sidebar" }));
    expect(html).toContain('aria-label="Switch to light mode"');
    expect(html).toContain("lucide-sun");
    expect(html).not.toContain("lucide-moon");
  });
  it("collapsed sidebar: an icon-only sidebar menu button (the sidebar's tooltip)", () => {
    const html = render("light", createElement(ThemeToggle, { variant: "sidebar-collapsed" }));
    expect(html).toContain('data-sidebar="menu-button"');
    expect(html).toContain('aria-label="Switch to dark mode"');
    expect(html).toContain("lucide-moon");
    expect(html).not.toMatch(/>Switch to/); // no visible words: icon only
  });
  it("Account page variant: the same control with its words", () => {
    const html = render("dark", createElement(ThemeToggle, { variant: "account" }));
    expect(html).toContain("lucide-sun");
    expect(html).toMatch(/>Switch to light mode</);
  });
  it("the tooltip text is the label", () => {
    const src = read("src/components/theme-toggle.tsx");
    expect(src).toContain("<TooltipContent");
    expect(src).toMatch(/<TooltipContent[^>]*>\{label\}<\/TooltipContent>/);
    expect(src).toMatch(/import \{ Moon, Sun \} from "lucide-react";/);
  });

  it("sits in the sidebar footer right after Collapse menu, open and collapsed", () => {
    const src = read("src/components/app-sidebar.tsx");
    const footer = src.slice(src.indexOf("<SidebarFooter>"), src.indexOf("</SidebarFooter>"));
    const collapse = footer.indexOf("<span>Collapse menu</span>");
    const collapseButtonEnd = footer.indexOf("</SidebarMenuButton>", collapse);
    const open = footer.indexOf('<ThemeToggle variant="sidebar" />');
    const iconOnly = footer.indexOf('<ThemeToggle variant="sidebar-collapsed" />');
    expect(collapse).toBeGreaterThan(-1);
    // Same row, to the right: the very next element after the Collapse menu button.
    expect(footer.slice(collapseButtonEnd, open).replace(/\s+/g, " ").trim()).toBe(
      "</SidebarMenuButton> {!collapsed &&",
    );
    expect(footer).toContain('className={collapsed ? undefined : "flex items-center gap-1"}');
    // Collapsed: its own icon row, still after Collapse menu.
    expect(iconOnly).toBeGreaterThan(open);
    expect(footer.slice(open, iconOnly)).toMatch(/\{collapsed && \(\s*<SidebarMenuItem>\s*$/);
  });
  it("the Account page offers the same control", () => {
    const src = read("src/routes/account.tsx");
    expect(src).toContain('import { ThemeToggle } from "@/components/theme-toggle";');
    expect(src).toContain("<CardTitle>Appearance</CardTitle>");
    expect(src).toContain('<ThemeToggle variant="account" />');
  });
  it("the Toaster follows the app's theme (not sonner's light default)", () => {
    const src = read("src/components/ui/sonner.tsx");
    expect(src).toContain("const { resolved } = useTheme();");
    expect(src).toContain("theme={resolved}");
    expect(src).not.toMatch(/theme=["']light["']/);
    const root = read("src/routes/__root.tsx");
    const provider = root.indexOf("<ThemeProvider>");
    expect(provider).toBeGreaterThan(-1);
    expect(root.indexOf("<Toaster />")).toBeGreaterThan(provider);
    expect(root.indexOf("<Toaster />")).toBeLessThan(root.indexOf("</ThemeProvider>"));
  });
  it("the root document sets the theme before first paint", () => {
    const root = read("src/routes/__root.tsx");
    const shell = root.slice(
      root.indexOf("function RootShell"),
      root.indexOf("function RootComponent"),
    );
    expect(shell).toContain('<html lang="en" suppressHydrationWarning>');
    const script = shell.indexOf(
      "<script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />",
    );
    expect(script).toBeGreaterThan(shell.indexOf("<head>"));
    expect(script).toBeLessThan(shell.indexOf("<HeadContent />"));
  });
  it("the logo sits on the image plate (the image itself untouched)", () => {
    const src = read("src/components/app-sidebar.tsx");
    const header = src.slice(src.indexOf("<SidebarHeader"), src.indexOf("</SidebarHeader>"));
    expect(header).toContain("rounded-md bg-image-plate");
    expect(header.indexOf("bg-image-plate")).toBeLessThan(header.indexOf('src="/jbk-logo.webp"'));
  });
});

// ── 6. Pop-ups ─────────────────────────────────────────────────────────────────────────────

const FLOATING = [
  "dialog",
  "alert-dialog",
  "sheet",
  "popover",
  "dropdown-menu",
  "select",
  "command",
  "tooltip",
  "hover-card",
  "drawer",
  "sonner",
  "context-menu",
  "menubar",
  "navigation-menu",
  "calendar",
  "accordion",
  "collapsible",
];

describe("6. every pop-up primitive uses token colours only", () => {
  it.each(FLOATING)("ui/%s.tsx: no hard-coded light colour at all", (name) => {
    const src = read(`src/components/ui/${name}.tsx`);
    const hits = literals(src).filter(({ text }) => DENY.test(text) || DARK_TEXT.test(text));
    expect(hits).toEqual([]);
  });
  it.each([
    "dialog",
    "alert-dialog",
    "sheet",
    "drawer",
    "popover",
    "dropdown-menu",
    "select",
    "command",
    "tooltip",
    "hover-card",
    "context-menu",
    "menubar",
    "sonner",
  ])("ui/%s.tsx: its surface is a theme token", (name) => {
    expect(read(`src/components/ui/${name}.tsx`)).toMatch(
      /(?<![\w-])(?:group-\[\.toaster\]:)?bg-(?:background|popover|card|primary)\b/,
    );
  });
  it("toasts use the popover surface, so they stand off the page in dark mode", () => {
    expect(read("src/components/ui/sonner.tsx")).toContain(
      "group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground",
    );
  });
});

// ── Paper and exports ──────────────────────────────────────────────────────────────────────

describe("paper and exported surfaces do not change with the theme", () => {
  const SURFACES = [
    "src/lib/invoices.server.ts", // invoice PDF
    "src/lib/bid-summary-pdf.ts", // bid summary PDF
    "src/lib/bid-summary-shots.ts",
    "src/components/service/photo-export.ts", // exported photos
    "src/lib/notify.server.ts", // email HTML
    "src/lib/takeoff/markup-pdf.ts",
    "src/lib/order-list-export.ts",
    "src/lib/aerial-markup.ts",
  ];
  it.each(SURFACES)("%s never reads the theme", (f) => {
    const src = read(f);
    expect(src).not.toMatch(
      /prefers-color-scheme|theme-context|@\/lib\/theme"|classList|\.dark\b|dark:/,
    );
  });
  it("the bid summary screenshots are taken in light mode", () => {
    const src = read("src/routes/estimate.tsx");
    const at = src.indexOf("await withLightTheme(document.documentElement, async () => {");
    expect(at).toBeGreaterThan(-1);
    expect(src.indexOf("await capturePanel(panel)", at)).toBeGreaterThan(at);
    expect(src.indexOf("const bytes = await renderShotsPdf(", at)).toBeGreaterThan(
      src.indexOf("await capturePanel(panel)", at),
    );
    expect(src).toContain('import { withLightTheme } from "@/lib/theme";');
  });
  it("printing drops dark mode for the print and restores it after", () => {
    const src = read("src/lib/theme-context.tsx");
    expect(src).toMatch(/addEventListener\("beforeprint"/);
    expect(src).toMatch(/addEventListener\("afterprint"/);
    expect(src).toContain("document.documentElement.classList.remove(DARK_CLASS)");
    expect(src).toContain("applyTheme(document.documentElement, resolvedRef.current)");
  });
});
