/**
 * "Materials & POs" (owner, Oct 27): the ticket page's Materials fold and Purchase orders fold
 * are two tabs of ONE fold, Materials first — the Work fold's pattern. The fold's one line and
 * the remembered tab are pure (materials-pos.ts); the fold, the page's open-by-default rule and
 * the column order are pinned to the sources.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { SECTION_TONES, sectionTone } from "./section-tones";
import {
  MATERIALS_TAB_KEY,
  materialsPosSummary,
  posPart,
  readMaterialsTab,
  ticketLineCount,
} from "./materials-pos";

const read = (p: string) => readFileSync(p, "utf8");

describe("materialsPosSummary", () => {
  it('"3 items · 1 PO" / "nothing logged · no POs" (no approval count since Oct 28)', () => {
    expect(materialsPosSummary({ lines: 3, pos: [{ price: 10 }] })).toBe("3 items · 1 PO");
    expect(materialsPosSummary({ lines: 0, pos: [] })).toBe("nothing logged · no POs");
    expect(materialsPosSummary({ lines: 1, pos: [{ price: 10 }, { price: 5 }] })).toBe(
      "1 item · 2 POs",
    );
  });
  it("a part still loading is left out; nothing known reads as nothing", () => {
    expect(materialsPosSummary({ lines: 2, pos: null })).toBe("2 items");
    expect(materialsPosSummary({ lines: null, pos: [] })).toBe("no POs");
    expect(materialsPosSummary({ lines: null, pos: null })).toBe("");
  });
  it("posPart counts the POs, never an approval (owner, Oct 28: approval is gone)", () => {
    expect(posPart([])).toBe("no POs");
    expect(posPart([{ price: 1 }, { price: 1 }])).toBe("2 POs");
    expect(read("src/components/service/materials-pos.ts")).not.toContain("awaiting approval");
  });
});

describe("ticketLineCount: cells with something used or returned, net of take-backs", () => {
  const cell = (row_label: string, qty: number, location_id = "truck") => ({
    location_id,
    screen_id: "s",
    row_label,
    price_col: "price",
    qty,
  });
  it("counts each cell once, drops a cell taken back to zero", () => {
    expect(ticketLineCount([])).toBe(0);
    expect(ticketLineCount([cell("Caulk", -1), cell("Caulk", -1), cell("Screws", -0.5)])).toBe(2);
    expect(ticketLineCount([cell("Caulk", -1), cell("Caulk", 1)])).toBe(0);
    // The same product at two places is two lines.
    expect(ticketLineCount([cell("Caulk", -1), cell("Caulk", -1, "shop")])).toBe(2);
    expect(ticketLineCount([cell("Caulk", 1)])).toBe(1); // a return alone is still a line
  });
});

describe("readMaterialsTab", () => {
  it("takes a remembered tab and falls back to Materials", () => {
    expect(MATERIALS_TAB_KEY).toBe("bid-o-matic:ticket-materials-tab");
    expect(readMaterialsTab("pos")).toBe("pos");
    expect(readMaterialsTab("materials")).toBe("materials");
    expect(readMaterialsTab(null)).toBe("materials");
    expect(readMaterialsTab("purchase-orders")).toBe("materials");
  });
});

describe("the fold (materials-pos-fold.tsx)", () => {
  const src = read("src/components/service/materials-pos-fold.tsx");
  it("is one collapsible Box, remembered as materials-pos (or -review), with two tabs, Materials first", () => {
    expect(src).toMatch(/<Box\s+title="Materials & POs"\s+icon=\{Package\}\s+collapsible/);
    expect(src).toContain("defaultOpen={defaultOpen}");
    expect(src).toContain("storageKey={storageKey}");
    expect(src).toContain('storageKey = "materials-pos",');
    expect(src).toContain('storageKey?: "materials-pos" | "materials-pos-review" | undefined;');
    expect(src).toContain(
      '<TabsList className="grid h-auto w-full grid-cols-2" aria-label="Materials & POs">',
    );
    const materialsTab = src.indexOf('<TabsTrigger value="materials"');
    const posTab = src.indexOf('<TabsTrigger value="pos"');
    expect(materialsTab).toBeGreaterThan(-1);
    expect(posTab).toBeGreaterThan(materialsTab);
    expect(src).toMatch(/<TabsTrigger value="materials"[^>]*>[\s\S]*?Materials\s*<\/TabsTrigger>/);
    expect(src).toMatch(/<TabsTrigger value="pos"[^>]*>[\s\S]*?Purchase orders\s*<\/TabsTrigger>/);
    expect(src).toMatch(/<TabsContent value="materials" className="mt-3">\s*\{materials\}/);
    expect(src).toMatch(
      /<TabsContent value="pos" className="mt-3">\s*<PurchaseOrdersSection jobId=\{jobId\} embedded \/>/,
    );
    expect(src).toContain(
      "return readMaterialsTab(window.localStorage.getItem(MATERIALS_TAB_KEY));",
    );
    expect(src).toMatch(/function initialMaterialsTab\(\): MaterialsTab \{\s+try \{/);
    expect(src).toMatch(/function rememberMaterialsTab\(tab: MaterialsTab\) \{\s+try \{/);
  });
  it("its one line is composed from both tabs' queries (the same keys the bodies read)", () => {
    expect(src).toContain("queryKey: fieldKeys.materials(jobId),");
    expect(src).toContain("queryKey: fieldKeys.pos(jobId),");
    expect(src).toContain("lines: ledger.data ? ticketLineCount(ledger.data) : null,");
    expect(src).toContain("pos: pos.data?.pos ?? null,");
  });
  it("takes Materials' green; a review copy the same", () => {
    expect(SECTION_TONES["materials-pos"]).toEqual(SECTION_TONES["materials"]);
    expect(sectionTone("materials-pos-review")).toBe(SECTION_TONES["materials-pos"]);
  });
  it("the Purchase orders body renders unchanged, no Box, when embedded; the close-out keeps its own fold", () => {
    const pos = read("src/components/service/purchase-orders-section.tsx");
    expect(pos).toContain("embedded = false,");
    expect(pos).toMatch(
      /if \(embedded\)\s+return \(\s+<section className="space-y-3" aria-label="Purchase orders">\s+\{body\}/,
    );
    expect(pos).toMatch(
      /<Box\s+title="Purchase orders"\s+icon=\{Receipt\}\s+collapsible\s+storageKey="purchase-orders"/,
    );
    // The Approved switch left on Oct 28; `field` only makes the close-out's fold plain.
    expect(pos).not.toContain("approver");
    expect(pos).toContain("plain={field}");
    expect(read("src/components/service/closeout.tsx")).toMatch(
      /<MaterialsSection jobId=\{job\.id\} \/>\s*\{\/\*[^*]*\*\/\}\s*<PurchaseOrdersSection jobId=\{job\.id\} field \/>/,
    );
  });
});

describe("the ticket page (service-page.tsx)", () => {
  const page = read("src/components/service-page.tsx");
  it("renders the fold where Materials was, open by default where the Materials fold was (a technician on an Open / Scheduled ticket; a manager's review, remembered apart)", () => {
    expect(page).toContain(
      'import { MaterialsPosFold } from "@/components/service/materials-pos-fold";',
    );
    const materials = page.slice(
      page.indexOf("const materials = job && ("),
      page.indexOf("return (", page.indexOf("const materials = job && (")),
    );
    expect(materials).toContain("<MaterialsPosFold");
    expect(materials).toContain(
      'defaultOpen={review || (isTech && (jobStage === "open" || jobStage === "scheduled"))}',
    );
    expect(materials).toContain('storageKey={review ? "materials-pos-review" : "materials-pos"}');
    // The Materials body: the logging screen for a login that may log, else the read-only list.
    expect(materials).toContain('can("service") || can("inventory") || can("estimate") ? (');
    expect(materials).toContain("<MaterialsSection jobId={job.id} />");
    expect(materials).toContain("<MaterialsUsed jobId={job.id} canLog={false} plain />");
    expect(page).toContain(
      'const review = manager && (jobStage === "done" || jobStage === "authorized");',
    );
  });
  it("no standalone Purchase orders fold on the page any more — office column and technician's page alike", () => {
    expect(page).not.toMatch(/<PurchaseOrdersSection\b/);
    expect(page).not.toContain("purchase-orders-section");
    const aside = page.slice(page.indexOf("<aside"), page.indexOf("</aside>"));
    expect(aside.indexOf("{materials}")).toBeGreaterThan(aside.indexOf("<TicketRepairs"));
    expect(aside.indexOf("{materials}")).toBeLessThan(
      aside.indexOf(
        "<TicketFieldSections job={job} officeOrAdmin={officeOrAdmin} repairs={false} />",
      ),
    );
    const tech = page.slice(page.indexOf("</aside>"));
    expect(tech.indexOf("{materials}")).toBeGreaterThan(tech.indexOf("<TicketExtras"));
    expect(tech.indexOf("{materials}")).toBeLessThan(
      tech.indexOf("<TicketFieldSections job={job} officeOrAdmin={officeOrAdmin} />"),
    );
  });
  it("the Materials body keeps its own count (the same helper the fold's line uses)", () => {
    const m = read("src/components/service/materials-section.tsx");
    expect(m).toContain("const lineCount = useMemo(() => ticketLineCount(ledger), [ledger]);");
    expect(m).toContain('import { ticketLineCount } from "@/components/service/materials-pos";');
  });
});
