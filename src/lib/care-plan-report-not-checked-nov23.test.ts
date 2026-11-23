/**
 * The Care plan report, the owner's two go-aheads of Nov 23 ("go with issue 1, issue 2"):
 *
 *  1. A row of the checklist nobody answered prints "Not checked" on this report, and its
 *     Summary counts such rows apart. Every other document keeps the Oct 26 rule: a row with no
 *     answer reads as OK.
 *  2. The ticket's pictures that are on no row are in the report: a heading and a Photo Grid
 *     after everything else on the last page. Nothing is added when there are none.
 *
 * Both are told by what the document holds (a list or a row marked `showStatus`), not by the
 * template's name or a change to the shipped template, so a "Care plan report" template that
 * was put into an install before today behaves the same. Names and notes here are made up.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CARE_PLAN_REPORT_OPTIONS,
  carePlanSummary,
  carePlanVariables,
  isCarePlanReport,
  loosePhotoIds,
  OTHER_PICTURES_HEADING,
  withOtherPictures,
} from "@/lib/documents/care-plan-report";
import {
  CARE_PLAN_REPORT_TEMPLATE,
  defaultTemplates,
  INSPECTION_REPORT_TEMPLATE,
} from "@/lib/documents/defaults";
import { imageRefs } from "@/lib/documents/document-pdf.server";
import { INSPECTION_REPORT_OPTIONS } from "@/lib/documents/inspection-report";
import {
  instantiatePages,
  newModule,
  pagesSchema,
  richToText,
  type DocModule,
  type DocPage,
  type RepairItemModule,
  type RichDoc,
} from "@/lib/documents/model";
import {
  CONTENT_WIDTH,
  layoutModules,
  repairItemData,
  repairListData,
  type Piece,
} from "@/lib/documents/pdf-layout";
import { splitRepairLists } from "@/lib/documents/server-pure";
import {
  type DocumentSource,
  INSPECTION_NOT_CHECKED,
  type InspectionSnapshot,
  inspectionRows,
  repairItemFullTitle,
  repairItemTitle,
  resolveVariables,
} from "@/lib/documents/variables";

/** Two pictures of the ticket that are on no row (made-up ids, shaped like real ones). */
const X1 = "0a1b2c3d-0000-4000-8000-000000000001";
const X2 = "0a1b2c3d-0000-4000-8000-000000000002";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

/** Six rows: two ticked OK, an issue, an N/A, and two nobody answered. */
const insp: InspectionSnapshot = {
  inspectedOn: "2026-11-20",
  grade: "B",
  technician: "Sam Sample",
  notes: "",
  recommendRepairs: true,
  items: [
    { id: "a", label: "Field membrane", status: "ok", note: "", photoIds: ["p1", "p2"] },
    { id: "b", label: "Drains", status: "ok", note: "Clear", photoIds: [] },
    { id: "c", label: "Seams", status: "issue", note: "Open lap by unit 3", photoIds: ["p3"] },
    { id: "d", label: "Skylights", status: "na", note: "", photoIds: [] },
    { id: "e", label: "Gutters", status: null, note: "", photoIds: ["p4"] },
    { id: "f", label: "Penetrations", status: null, note: "", photoIds: [] },
  ],
};

const ctx = (over: Record<string, unknown> = {}) => ({
  width: CONTENT_WIDTH,
  measure: (t: string, _f: string, s: number) => t.length * s * 0.5,
  vars: {},
  labelOf: (k: string) => k,
  image: () => ({ width: 4, height: 3 }),
  pricing: { bid: null },
  inspection: insp,
  marks: true,
  ...over,
});
const words = (pieces: readonly Piece[]) =>
  pieces
    .filter((p) => p.kind === "text")
    .map((p) => (p.kind === "text" ? p.line.segments.map((s) => s.text).join("") : ""));
const noIds = (x: unknown) =>
  JSON.parse(JSON.stringify(x, (k, v: unknown) => (k === "id" ? undefined : v))) as unknown;
const template = (name: string) => defaultTemplates().find((t) => t.name === name)!;
const made = (name: string, options = INSPECTION_REPORT_OPTIONS) =>
  splitRepairLists(instantiatePages(template(name).pages, options), insp);
