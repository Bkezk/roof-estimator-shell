/**
 * The document model (owner, Oct 26: a CenterPoint-style generator whose output stays editable):
 * rich text with variable chips, the page / module operations the editor runs, generating from a
 * template with the checkboxes, and the variables resolved from a record.
 */
import { describe, expect, it } from "vitest";

import { defaultTemplates, INSPECTION_REPORT_TEMPLATE, missingDefaultTemplates } from "./defaults";
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
  marksShown,
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
  // Oct 28: Photos off used to DROP the photo modules (the box then looked dead on an existing
  // document); it is a view switch now — the modules stay, hidden until it is ticked again.
  it("photos off keeps the photo modules (hidden, not dropped); prices none sets every pricing table; ids are fresh", () => {
    const out = instantiatePages(tpl, { ...DEFAULT_OPTIONS, photos: false, prices: "none" });
    expect(out[0]!.modules.map((m) => m.type)).toEqual(["letterhead", "fullPhoto", "pricingTable"]);
    expect((out[0]!.modules[1] as FullPhotoModule).image).toEqual({
      kind: "ticketPhoto",
      photoId: "p1",
      marks: true,
    });
    expect((out[0]!.modules[2] as { mode: string }).mode).toBe("none");
    expect(out[0]!.id).not.toBe(tpl[0]!.id);
    expect(out[0]!.modules[0]!.id).not.toBe(tpl[0]!.modules[0]!.id);
  });
  // Oct 28: Marks off used to turn the ticket photo's "with marks" flag off for good; the flag
  // stays (the renderer hides the marks while the box is off).
  it("marks off leaves the ticket photo's ref as it was; flipping prices later keeps text and ids", () => {
    const out = instantiatePages(tpl, { ...DEFAULT_OPTIONS, marks: false });
    const img = (out[0]!.modules[1] as { image: { marks: boolean } }).image;
    expect(img.marks).toBe(true);
    const back = applyOptionsToPages(out, { ...DEFAULT_OPTIONS, prices: "none" });
    expect((back[0]!.modules[2] as { mode: string }).mode).toBe("none");
    expect(back[0]!.modules[0]!.id).toBe(out[0]!.modules[0]!.id);
    // Untouched modules are the very same objects (the editor's dirty check stays quiet).
    expect(back[0]!.modules[1]).toBe(out[0]!.modules[1]);
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
    const grid = {
      ...(newModule("photoGrid") as PhotoGridModule),
      images: [{ image: img, caption: "NE corner" }],
    };
    expect(moduleSchema.parse(grid)).toEqual(grid);
  });
  // Oct 28: this used to pin Marks off flipping the grid's ticket photo to marks:false and Photos
  // off flipping the Repair List's own switch off — both destructive. Neither box touches a module now.
  it("the Photos and Marks checkboxes change no module (view switches): the grid's refs and the Repair List stay as saved", () => {
    const pages: DocPage[] = [
      {
        id: "p",
        modules: [
          newModule("repairList"),
          {
            ...(newModule("photoGrid") as PhotoGridModule),
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
      marks: true,
    });
    expect(noMarks[0]!.modules[1]).toBe(pages[0]!.modules[1]);
    const noPhotos = applyOptionsToPages(pages, { ...DEFAULT_OPTIONS, photos: false });
    expect((noPhotos[0]!.modules[0] as RepairListModule).photos).toBe(true);
    expect(noPhotos[0]!.modules).toEqual(pages[0]!.modules);
    // Whether the marks DRAW is decided where the picture is rendered.
    const ref = (pages[0]!.modules[1] as PhotoGridModule).images[0]!.image;
    expect(marksShown(ref, true)).toBe(true);
    expect(marksShown(ref, false)).toBe(false);
    expect(
      marksShown(
        { kind: "ticketPhoto", photoId: "11111111-1111-4111-8111-111111111111", marks: false },
        true,
      ),
    ).toBe(false);
  });
  // Oct 28: stripMarks (gone) DELETED an upload's drawn marks when the Marks checkbox was off —
  // a mark-up lost for good the moment the box was unticked. The marks stay on the ref whatever
  // the box says; marksShown tells the canvas and the PDF whether to draw them.
  it("Marks off leaves the marks drawn on an uploaded picture on the ref; marksShown hides them until the box is on", () => {
    const marked: ImageRef = {
      kind: "upload",
      path: "docs/d/a.jpg",
      width: 800,
      height: 600,
      marks: [{ id: "m", kind: "rect", color: "red", a: [0.1, 0.1], b: [0.5, 0.5] }],
    };
    const page: DocPage = {
      id: "p",
      modules: [
        { ...(newModule("fullPhoto") as FullPhotoModule), image: marked },
        {
          ...(newModule("photoGrid") as PhotoGridModule),
          images: [{ image: marked, caption: "" }],
        },
      ],
    };
    const off = applyOptionsToPages([page], { ...DEFAULT_OPTIONS, marks: false });
    expect((off[0]!.modules[0] as FullPhotoModule).image).toEqual(marked);
    expect((off[0]!.modules[1] as PhotoGridModule).images[0]!.image).toEqual(marked);
    const on = applyOptionsToPages(off, DEFAULT_OPTIONS);
    expect((on[0]!.modules[0] as FullPhotoModule).image).toEqual(marked);
    // A template instantiated with Marks off keeps them too.
    const made = instantiatePages([page], { ...DEFAULT_OPTIONS, marks: false });
    expect((made[0]!.modules[0] as FullPhotoModule).image).toEqual(marked);
    expect(marksShown(marked, false)).toBe(false);
    expect(marksShown(marked, true)).toBe(true);
    expect(marksShown({ ...marked, marks: [] }, true)).toBe(false);
    expect(marksShown({ kind: "logo" }, true)).toBe(false);
    expect(marksShown(null, true)).toBe(false);
  });
});

