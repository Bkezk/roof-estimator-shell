/**
 * The Care plan report (owner, Nov 23: "we should also be able to add pictures to checked
 * marked good items since we can then use that to generate the care plan reports", then "add a
 * care plan report"): a second one-tap report on an inspection ticket that lists EVERY row of
 * the checklist with its result, note and pictures, the rows found OK included.
 *
 * Two halves. The first holds the Inspection report still: its template, its choices, what its
 * findings are split into and how they read are pinned to what they were before this report
 * was added. The second is the new report. Names and notes here are made up.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  CARE_PLAN_REPORT_OPTIONS,
  carePlanLines,
  findCarePlanTemplate,
  NO_CARE_PLAN_TEMPLATE,
} from "@/lib/documents/care-plan-report";
import {
  CARE_PLAN_REPORT_TEMPLATE,
  type DefaultTemplate,
  defaultTemplates,
  INSPECTION_REPORT_TEMPLATE,
  missingDefaultTemplates,
} from "@/lib/documents/defaults";
import { imageRefs } from "@/lib/documents/document-pdf.server";
import {
  findInspectionTemplate,
  INSPECTION_REPORT_OPTIONS,
} from "@/lib/documents/inspection-report";
import {
  DEFAULT_OPTIONS,
  instantiatePages,
  pagesSchema,
  richToText,
  type DocModule,
  type DocPage,
  type RepairItemModule,
  type RepairListModule,
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
  type InspectionSnapshot,
  repairItemFullTitle,
  repairItemTitle,
  resolveVariables,
  variableDefs,
} from "@/lib/documents/variables";
import { cleaningAsked } from "@/lib/roof-care-cleaning";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

/** Five rows in the checklist's order: two found OK (one with pictures), an issue, an N/A, one never answered. */
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
  ],
};

/** Module ids are made fresh each time: take them out before comparing. */
const noIds = (pages: readonly DocPage[]) =>
  JSON.parse(JSON.stringify(pages, (k, v: unknown) => (k === "id" ? undefined : v))) as unknown;
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
const template = (name: string) => defaultTemplates().find((t) => t.name === name)!;
const made = (name: string, options = INSPECTION_REPORT_OPTIONS) =>
  splitRepairLists(instantiatePages(template(name).pages, options), insp);
const modulesOf = (pages: readonly DocPage[]) => pages.flatMap((p) => p.modules);

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
  ticket: { number: "999901", description: "", date: "2026-11-20", po: "", type: "inspection" },
  inspection: insp,
  manager: null,
  accountManager: null,
  ...over,
});

