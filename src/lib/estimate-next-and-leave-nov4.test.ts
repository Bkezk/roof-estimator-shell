/**
 * Owner, Nov 4, on the estimator:
 *  - "can we have it to where a new customer can be made in the customer form when starting a
 *    bid, similar to the service side with a popup" — Setup › Customer Name (the free-text
 *    AccountPicker) offers "Add … as a new customer", which opens the same New customer dialog
 *    the ticket form uses and links the bid to the customer it saves.
 *  - "can we save the save and next button to just be next and when you leave the page it asks
 *    if you want to save the changes rather than each next being a save" — Previous / Next only
 *    change the step; leaving the page with unsaved changes opens a dialog (Save and leave /
 *    Leave without saving / Stay) in place of the browser's confirm box.
 * Fails on the old code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/routes/estimate.tsx", "utf8");
const picker = readFileSync("src/components/crm/account-picker.tsx", "utf8");

describe("Setup › Customer Name adds a new customer through the popup", () => {
  it("the free-text picker offers the add row whenever adding is allowed", () => {
    expect(picker).toContain('const addLabel = allowAdd ? typed.trim() : "";');
    expect(picker).not.toContain("free || !allowAdd");
    // The row opens the New customer dialog; the saved customer is picked (linked) like a hit.
    expect(picker).toMatch(/\{addLabel && \(\s*<div\s+role="option"/);
    expect(picker).toMatch(
      /<QuickAddCustomerDialog[\s\S]*?onCreated=\{\(hit\) => \{\s*setAdding\(null\);\s*pick\(hit\);/,
    );
    expect(picker).toContain("Add them below, or the name stays as typed.");
  });
  it("the bid's picker is the free-text one with adding on, and the hint names the row", () => {
    const setup = page.slice(
      // Both boxes are placed by name since Nov 13 (bid-setup-contact-nov13p.test.ts).
      page.indexOf('label="Customer Name"'),
      page.indexOf('<Field label="Job Name"'),
    );
    expect(setup).toContain("allowFreeText");
    expect(setup).not.toContain("allowAdd={false}");
    expect(setup).toContain("onChange={(hit) => void pickAccount(hit)}");
    expect(setup).toContain("as a new\n                          customer");
  });
});

describe("a renamed bid, a changed status or due date count as unsaved changes", () => {
  it("the baselines carry the name (body) and the header beside the saved body and the link", () => {
    expect(page).toContain("const bodyJsonOf = (name: string, body: SavedBidState = saved) =>");
    expect(page).toContain(
      '`${JSON.stringify(body)}|${linkedAccountId ?? ""}|${linkedSiteId ?? ""}|${name.trim()}`;',
    );
    expect(page).toContain("const headerJsonOf = (h: BidHeader) =>");
    expect(page).toContain(
      '`${h.status}|${h.status === "lost" ? (h.lostReason ?? "") : ""}|${h.status === "won" ? h.wonOn : ""}|${h.dueDate}|${normalizeFolder(h.folder) ?? ""}|',
    );
    // After a save whose header was partly kept from elsewhere, the baseline is the row's header.
    expect(page).toContain(
      "lastSavedHeader.current = row && kept.length ? bidHeaderOfRow(row) : tabHeader;",
    );
  });
});

describe("Previous / Next move; leaving asks", () => {
  const footer = page.slice(
    page.indexOf('<div className="flex items-center justify-between border-t pt-4">'),
    page.indexOf("<UpdateBidDialog"),
  );
  it("Previous and Next only change the step — no save, no 'Save &' wording", () => {
    expect(footer).toContain("onClick={() => goStep(step - 1)}");
    expect(footer).toContain("onClick={() => goStep(step + 1)}");
    expect(footer).toMatch(/<ChevronLeft className="mr-1 h-4 w-4" \/> Previous/);
    expect(footer).toMatch(/Next <ChevronRight className="ml-1 h-4 w-4" \/>/);
    expect(page).not.toContain("Save & Next");
    expect(page).not.toContain("Save & Previous");
    expect(page).not.toContain("saveAndGo");
  });
  it("the blocker resolves through a dialog, not window.confirm", () => {
    expect(page).not.toContain("Leave without saving them?");
    expect(page).toMatch(
      /const blocker = useBlocker\(\{\s*shouldBlockFn: \(\) => dirtyRef\.current,\s*withResolver: true,\s*enableBeforeUnload: \(\) => dirtyRef\.current,\s*\}\);/,
    );
    const start = page.indexOf('data-dialog="leave-bid"');
    const dialog = page.slice(start, page.indexOf("Save and leave", start));
    expect(dialog).toContain("Save changes to this bid?");
    expect(dialog).toContain("Leave without saving");
    expect(dialog).toContain("<AlertDialogCancel onClick={stayHere}>Stay</AlertDialogCancel>");
    expect(page).toContain('open={blocker.status === "blocked" && !leaving}');
  });
  it("Save and leave: saved → the navigation goes on; the unusual-numbers dialog answers for it; a failed save stays", () => {
    expect(page).toMatch(
      /const saveAndLeave = async \(\) => \{[\s\S]*?after: \(\) => blocker\.proceed\(\),[\s\S]*?if \(ok\) blocker\.proceed\(\);\s*else if \(!prompted\) stayHere\(\);/,
    );
    expect(page).toContain("opts?.onPrompt?.();");
    // The unusual-numbers dialog's Go back / close / failed Save anyway bring the leave dialog back.
    expect(page.match(/if \(leavingRef\.current\) stayHere\(\);/g)?.length).toBe(3);
    expect(page).toContain("else if (leavingRef.current) stayHere();");
  });
});
