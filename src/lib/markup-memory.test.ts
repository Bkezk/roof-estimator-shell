/**
 * The markup editor's last pen, remembered per device (owner, Oct 28: mark up as you shoot):
 * read / write over a Storage-like object, defaults for anything missing or broken, a storage
 * that throws is ignored. The editor's wiring is pinned to its source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKUP_TOOL,
  MARKUP_MEMORY_KEY,
  readMarkupMemory,
  writeMarkupMemory,
} from "./markup-memory";

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    map,
  };
}

describe("readMarkupMemory", () => {
  it("defaults (Circle, red) with no storage, nothing stored, or junk", () => {
    expect(readMarkupMemory(null)).toEqual({ tool: "ellipse", color: "red" });
    expect(readMarkupMemory(storage())).toEqual({ tool: DEFAULT_MARKUP_TOOL, color: "red" });
    expect(readMarkupMemory(storage({ [MARKUP_MEMORY_KEY]: "not json" }))).toEqual({
      tool: "ellipse",
      color: "red",
    });
    expect(
      readMarkupMemory(storage({ [MARKUP_MEMORY_KEY]: '{"tool":"laser","color":"blue"}' })),
    ).toEqual({
      tool: "ellipse",
      color: "red",
    });
  });
  it("reads back what was written", () => {
    const s = storage();
    writeMarkupMemory(s, { tool: "arrow", color: "yellow" });
    expect(readMarkupMemory(s)).toEqual({ tool: "arrow", color: "yellow" });
  });
  it("a storage that throws (private mode) is a default read and a silent write", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readMarkupMemory(broken)).toEqual({ tool: "ellipse", color: "red" });
    expect(() => writeMarkupMemory(broken, { tool: "rect", color: "white" })).not.toThrow();
  });
});

describe("the editor (photo-markup.tsx PhotoMarkupSurface) starts from the remembered pen", () => {
  const src = readFileSync("src/components/service/photo-markup.tsx", "utf8");
  it("reads the tool and colour on open and writes them as they change; Move is not remembered", () => {
    expect(src).toContain("useState<Tool>(() => readMarkupMemory(deviceStorage()).tool)");
    expect(src).toContain("useState<PhotoColor>(() => readMarkupMemory(deviceStorage()).color)");
    expect(src).toMatch(
      /if \(tool !== "move"\) writeMarkupMemory\(deviceStorage\(\), \{ tool, color \}\);/,
    );
  });
});