describe("the Inspection report is what it was before the Care plan report", () => {
  it("its template is the same, module for module (ids aside)", () => {
    const t = template(INSPECTION_REPORT_TEMPLATE);
    const print = createHash("sha256")
      .update(JSON.stringify({ o: t.options, d: t.description, p: noIds(t.pages) }))
      .digest("hex");
    // Worked out on the code as it stood before this report (Nov 23, commit 771fbad).
    expect(print).toBe("58bfbeadb8a54fd4b599a710c13a95151d6befa1e855d7afcff08f359dbe67b1");
    const lists = modulesOf(t.pages).filter((m) => m.type === "repairList") as RepairListModule[];
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ rows: null, photos: true, allItems: false });
    expect("showStatus" in lists[0]!).toBe(false);
    expect("listOnly" in lists[0]!).toBe(false);
  });
  it("its choices are the same: pictures and marks on, no prices, not one item a page", () => {
    expect(INSPECTION_REPORT_OPTIONS).toEqual({
      ...DEFAULT_OPTIONS,
      prices: "none",
      photos: true,
      marks: true,
      itemPerPage: false,
    });
  });
  it("its button still finds its own template, never the new one", () => {
    const rows = defaultTemplates().map((t, i) => ({ id: `t${i}`, name: t.name, kind: t.kind }));
    expect(findInspectionTemplate(rows)?.name).toBe(INSPECTION_REPORT_TEMPLATE);
    const button = read("src/components/documents/inspection-report-button.tsx");
    expect(button).toContain("findInspectionTemplate(templates)");
    expect(button).toContain("options: INSPECTION_REPORT_OPTIONS");
    expect(button).not.toContain("care-plan");
  });
  it("made on a ticket, its findings are one box per ISSUE only, as before", () => {
    const pages = made(INSPECTION_REPORT_TEMPLATE);
    expect(pages).toHaveLength(3);
    const findings = pages[1]!.modules;
    expect(findings.map((m) => m.type)).toEqual(["body", "repairItem"]);
    const item = findings[1] as RepairItemModule;
    // Exactly the keys a split item had before: no new one rides along.
    expect(Object.keys(item).sort()).toEqual(["id", "itemId", "label", "note", "type"]);
    expect(item).toMatchObject({ itemId: "c", label: null, note: null });
    // An issue's heading is its bare name, and a row found OK is not listed at all.
    expect(repairItemData(item, insp)!.title).toBe("Seams");
    expect(words(layoutModules(findings, ctx()))).toEqual([
      "Findings",
      "Seams",
      "Open lap by unit 3",
    ]);
    // The only pictures loaded for the page are that issue's.
    const refs = [...imageRefs(pages, { inspection: insp }).values()];
    expect(refs.filter((r) => r.kind === "ticketPhoto")).toEqual([
      { kind: "ticketPhoto", photoId: "p3", marks: true },
    ]);
    expect(pages[2]!.modules.map((m) => m.type)).toEqual(["photoGrid", "body", "signature"]);
  });
  it("a box's heading reads as it did: the bare name for an issue, the result after any other", () => {
    expect(repairItemTitle("Seams", "issue")).toBe("Seams");
    expect(repairItemTitle("Drains", "ok")).toBe("Drains · OK");
    expect(repairItemTitle("Skylights", "na")).toBe("Skylights · N/A");
    expect(repairItemTitle("Gutters", null)).toBe("Gutters · OK");
    const m = { itemId: "c", label: null, note: null };
    expect(repairItemData(m, insp)!.title).toBe("Seams");
    expect(repairItemData({ ...m, showStatus: false }, insp)!.title).toBe("Seams");
  });
  it("an ordinary Repair List still prints its pictures and is still split", () => {
    const list = { rows: null, allItems: false };
    expect(repairListData(list, insp, true)).toMatchObject({
      rows: [["Seams", "Open lap by unit 3"]],
      photoIds: [["p3"]],
    });
    expect(repairListData(list, insp, false).photoIds).toEqual([[]]);
  });
  it("the variables it prints are untouched", () => {
    const v = resolveVariables(source());
    expect(v["inspection.date"]).toBe("November 20, 2026");
    expect(v["inspection.grade"]).toBe("B");
    expect(v["inspection.summary"]).toBe("1 issue · 3 OK · 1 N/A");
    expect(v["inspection.issues"]).toBe("Seams");
    expect(v["inspection.recommend"]).toBe("Repairs recommended");
    expect(v["inspection.technician"]).toBe("Sam Sample");
  });
});