/** A template as an install keeps it: through the database and back. */
const stored = (name: string): DocPage[] =>
  pagesSchema.parse(JSON.parse(JSON.stringify(template(name).pages)));

const source = (over: Partial<DocumentSource> = {}): DocumentSource => ({
  kind: "ticket",
  today: new Date("2026-11-23T15:00:00Z"),
  documentTitle: "Report",
  account: {
    name: "Roofer",
    address: "",
    city: "",
    state: "",
    zip: "",
    phone: "",
    website: "",
    email: "",
  },
  company: null,
  property: null,
  bid: null,
  ticket: { number: "999902", description: "", date: "2026-11-20", po: "", type: "inspection" },
  inspection: insp,
  manager: null,
  accountManager: null,
  ...over,
});

describe("which document is a Care plan report", () => {
  it("is told by what it holds: the shipped template, and no other shipped template", () => {
    const yes = defaultTemplates().filter((t) => isCarePlanReport(t.pages));
    expect(yes.map((t) => t.name)).toEqual([CARE_PLAN_REPORT_TEMPLATE]);
  });
  it("a template an install was given before today counts, and so does the report made from it", () => {
    expect(isCarePlanReport(stored(CARE_PLAN_REPORT_TEMPLATE))).toBe(true);
    expect(isCarePlanReport(made(CARE_PLAN_REPORT_TEMPLATE, CARE_PLAN_REPORT_OPTIONS))).toBe(true);
  });
  it("the Inspection report is not one, as a template or made; nor is nothing", () => {
    expect(isCarePlanReport(stored(INSPECTION_REPORT_TEMPLATE))).toBe(false);
    expect(isCarePlanReport(made(INSPECTION_REPORT_TEMPLATE))).toBe(false);
    expect(isCarePlanReport(null)).toBe(false);
    expect(isCarePlanReport([])).toBe(false);
  });
});

describe("1. a row nobody answered reads Not checked on the Care plan report", () => {
  const pages = made(CARE_PLAN_REPORT_TEMPLATE, CARE_PLAN_REPORT_OPTIONS);
  const items = pages[1]!.modules.filter((m) => m.type === "repairItem") as RepairItemModule[];
  it("in each row's heading, and a ticked row still says OK", () => {
    expect(INSPECTION_NOT_CHECKED).toBe("Not checked");
    expect(items.map((m) => repairItemData(m, insp)!.title)).toEqual([
      "Field membrane · OK",
      "Drains · OK",
      "Seams · Issue",
      "Skylights · N/A",
      "Gutters · Not checked",
      "Penetrations · Not checked",
    ]);
    expect(repairItemFullTitle("Gutters", null)).toBe("Gutters · Not checked");
    expect(repairItemFullTitle("Drains", "ok")).toBe("Drains · OK");
  });
  it("on the printed page, with the row's pictures still under it", () => {
    const laid = layoutModules(pages[1]!.modules, ctx());
    expect(words(laid)).toContain("Gutters · Not checked");
    expect(words(laid)).toContain("Penetrations · Not checked");
    expect(words(laid)).not.toContain("Gutters · OK");
    const refs = imageRefs(pages, { inspection: insp });
    const gutters = items[4]!;
    expect(
      [...refs.entries()]
        .filter(([k]) => k.startsWith(`${gutters.id}:`))
        .map(([, r]) => (r.kind === "ticketPhoto" ? r.photoId : "")),
    ).toEqual(["p4"]);
  });
  it("in the editor, by the same words as the PDF", () => {
    const view = flat(read("src/components/documents/editor/module-view.tsx"));
    expect(view).toContain(
      'm.showStatus ? fullStatusText(data.status) : INSPECTION_STATUS_TEXT[data.status ?? "ok"]',
    );
    // The box that picks which row a box shows lists the rows the same way.
    expect(view).toContain(
      "m.showStatus ? repairItemFullTitle(i.label, i.status) : repairItemTitle(i.label, i.status)",
    );
  });
  it("in a list of every row that was never split into boxes", () => {
    const list = { rows: null, allItems: true, showStatus: true };
    expect(repairListData(list, insp, true).rows.map((r) => r[1])).toEqual([
      "OK",
      "OK",
      "Issue",
      "N/A",
      "Not checked",
      "Not checked",
    ]);
  });
  it("the Summary counts them apart, never as OK", () => {
    expect(carePlanSummary(insp)).toBe("1 issue · 2 OK · 1 N/A · 2 not checked");
    const all = { items: insp.items.map((i) => ({ ...i, status: "ok" as const })) };
    expect(carePlanSummary(all)).toBe("6 OK");
    const none = { items: insp.items.map((i) => ({ ...i, status: null })) };
    expect(carePlanSummary(none)).toBe("6 not checked");
  });
  it("the report stores that Summary when made and again after Refresh data", () => {
    const vars = resolveVariables(source());
    const care = carePlanVariables(vars, pages, insp);
    expect(care["inspection.summary"]).toBe("1 issue · 2 OK · 1 N/A · 2 not checked");
    // Nothing else moves.
    expect({ ...care, "inspection.summary": vars["inspection.summary"] }).toEqual(vars);
    const fns = flat(read("src/lib/documents.functions.ts"));
    expect(fns).toContain(
      "const variables = carePlanVariables(snapshot(loaded.source), pages, inspection);",
    );
    expect(fns).toContain("const kept = pagesSchema.safeParse(row.pages);");
    expect(fns).toContain(
      'const variables = carePlanVariables( snapshot(loaded.source), kept.success ? kept.data : null, loaded.source.kind === "ticket" ? loaded.source.inspection : null, );',
    );
  });
});

