/**
 * The document PDF end to end (owner, Oct 26): the shipped templates render with pdf-lib against
 * a stand-in client whose storage has nothing — so every picture but the logo prints as the grey
 * box, nothing throws, the pages count, an overflowing body continues on a new page, and an
 * empty document is one page. The layout itself is tested in pdf-layout.test.ts.
 */
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";

import { defaultTemplates, INSPECTION_REPORT_TEMPLATE } from "./defaults";
import { imageRefs, loadImages, parseDocument, renderDocumentPdf } from "./document-pdf.server";
import {
  type BodyModule,
  DEFAULT_OPTIONS,
  type DocPage,
  type FullPhotoModule,
  type ImageRef,
  instantiatePages,
  newModule,
  newPage,
  type PhotoGridModule,
  type RepairListModule,
  richFromText,
} from "./model";
import { CONTENT_WIDTH, layoutModules } from "./pdf-layout";
import { withStoredInspection, withStoredPricing } from "./server-pure";
import { sampleVariables } from "./variables";

/** A query builder whose every method returns itself and which awaits to `result`. */
function chain<T>(result: T) {
  const c: unknown = new Proxy(function () {}, {
    get(_t, key) {
      if (key === "then")
        return (onF: (v: T) => unknown, onR: (e: unknown) => unknown) =>
          Promise.resolve(result).then(onF, onR);
      return () => c;
    },
    apply() {
      return c;
    },
  });
  return c;
}
const sb = {
  from: () => chain({ data: [], error: null }),
  storage: {
    from: () => ({ download: async () => ({ data: null, error: { message: "not found" } }) }),
  },
} as unknown as SupabaseClient<Database>;

const json = (v: unknown) => v as Json;

const bidVars = withStoredPricing(sampleVariables("bid"), {
  name: "Whitley",
  total: 242879.61,
  system: "Duro-Last 60 mil",
  dueDate: "2026-10-30",
  sections: [
    { name: "Main roof", lengthFt: 300, widthFt: 150, system: "Duro-Last 60 mil" },
    { name: "Annex", lengthFt: 100, widthFt: 75, system: "Duro-Last 60 mil" },
  ],
  sqFt: 52500,
  warranty: "20 Yr NDL",
});

const render = (
  pages: DocPage[],
  variables: Record<string, string> = bidVars,
  options = DEFAULT_OPTIONS,
) =>
  renderDocumentPdf(sb, { pages: json(pages), options: json(options), variables: json(variables) });