describe("the Care plan report's template", () => {
  let t: DefaultTemplate;
  beforeAll(() => {
    t = template(CARE_PLAN_REPORT_TEMPLATE);
    expect(t, "the template is shipped").toBeTruthy();
  });
  it("is shipped as a ticket template with no prices, after the Inspection report", () => {
    expect(CARE_PLAN_REPORT_TEMPLATE).toBe("Care plan report");
    expect(t).toBeTruthy();
    expect(t.kind).toBe("ticket");
    expect(t.options).toEqual({ ...DEFAULT_OPTIONS, prices: "none" });
    const names = defaultTemplates()
      .filter((x) => x.kind === "ticket")
      .map((x) => x.name);
    expect(names).toEqual(["Service letter", INSPECTION_REPORT_TEMPLATE, "Care plan report"]);
  });
  it("starts with the property, the plan's inspection, the customer and the inspection", () => {
    const cover = t.pages[0]!.modules;
    expect(cover.map((m) => m.type)).toEqual([
      "letterhead",
      "hr",
      "body",
      "fullPhoto",
      "hr",
      "body",
    ]);
    const vars = {
      "property.name": "Sample Hall",
      "careplan.plan": "Roof Care plan, inspection 1 of 2",
      "careplan.cleaning": "Drains and scuppers cleaned: Yes",
      "company.name": "Sample Customer",
      "inspection.date": "November 20, 2026",
      "inspection.technician": "Sam Sample",
      "inspection.summary": "1 issue · 3 OK · 1 N/A",
      "inspection.grade.line": "Property Grade: B",
      "property.address1": "1 Sample St",
      "property.address2": "Sampleton, KY 40000",
    };
    expect(richToText((cover[2] as { text: RichDoc }).text, vars)).toBe(
      "Sample Hall\nRoof Care Plan Report\nRoof Care plan, inspection 1 of 2\nDrains and scuppers cleaned: Yes",
    );
    expect(richToText((cover[5] as { text: RichDoc }).text, vars)).toBe(
      "Customer: Sample Customer\nProperty Inspected: November 20, 2026\nInspected By: Sam Sample\nSummary: 1 issue · 3 OK · 1 N/A\nProperty Grade: B\n\n1 Sample St\nSampleton, KY 40000",
    );
  });
  it("then every row, then the issues as a short list and the recommendation", () => {
    const body = t.pages[1]!.modules;
    expect(t.pages).toHaveLength(2);
    expect(body.map((m) => m.type)).toEqual(["body", "repairList", "body", "repairList", "body"]);
    expect(richToText((body[0] as { text: RichDoc }).text)).toBe("Checklist");
    expect(body[1]).toMatchObject({ allItems: true, showStatus: true, rows: null });
    expect((body[1] as RepairListModule).listOnly).toBeUndefined();
    expect(richToText((body[2] as { text: RichDoc }).text)).toBe("Items needing attention");
    expect(body[3]).toMatchObject({ allItems: false, listOnly: true, rows: null });
    expect(richToText((body[4] as { text: RichDoc }).text, {}, (k) => k)).toBe(
      "Recommendation: [inspection.recommend]",
    );
  });
  it("carries nothing about money: no price module, no price or cost variable", () => {
    const all = modulesOf(t.pages);
    expect(all.some((m) => m.type === "pricingTable" || m.type === "priceLines")).toBe(false);
    // The letterhead is the company's own block, the same as on every template: left aside.
    const text = JSON.stringify(all.filter((m) => m.type !== "letterhead"));
    const keys = [...text.matchAll(/"key":"([^"]+)"/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual([
      "careplan.cleaning",
      "careplan.plan",
      "company.name",
      "inspection.date",
      "inspection.grade.line",
      "inspection.recommend",
      "inspection.summary",
      "inspection.technician",
      "property.address1",
      "property.address2",
      "property.name",
    ]);
    expect(text).not.toMatch(/\$|price|cost|credit|allowance|total/i);
  });
  it("is kept whole when it is stored and read back", () => {
    const back = pagesSchema.parse(JSON.parse(JSON.stringify(t.pages)));
    expect(back).toEqual(t.pages);
    const lists = modulesOf(back).filter((m) => m.type === "repairList") as RepairListModule[];
    expect(lists.map((l) => [l.allItems, l.showStatus, l.listOnly])).toEqual([
      [true, true, undefined],
      [false, undefined, true],
    ]);
  });
  it("reaches an install that already has the others, and one the office removed stays removed", () => {
    const existing = defaultTemplates()
      .filter((x) => x.name !== CARE_PLAN_REPORT_TEMPLATE)
      .map((x) => ({ kind: x.kind, name: x.name, deleted_at: null }));
    const added = missingDefaultTemplates(existing);
    expect(added.map((x) => [x.kind, x.name, x.isDefault])).toEqual([
      ["ticket", "Care plan report", false],
    ]);
    expect(
      missingDefaultTemplates([
        ...existing,
        { kind: "ticket", name: "Care Plan Report", deleted_at: "2026-11-24T00:00:00Z" },
      ]),
    ).toEqual([]);
  });
});

