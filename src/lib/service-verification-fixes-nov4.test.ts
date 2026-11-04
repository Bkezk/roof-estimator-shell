/**
 * The six findings of the Nov 4 behaviour check (docs/qa/service-pages-verification-2026-11-04.md;
 * owner: "go ahead and fix 1-6"). Each test fails on the code before the fix.
 *
 *   1  the material row's + / −, the two "next step" marks and the checklist's OK / Issue / N/A
 *      are 44 px tall
 *   2  a material logged clears the "Nothing used" mark (the close-out's draft and the server)
 *   3  Setup makes the small copies for pictures from before Nov 3
 *   4  the Inventory page reads the item-number keys, not the 700 KB of full rows
 *   5  Setup names the "Recommend repairs" row the phone turns into a switch
 *   6  the signature's link rides in the ticket bundle
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { itemNumberKeyLine, parseItemNumberKeyLine } from "@/lib/admin-item-numbers.functions";
import { PHOTO_COPY_BATCH } from "@/lib/service-field.functions";

const read = (p: string) => readFileSync(p, "utf8");
const materials = read("src/components/service/materials-section.tsx");
const closeout = read("src/components/service/closeout.tsx");
const inspection = read("src/components/service/inspection-section.tsx");
const inventoryFns = read("src/lib/inventory.functions.ts");
const fieldFns = read("src/lib/service-field.functions.ts");
const shared = read("src/components/service/field-shared.tsx");
const utils = read("src/components/service/field-utils.ts");
const card = read("src/components/service/picture-copies-card.tsx");
const setup = read("src/routes/setup.tsx");

describe("1. finger-sized buttons (44 px; the root font is 13 px, so Tailwind's h-11 is 36 px)", () => {
  it("the material row: − and + are 44 × 44, the count box and Remove 44 tall, a search source 44 tall", () => {
    expect(materials).toContain(
      'className="h-[44px] w-[44px]"\n            aria-label={`One ${unitLabel(1, row.piece, row.unit)} of ${cellName(row)} fewer`}',
    );
    expect(materials).toContain(
      'className="h-[44px] w-[44px]"\n            aria-label={`One ${unitLabel(1, row.piece, row.unit)} of ${cellName(row)} more`}',
    );
    expect(materials).toContain(
      'className="h-[44px] w-16 px-1 text-center text-lg font-semibold tabular-nums"',
    );
    expect(materials).toContain(
      'className="h-[44px] px-2 text-xs text-destructive hover:text-destructive"',
    );
    expect(materials).toContain(
      "className={`h-[44px] max-w-full justify-start rounded-full px-3 text-sm ${",
    );
    expect(materials).not.toContain('className="h-12 w-12"');
  });
  it("the close-out's marks and their Undo", () => {
    expect(closeout).not.toContain('className="h-11 w-full text-base"');
    expect(closeout.match(/className="h-\[44px\] w-full text-base"/g)?.length).toBe(3);
    expect(closeout).toMatch(
      /className="h-\[44px\]"\s+onClick=\{\(\) => markNothingUsed\(false\)\}/,
    );
    expect(closeout).toMatch(
      /className="h-\[44px\]"\s+onClick=\{\(\) => markNotesSkipped\(false\)\}/,
    );
  });
  it("the inspection checklist's OK / Issue / N/A", () => {
    expect(inspection).toContain("className={`h-[44px] w-[44px] p-0 ${ok ?");
    expect(inspection).toContain("className={`h-[44px] px-2.5 ${flagged ?");
    expect(inspection).toContain("className={`h-[44px] px-2 text-xs ${na ?");
    expect(inspection).not.toMatch(/className=\{`h-9 /);
  });
});

describe("2. a material logged clears the 'Nothing used' mark", () => {
  it("the close-out: materials on the ticket and the mark on → the draft turns it off (and saves)", () => {
    expect(closeout).toContain("const materialsLogged = (materialsQ.data ?? []).length > 0;");
    expect(closeout).toContain(
      "useEffect(() => {\n    if (materialsLogged && nothingUsed) update({ nothing_used: false });",
    );
    expect(closeout).toContain("}, [materialsLogged, nothingUsed]);");
  });
  it("the server: a consumed movement on a ticket clears nothing_used_at (the office page's path too)", () => {
    const add = inventoryFns.slice(
      inventoryFns.indexOf("export const addMovement"),
      inventoryFns.indexOf("async function locationOf"),
    );
    expect(add).toContain('if (data.service_job_id && data.reason === "consumed") {');
    expect(add).toContain(".update({ nothing_used_at: null })");
    expect(add).toContain('.not("nothing_used_at", "is", null);');
    // Logged, never thrown: the material is already recorded.
    expect(add).toMatch(
      /if \(markErr\)\s+console\.error\(`addMovement: could not clear nothing_used_at/,
    );
  });
});

describe("3. Setup makes the small copies for older pictures", () => {
  it("listPhotosWithoutThumb: a manager's, a batch of rows without a copy (before/after/other), their links signed in one call, the total", () => {
    expect(PHOTO_COPY_BATCH).toBe(25);
    const fn = fieldFns.slice(
      fieldFns.indexOf("export const listPhotosWithoutThumb"),
      fieldFns.indexOf("export function photoObjectPath"),
    );
    expect(fn).toContain(
      'if (!managesTickets(p)) throw new Error("Only a manager makes the small copies");',
    );
    expect(fn).toContain(
      '.select("id, service_job_id, storage_path, thumb_path", { count: "exact" })',
    );
    expect(fn).toContain('.is("thumb_path", null)');
    expect(fn).toContain('.in("role", ["before", "after", "other"])');
    expect(fn).toContain(".limit(PHOTO_COPY_BATCH);");
    expect(fn).toContain("const urls = await signPhotoPaths(context.supabase, rows);");
    expect(fn).toContain("total: count ?? rows.length,");
  });
  it("makeSmallCopy: download, shrink, upload beside the picture (a copy already there is fine), record; the viewer's backfill uses it", () => {
    const fn = read("src/components/service/small-copy.ts");
    expect(fn).toContain("const res = await fetch(fullUrl);");
    expect(fn).toContain("const small = await makeThumb(await res.blob());");
    expect(fn).toContain("if (!small) return null;");
    expect(fn).toContain("const path = thumbPathFor(photo.storage_path);");
    expect(fn).toContain(
      "if (!/already exists|duplicate/i.test(e instanceof Error ? e.message : String(e))) throw e;",
    );
    expect(fn).toContain("const row = await setPhotoThumb({");
    expect(shared).toContain("const path = await makeSmallCopy(photo, fullUrl);");
    expect(shared).toContain('import { makeSmallCopy } from "@/components/service/small-copy";');
  });
  it("the card: counts what is left, runs the batches, skips a picture that failed, reports; on Setup for managers and admins", () => {
    expect(card).toContain("const batch = await listFn();");
    expect(card).toContain("const todo = batch.photos.filter((ph) => !tried.current.has(ph.id));");
    expect(card).toContain("const path = await makeSmallCopy(ph, ph.url);");
    expect(card).toContain("Every picture has its small copy.");
    expect(card).toContain("no small copy yet.");
    expect(card).toContain("Make the small copies");
    expect(card).toContain("The full pictures are not changed.");
    expect(setup).toContain("{canSetDrivers && <PictureCopiesCard />}");
  });
});

describe("4. the Inventory page reads the item-number keys alone", () => {
  it("one line per mapping, read back exactly (a row label may hold | and spaces)", () => {
    const k = {
      screen_id: "duro_last:fasteners",
      row_label: '1 1/2" [Collated | Screws]',
      price_col: "Price/Box",
      item_no: "1106",
    };
    const line = itemNumberKeyLine(k);
    expect(line).toBe('duro_last:fasteners|1 1/2" [Collated | Screws]|Price/Box\t1106');
    expect(parseItemNumberKeyLine(line)).toEqual({
      key: 'duro_last:fasteners|1 1/2" [Collated | Screws]|Price/Box',
      item_no: "1106",
    });
    expect(parseItemNumberKeyLine("no tab")).toEqual({ key: "no tab", item_no: "" });
  });
  it("listItemNumberKeys selects the four key columns; the page uses it with a five-minute freshness", () => {
    const fns = read("src/lib/admin-item-numbers.functions.ts");
    expect(fns.replace(/\s+/g, " ")).toContain(
      'export type ItemNumberKey = Pick< ItemNumberRow, "item_no" | "screen_id" | "row_label" | "price_col" >;',
    );
    expect(fns).toContain('export const listItemNumberKeys = createServerFn({ method: "GET" })');
    expect(fns).toContain('.select("item_no, screen_id, row_label, price_col")');
    const page = read("src/components/inventory-page.tsx");
    expect(page).toContain("const itemNosFn = useServerFn(listItemNumberKeys);");
    expect(page).toContain('queryKey: ["item-number-keys"],');
    expect(page).toContain("staleTime: 5 * 60_000,");
    expect(page).not.toContain("useServerFn(listItemNumbers)");
    expect(page).toContain(
      "function productOptions(targets: PriceTarget[], itemNumberLines: string[]): ProductOption[] {",
    );
    expect(page).toContain("const { key: k, item_no } = parseItemNumberKeyLine(line);");
  });
});

describe("5. Setup names the row the phone turns into a switch", () => {
  it("the 'Recommend repairs' row carries a note and the description says why the phone shows one row fewer", () => {
    const src = read("src/components/service/inspection-checklist-settings.tsx");
    expect(src).toContain(
      'import { hiddenChecklistItem, ITEM_LABEL_MAX } from "@/lib/inspection";',
    );
    expect(src).toContain("{hiddenChecklistItem(r.label) && (");
    expect(src).toContain("asked as the switch in Findings — not a row on the phone");
    expect(src).toContain("so the phone shows one row fewer than this list.");
  });
});

describe("6. the signature's link rides in the ticket bundle", () => {
  it("getTicketBundle signs signature_path with the photos and returns signature_url on the job", () => {
    const bundle = fieldFns.slice(
      fieldFns.indexOf("export const getTicketBundle"),
      fieldFns.indexOf("export const registerJobPhoto"),
    );
    expect(bundle).toContain(
      "...(job.signature_path ? [{ storage_path: job.signature_path, thumb_path: null }] : []),",
    );
    expect(bundle).toContain(
      "signature_url: job.signature_path ? (urls.get(job.signature_path) ?? null) : null,",
    );
    expect(read("src/lib/service.functions.ts")).toContain("signature_url?: string | null;");
  });
  it("useSignatureUrl uses the bundled link only while it names the row's path, else signs its own; both screens read through it", () => {
    expect(utils).toContain("export function useSignatureUrl(job: {");
    expect(utils).toContain(
      "job.signature_url && job.signature_path && job.signature_url.includes(job.signature_path)",
    );
    expect(utils).toContain("const own = useSignedUrl(bundled ? null : job.signature_path);");
    expect(closeout).toContain("const url = useSignatureUrl(job);");
    expect(closeout).not.toContain("useSignedUrl(job.signature_path)");
    const sections = read("src/components/service/ticket-field-sections.tsx");
    expect(sections).toContain("const sig = useSignatureUrl(job);");
    expect(sections).not.toContain("useSignedUrl(job.signature_path)");
  });
});
