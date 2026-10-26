/**
 * The document model (owner, Oct 26: a CenterPoint-style generator whose output stays editable):
 * rich text with variable chips, the page / module operations the editor runs, generating from a
 * template with the checkboxes, and the variables resolved from a record.
 */
import { describe, expect, it } from "vitest";

import { defaultTemplates } from "./defaults";
import {
  addModule,
  addPage,
  applyOptionsToPages,
  DEFAULT_OPTIONS,
  duplicateModule,
  duplicatePage,
  findModule,
  imageRefSchema,
  instantiatePages,
  MODULE_TILES,
  moduleSchema,
  moveModule,
  movePage,
  newModule,
  newPage,
  newPdfModule,
  pagesSchema,
  pagesVariables,
  removeModule,
  removePage,
  resolveCellText,
  richFromText,
  richLine,
  richToText,
  richVariables,
  updateModule,
  type DocPage,
  type FullPhotoModule,
  type ImageRef,
  type PhotoGridModule,
  type RepairListModule,
  type RichDoc,
} from "./model";
import {
  type DocumentSource,
  type InspectionSnapshot,
  inspectionRows,
  pricingRows,
  resolveVariables,
  sampleVariables,
  VARIABLE_DEFS,
  variableDefs,
  variableLabel,
} from "./variables";

describe("rich text", () => {
  it("richFromText makes one paragraph per line; richToText prints them back", () => {
    const d = richFromText("Dear Jason,\n\nThank you.");
    expect(d.content).toHaveLength(3);
    expect(richToText(d)).toBe("Dear Jason,\n\nThank you.");
  });
  it("variables print their value, or [label] when the record has none", () => {
    const p = richLine([
      "Re: ",
      { variable: "property.name" },
      " for ",
      { variable: "company.name" },
    ]);
    const d = { type: "doc" as const, content: [p] };
    expect(
      richToText(d, { "property.name": "Whitley County Detention Center" }, variableLabel),
    ).toBe("Re: Whitley County Detention Center for [Company Name]");
    expect([...richVariables(d)]).toEqual(["property.name", "company.name"]);
  });
  it("table cells take {{key}}", () => {
    expect(resolveCellText("Total {{opportunity.price}}", { "opportunity.price": "$5" })).toBe(
      "Total $5",
    );
    expect(resolveCellText("{{ nope }}", {}, variableLabel)).toBe("[nope]");
  });
});

describe("modules and pages", () => {
  const pages = (): DocPage[] => [
    newPage([
      { ...newModule("body"), id: "a" },
      { ...newModule("hr"), id: "b" },
    ]),
    newPage([{ ...newModule("signature"), id: "c" }]),
  ];
  it("every tile makes a valid module", () => {
    for (const t of MODULE_TILES) {
      const m = newModule(t);
      expect(m.type).toBe(t);
      expect(pagesSchema.safeParse([newPage([m])]).success).toBe(true);
    }
    expect(() => newModule("pdf")).toThrow();
    const pdf = newPdfModule({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Award",
      pageCount: 2,
    });
    expect(pagesSchema.safeParse([newPage([pdf])]).success).toBe(true);
  });
  it("add / update / remove / duplicate a module", () => {
    let p = addModule(pages(), 0, { ...newModule("hr"), id: "x" }, 1);
    expect(p[0]!.modules.map((m) => m.id)).toEqual(["a", "x", "b"]);
    p = updateModule(p, "a", (m) => (m.type === "body" ? { ...m, text: richFromText("hi") } : m));
    expect(richToText((p[0]!.modules[0] as unknown as { text: RichDoc }).text)).toBe("hi");
    p = removeModule(p, "x");
    expect(p[0]!.modules.map((m) => m.id)).toEqual(["a", "b"]);
    p = duplicateModule(p, "a");
    expect(p[0]!.modules).toHaveLength(3);
    expect(p[0]!.modules[1]!.id).not.toBe("a");
    expect(richToText((p[0]!.modules[1] as unknown as { text: RichDoc }).text)).toBe("hi");
  });
  it("moving a module past the edge of its page carries it to the next / previous page", () => {
    let p = moveModule(pages(), "b", 1);
    expect(p[0]!.modules.map((m) => m.id)).toEqual(["a"]);
    expect(p[1]!.modules.map((m) => m.id)).toEqual(["b", "c"]);
    p = moveModule(p, "b", -1);
    expect(p[0]!.modules.map((m) => m.id)).toEqual(["a", "b"]);
    expect(moveModule(pages(), "a", -1)[0]!.modules.map((m) => m.id)).toEqual(["a", "b"]);
    expect(findModule(pages(), "zzz")).toBeNull();
  });
  it("pages: add, move, duplicate (fresh ids), remove (never below one page)", () => {
    let p = addPage(pages(), 1);
    expect(p).toHaveLength(3);
    expect(p[1]!.modules).toEqual([]);
    p = movePage(p, p[1]!.id, 1);
    expect(p[2]!.modules).toEqual([]);
    const dup = duplicatePage(pages(), pages()[0]!.id);
    expect(dup).toHaveLength(2);
    const base = pages();
    const one = removePage(removePage(base, base[0]!.id), "nope");
    expect(one).toHaveLength(1);
    const first = pages()[0]!;
    const d2 = duplicatePage([first], first.id);
    expect(d2[1]!.id).not.toBe(first.id);
    expect(d2[1]!.modules[0]!.id).not.toBe("a");
  });
});

