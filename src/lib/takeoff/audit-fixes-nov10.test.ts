/**
 * The takeoff audit's fixes (docs/qa/takeoff-audit-2026-11-10.md), one block per finding. Each
 * block fails on the code as it was at the audit and passes now.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { scaleChipText } from "@/components/takeoff/sheet-scale";
import { bidSeedFromTakeoff } from "./create-bid";
import {
  areaProblem,
  CROSSED_OUTLINE_TEXT,
  CUTOUT_PROBLEM_TEXT,
  cutoutProblem,
  outlineCrossesItself,
  ringInsideOutline,
  ringsOverlap,
  type Pt,
} from "./geometry";
import { shouldAutosave, staleSave, staleSaveRefusal, TAKEOFF_STALE } from "./lock";
import {
  bidBlocker,
  feetPerPx,
  takeoffQuantities,
  type PageScale,
  type TakeoffObject,
  type TakeoffPage,
} from "./model";
import {
  APPLY_SCALE_TO_ALL_DEFAULT,
  copiedScaleReplacedMessage,
  sheetScaleVerdict,
  spreadScale,
} from "./scale-spread";
import {
  LINK_ATTEMPTS,
  linkFailedToast,
  linkRetryDelayMs,
  takeoffApplyReady,
} from "./update-bid-ready";

const src = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const sq = (x: number, y: number, s: number): Pt[] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];
const roof: Pt[] = [
  [0, 0],
  [100, 0],
  [100, 50],
  [0, 50],
];
/** 1 px = 1 ft. */
const page = (over: Partial<TakeoffPage> = {}): TakeoffPage => ({
  index: 0,
  name: "A-101 Roof Plan",
  rotation: 0,
  scale: { ax: 0, ay: 0, bx: 100, by: 0, feet: 100 },
  ...over,
});
const area = (id: string, points: Pt[], attrs: object = {}): TakeoffObject => ({
  id,
  page: 0,
  kind: "area",
  points: points.map((p) => [p[0], p[1]]),
  attrs: { name: id, ...attrs },
});
const quantities = (objs: TakeoffObject[]) => takeoffQuantities([page()], objs);

describe("1. Update bid is applied to the loaded bid, never to the page from before the load", () => {
  it("a new bid is seeded at once; an update waits until the page's own state holds that bid", () => {
    expect(takeoffApplyReady({ bidParam: undefined, renderedBidId: null })).toBe(true);
    expect(takeoffApplyReady({ bidParam: "bid-1", renderedBidId: null })).toBe(false);
    expect(takeoffApplyReady({ bidParam: "bid-1", renderedBidId: "bid-0" })).toBe(false);
    expect(takeoffApplyReady({ bidParam: "bid-1", renderedBidId: "bid-1" })).toBe(true);
  });

  it("the estimator waits on a STATE set with the bid's content, not on the ref", () => {
    const s = src("src/routes/estimate.tsx");
    expect(s).toContain("const [renderedBidId, setRenderedBidId] = useState<string | null>(null);");
    expect(s).toContain("setRenderedBidId(loadedBid.id);");
    expect(s).toContain("if (!takeoffApplyReady({ bidParam, renderedBidId })) return;");
    expect(s).toContain("[takeoffRow, takeoffParam, bidParam, hydrationStamp, renderedBidId]");
    // The old guard read a ref that is set in the same pass that only QUEUES the bid's sections.
    expect(s).not.toContain("if (updating && hydratedFor.current !== bidParam) return;");
  });
});

