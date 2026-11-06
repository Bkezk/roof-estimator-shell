/**
 * The app menu on a half-screen window (owner, Nov 6: "when i have the portal on half screen i
 * cant open the nav bar, it stays collapsed"). Between 768 and 1099 px the Nov 3 iPad rule
 * folded the menu on arrival — and again at every attempt to open it, because the effect was
 * keyed on the sidebar's setOpen, which is remade on each toggle. The fold now runs once per
 * arrival (lib/narrow-menu.ts), so the header button and "Expand menu" open it for the visit.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { foldMenuOnArrival } from "@/lib/narrow-menu";

const gate = readFileSync("src/components/auth-gate.tsx", "utf8");

describe("foldMenuOnArrival", () => {
  it("a narrow window (960 px, a half screen): folds once; a second run — the effect after a toggle — does nothing", () => {
    const done = { current: false };
    const setOpen = vi.fn();
    foldMenuOnArrival(done, 960, setOpen);
    expect(setOpen).toHaveBeenCalledTimes(1);
    expect(setOpen).toHaveBeenCalledWith(false);
    foldMenuOnArrival(done, 960, setOpen);
    foldMenuOnArrival(done, 960, setOpen);
    expect(setOpen).toHaveBeenCalledTimes(1);
  });
  it("a wide window (1440 px): never folds, and is still spent", () => {
    const done = { current: false };
    const setOpen = vi.fn();
    foldMenuOnArrival(done, 1440, setOpen);
    foldMenuOnArrival(done, 1440, setOpen);
    expect(setOpen).not.toHaveBeenCalled();
    expect(done.current).toBe(true);
  });
  it("the boundary: 1099 folds, 1100 does not (NARROW_PX)", () => {
    const a = vi.fn();
    foldMenuOnArrival({ current: false }, 1099, a);
    expect(a).toHaveBeenCalledWith(false);
    const b = vi.fn();
    foldMenuOnArrival({ current: false }, 1100, b);
    expect(b).not.toHaveBeenCalled();
  });
});

describe("the shell", () => {
  it("runs the fold through a ref that outlives the effect's re-runs", () => {
    expect(gate).toContain('import { foldMenuOnArrival } from "@/lib/narrow-menu";');
    expect(gate).toContain("const done = useRef(false);");
    expect(gate).toContain(
      "useEffect(() => foldMenuOnArrival(done, window.innerWidth, setOpen), [setOpen]);",
    );
    expect(gate).not.toContain("if (isNarrow(window.innerWidth)) setOpen(false);");
  });
});
