/**
 * Owner, Oct 29 (an inspection report, Ticket 6036): "the pages extend all the way down, when the
 * page breaks and a new page starts it should reflect that in the visual by a new page starting
 * on the visual as well … something with a couple pictures looks normal but something with a lot
 * of pictures extends the screen really far down." The editor never cut a module, so a Checklist
 * item with many thumbnail rows ran past its sheet while the PDF paged it. packIntoSegments cuts
 * a tall picture module between its rows (`breaks`) as the PDF does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { breakOffsets, packIntoSegments, packIntoSheets } from "@/lib/documents/editor-helpers";

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const LIMIT = 900;
const GAP = 12;

describe("packIntoSegments", () => {
  it("a module that fits is placed whole", () => {
    expect(packIntoSegments([{ id: "a", height: 300, breaks: [100] }], LIMIT, GAP)).toEqual([
      [{ id: "a" }],
    ]);
  });
  it("cut once: the largest part that fits the room left stays, the rest starts the next sheet", () => {
    expect(
      packIntoSegments(
        [
          { id: "a", height: 100 },
          { id: "b", height: 1200, breaks: [400, 800] },
        ],
        LIMIT,
        GAP,
      ),
    ).toEqual([[{ id: "a" }, { id: "b", from: 0, to: 400 }], [{ id: "b", from: 400, to: 1200 }]]);
  });
  it("cut three times: a 2000 px module of rows on 900 px sheets takes four sheets", () => {
    expect(
      packIntoSegments([{ id: "a", height: 2000, breaks: [500, 1000, 1500] }], LIMIT, GAP),
    ).toEqual([
      [{ id: "a", from: 0, to: 500 }],
      [{ id: "a", from: 500, to: 1000 }],
      [{ id: "a", from: 1000, to: 1500 }],
      [{ id: "a", from: 1500, to: 2000 }],
    ]);
  });
  it("no part fits the room left but the whole fits a fresh sheet: it moves whole", () => {
    expect(
      packIntoSegments(
        [
          { id: "a", height: 800 },
          { id: "b", height: 500, breaks: [300] },
        ],
        LIMIT,
        GAP,
      ),
    ).toEqual([[{ id: "a" }], [{ id: "b" }]]);
  });
  it("breakBefore still starts a fresh sheet, and the module is cut there", () => {
    expect(
      packIntoSegments(
        [
          { id: "a", height: 100 },
          { id: "b", height: 1000, breakBefore: true, breaks: [600] },
        ],
        LIMIT,
        GAP,
      ),
    ).toEqual([[{ id: "a" }], [{ id: "b", from: 0, to: 600 }], [{ id: "b", from: 600, to: 1000 }]]);
  });
  it("no breaks (a letter): the old rule — taller than a sheet stays and overflows, what follows starts the next", () => {
    expect(
      packIntoSegments(
        [
          { id: "a", height: 100 },
          { id: "b", height: 2000 },
          { id: "c", height: 100 },
        ],
        LIMIT,
        GAP,
      ),
    ).toEqual([[{ id: "a" }, { id: "b" }], [{ id: "c" }]]);
  });
  it("the next module follows the last part on the same sheet when it fits", () => {
    expect(
      packIntoSegments(
        [
          { id: "b", height: 1000, breaks: [600] },
          { id: "c", height: 100 },
        ],
        LIMIT,
        GAP,
      ),
    ).toEqual([[{ id: "b", from: 0, to: 600 }], [{ id: "b", from: 600, to: 1000 }, { id: "c" }]]);
  });
  it("a row taller than a sheet: the part up to the next cut overflows one sheet, the rest goes on", () => {
    expect(packIntoSegments([{ id: "a", height: 2000, breaks: [1200] }], LIMIT, GAP)).toEqual([
      [{ id: "a", from: 0, to: 1200 }],
      [{ id: "a", from: 1200, to: 2000 }],
    ]);
  });
  it("without breaks it packs exactly as packIntoSheets did", () => {
    const cases = [
      [100, 200, 300, 400],
      [800, 50, 900, 10],
      [1500, 100, 100],
      [undefined, 400, 600, 2000, 30],
    ];
    for (const hs of cases) {
      const items = hs.map((height, i) => ({ id: `m${i}`, height }));
      expect(packIntoSegments(items, LIMIT, GAP).map((s) => s.map((x) => x.id))).toEqual(
        packIntoSheets(items, LIMIT, GAP),
      );
    }
  });
});

describe("breakOffsets", () => {
  it("px from the module's top, one per line, the top itself dropped", () => {
    expect(breakOffsets(100, [100, 150, 150.4, 300], 1)).toEqual([50, 200]);
  });
  it("undoes the sheet's on-screen scale", () => {
    expect(breakOffsets(100, [150, 200], 0.5)).toEqual([100, 200]);
  });
});

describe("the editor wires it", () => {
  const canvas = read("src/components/documents/editor/page-canvas.tsx");
  const views = read("src/components/documents/editor/module-view.tsx");
  it("measures the cut points and packs into segments", () => {
    expect(canvas).toContain('target.querySelectorAll<HTMLElement>("[data-break]")');
    expect(canvas).toContain("const offs = breakOffsets(box.top, tops, scale);");
    expect(canvas).toContain("const groups = packIntoSegments(");
    expect(canvas).toContain("breaks: breaks[m.id],");
    expect(canvas).not.toContain("packIntoSheets(");
  });
  it("draws a cut part as a clipped window, measuring only the first part", () => {
    expect(canvas).toContain('data-segment={from > 0 ? "continued" : undefined}');
    expect(canvas).toContain(
      'style={cut ? { height: seg.to! - from, overflow: "hidden" } : undefined}',
    );
    expect(canvas).toContain("transform: `translateY(-${from}px)`");
    expect(canvas).toContain("ref={from === 0 ? props.measureRef(m.id) : undefined}");
    expect(canvas).toContain('const mid = (e.target as HTMLElement).dataset["measureId"];');
  });
  it("the Photo Grid cells, the Repair List rows and thumbnails, and a Checklist item's thumbnails may start a sheet", () => {
    const grid = views.slice(
      views.indexOf("function PhotoGrid("),
      views.indexOf("function RepairList("),
    );
    const list = views.slice(
      views.indexOf("function RepairList("),
      views.indexOf("function RepairItem("),
    );
    const item = views.slice(
      views.indexOf("function RepairItem("),
      views.indexOf("const paperInput ="),
    );
    expect(grid).toContain('<div key={i} className="group/cell relative" data-break="">');
    expect(list).toContain('<tr data-break="">');
    expect(list).toMatch(/data-repair-photo=\{photoId\}\s*data-break=""/);
    expect(item).toContain('data-item-photo={photoId} data-break=""');
  });
});