describe("the Inspection report template (phase 2)", () => {
  it("is a ticket template of three pages: the cover block, the Repair List with pictures, the photo grid and the recommendation", () => {
    const t = defaultTemplates().find((x) => x.name === INSPECTION_REPORT_TEMPLATE);
    expect(t).toBeTruthy();
    expect(t!.kind).toBe("ticket");
    expect(t!.options.prices).toBe("none");
    expect(t!.pages).toHaveLength(3);
    const [cover, findings, photos] = t!.pages;
    expect(cover!.modules.map((m) => m.type)).toEqual([
      "letterhead",
      "hr",
      "body",
      "fullPhoto",
      "hr",
      "body",
    ]);
    expect((cover!.modules[3] as FullPhotoModule).heightIn).toBe(2.2);
    const coverText = richToText(
      (cover!.modules[2] as { text: RichDoc }).text,
      sampleVariables("ticket"),
    );
    expect(coverText).toContain("Roof Inspection Report");
    const block = richToText((cover!.modules[5] as { text: RichDoc }).text, {}, variableLabel);
    expect(block).toContain("Property Inspected: [Property Inspected]");
    expect(block).toContain("Property Grade: [Property Grade]");
    expect(block).toContain("Inspected By: [Inspected By]");
    expect(block).toContain("Summary: [Inspection Summary]");
    expect(findings!.modules.map((m) => m.type)).toEqual(["body", "repairList"]);
    expect((findings!.modules[1] as RepairListModule).photos).toBe(true);
    expect(richToText((findings!.modules[0] as { text: RichDoc }).text)).toBe("Findings");
    expect(photos!.modules.map((m) => m.type)).toEqual(["photoGrid", "body", "signature"]);
    expect((photos!.modules[0] as PhotoGridModule).columns).toBe(3);
    expect(richToText((photos!.modules[1] as { text: RichDoc }).text, {}, variableLabel)).toBe(
      "Recommendation: [Recommendation]",
    );
    // The template stores no picture; the cover is filled on create (server-pure placeCoverImage).
    expect((cover!.modules[3] as FullPhotoModule).image).toBeNull();
  });
  it("missingDefaultTemplates adds it to an install that has the others, never resurrects a deleted one, and defaults only a template-less kind", () => {
    const existing = [
      { kind: "bid", name: "Proposal", deleted_at: null },
      { kind: "bid", name: "Scope letter (no prices)", deleted_at: null },
      { kind: "ticket", name: "Service letter", deleted_at: null },
    ];
    const added = missingDefaultTemplates(existing);
    expect(added.map((t) => t.name)).toEqual([INSPECTION_REPORT_TEMPLATE]);
    expect(added[0]!.isDefault).toBe(false);
    // Removed by the office: stays removed.
    expect(
      missingDefaultTemplates([
        ...existing,
        { kind: "ticket", name: "inspection report", deleted_at: "2026-10-27T00:00:00Z" },
      ]),
    ).toEqual([]);
    // A fresh install: everything, the first of each kind the default.
    const fresh = missingDefaultTemplates([]);
    expect(fresh.map((t) => [t.kind, t.isDefault])).toEqual([
      ["bid", true],
      ["bid", false],
      ["ticket", true],
      ["ticket", false],
    ]);
    // Nothing missing: nothing inserted.
    expect(missingDefaultTemplates(fresh.map((t) => ({ ...t, deleted_at: null })))).toEqual([]);
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
