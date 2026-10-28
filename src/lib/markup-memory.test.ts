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
  RECENT_LABELS_KEY,
  pushRecentLabel,
  readMarkupMemory,
  readRecentLabels,
  rememberLabel,
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
      readMarkupMemory(storage({ [MARKUP_MEMORY_KEY]: '{"tool":"laser","color":"green"}' })),
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

describe("the last labels (the phone's sheet offers them as chips; owner, Oct 28)", () => {
  it("pushRecentLabel: newest first, no duplicates, at most five, blanks ignored", () => {
    let list: string[] = [];
    for (const l of ["Ponding", "Open seam", "Blister", "Puncture", "Flashing"])
      list = pushRecentLabel(list, l);
    expect(list).toEqual(["Flashing", "Puncture", "Blister", "Open seam", "Ponding"]);
    // A sixth pushes the oldest out.
    list = pushRecentLabel(list, "Debris");
    expect(list).toEqual(["Debris", "Flashing", "Puncture", "Blister", "Open seam"]);
    // A label used again moves to the front once; it is trimmed first.
    list = pushRecentLabel(list, "  Blister ");
    expect(list).toEqual(["Blister", "Debris", "Flashing", "Puncture", "Open seam"]);
    expect(pushRecentLabel(list, "   ")).toEqual(list);
    expect(list).toHaveLength(5);
  });
  it("rememberLabel / readRecentLabels keep text and tag labels apart, per device", () => {
    const s = storage();
    expect(readRecentLabels(s, "tag")).toEqual([]);
    rememberLabel(s, "tag", "Open seam");
    rememberLabel(s, "tag", "Ponding");
    rememberLabel(s, "text", "Leak here");
    expect(readRecentLabels(s, "tag")).toEqual(["Ponding", "Open seam"]);
    expect(readRecentLabels(s, "text")).toEqual(["Leak here"]);
    expect(readRecentLabels(null, "tag")).toEqual([]);
    expect(JSON.parse(s.map.get(RECENT_LABELS_KEY)!)).toEqual({
      text: ["Leak here"],
      tag: ["Ponding", "Open seam"],
    });
  });
  it("junk stored reads as nothing and is overwritten; a storage that throws is a silent no-op", () => {
    const junk = storage({ [RECENT_LABELS_KEY]: "not json" });
    expect(readRecentLabels(junk, "tag")).toEqual([]);
    rememberLabel(junk, "tag", "Debris");
    expect(readRecentLabels(junk, "tag")).toEqual(["Debris"]);
    const odd = storage({ [RECENT_LABELS_KEY]: '{"tag":["a",3,"",null,"b"],"text":"x"}' });
    expect(readRecentLabels(odd, "tag")).toEqual(["a", "b"]);
    expect(readRecentLabels(odd, "text")).toEqual([]);
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readRecentLabels(broken, "text")).toEqual([]);
    expect(() => rememberLabel(broken, "text", "Leak")).not.toThrow();
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
  it("remembers each label as it is placed and offers the last ones as chips in the form", () => {
    expect(src).toContain("rememberLabel(deviceStorage(), pending.kind, f.label);");
    expect(src).toContain(
      "const recent = pending ? readRecentLabels(deviceStorage(), pending.kind) : [];",
    );
    expect(src.match(/recent=\{recent\}/g)).toHaveLength(2); // the sheet and the inline form
    expect(src).toContain('data-chips="recent"');
  });
});