describe("generating from a template with the checkboxes", () => {
  const tpl: DocPage[] = [
    newPage([
      newModule("letterhead"),
      {
        ...(newModule("fullPhoto") as FullPhotoModule),
        image: { kind: "ticketPhoto", photoId: "p1", marks: true },
      },
      newModule("pricingTable"),
    ]),
  ];
  it("photos off drops photo modules; prices none sets every pricing table; ids are fresh", () => {
    const out = instantiatePages(tpl, { ...DEFAULT_OPTIONS, photos: false, prices: "none" });
    expect(out[0]!.modules.map((m) => m.type)).toEqual(["letterhead", "pricingTable"]);
    expect((out[0]!.modules[1] as { mode: string }).mode).toBe("none");
    expect(out[0]!.id).not.toBe(tpl[0]!.id);
    expect(out[0]!.modules[0]!.id).not.toBe(tpl[0]!.modules[0]!.id);
  });
  it("marks off strips the marks from ticket photos, keeps the photo; flipping later keeps text", () => {
    const out = instantiatePages(tpl, { ...DEFAULT_OPTIONS, marks: false });
    const img = (out[0]!.modules[1] as { image: { marks: boolean } }).image;
    expect(img.marks).toBe(false);
    const back = applyOptionsToPages(out, { ...DEFAULT_OPTIONS, prices: "none" });
    expect((back[0]!.modules[2] as { mode: string }).mode).toBe("none");
    expect(back[0]!.modules[0]!.id).toBe(out[0]!.modules[0]!.id);
  });
  it("the default templates are valid and use only known variables", () => {
    const known = new Set(VARIABLE_DEFS.map((d) => d.key));
    for (const t of defaultTemplates()) {
      expect(pagesSchema.safeParse(t.pages).success).toBe(true);
      for (const k of pagesVariables(t.pages)) expect(known.has(k)).toBe(true);
    }
    expect(defaultTemplates().map((t) => t.name)).toContain("Proposal");
  });
});

