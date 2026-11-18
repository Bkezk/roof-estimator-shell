/**
 * The workflow's bottom bar on a phone (owner, Nov 18, with two pictures from his iPhone):
 *
 *  1. "The two buttons at the bottom are kinda cut off can you adjust them up a smidge or reshape
 *     them so they fit better and color them blue, the same blue as in the logo".
 *  2. "I had this bug the other day after drawing on the takeoff where step 2 stayed in the
 *     middle of my screen": the pinned bar a quarter of the way up the screen.
 *
 *  colour   styles.css --jbk-blue, measured from the logo; the two big buttons.
 *  room     closeout.tsx PINNED_BAR: 2 rem clear of the bottom edge on a touch screen.
 *  guard    lib/ios-viewport.ts: the page is set straight after the keyboard closes (iOS only).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IOS_RESYNC_DELAYS_MS,
  isTypingElement,
  PINNED_BARS,
  resyncPinned,
  watchIosPinned,
} from "@/lib/ios-viewport";

const read = (p: string) => readFileSync(p, "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

/** WCAG contrast of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("the two buttons in the logo's blue", () => {
  const css = read("src/styles.css");
  const card = flat(read("src/components/roof-care/plan-card.tsx"));
  it("the blue is the one measured from the logo's letters, and white reads on it", () => {
    expect(css).toContain("--jbk-blue: #014b96;");
    expect(contrast("#014b96", "#ffffff")).toBeGreaterThan(7);
    expect(contrast("#0a5fb8", "#ffffff")).toBeGreaterThan(4.5);
  });
  it("the workflow's two buttons are filled with it, white words, a thumb tall", () => {
    const big = card.slice(
      card.indexOf("const BIG_BUTTON ="),
      card.indexOf("/** The property's plan in a pop-up"),
    );
    expect(big).toContain("bg-[var(--jbk-blue)]");
    expect(big).toContain("text-white");
    expect(big).toContain("hover:bg-[var(--jbk-blue-hover)]");
    expect(big).toContain("h-11");
    expect(card).toContain('const size = big ? BIG_BUTTON : "";');
  });
  it("the plan's chip on the blue button is white on it; elsewhere it is as it was", () => {
    expect(card).toContain(
      '${big ? "bg-white/20 text-[10px] text-white" : "ml-1.5 bg-emerald-600/15 py-0.5 text-[11px] text-emerald-800 dark:text-emerald-300"}',
    );
  });
  it("the buttons on a ticket and on a property keep their outline", () => {
    // Only `big` takes the blue: the others sit beside New ticket and Edit.
    expect(card).toContain('variant="outline"');
    expect(card).toContain('size={big ? "lg" : "sm"}');
  });
});

describe("room under the bar on a phone", () => {
  const closeout = flat(read("src/components/service/closeout.tsx"));
  it("the bar stands 2 rem clear of the bottom edge on a touch screen, more if the phone asks", () => {
    const bar = closeout.slice(closeout.indexOf("export const PINNED_BAR ="));
    expect(bar).toContain("[@media(pointer:coarse)]:pb-[max(2rem,env(safe-area-inset-bottom))]");
    // A mouse keeps the smaller gap.
    expect(bar).toContain("pb-[max(0.75rem,env(safe-area-inset-bottom))]");
    expect(bar).toContain("sticky bottom-0 z-10");
  });
  it("both of the workflow's bars are that bar", () => {
    expect(closeout).toContain("<div className={PINNED_BAR} data-plan-bar data-pinned-bar>");
    expect(closeout).toContain("<div className={PINNED_BAR} data-pinned-bar>");
    expect(closeout.split("className={PINNED_BAR}").length - 1).toBe(2);
  });
});

describe("a box the keyboard is up for", () => {
  it("a text box, a text area, a picker, an editable block", () => {
    expect(isTypingElement({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTypingElement({ tagName: "input" })).toBe(true);
    expect(isTypingElement({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(isTypingElement({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingElement({ tagName: "SELECT" })).toBe(true);
    expect(isTypingElement({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("not a button, a tick box or the page", () => {
    expect(isTypingElement({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTypingElement({ tagName: "INPUT", type: "file" })).toBe(false);
    expect(isTypingElement({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingElement({ tagName: "BODY" })).toBe(false);
    expect(isTypingElement(null)).toBe(false);
    expect(isTypingElement(undefined)).toBe(false);
  });
});

function fakeWindow(opts: {
  y: number;
  scrollHeight: number;
  innerHeight: number;
  active?: unknown;
}) {
  const moves: [number, number][] = [];
  const bottoms: string[] = [];
  const bar = {
    style: {
      _b: "",
      get bottom() {
        return this._b;
      },
      set bottom(v: string) {
        this._b = v;
        bottoms.push(v);
      },
    },
    offsetHeight: 80,
  };
  const win = {
    scrollX: 0,
    scrollY: opts.y,
    innerHeight: opts.innerHeight,
    scrollTo: (x: number, y: number) => moves.push([x, y]),
    document: {
      activeElement: opts.active ?? { tagName: "BODY" },
      documentElement: { scrollHeight: opts.scrollHeight },
      querySelectorAll: () => [bar],
    },
  };
  return { win: win as unknown as Window, moves, bottoms, bar };
}

describe("setting the page straight", () => {
  it("a pixel down and back, and the pinned bar placed again; the page ends where it was", () => {
    const f = fakeWindow({ y: 400, scrollHeight: 3000, innerHeight: 800 });
    expect(resyncPinned(f.win)).toBe(true);
    expect(f.moves).toEqual([
      [0, 401],
      [0, 400],
    ]);
    expect(f.bottoms).toEqual(["0.5px", ""]);
    expect(f.bar.style.bottom).toBe("");
  });
  it("at the very bottom of the page: a pixel up and back", () => {
    const f = fakeWindow({ y: 2200, scrollHeight: 3000, innerHeight: 800 });
    resyncPinned(f.win);
    expect(f.moves).toEqual([
      [0, 2199],
      [0, 2200],
    ]);
  });
  it("on a page too short to scroll it never asks for a place above the top", () => {
    const f = fakeWindow({ y: 0, scrollHeight: 600, innerHeight: 800 });
    resyncPinned(f.win);
    expect(f.moves).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
  it("nothing while a box has the keyboard", () => {
    const f = fakeWindow({
      y: 400,
      scrollHeight: 3000,
      innerHeight: 800,
      active: { tagName: "INPUT", type: "text" },
    });
    expect(resyncPinned(f.win)).toBe(false);
    expect(f.moves).toEqual([]);
    expect(f.bottoms).toEqual([]);
  });
});

describe("the guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  function stub(userAgent: string) {
    const f = fakeWindow({ y: 100, scrollHeight: 3000, innerHeight: 800 });
    const docL = new Map<string, (e: unknown) => void>();
    const vvL = new Map<string, () => void>();
    const winL = new Map<string, () => void>();
    const doc = {
      ...(f.win.document as unknown as object),
      addEventListener: (n: string, fn: (e: unknown) => void) => docL.set(n, fn),
      removeEventListener: (n: string) => docL.delete(n),
    };
    const win = {
      ...(f.win as unknown as object),
      document: doc,
      visualViewport: {
        addEventListener: (n: string, fn: () => void) => vvL.set(n, fn),
        removeEventListener: (n: string) => vvL.delete(n),
      },
      addEventListener: (n: string, fn: () => void) => winL.set(n, fn),
      removeEventListener: (n: string) => winL.delete(n),
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", { userAgent, platform: "", maxTouchPoints: 5 });
    return { f, docL, vvL, winL };
  }
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)";

  it("is for iPhones and iPads only: nothing is listened for anywhere else", () => {
    const s = stub("Mozilla/5.0 (Linux; Android 15)");
    const stop = watchIosPinned();
    expect(s.docL.size + s.vvL.size + s.winL.size).toBe(0);
    stop();
  });
  it("after the keyboard closes, the page is set straight twice, a moment apart", () => {
    vi.useFakeTimers();
    const s = stub(IPHONE);
    const stop = watchIosPinned();
    expect([...s.docL.keys()]).toEqual(["focusout"]);
    expect([...s.vvL.keys()]).toEqual(["resize"]);
    s.docL.get("focusout")!({ target: { tagName: "INPUT", type: "text" } });
    expect(s.f.moves).toEqual([]);
    vi.advanceTimersByTime(IOS_RESYNC_DELAYS_MS[0]);
    expect(s.f.moves.length).toBe(2);
    vi.advanceTimersByTime(IOS_RESYNC_DELAYS_MS[1]);
    expect(s.f.moves.length).toBe(4);
    stop();
    expect(s.docL.size + s.vvL.size + s.winL.size).toBe(0);
  });
  it("leaving a button does nothing; the screen changing size does", () => {
    vi.useFakeTimers();
    const s = stub(IPHONE);
    const stop = watchIosPinned();
    s.docL.get("focusout")!({ target: { tagName: "BUTTON" } });
    vi.advanceTimersByTime(2000);
    expect(s.f.moves).toEqual([]);
    s.vvL.get("resize")!();
    vi.advanceTimersByTime(2000);
    expect(s.f.moves.length).toBe(4);
    stop();
  });
  it("stopping it cancels what was waiting", () => {
    vi.useFakeTimers();
    const s = stub(IPHONE);
    const stop = watchIosPinned();
    s.vvL.get("resize")!();
    stop();
    vi.advanceTimersByTime(2000);
    expect(s.f.moves).toEqual([]);
  });
  it("runs once for the whole site, and the pinned bars are marked for it", () => {
    expect(read("src/routes/__root.tsx")).toContain("useEffect(() => watchIosPinned(), []);");
    expect(PINNED_BARS).toBe("[data-pinned-bar], [data-save-bar]");
    expect(read("src/components/save-bar.tsx")).toContain("data-save-bar>");
  });
});