describe("1. every other document keeps the Oct 26 rule: no answer reads as OK", () => {
  it("the Inspection report's boxes and an ordinary Checklist item", () => {
    expect(repairItemTitle("Gutters", null)).toBe("Gutters · OK");
    const item = { itemId: "e", label: null, note: null };
    expect(repairItemData(item, insp)!.title).toBe("Gutters · OK");
    // The Inspection report made on the same ticket: one box, the issue, with its bare name.
    const boxes = made(INSPECTION_REPORT_TEMPLATE)
      .flatMap((p) => p.modules)
      .filter((m) => m.type === "repairItem") as RepairItemModule[];
    expect(boxes.map((m) => repairItemData(m, insp)!.title)).toEqual(["Seams"]);
    expect(boxes.every((m) => !("showStatus" in m))).toBe(true);
  });
  it("an ordinary list of every row", () => {
    expect(inspectionRows(insp, true).rows.map((r) => r[1])).toEqual([
      "OK",
      "OK",
      "Issue",
      "N/A",
      "OK",
      "OK",
    ]);
    const list = { rows: null, allItems: true };
    expect(repairListData(list, insp, true).rows.map((r) => r[1])).toEqual([
      "OK",
      "OK",
      "Issue",
      "N/A",
      "OK",
      "OK",
    ]);
  });
  it("the Summary everyone else prints, and what an Inspection report stores", () => {
    const vars = resolveVariables(source());
    expect(vars["inspection.summary"]).toBe("1 issue · 4 OK · 1 N/A");
    // Not a Care plan report: the very same variables come back.
    expect(carePlanVariables(vars, made(INSPECTION_REPORT_TEMPLATE), insp)).toBe(vars);
    expect(carePlanVariables(vars, null, insp)).toBe(vars);
    expect(carePlanVariables(vars, made(CARE_PLAN_REPORT_TEMPLATE), null)).toBe(vars);
  });
});