describe("phase 2 modules and marked-up uploads", () => {
  it("Photo Grid and Repair List are modules with tiles; a new one starts empty", () => {
    expect(MODULE_TILES).toContain("photoGrid");
    expect(MODULE_TILES).toContain("repairList");
    expect(newModule("photoGrid")).toMatchObject({ type: "photoGrid", images: [], columns: 2 });
    expect(newModule("repairList")).toMatchObject({
      type: "repairList",
      rows: null,
      photos: true,
      allItems: false,
    });
  });
  it("an uploaded picture keeps the marks drawn on it; the schema accepts them and a site cover", () => {
    const img: ImageRef = {
      kind: "upload",
      path: "d1/a.jpg",
      width: 1200,
      height: 900,
      marks: [
        {
          id: "m1",
          kind: "ellipse",
          a: [0.1, 0.1],
          b: [0.4, 0.3],
          color: "red",
        },
      ],
    };
    expect(imageRefSchema.parse(img)).toEqual(img);
    expect(
      imageRefSchema.parse({ kind: "siteCover", siteId: "55555555-5555-4555-8555-555555555555" }),
    ).toEqual({ kind: "siteCover", siteId: "55555555-5555-4555-8555-555555555555" });
    const grid = { ...newModule("photoGrid"), images: [{ image: img, caption: "NE corner" }] };
    expect(moduleSchema.parse(grid)).toEqual(grid);
  });
  it("the Photos and Marks checkboxes reach the new modules", () => {
    const pages: DocPage[] = [
      {
        id: "p",
        modules: [
          newModule("repairList"),
          {
            ...newModule("photoGrid"),
            images: [
              {
                image: {
                  kind: "ticketPhoto" as const,
                  photoId: "11111111-1111-4111-8111-111111111111",
                  marks: true,
                },
                caption: "",
              },
            ],
          },
        ],
      },
    ];
    const noMarks = applyOptionsToPages(pages, { ...DEFAULT_OPTIONS, marks: false });
    expect((noMarks[0]!.modules[1] as PhotoGridModule).images[0]!.image).toMatchObject({
      marks: false,
    });
    const noPhotos = applyOptionsToPages(pages, { ...DEFAULT_OPTIONS, photos: false });
    expect((noPhotos[0]!.modules[0] as RepairListModule).photos).toBe(false);
  });
});