describe("2. A drawn scale stays on its own sheet unless asked", () => {
  const drawn: PageScale = { ax: 10, ay: 10, bx: 550, by: 10, feet: 60, source: "drawn" };
  const pages: TakeoffPage[] = [
    page({ scale: null, width: 2592, height: 1728 }),
    page({ index: 1, name: "A-102", scale: null }),
    page({ index: 2, name: "Page 3", scale: { ax: 0, ay: 0, bx: 360, by: 0, feet: 30 } }),
  ];

  it("the popup's box starts unticked", () => {
    expect(APPLY_SCALE_TO_ALL_DEFAULT).toBe(false);
    const d = src("src/components/takeoff/scale-dialog.tsx");
    expect(d).toContain("useState(APPLY_SCALE_TO_ALL_DEFAULT)");
    expect(d).not.toContain("useState(multi)");
  });

  it("unticked: only the page it was drawn on takes it", () => {
    const next = spreadScale(pages, pages[0]!, drawn, false);
    expect(next[0]!.scale).toEqual(drawn);
    expect(next[1]!.scale).toBeNull();
    expect(next[2]!.scale).toEqual(pages[2]!.scale);
  });

  it("ticked: pages with no scale take a copy that says where it came from; others keep theirs", () => {
    const next = spreadScale(pages, pages[0]!, drawn, true);
    expect(next[0]!.scale?.copiedFrom).toBeUndefined();
    expect(next[1]!.scale).toEqual({ ...drawn, copiedFrom: "A-101 Roof Plan" });
    expect(next[2]!.scale).toEqual(pages[2]!.scale);
    expect(scaleChipText(next[1]!.scale!, feetPerPx(next[1]!.scale))).toContain(
      "copied from “A-101 Roof Plan”",
    );
    expect(scaleChipText(next[1]!.scale!, 0.11)).not.toContain("line drawn on the sheet");
    expect(scaleChipText(next[0]!.scale!, 0.11)).toContain("60' line drawn on the sheet");
  });

  it("a sheet's own printed scale replaces a copy that disagrees, and nothing set on the sheet", () => {
    const copy: PageScale = { ...drawn, copiedFrom: "A-101 Roof Plan" }; // 1/9 ft per unit
    const quarterInch = 4 / 72; // 1/4" = 1'-0"
    const eighthInch = 8 / 72;
    expect(sheetScaleVerdict(null, quarterInch)).toBe("set");
    expect(sheetScaleVerdict(copy, quarterInch)).toBe("replace");
    expect(sheetScaleVerdict(copy, eighthInch)).toBe("leave"); // the copy already agrees
    expect(sheetScaleVerdict(drawn, quarterInch)).toBe("leave"); // drawn on this sheet
    expect(sheetScaleVerdict({ ...drawn, source: "sheet", note: "x" }, quarterInch)).toBe("leave");
    expect(copiedScaleReplacedMessage("A-101 Roof Plan", `1/4" = 1'-0"`)).toContain(
      "the scale copied from “A-101 Roof Plan” was replaced",
    );
    const v = src("src/components/takeoff/viewer.tsx");
    expect(v).toContain('if (sheetScaleVerdict(scaleRef.current, note.fpp) === "leave") return;');
    expect(v).toContain("toast.warning(copiedScaleReplacedMessage(copiedFrom, note.text)");
  });
});

describe("3. A stale save is refused; a save of nothing is not sent", () => {
  it("a save from an older revision is stale; one that names none is let through", () => {
    expect(staleSave(3, 3)).toBe(false);
    expect(staleSave(2, 3)).toBe(true);
    expect(staleSave(undefined, 3)).toBe(false);
    const msg = staleSaveRefusal("Dana");
    expect(msg.startsWith(TAKEOFF_STALE)).toBe(true);
    expect(msg).toContain("by Dana");
    expect(msg).toContain("your last change was not saved");
    expect(staleSaveRefusal(null)).toContain("somewhere else");
  });

  it("the editor sends the revision it holds, stops on a stale refusal and offers a reload", () => {
    const e = src("src/components/takeoff/editor.tsx");
    expect(e).toContain("base_rev: revRef.current,");
    expect(e).toContain("revRef.current = saved.rev;");
    expect(e).toContain("if (errText(e).includes(TAKEOFF_STALE)) setStale(errText(e));");
    expect(e).toContain('data-banner="takeoff-stale"');
    expect(e).toContain("const readOnly = locked || !!stale;");
  });

  it("content equal to what is saved is not a change (opening a takeoff saves nothing)", () => {
    expect(shouldAutosave({ locked: false, changed: true })).toBe(true);
    expect(shouldAutosave({ locked: false, changed: true, sameAsSaved: true })).toBe(false);
    expect(shouldAutosave({ locked: true, changed: true })).toBe(false);
    const h = src("src/components/takeoff/use-autosave.ts");
    expect(h).toContain("keyOfRef.current(value) === savedKey.current");
    expect(src("src/components/takeoff/editor.tsx")).toContain("takeoffDocKey, );");
  });
});