describe("the Care plan report made on a ticket", () => {
  let pages: DocPage[];
  let body: DocModule[];
  let items: RepairItemModule[];
  beforeAll(() => {
    pages = made(CARE_PLAN_REPORT_TEMPLATE, CARE_PLAN_REPORT_OPTIONS);
    body = pages[1]!.modules;
    items = body.filter((m) => m.type === "repairItem") as RepairItemModule[];
  });
  it("is generated with the Inspection report's own choices", () => {
    expect(CARE_PLAN_REPORT_OPTIONS).toEqual(INSPECTION_REPORT_OPTIONS);
    expect(CARE_PLAN_REPORT_OPTIONS).not.toBe(INSPECTION_REPORT_OPTIONS);
  });
  it("has one box for EVERY row, in the checklist's order", () => {
    expect(body.map((m) => m.type)).toEqual([
      "body",
      "repairItem",
      "repairItem",
      "repairItem",
      "repairItem",
      "repairItem",
      "body",
      "repairList",
      "body",
    ]);
    expect(items.map((m) => m.itemId)).toEqual(["a", "b", "c", "d", "e"]);
    // Live from the ticket, so Refresh data keeps them current, and each says its result.
    for (const m of items) expect(m).toMatchObject({ label: null, note: null, showStatus: true });
  });
  it("each row says its result in the site's own words, an issue's too", () => {
    expect(items.map((m) => repairItemData(m, insp)!.title)).toEqual([
      "Field membrane · OK",
      "Drains · OK",
      "Seams · Issue",
      "Skylights · N/A",
      // Never answered reads as OK (owner, Oct 26).
      "Gutters · OK",
    ]);
    expect(repairItemFullTitle("Seams", "issue")).toBe("Seams · Issue");
    expect(repairItemFullTitle("Gutters", null)).toBe("Gutters · OK");
  });
  it("prints each row's note and pictures, the pictures of rows found OK included", () => {
    const laid = layoutModules(body, ctx());
    expect(words(laid)).toEqual([
      "Checklist",
      "Field membrane · OK",
      "Drains · OK",
      "Clear",
      "Seams · Issue",
      "Open lap by unit 3",
      "Skylights · N/A",
      "Gutters · OK",
      "Items needing attention",
      "Recommendation: [inspection.recommend]",
    ]);
    // One line of thumbnails under each row that has pictures: two OK rows and the issue.
    expect(laid.filter((p) => p.kind === "columns")).toHaveLength(3);
    const refs = imageRefs(pages, { inspection: insp });
    const byRow = (m: RepairItemModule) =>
      [...refs.entries()]
        .filter(([k]) => k.startsWith(`${m.id}:`))
        .map(([, r]) => (r.kind === "ticketPhoto" ? r.photoId : ""));
    expect(items.map(byRow)).toEqual([["p1", "p2"], [], ["p3"], [], ["p4"]]);
    // Every picture once: the closing list loads none of them again.
    expect([...refs.values()].filter((r) => r.kind === "ticketPhoto")).toHaveLength(4);
  });
  it("several pictures share a line, so several rows fit a page", () => {
    const one = layoutModules([items[0]!], ctx());
    const line = one.find((p) => p.kind === "columns");
    expect(line && line.kind === "columns" && line.height).toBeLessThan(1.5 * 72);
  });
  it("with the document's Photos off it prints no picture, like any report", () => {
    expect(layoutModules(body, ctx({ photos: false })).some((p) => p.kind === "columns")).toBe(
      false,
    );
  });
  it("ends with the issues as a table that stays a table and has no pictures", () => {
    const list = body.find((m) => m.type === "repairList") as RepairListModule;
    expect(list.listOnly).toBe(true);
    const data = repairListData(list, insp, true);
    expect(data.columns.map((c) => c.title)).toEqual(["Item", "Note"]);
    expect(data.rows).toEqual([["Seams", "Open lap by unit 3"]]);
    expect(data.photoIds).toEqual([[]]);
    const laid = layoutModules([list], ctx());
    expect(laid.filter((p) => p.kind === "tableRow")).toHaveLength(2);
    expect(laid.some((p) => p.kind === "columns")).toBe(false);
  });
  it("a roof with nothing wrong says so at the end", () => {
    const clean: InspectionSnapshot = {
      ...insp,
      recommendRepairs: false,
      items: insp.items.map((i) => ({ ...i, status: "ok" as const })),
    };
    const p = splitRepairLists(
      instantiatePages(template(CARE_PLAN_REPORT_TEMPLATE).pages, CARE_PLAN_REPORT_OPTIONS),
      clean,
    );
    const mods: DocModule[] = p[1]!.modules;
    expect(mods.filter((m) => m.type === "repairItem")).toHaveLength(5);
    expect(words(layoutModules(mods, ctx({ inspection: clean })))).toContain("No issues found");
    expect(resolveVariables(source({ inspection: clean }))["inspection.recommend"]).toBe(
      "No issues found",
    );
  });
});