describe("variables", () => {
  const src: DocumentSource = {
    kind: "bid",
    today: new Date("2026-10-26T15:00:00Z"),
    documentTitle: "Proposal — Whitley",
    account: {
      name: "JBK, Inc.",
      address: "1486 W Cumberland Gap Pkwy",
      city: "Corbin",
      state: "KY",
      zip: "40702",
      phone: "(606) 523-9000",
      website: "www.flatroofonline.com",
      email: "",
    },
    company: {
      name: "City of Corbin",
      contact: "Jason Wilson",
      contactPosition: "Jailer",
      phone: "(606) 549-6013",
      email: "",
      address: "128 Civic Center Dr",
      city: "Corbin",
      state: "KY",
      zip: "40701",
      externalId: "",
    },
    property: {
      name: "Whitley County Detention Center",
      address: "128 Civic Center Dr",
      city: "Corbin",
      county: "Whitley County",
      state: "KY",
      zip: "40701",
      areaSqFt: 18008,
    },
    bid: {
      name: "Whitley County Detention Center",
      total: 242879.61,
      system: "Duro-Last 60 mil",
      dueDate: "2026-10-30",
      sections: [
        { name: "Section 1", lengthFt: 188, widthFt: 182, system: "Duro-Last" },
        { name: "Section 2", lengthFt: 164, widthFt: 111.5, system: "Duro-Last" },
      ],
      sqFt: 52502,
      warranty: "20 Yr NDL",
    },
    ticket: null,
    manager: { name: "Brandon Keck", email: "brandon@flatroofonline.com", phone: "(606) 523-9000" },
    accountManager: { name: "RoAnna Sims", email: "sales@flatroofonline.com", phone: "" },
  };
  it("resolves every key of the kind; the record's blanks stay blank, never undefined", () => {
    const v = resolveVariables(src);
    expect(v["today"]).toBe("October 26, 2026");
    expect(v["today.short"]).toBe("10/26/26");
    expect(v["account.address2"]).toBe("Corbin, KY 40702");
    expect(v["company.contact.position"]).toBe("Jailer");
    expect(v["property.area"]).toBe("18,008");
    expect(v["opportunity.price"]).toBe("$242,879.61");
    expect(v["opportunity.due"]).toBe("October 30, 2026");
    expect(v["opportunity.sqft"]).toBe("52,502");
    expect(v["account.email"]).toBe("");
    for (const d of variableDefs("bid")) expect(typeof v[d.key]).toBe("string");
    expect("ticket.number" in v).toBe(false);
  });
  it("a ticket document carries the ticket keys and not the bid's", () => {
    const v = resolveVariables({
      ...src,
      kind: "ticket",
      bid: null,
      ticket: {
        number: "6012",
        description: "Leak",
        date: "2026-10-20",
        po: "PO 1",
        type: "Repair",
      },
    });
    expect(v["ticket.number"]).toBe("6012");
    expect(v["ticket.date"]).toBe("October 20, 2026");
    expect("opportunity.price" in v).toBe(false);
  });
  it("an inspection ticket (phase 2): Property Inspected / Grade, the summary; an unflagged item reads as OK", () => {
    const v = resolveVariables({
      ...src,
      kind: "ticket",
      bid: null,
      ticket: { number: "6040", description: "Inspection", date: null, po: "", type: "Inspection" },
      inspection: {
        inspectedOn: "2026-10-20",
        grade: "D",
        technician: "Braden Keck",
        notes: "",
        recommendRepairs: true,
        items: [
          { id: "c1", label: "Seams", status: "issue", note: "open at NE", photoIds: ["p1"] },
          { id: "c2", label: "Flashings", status: "issue", note: "", photoIds: [] },
          { id: "c3", label: "Drains", status: null, note: "", photoIds: [] },
          { id: "c4", label: "Membrane", status: "ok", note: "", photoIds: [] },
          { id: "c5", label: "Skylights", status: "na", note: "", photoIds: [] },
        ],
      },
    });
    expect(v["inspection.date"]).toBe("October 20, 2026");
    expect(v["inspection.grade"]).toBe("D");
    expect(v["inspection.summary"]).toBe("2 issues · 2 OK · 1 N/A");
    expect(v["inspection.issues"]).toBe("Seams; Flashings");
    expect(v["inspection.recommend"]).toBe("Repairs recommended");
    expect(v["inspection.technician"]).toBe("Braden Keck");
    for (const d of variableDefs("ticket")) expect(typeof v[d.key]).toBe("string");
  });
  it("a plain ticket leaves the inspection keys blank, never undefined", () => {
    const v = resolveVariables({
      ...src,
      kind: "ticket",
      bid: null,
      ticket: { number: "6012", description: "Leak", date: null, po: "", type: "Repair" },
    });
    expect(v["inspection.grade"]).toBe("");
    expect(v["inspection.recommend"]).toBe("");
  });
  it("inspectionRows: the issues with their notes and pictures, or every item with its finding", () => {
    const insp: InspectionSnapshot = {
      inspectedOn: null,
      grade: null,
      technician: "",
      notes: "",
      recommendRepairs: false,
      items: [
        { id: "c1", label: "Seams", status: "issue", note: "open at NE", photoIds: ["p1", "p2"] },
        { id: "c3", label: "Drains", status: null, note: "", photoIds: [] },
        { id: "c5", label: "Skylights", status: "na", note: "", photoIds: [] },
      ],
    };
    expect(inspectionRows(insp, false)).toEqual({
      columns: ["Item", "Note"],
      rows: [["Seams", "open at NE"]],
      photoIds: [["p1", "p2"]],
    });
    expect(inspectionRows(insp, true).rows).toEqual([
      ["Seams", "Issue", "open at NE"],
      ["Drains", "OK", ""],
      ["Skylights", "N/A", ""],
    ]);
    expect(inspectionRows(null, false).rows).toEqual([]);
  });
  it("samples cover every key; labels are CenterPoint's", () => {
    expect(Object.keys(sampleVariables("bid")).length).toBe(variableDefs("bid").length);
    expect(variableLabel("account.name")).toBe("Account Name");
    expect(variableLabel("company.external_id")).toBe("Company External ID");
    expect(variableLabel("made.up")).toBe("made.up");
  });
  it("the pricing table: a row per section and the total, or no total without prices", () => {
    const t = pricingRows(src, "total", true);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]).toEqual(["Section 1", "182 × 188 ft", "34,216", "Duro-Last"]);
    expect(t.rows[2]).toEqual(["Total", "", "", "$242,879.61"]);
    expect(pricingRows(src, "none", true).rows).toHaveLength(2);
    expect(pricingRows(src, "total", false).rows).toEqual([["Total", "", "", "$242,879.61"]]);
  });
});