describe("2. the ticket's pictures that are on no row", () => {
  const pages = made(CARE_PLAN_REPORT_TEMPLATE, CARE_PLAN_REPORT_OPTIONS);
  it("are the inspection's pictures no listed row carries, in the order taken, each once", () => {
    expect(loosePhotoIds(insp, ["p1", X1, "p3", X2, "p4", X1, "p2"])).toEqual([X1, X2]);
    expect(loosePhotoIds(insp, ["p1", "p2", "p3", "p4"])).toEqual([]);
    expect(loosePhotoIds(null, [X1])).toEqual([X1]);
  });
  it("go under a plain heading, in a grid, after everything else on the last page", () => {
    const out = withOtherPictures(pages, [X1, X2]);
    expect(out).toHaveLength(pages.length);
    expect(pagesSchema.safeParse(out).success).toBe(true);
    const last: DocModule[] = out[out.length - 1]!.modules;
    const before = pages[pages.length - 1]!.modules;
    expect(last).toHaveLength(before.length + 2);
    // What was there is untouched, and so is every earlier page.
    expect(last.slice(0, before.length)).toEqual(before);
    expect(out.slice(0, -1)).toEqual(pages.slice(0, -1));
    const [heading, grid] = last.slice(-2) as [DocModule, DocModule];
    expect(heading.type).toBe("body");
    expect(heading.type === "body" && richToText(heading.text as RichDoc)).toBe(
      "Other pictures from this visit",
    );
    expect(OTHER_PICTURES_HEADING).toBe("Other pictures from this visit");
    expect(noIds(grid)).toEqual({
      type: "photoGrid",
      columns: 3,
      // The ticket's own files, by reference: nothing is copied or made smaller.
      images: [
        { image: { kind: "ticketPhoto", photoId: X1, marks: true }, caption: "" },
        { image: { kind: "ticketPhoto", photoId: X2, marks: true }, caption: "" },
      ],
    });
  });
  it("print on the page: the heading, then one line of pictures", () => {
    const out = withOtherPictures(pages, [X1, X2]);
    const last = out[out.length - 1]!.modules;
    const laid = layoutModules(last.slice(-2), ctx());
    expect(words(laid)).toEqual(["Other pictures from this visit"]);
    expect(laid.filter((p) => p.kind === "columns")).toHaveLength(1);
    const refs = [...imageRefs(out, { inspection: insp }).values()];
    const ids = refs.map((r) => (r.kind === "ticketPhoto" ? r.photoId : ""));
    expect(ids.filter((id) => id === X1 || id === X2)).toEqual([X1, X2]);
    // The rows' own pictures are still there, each once.
    expect(ids.filter((id) => /^p\d$/.test(id)).sort()).toEqual(["p1", "p2", "p3", "p4"]);
  });
  it("with none there is no heading and no gap: the pages are as they were", () => {
    const out = withOtherPictures(pages, []);
    expect(out).toEqual(pages);
    expect(JSON.stringify(out)).not.toContain(OTHER_PICTURES_HEADING);
  });
  it("the Inspection report and any other document are left alone", () => {
    const report = made(INSPECTION_REPORT_TEMPLATE);
    expect(withOtherPictures(report, [X1, X2])).toEqual(report);
    expect(withOtherPictures([], [X1])).toEqual([]);
  });
  it("a template the office gave an empty Photo Grid gets them there, with no heading added", () => {
    const own = stored(CARE_PLAN_REPORT_TEMPLATE);
    own[1]!.modules.push({ ...newModule("photoGrid"), columns: 2 } as DocModule);
    const doc = splitRepairLists(instantiatePages(own, CARE_PLAN_REPORT_OPTIONS), insp);
    const out = withOtherPictures(doc, [X1]);
    const last = out[out.length - 1]!.modules;
    expect(last).toHaveLength(doc[doc.length - 1]!.modules.length);
    const grid = last[last.length - 1]!;
    expect(grid.type === "photoGrid" && grid.columns).toBe(2);
    expect(grid.type === "photoGrid" && grid.images.map((c) => c.image)).toEqual([
      { kind: "ticketPhoto", photoId: X1, marks: true },
    ]);
    expect(JSON.stringify(out)).not.toContain(OTHER_PICTURES_HEADING);
  });
  it("are read once with the inspection and put in when the report is made", () => {
    const fns = flat(read("src/lib/documents.functions.ts"));
    expect(fns).toContain("photoIds: (photos.data ?? []).map((p) => p.id),");
    expect(fns).toContain(
      "const pages = withOtherPictures( split, inspection ? loosePhotoIds(inspection, loaded.inspectionPhotoIds) : [], );",
    );
    // The same read as the rows' pictures: the inspection's own, never a repair's.
    expect(fns).toContain('.eq("role", "other") .is("repair_id", null)');
  });
});