describe("what the cover says of a Roof Care plan's inspection", () => {
  const visit = (
    plan: "watch" | "care" | "guard",
    kind: "visit1" | "visit2" | "storm" | "carried",
    drains: boolean | null,
    gutters: boolean | null,
    note: string | null = null,
  ) => ({ plan, kind, asked: cleaningAsked(plan, kind), drains, gutters, note });
  it("which plan and which inspection of the year", () => {
    expect(carePlanLines(visit("care", "visit1", true, null)).plan).toBe(
      "Roof Care plan, inspection 1 of 2",
    );
    expect(carePlanLines(visit("guard", "visit2", true, true)).plan).toBe(
      "Roof Guard plan, inspection 2 of 2",
    );
    expect(carePlanLines(visit("watch", "storm", null, null)).plan).toBe(
      "Roof Watch plan, storm inspection",
    );
    expect(carePlanLines(visit("care", "carried", null, null)).plan).toBe(
      "Roof Care plan, inspection owed from last plan year",
    );
  });
  it("the cleaning the plan includes, answered yes or no, read as it is kept", () => {
    expect(carePlanLines(visit("care", "visit1", true, null)).cleaning).toBe(
      "Drains and scuppers cleaned: Yes",
    );
    expect(carePlanLines(visit("guard", "visit2", true, false, "needs a lift")).cleaning).toBe(
      "Drains and scuppers cleaned: Yes · Gutters cleaned: No: needs a lift",
    );
    expect(carePlanLines(visit("guard", "visit1", null, null)).cleaning).toBe(
      "Drains and scuppers cleaned: Not answered · Gutters cleaned: Not answered",
    );
    // Nothing is asked of Roof Watch, or at a storm inspection: no line.
    expect(carePlanLines(visit("watch", "visit1", null, null)).cleaning).toBe("");
    expect(carePlanLines(visit("guard", "storm", null, null)).cleaning).toBe("");
  });
  it("is two lines of words and nothing else: no price, cost or credit can ride along", () => {
    const lines = carePlanLines(visit("guard", "visit1", true, true));
    expect(Object.keys(lines).sort()).toEqual(["cleaning", "plan"]);
    expect(JSON.stringify(lines)).not.toMatch(/\$|\d{3}/);
  });
  it("prints on a plan's inspection, and is blank on any other ticket", () => {
    const on = resolveVariables(
      source({ carePlan: carePlanLines(visit("care", "visit1", true, null)) }),
    );
    expect(on["careplan.plan"]).toBe("Roof Care plan, inspection 1 of 2");
    expect(on["careplan.cleaning"]).toBe("Drains and scuppers cleaned: Yes");
    const off = resolveVariables(source());
    expect(off["careplan.plan"]).toBe("");
    expect(off["careplan.cleaning"]).toBe("");
    expect(resolveVariables(source({ carePlan: null }))["careplan.plan"]).toBe("");
  });
  it("the grade prints as a whole line, and not at all when there is none", () => {
    expect(resolveVariables(source())["inspection.grade.line"]).toBe("Property Grade: B");
    expect(
      resolveVariables(source({ inspection: { ...insp, grade: null } }))["inspection.grade.line"],
    ).toBe("");
    const keys = variableDefs("ticket").map((d) => d.key);
    for (const k of ["inspection.grade.line", "careplan.plan", "careplan.cleaning"])
      expect(keys).toContain(k);
    expect(variableDefs("bid").map((d) => d.key)).not.toContain("careplan.plan");
  });
});