describe("renderDocumentPdf", () => {
  it("renders the shipped Proposal: two document pages, a PDF that opens, the logo embedded", async () => {
    const tpl = defaultTemplates().find((t) => t.name === "Proposal")!;
    const pages = instantiatePages(tpl.pages, tpl.options);
    expect([...imageRefs(pages).values()].filter((r) => r.kind === "logo").length).toBe(2);
    const bytes = await render(pages);
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
    const [w, h] = [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()];
    expect([w, h]).toEqual([612, 792]);
  });
  it("renders the Service letter with ticket photos the storage does not have: no throw", async () => {
    const tpl = defaultTemplates().find((t) => t.kind === "ticket")!;
    const pages = instantiatePages(tpl.pages, tpl.options);
    const photos = pages[0]!.modules.find((m) => m.type === "twoPhotos")!;
    if (photos.type === "twoPhotos")
      photos.images = [
        { kind: "ticketPhoto", photoId: "00000000-0000-4000-8000-000000000001", marks: true },
        { kind: "upload", path: "docs/x/y.jpg", width: 800, height: 600 },
      ];
    const bytes = await render(pages, sampleVariables("ticket"));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("an overflowing body continues on a new page; an empty document is one page; footer off still renders", async () => {
    const long = richFromText(
      Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of a long letter.`).join("\n"),
    );
    const pages = [newPage([{ ...newModule("body"), text: long } as BodyModule])];
    const many = await PDFDocument.load(await render(pages));
    expect(many.getPageCount()).toBeGreaterThan(1);
    expect((await PDFDocument.load(await render([]))).getPageCount()).toBe(1);
    expect(
      (
        await PDFDocument.load(await render([newPage()], {}, { ...DEFAULT_OPTIONS, footer: false }))
      ).getPageCount(),
    ).toBe(1);
  });
  it("parseDocument reads the row leniently", () => {
    expect(parseDocument({ pages: "garbage", options: null })).toEqual({
      pages: [],
      options: DEFAULT_OPTIONS,
    });
    const p = [newPage()];
    expect(parseDocument({ pages: json(p), options: json(DEFAULT_OPTIONS) }).pages).toEqual(p);
  });
});

// ---------------------------------------------------------------------------- phase 2

/** A 1 × 1 PNG, so the stand-in storage can hand back a picture pdf-lib embeds. */
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const SITE = "55555555-5555-4555-8555-555555555555";
const PHOTO = "11111111-1111-4111-8111-111111111111";
const insp = {
  inspectedOn: "2026-10-20",
  grade: "D",
  technician: "Braden Keck",
  notes: "",
  recommendRepairs: true,
  items: [
    { id: "a", label: "Membrane condition", status: "ok" as const, note: "", photoIds: [] },
    { id: "b", label: "Seams", status: "issue" as const, note: "Open lap", photoIds: [PHOTO] },
    { id: "c", label: "Flashings", status: "issue" as const, note: "Lifting", photoIds: [] },
  ],
};
const circle = {
  id: "m1",
  kind: "ellipse" as const,
  color: "red" as const,
  a: [0.1, 0.1] as [number, number],
  b: [0.5, 0.5] as [number, number],
};
/** A stand-in whose tables and storage answer by name: the site's cover path, the ticket photo's row, the files. */
const sb2 = {
  from: (table: string) =>
    chain({
      data:
        table === "crm_sites"
          ? [{ id: SITE, cover_photo_path: `sites/${SITE}/cover.png` }]
          : table === "service_job_photos"
            ? [
                {
                  id: PHOTO,
                  storage_path: "jobs/j/p.png",
                  annotations: { v: 1, kind: "photo", marks: [circle] },
                },
              ]
            : [],
      error: null,
    }),
  storage: {
    from: (bucket: string) => ({
      download: async (path: string) =>
        (bucket === "documents" &&
          (path === `sites/${SITE}/cover.png` || path === "docs/d/a.png")) ||
        (bucket === "service" && path === "jobs/j/p.png")
          ? { data: new Blob([PNG]), error: null }
          : { data: null, error: { message: "not found" } },
    }),
  },
} as unknown as SupabaseClient<Database>;

describe("phase 2: the Inspection report, the Photo Grid, marked-up uploads and the property photo", () => {
  it("imageRefs lists the grid's cells and, with the inspection, the Repair List's pictures (marks per the checkbox)", () => {
    const grid = {
      ...(newModule("photoGrid") as PhotoGridModule),
      id: "g",
      images: [
        {
          image: { kind: "upload" as const, path: "docs/d/a.png", width: 1, height: 1 },
          caption: "",
        },
        { image: { kind: "siteCover" as const, siteId: SITE }, caption: "" },
      ],
    };
    const list = { ...(newModule("repairList") as RepairListModule), id: "r" };
    const pages = [newPage([grid, list])];
    expect([...imageRefs(pages).keys()]).toEqual(["g:0", "g:1"]);
    const withInsp = imageRefs(pages, { inspection: insp, marks: false });
    expect([...withInsp.keys()]).toEqual(["g:0", "g:1", "r:r0p0"]);
    expect(withInsp.get("r:r0p0")).toEqual({ kind: "ticketPhoto", photoId: PHOTO, marks: false });
    expect(imageRefs(pages, { inspection: insp }).get("r:r0p0")).toMatchObject({ marks: true });
    expect([
      ...imageRefs([newPage([{ ...list, photos: false }])], { inspection: insp }).keys(),
    ]).toEqual([]);
  });
  it("loadImages: an upload carries the marks drawn on it, a ticket photo its row's, the property photo comes from the row's path in the documents bucket", async () => {
    const pdf = await PDFDocument.create();
    const refs = new Map<string, ImageRef>([
      ["u", { kind: "upload", path: "docs/d/a.png", width: 1, height: 1, marks: [circle] }],
      ["u0", { kind: "upload", path: "docs/d/a.png", width: 1, height: 1 }],
      ["t", { kind: "ticketPhoto", photoId: PHOTO, marks: true }],
      ["t0", { kind: "ticketPhoto", photoId: PHOTO, marks: false }],
      ["s", { kind: "siteCover", siteId: SITE }],
      ["s0", { kind: "siteCover", siteId: "66666666-6666-4666-8666-666666666666" }],
      ["x", { kind: "upload", path: "docs/d/missing.png", width: 1, height: 1 }],
    ]);
    const loaded = await loadImages(sb2, pdf, refs, {});
    expect(loaded.get("u")!.marks).toEqual([circle]);
    expect(loaded.get("u0")!.marks).toEqual([]);
    expect(loaded.get("t")!.marks).toEqual([circle]);
    expect(loaded.get("t0")!.marks).toEqual([]);
    expect(loaded.get("s")).toMatchObject({ width: 1, height: 1, marks: [] });
    expect(loaded.get("s0")).toBeNull();
    expect(loaded.get("x")).toBeNull();
  });
  it("renders the shipped Inspection report for a ticket with an inspection: three document pages, the findings table and its pictures, the grid, no throw", async () => {
    const tpl = defaultTemplates().find((t) => t.name === INSPECTION_REPORT_TEMPLATE)!;
    const pages = instantiatePages(tpl.pages, tpl.options);
    // As createDocument makes it: the property photo on the cover, the ticket's photos in the grid.
    const cover = pages[0]!.modules.find((m) => m.type === "fullPhoto") as FullPhotoModule;
    cover.image = { kind: "siteCover", siteId: SITE };
    const grid = pages[2]!.modules.find((m) => m.type === "photoGrid") as PhotoGridModule;
    grid.images = Array.from({ length: 7 }, () => ({
      image: { kind: "ticketPhoto" as const, photoId: PHOTO, marks: true },
      caption: "Seams",
    }));
    const vars = withStoredInspection(sampleVariables("ticket"), insp);
    const bytes = await renderDocumentPdf(sb2, {
      pages: json(pages),
      options: json(tpl.options),
      variables: json(vars),
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    // The same pages laid out by the pure layout: the findings page holds the header, two issue rows and one picture line.
    const ctx = {
      width: CONTENT_WIDTH,
      measure: (t: string, _f: string, s: number) => t.length * s * 0.5,
      vars: {},
      labelOf: (k: string) => k,
      image: () => ({ width: 1, height: 1 }),
      pricing: { bid: null },
      inspection: insp,
      marks: true,
    };
    const findings = layoutModules(pages[1]!.modules, ctx);
    expect(findings.filter((p) => p.kind === "tableRow")).toHaveLength(3);
    expect(findings.filter((p) => p.kind === "columns")).toHaveLength(1);
    const photoPage = layoutModules(pages[2]!.modules, ctx);
    expect(photoPage.filter((p) => p.kind === "columns")).toHaveLength(3);
    // Without an inspection the same document still renders (the list prints its one line).
    const plain = await renderDocumentPdf(sb2, {
      pages: json(pages),
      options: json(tpl.options),
      variables: json(sampleVariables("ticket")),
    });
    expect((await PDFDocument.load(plain)).getPageCount()).toBe(3);
  });
});