describe("4. An outline that crosses itself", () => {
  const bowtie: Pt[] = [
    [0, 0],
    [30, 30],
    [30, 0],
    [0, 30],
  ];
  it("is recognised; honest outlines are not", () => {
    expect(outlineCrossesItself(bowtie)).toBe(true);
    expect(outlineCrossesItself(roof)).toBe(false);
    expect(outlineCrossesItself([...roof].reverse())).toBe(false);
    const ell: Pt[] = [
      [0, 0],
      [80, 0],
      [80, 30],
      [40, 30],
      [40, 60],
      [0, 60],
    ];
    expect(outlineCrossesItself(ell)).toBe(false);
    expect(
      outlineCrossesItself([
        [0, 0],
        [40, 0],
        [0, 30],
      ]),
    ).toBe(false);
  });

  it("the viewer refuses to close one and says why", () => {
    const v = src("src/components/takeoff/viewer.tsx");
    expect(v).toContain('if (tool === "area" && pts.length >= 3 && outlineCrossesItself(pts)) {');
    expect(CROSSED_OUTLINE_TEXT).toContain("crosses itself");
  });

  it("one already in a drawing is flagged, blocks the bid, and leads the bid notice", () => {
    const q = quantities([area("Section 6", bowtie), area("Section 1", roof)]);
    expect(q.sections[0]!.problem).toContain("crosses itself");
    expect(q.sections[1]!.problem).toBeUndefined();
    expect(bidBlocker(q)).toContain("“Section 6”: its outline crosses itself");
    expect(bidBlocker(quantities([area("Section 1", roof)]))).toBeNull();
    expect(bidSeedFromTakeoff({}, q).unmapped[0]!.label).toBe(
      "CHECK Section 6: the measured area is wrong",
    );
    expect(src("src/components/takeoff/editor.tsx")).toContain(
      "const blocker = bidBlocker(quantities); if (blocker) {",
    );
  });

  it("a section that measures nothing blocks the bid too", () => {
    const sliver = quantities([
      area("Sliver", [
        [0, 0],
        [100, 0],
        [100, 0.001],
        [0, 0.001],
      ] as Pt[]),
    ]);
    expect(bidBlocker(sliver)).toContain("“Sliver” measures 0 sq ft");
    expect(bidSeedFromTakeoff({}, sliver).unmapped[0]!.label).toBe(
      "CHECK Sliver: it measures 0 sq ft",
    );
  });
});

describe("5. Cut-outs are checked against the roof and each other", () => {
  it("inside is fine, touching the roof's edge is fine", () => {
    expect(cutoutProblem(roof, [], sq(45, 20, 10))).toBeNull();
    expect(cutoutProblem(roof, [], sq(0, 20, 10))).toBeNull(); // a well against the wall
    expect(cutoutProblem(roof, [sq(10, 10, 10)], sq(20, 10, 10))).toBeNull(); // side by side
    expect(ringInsideOutline(sq(45, 20, 10), roof)).toBe(true);
  });

  it("outside, half outside, over another one, or crossed is refused", () => {
    expect(cutoutProblem(roof, [], sq(200, 200, 10))).toBe("outside");
    expect(cutoutProblem(roof, [], sq(95, 10, 10))).toBe("outside");
    expect(cutoutProblem(roof, [], sq(-50, -50, 300))).toBe("outside"); // bigger than the roof
    expect(cutoutProblem(roof, [sq(10, 10, 10)], sq(10, 10, 10))).toBe("overlap"); // on top
    expect(cutoutProblem(roof, [sq(10, 10, 10)], sq(15, 15, 10))).toBe("overlap");
    expect(cutoutProblem(roof, [sq(10, 10, 20)], sq(15, 15, 5))).toBe("overlap"); // inside it
    expect(ringsOverlap(sq(10, 10, 10), sq(20, 10, 10))).toBe(false);
    expect(
      cutoutProblem(
        roof,
        [],
        [
          [10, 10],
          [20, 20],
          [20, 10],
          [10, 20],
        ],
      ),
    ).toBe("crossed");
    expect(CUTOUT_PROBLEM_TEXT.outside).toContain("inside its roof area");
  });

  it("the editor does not add a refused cut-out", () => {
    const e = src("src/components/takeoff/editor.tsx");
    expect(e).toContain("cutoutProblem(area.points, area.attrs.cutouts ?? [], ring)");
    expect(e).toContain("toast.error(CUTOUT_PROBLEM_TEXT[problem]");
  });

  it("one already in a drawing is flagged and blocks the bid", () => {
    expect(areaProblem(roof, [sq(200, 200, 10)])).toContain("reaches outside the roof");
    expect(areaProblem(roof, [sq(10, 10, 10), sq(10, 10, 10)])).toContain("over each other");
    expect(areaProblem(roof, [sq(10, 10, 10), sq(30, 10, 10)])).toBeNull();
    const q = quantities([area("Section 4", roof, { cutouts: [sq(200, 200, 10)] })]);
    expect(q.sections[0]!.problem).toContain("reaches outside the roof");
    expect(bidBlocker(q)).toContain("“Section 4”");
    expect(src("src/components/takeoff/quantities-tab.tsx")).toContain('data-problem="section"');
  });
});

