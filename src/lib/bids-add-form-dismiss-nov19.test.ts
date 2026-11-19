/**
 * Bids, Nov 19 (owner's list):
 *
 *   1. "when you add custom items in non DL items, metals, etc. currently the form to add items
 *      is at the bottom of the list, can we make it at the top": the box is the FIRST row of
 *      every Non-DL list (Sheet Metal among them). Only where it shows moved.
 *   2. "the yellow bullet point notifications should be able to be dismissed individually":
 *      each has its own button, the dismissal is kept on the bid, a notice whose words change
 *      shows again, and one button brings the dismissed ones back.
 *   3. An estimator lost unsaved work and was not asked. One way that could happen without a
 *      question: the edit lock came back to a tab, and the tab read the saved bid over whatever
 *      was typed there. Unsaved changes are now kept and said.
 *
 * Each block fails on the code before the change.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BidNoticeList } from "@/components/bid-notice-list";
import {
  MAX_DISMISSED_NOTICES,
  dismissNotice,
  noticeKey,
  readDismissedNotices,
  restoreNotices,
  showDismissedLabel,
  splitNotices,
} from "@/lib/bid-dismissed-notices";
import { LOCK_BACK_UNSAVED, bidChangedSince, lockReturnAction } from "@/lib/bid-lock-return";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const estimate = flat(read("routes/estimate.tsx"));

describe("1. the box that adds a custom item is first in the list", () => {
  const src = flat(read("components/nondl-screens.tsx"));
  const grid = src.slice(src.indexOf("function GroupGrid("));
  const body = grid.slice(grid.indexOf("<TableBody>"), grid.indexOf("</TableBody>"));
  const at = (needle: string) => {
    const i = body.indexOf(needle);
    expect(i, needle).toBeGreaterThan(-1);
    return i;
  };

  it("comes before the stock rows and the custom rows", () => {
    const box = at("data-nondl-add-row");
    expect(box).toBeLessThan(at("{refRows.map((row) =>"));
    expect(box).toBeLessThan(at("{customRows.map((c, i) =>"));
    expect(at("Add a custom ${NON_DL_CATEGORY_LABEL[group].toLowerCase()} item…")).toBeLessThan(
      at("{refRows.map((row) =>"),
    );
  });

  it("is the only such box, and one list serves every group", () => {
    expect(src.split("Add a custom ").length - 1).toBe(1);
    expect(src.split("data-nondl-add-row").length - 1).toBe(1);
  });

  it("changes nothing that is saved: an added item still joins the end of the list", () => {
    expect(grid).toContain(
      "onCustom([ ...customRows, { description: d, qty: 0, unitCost: 0, laborPerUnit: 0, laborRate: lastRate }, ]);",
    );
    // Tab or Enter still lands in the new item's Quantity box.
    expect(grid).toContain("setFocusQtyRow(focusQty ? customRows.length : null);");
    expect(grid).toContain("if (customBoxAdds(e.key, e.shiftKey, draft)) {");
  });
});

describe("2. a yellow notice is dismissed by itself", () => {
  const notices = [
    "Section 2 has no deck type.",
    "Parapet P1 is 2 ft taller than the section it sits on.",
    "Non-DL lines were added with no price.",
  ];

  it("hides the one dismissed and leaves the others, in order", () => {
    const d = dismissNotice([], notices[1]!);
    expect(splitNotices(notices, d)).toEqual({
      open: [notices[0], notices[2]],
      hidden: [notices[1]],
    });
    expect(splitNotices(notices, undefined)).toEqual({ open: notices, hidden: [] });
  });

  it("a notice whose numbers change is a new notice and shows again", () => {
    const d = dismissNotice([], "Parapet P1 is 2 ft taller than the section it sits on.");
    const now = ["Parapet P1 is 3 ft taller than the section it sits on."];
    expect(splitNotices(now, d).open).toEqual(now);
  });

  it("is remembered by its words, spacing aside, and only once", () => {
    expect(noticeKey("  Section 2   has no\n deck type. ")).toBe("Section 2 has no deck type.");
    const once = dismissNotice([], notices[0]!);
    expect(dismissNotice(once, `  ${notices[0]}  `)).toEqual(once);
    expect(dismissNotice(once, "   ")).toEqual(once);
  });

  it("Show N dismissed brings back the ones of that list, and only those", () => {
    let d: string[] = [];
    for (const n of notices) d = dismissNotice(d, n);
    d = dismissNotice(d, "From another list.");
    expect(splitNotices(notices, d).open).toEqual([]);
    const back = restoreNotices(d, notices);
    expect(back).toEqual(["From another list."]);
    expect(splitNotices(notices, back).open).toEqual(notices);
    expect(showDismissedLabel(2)).toBe("Show 2 dismissed");
  });

  it("reads what a bid stores safely, and keeps the newest when the list is long", () => {
    expect(readDismissedNotices(undefined)).toEqual([]);
    expect(readDismissedNotices("x")).toEqual([]);
    expect(readDismissedNotices(["a", 3, "", null, "b"])).toEqual(["a", "b"]);
    let d: string[] = [];
    for (let i = 0; i < MAX_DISMISSED_NOTICES + 5; i++) d = dismissNotice(d, `notice ${i}`);
    expect(d).toHaveLength(MAX_DISMISSED_NOTICES);
    expect(d[d.length - 1]).toBe(`notice ${MAX_DISMISSED_NOTICES + 4}`);
    expect(d[0]).toBe("notice 5");
  });

  describe("the list as drawn", () => {
    const draw = (dismissed: string[], readOnly = false) =>
      renderToStaticMarkup(
        createElement(BidNoticeList, {
          title: "Check inputs",
          notices,
          dismissed,
          onDismissed: () => undefined,
          readOnly,
        }),
      );
    const count = (html: string, needle: string) => html.split(needle).length - 1;

    it("gives every notice its own dismiss button", () => {
      const html = draw([]);
      expect(count(html, "data-bid-notice=")).toBe(3);
      expect(count(html, 'data-action="dismiss-notice"')).toBe(3);
      expect(html).toContain('aria-label="Dismiss this notice: Section 2 has no deck type."');
      expect(html).not.toContain("show-dismissed-notices");
    });

    it("leaves a dismissed one out and offers to show it", () => {
      const html = draw([notices[0]!]);
      expect(count(html, "data-bid-notice=")).toBe(2);
      expect(html).not.toContain("Section 2 has no deck type.");
      expect(html).toContain('data-action="show-dismissed-notices"');
      expect(html).toContain("Show 1 dismissed");
    });

    it("with all dismissed there is no yellow box, only the way back", () => {
      const html = draw([...notices]);
      expect(html).toContain('data-bid-notices="all-dismissed"');
      expect(html).not.toContain("Check inputs");
      expect(html).toContain("Show 3 dismissed");
    });

    it("draws nothing for an empty list, and locks its buttons on a read-only bid", () => {
      expect(
        renderToStaticMarkup(
          createElement(BidNoticeList, {
            title: "Check inputs",
            notices: [],
            dismissed: ["x"],
            onDismissed: () => undefined,
          }),
        ),
      ).toBe("");
      const html = draw([notices[0]!], true);
      // Two notices to dismiss and the one way back: all three locked.
      expect(count(html, ' disabled=""')).toBe(3);
      expect(count(draw([notices[0]!]), ' disabled=""')).toBe(0);
    });
  });

  describe("the estimator", () => {
    it("draws both yellow lists through it, each notice with its own dismiss", () => {
      expect(estimate).toContain(
        '<BidNoticeList title="Check inputs" notices={result.warnings} dismissed={dismissedNotices} onDismissed={setDismissedNotices} readOnly={readOnly} />',
      );
      expect(estimate).toContain(
        '<BidNoticeList title="Check:" tone="plain" notices={importInfo.warnings} dismissed={dismissedNotices} onDismissed={setDismissedNotices} readOnly={readOnly} />',
      );
      // The lists that could not be dismissed one by one are gone.
      expect(estimate).not.toContain("result.warnings.map(");
      expect(estimate).not.toContain("importInfo.warnings.map(");
    });

    it("keeps the dismissals on the bid: saved with it, read back with it", () => {
      expect(estimate).toContain("...(dismissedNotices.length ? { dismissedNotices } : {}),");
      expect(estimate).toContain("setDismissedNotices(readDismissedNotices(d.dismissedNotices));");
      // The waved-through numbers stay the LAST key of the saved body (bid-sanity.ts).
      expect(estimate.indexOf("{ dismissedNotices } : {}),")).toBeLessThan(
        estimate.indexOf("...(sanityAcknowledged.length ? { sanityAcknowledged } : {}), };"),
      );
      expect(flat(read("lib/proposal-bid.ts"))).toContain("dismissedNotices?: string[];");
    });

    it("the yellow triangles on the total count only what is still showing", () => {
      expect(estimate).toContain(
        "const openInputWarnings = result ? splitNotices(result.warnings, dismissedNotices).open : [];",
      );
      expect(estimate).not.toContain("result.warnings.length > 0 &&");
      expect(estimate.split("openInputWarnings.length > 0 &&").length - 1).toBe(2);
    });
  });
});

describe("3. the edit lock coming back never drops unsaved work without a word", () => {
  it("unsaved changes are kept; with none the saved bid is read again", () => {
    expect(lockReturnAction(true, false)).toBe("nothing");
    expect(lockReturnAction(true, true)).toBe("nothing");
    expect(lockReturnAction(false, true)).toBe("keep");
    expect(lockReturnAction(false, false)).toBe("reload");
  });

  it("the page is replaced only when the bid was saved meanwhile", () => {
    const t = "2026-11-19T16:01:04.915278+00:00";
    expect(bidChangedSince(t, t)).toBe(false);
    // The same instant written two ways is the same save.
    expect(bidChangedSince("2026-11-19T16:01:04.915Z", "2026-11-19T11:01:04.915-05:00")).toBe(
      false,
    );
    expect(bidChangedSince(t, "2026-11-19T16:31:53.554294+00:00")).toBe(true);
    expect(bidChangedSince(null, t)).toBe(true);
    expect(bidChangedSince(t, undefined)).toBe(true);
  });

  it("says plainly that the work is still there and what Save will do", () => {
    expect(LOCK_BACK_UNSAVED).toContain("Your unsaved changes are still on this page");
    expect(LOCK_BACK_UNSAVED).toContain("press Save now");
    expect(LOCK_BACK_UNSAVED).toContain("nothing of theirs is written over");
  });

  it("the estimator follows the rule", () => {
    expect(estimate).toContain(
      'const action = lockReturnAction(firstTime, dirtyRef.current); if (action === "nothing") return; if (action === "keep") { toast.warning(LOCK_BACK_UNSAVED, { duration: 30_000 }); return; }',
    );
    // The page is thrown away in ONE place, after the saved bid was found changed.
    expect(estimate.split("hydratedFor.current = null;").length - 1).toBe(1);
    expect(estimate).toContain(
      "if (!r.data || !bidChangedSince(loadedUpdatedAt.current, r.data.updated_at)) return; hydratedFor.current = null; setLockBackStamp((n) => n + 1);",
    );
    // Before: read again whatever was on the page.
    expect(estimate).not.toContain("if (firstTime) return; hydratedFor.current = null;");
    // The load effect runs again on the row already in hand.
    expect(estimate).toContain("}, [loadedBid, lockBackStamp]);");
  });

  it("no plain link out of the estimator: each goes through the question that offers to save", () => {
    // "Open the takeoff" loaded the page anew; a full load only gets the browser's own warning.
    expect(estimate).toContain(
      '<Link to="/takeoff" search={{ id: takeoffInfo.takeoffId }} className="underline">',
    );
    expect(estimate).not.toContain("href={`/takeoff");
    expect(estimate).not.toMatch(/<a\s[^>]*href=\{?[`"]\//);
  });
});
