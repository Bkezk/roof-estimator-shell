/**
 * The ticket page's shorter right column (owner, Oct 27): Close-out and Time are two tabs of ONE
 * "Work" fold (the Activity log tab it had that morning moved into the form's Activity block,
 * ticket-activity.tsx); the column runs Aerial → Inspection → Photos & repairs → Materials & POs
 * → Work → Invoice → a thin "History" heading with the property's History fold and the managers'
 * change log under it. The fold's one line is pure (workSummary); the order is pinned to the
 * sources.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { closeoutInfo, readWorkTab, workSummary } from "./ticket-work";

const read = (p: string) => readFileSync(p, "utf8");

describe("workSummary", () => {
  it('reads "Closed out … · 3.5 h" from what the two tabs know', () => {
    expect(workSummary({ closeout: "Closed out Oct 12, 3:04 PM", hours: 3.5 })).toBe(
      "Closed out Oct 12, 3:04 PM · 3.5 h",
    );
  });
  it("leaves out what there is none of, and says 'none yet' for nothing", () => {
    expect(workSummary({ closeout: null, hours: 2 })).toBe("2 h");
    expect(workSummary({ closeout: "Close-out in progress", hours: 0 })).toBe(
      "Close-out in progress",
    );
    expect(workSummary({ closeout: null, hours: 0 })).toBe("none yet");
  });
  it("rounds the hours like the Time line (two decimals, no trailing zeros)", () => {
    expect(workSummary({ closeout: null, hours: 1.3333 })).toBe("1.33 h");
  });
  it("no activity count any more: the Activity block says 'N entries' itself", () => {
    expect(workSummary({ closeout: null, hours: 0 })).not.toMatch(/entr/);
    expect(read("src/components/service/ticket-work.ts")).not.toContain("entries");
  });
});

describe("closeoutInfo", () => {
  const blank = {
    closing_notes: null,
    checked_in_with: null,
    checked_out_with: null,
    recommend_new_roof: false,
    signature_path: null,
    completed_at: null,
    stage: "scheduled",
  };
  it("is nothing for a ticket nobody has closed out", () => {
    expect(closeoutInfo(blank)).toEqual({ any: false, officeStage: false, line: null });
  });
  it("is in progress once anything is recorded, closed out once completed", () => {
    expect(closeoutInfo({ ...blank, checked_in_with: "Dana" })).toMatchObject({
      any: true,
      line: "Close-out in progress",
    });
    const done = closeoutInfo({ ...blank, completed_at: "2026-10-12T20:04:00.000Z" });
    expect(done.any).toBe(true);
    expect(done.line).toMatch(/^Closed out /);
  });
  it("knows an office stage set from the picker with no close-out behind it (Oct 5)", () => {
    expect(closeoutInfo({ ...blank, stage: "invoiced" })).toEqual({
      any: false,
      officeStage: true,
      line: "Invoiced by the office — no close-out",
    });
  });
});

describe("readWorkTab", () => {
  it("takes a remembered tab and falls back to Close-out — a stored 'timeline' (Oct 27 morning) included", () => {
    expect(readWorkTab("time")).toBe("time");
    expect(readWorkTab("closeout")).toBe("closeout");
    expect(readWorkTab(null)).toBe("closeout");
    expect(readWorkTab("audit")).toBe("closeout");
    expect(readWorkTab("timeline")).toBe("closeout");
  });
});

describe("the Work fold (ticket-field-sections.tsx)", () => {
  const src = read("src/components/service/ticket-field-sections.tsx");
  const fold = src.slice(
    src.indexOf("function WorkFold("),
    src.indexOf("/** The Work fold's Time tab"),
  );
  it("is one collapsible Box, remembered as 'work', with the two tabs", () => {
    expect(fold).toMatch(/<Box\s+title="Work"\s+icon=\{Hammer\}\s+collapsible/);
    expect(fold).toContain('storageKey="work"');
    expect(fold).toContain(
      '<TabsList className="grid h-auto w-full grid-cols-2" aria-label="Work">',
    );
    expect(fold).toMatch(/<TabsTrigger value="closeout"[^>]*>[\s\S]*?Close-out/);
    expect(fold).toMatch(/<TabsTrigger value="time"[^>]*>[\s\S]*?Time/);
    expect(fold).toContain('<TabsContent value="closeout"');
    expect(fold).toContain('<TabsContent value="time"');
    expect(fold).toContain("<CloseoutBody job={job} />");
    expect(fold).toContain("<TimeBody job={job} officeOrAdmin={officeOrAdmin} rows={time} />");
    expect(fold).toContain("workSummary({ closeout: closeout.line, hours })");
  });
  it("has no Activity log tab, no events query and no note box any more (the form's Activity block)", () => {
    expect(src).not.toContain('value="timeline"');
    expect(fold).not.toContain("Activity log");
    expect(src).not.toMatch(/Activity log\s*<\/TabsTrigger>/);
    expect(src).not.toContain("TimelineBody");
    expect(src).not.toContain("useJobEvents");
    expect(src).not.toContain("listJobEvents");
    expect(src).not.toContain("addJobNote");
    expect(src).not.toContain("<MentionTextarea");
    expect(src).not.toContain("Add note");
  });
  it("remembers the last tab per device (localStorage, guarded)", () => {
    expect(read("src/components/service/ticket-work.ts")).toContain(
      'export const WORK_TAB_KEY = "bid-o-matic:ticket-work-tab";',
    );
    expect(src).toMatch(/function initialWorkTab\(\): WorkTab \{\s+try \{/);
    expect(src).toMatch(/function rememberWorkTab\(tab: WorkTab\) \{\s+try \{/);
  });
  it("opens the first time for a manager's review or a ticket with a close-out (Time's review mode)", () => {
    expect(fold).toContain("defaultOpen={review || closeout.any}");
    expect(src).toMatch(
      /review=\{managesTickets\(profile\) && \(job\.stage === "done" \|\| job\.stage === "authorized"\)\}/,
    );
  });
  it("has no standalone Close-out, Time or Activity log boxes any more", () => {
    expect(src).not.toContain('storageKey="closeout"');
    expect(src).not.toContain('storageKey="time"');
    expect(src).not.toContain('storageKey="time-review"');
    expect(src).not.toContain('storageKey="timeline"');
    expect(src).not.toContain('title="Close-out"');
    expect(src).not.toContain('title="Time"');
    expect(src).not.toContain('title="Activity log"');
    // The Photos & repairs fold stays its own fold.
    expect(src).toContain('storageKey="repairs"');
  });
  it("renders the former folds' bodies unchanged inside the tabs", () => {
    expect(src).toMatch(/function CloseoutBody\(\{ job \}[\s\S]*?Not closed out yet\./);
    expect(src).toMatch(
      /function TimeBody\([\s\S]*?<TimeEntries\s+jobId=\{job\.id\}\s+editable=\{officeOrAdmin\}\s+defaultHelpers=\{job\.helper_count\}\s+compact/,
    );
  });
});

describe("the office column's order (service-page.tsx)", () => {
  const page = read("src/components/service-page.tsx");
  const aside = page.slice(
    page.indexOf("<aside className={stacked ? STACKED_ASIDE : SIDE_ASIDE}"),
    page.indexOf("</aside>"),
  );
  const at = (s: string) => {
    const i = aside.indexOf(s);
    expect(i, s).toBeGreaterThan(-1);
    return i;
  };
  it("runs Needs authorization → Aerial → Inspection → Photos & repairs → Materials & POs → Work → Invoice → History", () => {
    const order = [
      '{jobStage === "done" && <InvoiceBlock job={job} />}',
      "<AerialSection job={job} canEdit={canEdit} />",
      "<InspectionSection job={job} canEdit={canEdit} officeOrAdmin={officeOrAdmin} />",
      "<TicketRepairs jobId={job.id} ticketNumber={job.number} canEdit={canEdit} />",
      "{materials}", // Materials & POs (materials-pos-fold.tsx)
      "<TicketFieldSections job={job} officeOrAdmin={officeOrAdmin} repairs={false} />", // Work
      '{jobStage !== "done" && <InvoiceBlock job={job} />}',
      'aria-label="History"',
      "<HistoryFold job={job} open={historyOpen} onOpenChange={setHistoryOpen} />",
      '<AuditHistory\n                    entity="ticket"',
    ].map(at);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]!);
    expect(aside).not.toContain("<PurchaseOrdersSection");
  });
  it("ends with a thin History heading (small muted uppercase, no box) over the history folds", () => {
    const heading = aside.slice(aside.indexOf('aria-label="History"'));
    expect(heading).toMatch(
      /<h2 className="[^"]*text-xs[^"]*uppercase[^"]*text-muted-foreground[^"]*">\s*History\s*<\/h2>/,
    );
    expect(heading).not.toContain("<Box");
    expect(heading).toContain("<HistoryFold");
    expect(heading).toContain("<AuditHistory");
    // Only when there is something to put under it (a property, or a manager's change log).
    expect(aside).toContain("{(job.site_id || seesEveryone(profile)) && (");
    // The change log left the field sections for the heading.
    expect(read("src/components/service/ticket-field-sections.tsx")).not.toContain("<AuditHistory");
  });
  it("keeps the History fold's id, strip and ?open=history scroll (same element)", () => {
    expect(page).toContain(".getElementById(HISTORY_FOLD_ID)");
    expect(page).toContain("<FoldAllContext.Provider value={arrivedAtHistory ? 1 : 0}>");
    expect(read("src/components/service/site-history.tsx")).toContain("<div id={HISTORY_FOLD_ID}>");
  });
  it("no Documents fold in the column (the header's icon; ticket-header-actions.tsx)", () => {
    expect(aside).not.toMatch(/<TicketDocumentsFold|<DocumentsList|storageKey="documents"/);
  });
});