describe("where the plan's lines are read", () => {
  const fns = flat(read("src/lib/documents.functions.ts"));
  it("with the caller's own rights, only for an inspection that is a plan's", () => {
    expect(fns).toContain("contact_id, inspection, technician_id, roof_care_visit_id");
    expect(fns).toContain(
      'if (row.service_type === "inspection" && row.roof_care_visit_id) carePlan = await loadCarePlan(sb, row.roof_care_visit_id);',
    );
    expect(fns).toContain("const c = await readVisitCleaning(sb, visitId);");
    expect(fns).toContain("return c ? carePlanLines(c) : null;");
    // No key that passes the rules, in this file as before.
    expect(fns).not.toMatch(/supabaseAdmin|client\.server|SUPABASE_SERVICE/);
  });
  it("an inspection that cannot be read never stops the document", () => {
    const load = fns.slice(fns.indexOf("async function loadCarePlan("));
    expect(load.slice(0, load.indexOf("async function loadInspection("))).toMatch(
      /try \{ .* \} catch \(e\) \{ console\.warn\(.*\); return null; \}/,
    );
  });
});

describe("the Care plan report button", () => {
  const button = flat(read("src/components/documents/care-plan-report-button.tsx"));
  const actions = read("src/components/service/ticket-header-actions.tsx");
  it("makes the report in one press and opens it in the editor", () => {
    expect(button).toContain('const templates = await listFn({ data: { kind: "ticket" } });');
    expect(button).toContain("const t = findCarePlanTemplate(templates);");
    expect(button).toContain("if (!t) throw new Error(NO_CARE_PLAN_TEMPLATE);");
    expect(button).toContain("options: CARE_PLAN_REPORT_OPTIONS,");
    expect(button).toContain('void navigate({ to: "/documents", search: { id: r.id } });');
    expect(button).toContain("onClick={() => make.mutate()}");
    expect(button).toContain(" Care plan report </Button>");
    // One press, one document: nothing is sent, attached or made on its own.
    expect(button).not.toMatch(/useEffect|emailDocument|createDocumentShareLink|setInterval/);
    expect(NO_CARE_PLAN_TEMPLATE).toBe(
      'There is no "Care plan report" template (Setup › Documents)',
    );
  });
  it("finds its own template by name, whatever the case", () => {
    const rows = [
      { id: "1", name: "Inspection report", kind: "ticket" },
      { id: "2", name: " care plan REPORT ", kind: "ticket" },
      { id: "3", name: "Care plan report", kind: "bid" },
    ];
    expect(findCarePlanTemplate(rows)?.id).toBe("2");
    expect(findCarePlanTemplate(rows.slice(0, 1))).toBeNull();
  });
  it("sits beside the Inspection report, on an inspection ticket only, and nowhere else", () => {
    const dialog = actions.slice(actions.indexOf("export function TicketDocumentsDialog("));
    expect(dialog).toMatch(
      /\{job\.service_type === "inspection" && \(\s*<InspectionReportButton[\s\S]*?\/>\s*\)\}\s*\{job\.service_type === "inspection" && \(\s*<CarePlanReportButton\s+serviceJobId=\{job\.id\}\s+ticketNumber=\{job\.number\}/,
    );
    expect((dialog.match(/<CarePlanReportButton/g) ?? []).length).toBe(1);
    expect((dialog.match(/<InspectionReportButton/g) ?? []).length).toBe(1);
    // The same dialog, so the same people: whoever may open a ticket's documents.
    expect(read("src/components/service/closeout.tsx")).not.toContain("CarePlanReportButton");
    expect(read("src/components/service/inspection-section.tsx")).not.toContain(
      "CarePlanReportButton",
    );
  });
});
