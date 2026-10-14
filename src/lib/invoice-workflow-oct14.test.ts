/**
 * Owner, Oct 14 — the service invoice editor:
 *   1. the draft saves itself (no Save button): a complete payload ~900 ms after the last
 *      change, SavedIndicator by the actions, a hint while a line is incomplete, flush before
 *      Finalise;
 *   2. a ticket material's rate (ledger or PO) that follows the markup is shown as text with
 *      its rule and a pencil to override it; red outlines only after a Finalise was tried;
 *   3. one primary Finalise (then "Send it now?"), Preview as a collapsible pane remembered in
 *      localStorage, Rebuild / Delete in a "…" menu; the PdfPreviewDialog is gone;
 *   4. the ticket's approved purchase orders become lines ("po:<id>"), marked up or at cost
 *      (invoices.po_markup), and the Internal fold does not count them twice.
 * Pure rules first (no database), then source-scan pins on the wiring (the house style).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { computedRateHint, rateIsComputed } from "@/lib/invoice-lines-view";
import { applyMarkup } from "@/lib/invoice-materials";
import {
  PO_SOURCE,
  applyPoMarkup,
  isPoLine,
  poIdOfLine,
  poLineDescription,
  poLineFor,
  poLineRate,
} from "@/lib/invoice-po-lines";
import { mergeRebuild, type RebuildLine } from "@/lib/invoice-rebuild";
import { computeTotals, poCostForInvoice, splitPosByLines } from "@/lib/invoice-totals";
import { approvedPoTotal } from "@/lib/purchase-orders";

const read = (p: string) => readFileSync(p, "utf8");
const EDITOR = "src/components/service/invoice-editor.tsx";
const ed = read(EDITOR);
const draft = ed.slice(ed.indexOf("function DraftInvoice("), ed.indexOf("function useAccount("));
const page = ed.slice(
  ed.indexOf("export function InvoiceEditorPage"),
  ed.indexOf("// ---- Draft ----"),
);
const final = ed.slice(ed.indexOf("function FinalInvoice("), ed.indexOf("// ---- Dialogs"));
const actions = draft.slice(
  draft.indexOf("{/* Actions along the bottom"),
  draft.indexOf("<AlertDialog", draft.indexOf("{/* Actions along the bottom")),
);

// ---------------------------------------------------------------------------------------------
// 4. Purchase orders as lines — the pure rules

const PO = {
  id: "7c2a9d7e-1b7d-4a0e-9a4c-6a0e0f9c1a11",
  po_number: "6012.A",
  title: "Seam tape",
  price: 412.5,
  po_date: "2026-10-13",
  vendor_name: "Lowe's",
};

describe("a PO line (invoice-po-lines.ts)", () => {
  it("is a material line: PO <number> — <title> (<vendor>), qty 1 ea, cost = the price", () => {
    const l = poLineFor(PO, 0.75, true, 4);
    expect(l).toEqual({
      sort: 4,
      kind: "material",
      description: "PO 6012.A — Seam tape (Lowe's)",
      qty: 1,
      unit: "ea",
      rate: 721.88,
      total: 721.88,
      cost_rate: 412.5,
      cost_total: 412.5,
      on_date: "2026-10-13",
      source: `po:${PO.id}`,
      taxable: true,
    });
    expect(PO_SOURCE).toBe("po:");
  });
  it("marked up: price × (1 + markup); at cost when po_markup is off", () => {
    expect(poLineRate(412.5, 0.75, true)).toBe(721.88);
    expect(poLineRate(412.5, 0.75, false)).toBe(412.5);
    expect(poLineFor(PO, 0.75, false, 0)).toMatchObject({ rate: 412.5, total: 412.5 });
    // numeric comes back as a string from PostgREST sometimes.
    expect(poLineFor({ ...PO, price: "100" }, 0.5, true, 0)).toMatchObject({
      rate: 150,
      cost_rate: 100,
    });
  });
  it("the description without a title or a vendor; vendor only when known; 300 at most", () => {
    expect(poLineDescription({ ...PO, title: null, vendor_name: null })).toBe("PO 6012.A");
    expect(poLineDescription({ ...PO, vendor_name: "  " })).toBe("PO 6012.A — Seam tape");
    expect(poLineDescription({ ...PO, title: "x".repeat(400) })).toHaveLength(300);
  });
  it("isPoLine / poIdOfLine key on the source prefix", () => {
    const l = poLineFor(PO, 0.75, true, 0);
    expect(isPoLine(l)).toBe(true);
    expect(poIdOfLine(l)).toBe(PO.id);
    expect(isPoLine({ source: "cell:a|b|c" })).toBe(false);
    expect(poIdOfLine({ source: null })).toBeNull();
  });
});

describe("applyPoMarkup — the switch or the markup changed on the draft", () => {
  const po = { source: `po:${PO.id}`, rate: 721.88, cost_rate: 412.5, rate_overridden: false };
  it("off: the PO lines drop to cost; on again: back to cost × (1 + markup)", () => {
    const [off] = applyPoMarkup([po], 0.75, false);
    expect(off).toMatchObject({ rate: 412.5, rate_overridden: false });
    const [on] = applyPoMarkup([off!], 0.75, true);
    expect(on!.rate).toBe(721.88);
  });
  it("a markup change re-prices a PO line while the switch is on, not while it is off", () => {
    expect(applyPoMarkup([po], 0.5, true)[0]!.rate).toBe(618.75);
    expect(applyPoMarkup([{ ...po, rate: 412.5 }], 0.5, false)[0]!.rate).toBe(412.5);
  });
  it("a typed price, a blank rate, a ledger material and a hand-added line stay as they are", () => {
    const lines = [
      { ...po, rate: 700, rate_overridden: true },
      { ...po, rate: null },
      { source: "cell:service|Acetone|price", rate: 17.5, cost_rate: 10, rate_overridden: false },
      { source: null, rate: 50, cost_rate: 0, rate_overridden: false },
    ];
    expect(applyPoMarkup(lines, 0.5, false)).toEqual(lines);
    // applyMarkup (the ledger materials) in turn leaves the PO lines to applyPoMarkup.
    expect(applyMarkup([{ kind: "material", ...po }], 0.75, 0.5)).toEqual([
      { kind: "material", ...po },
    ]);
  });
});

describe("Rebuild from ticket treats a po: line like a cell: line (mergeRebuild)", () => {
  const built = (over: Partial<RebuildLine> = {}): RebuildLine => ({
    sort: 0,
    kind: "material",
    description: "PO 6012.A — Seam tape",
    qty: 1,
    unit: "ea",
    rate: 721.88,
    total: 721.88,
    cost_rate: 412.5,
    cost_total: 412.5,
    on_date: "2026-10-13",
    source: `po:${PO.id}`,
    taxable: true,
    ...over,
  });
  it("a typed price on the PO line is kept; one that follows the markup is rebuilt", () => {
    const [kept] = mergeRebuild(
      [built({ rate: 650, total: 650, rate_overridden: true })],
      [built({ rate: 700, total: 700 })],
    );
    expect(kept).toMatchObject({ rate: 650, total: 650, cost_rate: 412.5, rate_overridden: true });
    const [fresh] = mergeRebuild([built({ rate_overridden: false })], [built({ rate: 700 })]);
    expect(fresh!.rate).toBe(700);
  });
  it("a PO no longer approved is gone after the rebuild; a hand-added line stays", () => {
    const fee = built({ sort: 1, source: null, description: "Lift rental", rate: 50, total: 50 });
    expect(mergeRebuild([built(), fee], []).map((l) => l.description)).toEqual(["Lift rental"]);
  });
});

describe("the Internal fold counts a PO once (invoice-totals.ts)", () => {
  const pos = [
    { id: PO.id, price: 412.5, approved: true },
    { id: "other-po", price: 100, approved: true },
    { id: "waiting", price: 999, approved: false },
  ];
  const poLine = {
    kind: "material",
    qty: 1,
    rate: 721.88,
    cost_rate: 412.5,
    taxable: true,
    source: `po:${PO.id}`,
  };
  const labor = {
    kind: "labor",
    qty: 2,
    rate: 95,
    cost_rate: 40,
    taxable: false,
    source: "time:1",
  };
  it("splitPosByLines: the POs with a po: line here, and the rest", () => {
    const { onInvoice, offInvoice } = splitPosByLines(pos, [labor, poLine]);
    expect(onInvoice.map((p) => p.id)).toEqual([PO.id]);
    expect(offInvoice.map((p) => p.id)).toEqual(["other-po", "waiting"]);
    expect(splitPosByLines(pos, [labor]).onInvoice).toEqual([]);
  });
  it("computeTotals' po_cost leaves out the PO whose line carries its cost; cost_total has it once", () => {
    const lines = [labor, poLine];
    const invoices = [{ id: "inv", label: "6012", status: "draft", created_at: "2026-10-14" }];
    const { offInvoice } = splitPosByLines(pos, lines);
    const share = poCostForInvoice("inv", invoices, approvedPoTotal(offInvoice));
    const t = computeTotals(lines, 0, share.cost);
    expect(t.po_cost).toBe(100); // the other approved PO only; the waiting one never
    expect(t.cost_total).toBe(80 + 412.5 + 100); // the line's cost once, not again as a PO
    expect(t.subtotal).toBe(190 + 721.88);
    // Before Oct 14 the same PO was in the lines' cost AND the PO row.
    const twice = computeTotals(lines, 0, approvedPoTotal(pos));
    expect(twice.cost_total).toBe(80 + 412.5 + 412.5 + 100);
  });
});

describe("the server builds and saves PO lines (source scan)", () => {
  const server = read("src/lib/invoices.server.ts");
  const fns = read("src/lib/invoices.functions.ts");
  const build = server.slice(
    server.indexOf("export async function buildLinesFromJob("),
    server.indexOf("export function totals("),
  );
  it("buildLinesFromJob reads the ticket's APPROVED purchase orders and makes a line each", () => {
    expect(build).toContain("opts: { markup?: number | null; poMarkup?: boolean | null } = {},");
    expect(build).toMatch(
      /\.from\("service_job_purchase_orders"\)\s*\.select\("id, po_number, title, price, po_date, vendor_id, vendor_text"\)\s*\.eq\("service_job_id", jobId\)\s*\.eq\("approved", true\)/,
    );
    expect(build).toContain("if (poErr) throw new Error(");
    expect(build).toMatch(
      /poLineFor\(\s*\{[\s\S]*?\},\s*markup,\s*opts\.poMarkup !== false,\s*sort\+\+,\s*\)/,
    );
    // The supplier: as typed on the PO, else the linked vendor's name.
    expect(build).toContain(
      "p.vendor_text ?? (p.vendor_id ? (vendorName.get(p.vendor_id) ?? null) : null),",
    );
    expect(server).toContain('import { poLineFor } from "@/lib/invoice-po-lines";');
  });
  it("rebuild passes the draft's po_markup; a new draft passes the default (true)", () => {
    const rebuild = fns.slice(fns.indexOf("export const rebuildInvoiceLines"));
    expect(rebuild).toMatch(
      /buildLinesFromJob\(sb, inv\.service_job_id, \{\s*markup: inv\.material_markup == null \? null : Number\(inv\.material_markup\),[\s\S]*?poMarkup: inv\.po_markup !== false,\s*\}\)/,
    );
    const create = fns.slice(
      fns.indexOf("async function createInvoiceFor("),
      fns.indexOf("export const getInvoice"),
    );
    expect(create).toContain("buildLinesFromJob(sb, job.id, { poMarkup: true }),");
  });
  it("saveInvoice accepts po_markup and stores it", () => {
    const save = fns.slice(fns.indexOf("const saveSchema = z.object({"));
    expect(save).toContain("po_markup: z.boolean().optional(),");
    expect(save).toContain(
      "...(data.po_markup === undefined ? {} : { po_markup: data.po_markup }),",
    );
    // The column, replayable; typed.
    expect(read("supabase/migrations/20261014100000_invoice_po_markup.sql")).toContain(
      "add column if not exists po_markup boolean not null default true",
    );
    expect(read("src/integrations/supabase/types.ts")).toContain("po_markup: boolean;");
  });
  it("the PDF renderer keys on nothing a PO line lacks (no special casing)", () => {
    const pdf = server.slice(
      server.indexOf("export async function renderInvoicePdf"),
      server.indexOf("export function sageCsv"),
    );
    expect(pdf).not.toMatch(/po:|isPoLine|poIdOfLine/);
    expect(read("src/lib/invoice-pdf-rows.ts")).not.toContain("source");
  });
});

// ---------------------------------------------------------------------------------------------
// 2. The computed rate — the pure rule

describe("rateIsComputed / computedRateHint (invoice-lines-view.ts)", () => {
  const cell = { kind: "material", source: "cell:service|Acetone|price", rate_overridden: false };
  const po = { kind: "material", source: `po:${PO.id}`, rate_overridden: false };
  it("a ledger material or a PO line that follows the markup: shown, not typed", () => {
    expect(rateIsComputed(cell)).toBe(true);
    expect(rateIsComputed(po)).toBe(true);
  });
  it("a typed price, labor, travel, a hand-added material and a legacy line keep the box", () => {
    expect(rateIsComputed({ ...cell, rate_overridden: true })).toBe(false);
    expect(rateIsComputed({ kind: "labor", source: "time:1", rate_overridden: false })).toBe(false);
    expect(rateIsComputed({ kind: "travel", source: "time:2", rate_overridden: false })).toBe(
      false,
    );
    expect(rateIsComputed({ kind: "material", source: null, rate_overridden: false })).toBe(false);
    // Saved before the rate_overridden column: no flag, so the box as before.
    expect(rateIsComputed({ kind: "material", source: cell.source })).toBe(false);
    expect(rateIsComputed({ ...cell, rate_overridden: null })).toBe(false);
  });
  it('the hint: "cost + 75%", or "at cost" for a PO line not marked up', () => {
    expect(computedRateHint(cell, 75, true)).toBe("cost + 75%");
    expect(computedRateHint(cell, 75, false)).toBe("cost + 75%");
    expect(computedRateHint(po, 75, true)).toBe("cost + 75%");
    expect(computedRateHint(po, 75, false)).toBe("at cost");
    expect(computedRateHint(po, 12.345, true)).toBe("cost + 12.35%");
  });
});

// ---------------------------------------------------------------------------------------------
// The editor's wiring

describe("1. the draft saves itself (invoice-editor.tsx)", () => {
  it("no Save button, no Unsaved changes text; SavedIndicator by the actions", () => {
    expect(draft).not.toMatch(/[>}]\s*Save\s*</);
    expect(draft).not.toContain("Unsaved changes");
    expect(draft).not.toContain('"save"');
    expect(actions).toContain("<SavedIndicator state={autosave.state} />");
    expect(ed).toContain('import { SavedIndicator } from "@/components/service/field-shared";');
    expect(ed).toContain(
      'import { fieldKeys, useAutosave } from "@/components/service/field-utils";',
    );
  });
  it("useAutosave at ~900 ms through saveFn / payload; the answer goes to the cache (ctx.applied)", () => {
    expect(draft).toContain("const autosave = useAutosave<Pushed>(");
    expect(draft).toContain("const r = await saveFn({ data: v.p });");
    expect(draft).toContain("{ what: `Invoice #${no}`, delay: 900, signal: false },");
    const saveFn = draft.slice(
      draft.indexOf("const autosave = useAutosave<Pushed>("),
      draft.indexOf("const lastPushed"),
    );
    expect(saveFn).toContain("ctx.applied(r);");
    // The office's desktop: no "Check your signal" (field-utils.ts).
    const utils = read("src/components/service/field-utils.ts");
    expect(utils).toContain(
      'const [tail] = useState(opts.signal === false ? "" : ". Check your signal");',
    );
    expect(utils).toContain("onError: (e) => loudError(`${what.current} did not save${tail}`, e),");
  });
  it("pushes only when the edit key differs from the saved key and the last pushed one (no loop)", () => {
    expect(draft).toContain("const lastPushed = useRef(savedKey);");
    expect(draft).toContain("if (liveKey === savedKey || liveKey === lastPushed.current) return;");
    expect(draft).toContain("lastPushed.current = liveKey;");
    expect(draft).toMatch(/\}, \[liveKey, savedKey, push\]\);/);
  });
  it("an incomplete line: nothing saved, no toast, a muted hint by the actions", () => {
    expect(draft).toContain(
      'if (typeof p === "string") return; // Incomplete: shown by the actions, not saved yet.',
    );
    expect(draft).toContain(
      "if (l.qty === null || l.rate === null) return `Line ${i + 1} needs a quantity and a rate`;",
    );
    expect(actions).toContain("{problem} — not saved yet");
    expect(actions).toMatch(/\{problem && \(\s*<span className="text-xs text-muted-foreground"/);
    // The effect never toasts (complete() does, on Finalise).
    const effect = draft.slice(
      draft.indexOf("const push = autosave.push;"),
      draft.indexOf("// Red outlines"),
    );
    expect(effect).not.toContain("toast.");
  });
  it("Finalise and Rebuild flush the autosave first; Delete cancels it; the §4 date rule stays", () => {
    const fin = draft.slice(
      draft.indexOf("const finalise = () =>"),
      draft.indexOf("const removeDraft"),
    );
    expect(fin).toMatch(
      /await autosave\.flush\(\);\s*await saveIfNeeded\(true\);\s*const r = await finalizeFn/,
    );
    const rebuild = draft.slice(
      draft.indexOf("const rebuild = () =>"),
      draft.indexOf("const finalise"),
    );
    expect(rebuild).toMatch(/await autosave\.flush\(\);\s*const r = await rebuildFn/);
    expect(draft).toMatch(/autosave\.cancel\(\);[^\n]*\n\s*await deleteFn/);
    expect(draft).toContain(
      "forFinal && untouched && head.invoice_date < todayYmd() ? todayYmd() : head.invoice_date;",
    );
  });
  it("new lines keep their React key; the saved row ids are remembered for the next save", () => {
    expect(draft).toContain("const savedIds = useRef(new Map<string, number>());");
    expect(draft).toContain("if (k && saved) savedIds.current.set(k, saved.id);");
    expect(draft).toContain("const id = idOf(l.key);");
  });
  it("the draft is mounted once per invoice (no remount per save); Rebuild resets its state", () => {
    expect(page).toContain("<DraftInvoice key={inv.id} ctx={ctx} data={data} />");
    expect(page).not.toContain("${inv.updated_at}");
    expect(draft).toMatch(
      /const takeServer = \(r: InvoiceWithLines\) => \{\s*setHead\(headFrom\(r\.invoice\)\);\s*setLines\(r\.lines\.map\(lineFrom\)\);/,
    );
  });
});

describe("2. the computed Rate cell and the red outlines (invoice-editor.tsx)", () => {
  const rate = draft.slice(
    draft.indexOf("<CellLabel>Rate</CellLabel>"),
    draft.indexOf("{internal && ("),
  );
  it("a computed rate is text with its rule and a pencil; the pencil brings the box back", () => {
    expect(rate).toContain("{rateIsComputed(l) && !rateEdit.has(l.key) ? (");
    expect(rate).toContain("{rateText(l.rate)}");
    expect(rate).toContain("{computedRateHint(l, head.markup_pct, head.po_markup)}");
    expect(rate).toContain("aria-label={`Override the rate for line ${i + 1}`}");
    expect(rate).toContain("onClick={() => setRateEdit((s) => new Set(s).add(l.key))}");
    expect(rate).toContain("onChange={(v) => setLine(l.key, { rate: v })}");
    // setLine already flags a typed rate on a ticket line.
    expect(draft).toContain('if ("rate" in patch && l.source) next.rate_overridden = true;');
    expect(ed).toContain(
      'import { computedRateHint, rateIsComputed } from "@/lib/invoice-lines-view";',
    );
  });
  it("red only after a Finalise was tried, never on an untouched line; cleared once fixed", () => {
    expect(draft).toContain("const [showProblems, setShowProblems] = useState(false);");
    expect(draft).toContain(
      'className={showProblems && !l.description.trim() ? "border-destructive" : ""}',
    );
    expect(draft).toContain("invalid={showProblems && l.qty === null}");
    expect(draft).toContain("invalid={showProblems && l.rate === null}");
    expect(draft).not.toContain("invalid={l.qty === null}");
    expect(draft).not.toContain("invalid={l.rate === null}");
    expect(draft).toMatch(
      /const tryFinal = \(\) => \{\s*if \(!complete\(true, true\)\) \{\s*setShowProblems\(true\);/,
    );
    expect(draft).toContain("if (showProblems && problem === null) setShowProblems(false);");
  });
});

describe("3. one primary action, a menu, a collapsible preview (invoice-editor.tsx)", () => {
  it("Finalise is the one primary button; no Finalise & send; no Preview PDF dialog", () => {
    expect(actions).toMatch(
      /<Button type="button" disabled=\{!!busy\} onClick=\{tryFinal\}>\s*<FileCheck2 [^>]*\/> Finalise\s*<\/Button>/,
    );
    expect(actions.match(/[>}]\s*Finalise\s*</g)).toHaveLength(1);
    expect(draft).not.toContain("Finalise &amp; send");
    expect(draft).not.toContain("trySend");
    expect(draft).not.toContain("<SendDialog");
    expect(ed).not.toContain("PdfPreviewDialog");
    expect(ed).not.toContain("Preview PDF");
  });
  it('after a finalise the page asks "Send it now?"; Send opens the final invoice\'s Send dialog', () => {
    expect(draft).toMatch(/ctx\.applied\(r, true\);[\s\S]*?ctx\.askSend\(r\.invoice\.id\);/);
    expect(ed).toContain("askSend: (invoiceId: string) => void;");
    expect(page).toContain('askSend: (invoiceId) => setSendNow({ id: invoiceId, step: "ask" }),');
    expect(page).toContain("<AlertDialogTitle>Send it now?</AlertDialogTitle>");
    expect(page).toContain("<AlertDialogCancel>Not now</AlertDialogCancel>");
    expect(page).toMatch(
      /<AlertDialogAction onClick=\{\(\) => setSendNow\(\{ id: inv\.id, step: "open" \}\)\}>\s*<Send [^>]*\/> Send\s*<\/AlertDialogAction>/,
    );
    expect(page).toContain('openSend={sendNow?.id === inv.id && sendNow.step === "open"}');
    expect(page).toContain("onSendClosed={() => setSendNow(null)}");
    expect(final).toContain(
      'const shownDialog = dialog ?? (openSend && status !== "void" ? "send" : null);',
    );
    expect(final).toContain('{shownDialog === "send" && (');
    expect(final).toMatch(/onSuccess: \(r, v\) => \{\s*closeDialog\(\);/);
  });
  it('the "…" menu holds Rebuild from ticket and Delete draft with the same confirms', () => {
    expect(actions).toContain("<DropdownMenu>");
    expect(actions).toContain('aria-label="More actions"');
    expect(actions).toMatch(
      /onSelect=\{\(\) => setConfirm\("rebuild"\)\}\s*>\s*<RefreshCw [^>]*\/> Rebuild from ticket/,
    );
    expect(actions).toMatch(
      /onSelect=\{\(\) => setConfirm\("delete"\)\}\s*>\s*<Trash2 [^>]*\/> Delete draft/,
    );
    expect(draft).toContain('? "Rebuild the lines from the ticket?"');
    expect(draft).toContain("? deleteDraftNote(job.number, no)");
    expect(ed).toMatch(
      /import \{\s*DropdownMenu,\s*DropdownMenuContent,\s*DropdownMenuItem,\s*DropdownMenuTrigger,\s*\} from "@\/components\/ui\/dropdown-menu";/,
    );
  });
  it("Preview toggles a pane under the lines, remembered in localStorage; it redraws after each save", () => {
    expect(ed).toContain('const PREVIEW_OPEN_KEY = "jbk-portal:invoice-preview";');
    expect(draft).toContain(
      'if (localStorage.getItem(PREVIEW_OPEN_KEY) === "1") setPreviewOpen(true);',
    );
    expect(draft).toContain('localStorage.setItem(PREVIEW_OPEN_KEY, o ? "1" : "0");');
    expect(actions).toMatch(
      /aria-expanded=\{previewOpen\}\s*aria-controls="invoice-preview"\s*onClick=\{togglePreview\}\s*>\s*<Eye [^>]*\/> Preview/,
    );
    expect(draft).toContain(
      "{previewOpen && <PreviewPane invoiceId={inv.id} version={inv.updated_at} />}",
    );
    const pane = ed.slice(
      ed.indexOf("function PreviewPane("),
      ed.indexOf("const INTERNAL_OPEN_KEY"),
    );
    expect(pane).toContain('id="invoice-preview"');
    expect(pane).toContain("hasView.current ? 1500 : 0,");
    expect(pane).toMatch(/\}, \[invoiceId, version\]\);/);
    expect(pane).toContain("Updating…");
    // The dialog's blob-URL handling and its reasons (Chrome blocking) stay.
    expect(pane).toContain("const u = URL.createObjectURL(view.blob);");
    expect(pane).toContain("return () => URL.revokeObjectURL(u);");
    expect(pane).toContain("<PdfPages blob={view.blob} title={view.fileName} />");
    expect(pane).toContain("Open in a new tab");
    expect(pane).toContain("onClick={() => view && downloadBlob(view.blob, view.fileName)}");
    expect(pane).toMatch(/Chrome blocks its own PDF viewer in a sandboxed frame/);
    expect(pane).not.toContain("<iframe");
    expect(pane).not.toContain("<Dialog");
  });
});

describe("4. purchase orders in the editor (invoice-editor.tsx)", () => {
  it('a Switch "Mark up purchase orders" by the Markup % box, in head.po_markup, saved by the autosave', () => {
    expect(ed).toContain('import { Switch } from "@/components/ui/switch";');
    expect(draft).toMatch(
      /<Switch\s+id="inv-po-markup"\s+checked=\{head\.po_markup\}\s+onCheckedChange=\{setPoMarkup\}\s+aria-label="Mark up purchase orders"/,
    );
    expect(ed).toContain("po_markup: inv.po_markup !== false,");
    expect(draft).toContain("po_markup: head.po_markup,");
  });
  it("flipping the switch or the markup re-prices the PO lines at once (applyPoMarkup)", () => {
    expect(ed).toContain('import { applyPoMarkup } from "@/lib/invoice-po-lines";');
    expect(draft).toContain(
      "rebased(ls, applyPoMarkup(applyMarkup(ls, before, after), after, head.po_markup)),",
    );
    expect(draft).toMatch(
      /const setPoMarkup = \(on: boolean\) => \{\s*setH\("po_markup", on\);\s*setLines\(\(ls\) => rebased\(ls, applyPoMarkup\(ls, fromPct\(head\.markup_pct\), on\)\)\);/,
    );
  });
  it("the Internal fold leaves out the POs that are lines and says how many are on the invoice", () => {
    const hook = ed.slice(
      ed.indexOf("function useApprovedPoCost("),
      ed.indexOf("function Totals("),
    );
    expect(hook).toContain("lines: readonly { source: string | null }[],");
    expect(hook).toContain("const { onInvoice, offInvoice } = splitPosByLines(q.data.pos, lines);");
    expect(hook).toContain("onInvoice: onInvoice.filter((p) => p.approved).length,");
    expect(draft).toContain("const po = useApprovedPoCost(job.id, inv.id, lines);");
    expect(final).toContain("const po = useApprovedPoCost(job.id, inv.id, data.lines);");
    const totals = ed.slice(ed.indexOf("function Totals("), ed.indexOf("// ---- Final / sent"));
    expect(totals).toContain("poOnInvoice?: number;");
    expect(totals).toContain('{poOnInvoice ? ` · ${poOnInvoice} on the invoice` : ""}');
  });
});

describe("the wording the owner tripped on (Oct 14: 'cost 0.091? … what does mark up purchase orders do?')", () => {
  const ed = readFileSync("src/components/service/invoice-editor.tsx", "utf8");
  it("the switch's help says purchase orders, not the ticket's material lines", () => {
    expect(ed).toContain(
      "On: a purchase order on this invoice bills at what it cost plus the markup above.",
    );
    expect(ed).toContain("Off: at what it cost. A price typed by hand stays either way.");
    expect(ed).not.toContain("material lines are priced again");
  });
  it("a per-piece material's Cost cell says what the number is per", () => {
    expect(ed).toContain('per {l.unit.trim() || "ea"}');
    expect(ed.indexOf('per {l.unit.trim() || "ea"}')).toBeGreaterThan(
      ed.indexOf("<CellLabel>Cost</CellLabel>"),
    );
  });
});