describe("6. A failed takeoff link is retried, then said out loud", () => {
  it("three tries, then a plain message that names the bid and what happens next", () => {
    expect(LINK_ATTEMPTS).toBe(3);
    expect(linkRetryDelayMs(1)).toBe(2000);
    expect(linkRetryDelayMs(2)).toBe(4000);
    const msg = linkFailedToast("Acme roof", "Failed to fetch.");
    expect(msg).toContain("“Acme roof” is saved, but its takeoff could not be linked to it");
    expect(msg).toContain("(Failed to fetch)");
    expect(msg).toContain("tried again each time you save this bid");
  });

  it("the estimator no longer swallows the failure", () => {
    const s = src("src/routes/estimate.tsx");
    expect(s).toContain("if (attempt < LINK_ATTEMPTS) {");
    expect(s).toContain("takeoffToLock.current = { takeoffId, bidId: builtBidId };");
    expect(s).toContain("toast.error(linkFailedToast(builtBidName,");
    const at = s.indexOf("const lockTakeoff = (");
    const end = s.indexOf("const linkFromTakeoff", at);
    expect(s.slice(at, end)).not.toContain(".catch(() => {})");
  });
});

describe("7. Smaller points", () => {
  it("the bid's layout rectangle carries the measured area (it lost up to 3 sq ft to rounding)", () => {
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const w = 5 + ((i * 7919) % 4000) / 10;
      const h = 5 + ((i * 104729) % 3000) / 10;
      const n = (((i * 31) % 40) / 100) * Math.min(w, h);
      const pts: Pt[] =
        n > 0.5
          ? [
              [0, 0],
              [w, 0],
              [w, h - n],
              [w - n, h - n],
              [w - n, h],
              [0, h],
            ]
          : [
              [0, 0],
              [w, 0],
              [w, h],
              [0, h],
            ];
      const s = quantities([area("r", pts, i % 3 === 0 ? { pitch: 1 + (i % 12) } : {})])
        .sections[0]!;
      worst = Math.max(worst, Math.abs(s.section.length * s.section.width - s.areaSqFt));
    }
    expect(worst).toBeLessThan(0.03);
    // The audit's own roof: 4,900 + 3,600 + 600 sq ft priced as 9,099.47.
    const well = quantities([area("s", roof, { cutouts: [sq(45, 20, 10)] })]).sections[0]!;
    expect(well.section.length).toBe(101.93);
    expect(well.section.length * well.section.width).toBeCloseTo(4900, 1);
    // A plain rectangle is untouched.
    const plain = quantities([area("p", roof)]).sections[0]!;
    expect([plain.section.length, plain.section.width]).toEqual([100, 50]);
  });

  it("a bid just seeded from a takeoff sets its spacing without the 're-derived' notice", () => {
    const s = src("src/routes/estimate.tsx");
    expect(s).toContain("freshFromTakeoff.current = true;");
    expect(s).toContain(
      "const quietChain = freshFromTakeoff.current; freshFromTakeoff.current = false;",
    );
    expect(s).toContain("applyChainFix(rs.state, rc.state); if (!quietChain) warnMilChanges(");
  });
});
