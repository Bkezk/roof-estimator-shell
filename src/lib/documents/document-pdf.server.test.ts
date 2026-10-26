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

import { defaultTemplates } from "./defaults";
import { imageRefs, parseDocument, renderDocumentPdf } from "./document-pdf.server";
import {
  type BodyModule,
  DEFAULT_OPTIONS,
  type DocPage,
  instantiatePages,
  newModule,
  newPage,
  richFromText,
} from "./model";
import { withStoredPricing } from "./server-pure";
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
