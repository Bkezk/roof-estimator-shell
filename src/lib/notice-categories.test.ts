/**
 * notice-categories.ts (owner, Oct 13): which of the four Account-page switches — lead,
 * opportunity, service, bid notices — governs a notice. By kind first; the kinds the follow-up
 * machinery shares (assigned / followup / reminder / untouched) by where the link opens; tasks,
 * mentions and anything unplaced have no category and are always shown.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  KIND_CATEGORIES,
  NOTICE_CATEGORIES,
  NOTICE_CATEGORY_COLUMNS,
  NOTICE_CATEGORY_HELP,
  NOTICE_CATEGORY_LABELS,
  SHARED_KINDS,
  URL_CATEGORIES,
  kindsOfCategory,
  noticeCategory,
  noticeExclusions,
  offCategories,
  urlPrefixOfCategory,
  wantsNotice,
} from "@/lib/notice-categories";
import { KIND_LABELS } from "@/lib/notifications.functions";

describe("the four categories", () => {
  it("are leads, opportunities, service, bids, storms — in that order, with the owner's labels", () => {
    expect(NOTICE_CATEGORIES).toEqual(["leads", "opportunities", "service", "bids", "storms"]);
    expect(NOTICE_CATEGORIES.map((c) => NOTICE_CATEGORY_LABELS[c])).toEqual([
      "Lead notices",
      "Opportunity notices",
      "Service notices",
      "Bid notices",
      "Storm alerts",
    ]);
  });

  it("each has a one-line help, the lead one the Oct 12 wording", () => {
    expect(NOTICE_CATEGORY_HELP).toEqual({
      leads: "New leads from the bid boards. Off unless you work them.",
      opportunities: "Follow-ups, untouched and assignment notices on opportunities.",
      service: "Ticket assignments, date moves, done and ready-to-invoice notices.",
      bids: "Bid due, past due and your own bid reminders.",
      storms: "Storm reports for roofs in your counties. Off unless you work them.",
    });
    for (const c of NOTICE_CATEGORIES) expect(NOTICE_CATEGORY_HELP[c]).not.toContain("\n");
  });

  it("each is one profiles column; leads keeps the Oct 12 column", () => {
    expect(NOTICE_CATEGORY_COLUMNS).toEqual({
      leads: "notify_leads",
      opportunities: "notify_opportunities",
      service: "notify_service",
      bids: "notify_bids",
      storms: "notify_storms",
    });
  });
});

describe("noticeCategory by kind", () => {
  it.each([
    ["bid_due", "bids"],
    ["bid_overdue", "bids"],
    ["bid_reminder", "bids"],
    ["lead", "leads"],
    ["bid", "leads"],
    ["rfp", "leads"],
    ["storm", "storms"],
    ["ticket_done", "service"],
    ["ticket_authorized", "service"],
    ["ready_to_invoice", "service"],
    ["reassigned", "service"],
    ["date_moved", "service"],
  ])("%s → %s whatever the link", (kind, category) => {
    expect(noticeCategory(kind, null)).toBe(category);
    expect(noticeCategory(kind, "/service?id=1")).toBe(category);
    expect(noticeCategory(kind, "/opportunities?id=1")).toBe(category);
    expect(noticeCategory(kind, "/estimate?bid=1")).toBe(category);
    expect(noticeCategory(kind, "/prospect/leads?roof=1")).toBe(category);
  });

  it("the real sends: bid notices link to /estimate, leads to /prospect/leads, storms to /prospect", () => {
    expect(noticeCategory("bid_due", "/estimate?bid=b1")).toBe("bids");
    expect(noticeCategory("bid_overdue", "/estimate?bid=b1")).toBe("bids");
    expect(noticeCategory("bid_reminder", "/estimate?bid=b1")).toBe("bids");
    expect(noticeCategory("lead", "/prospect/leads?roof=1")).toBe("leads");
    // Owner, Oct 13: a storm alert is its own switch (off by default), not a lead notice.
    expect(noticeCategory("storm", "/prospect?storm=1")).toBe("storms");
    expect(noticeCategory("ticket_done", "/service?id=t1")).toBe("service");
    expect(noticeCategory("ticket_authorized", "/service?id=t1")).toBe("service");
    expect(noticeCategory("reassigned", "/service?id=t1")).toBe("service");
    expect(noticeCategory("date_moved", "/service?id=t1")).toBe("service");
  });
});

describe("noticeCategory for the shared kinds (assigned, followup, reminder, untouched): by the link", () => {
  it("lists exactly the four shared kinds", () => {
    expect([...SHARED_KINDS]).toEqual(["assigned", "followup", "reminder", "untouched"]);
    for (const k of SHARED_KINDS) expect(KIND_CATEGORIES[k]).toBeUndefined();
  });

  it.each([...SHARED_KINDS])("%s", (kind) => {
    expect(noticeCategory(kind, "/service?id=abc")).toBe("service");
    expect(noticeCategory(kind, "/service")).toBe("service");
    expect(noticeCategory(kind, "/opportunities?id=abc")).toBe("opportunities");
    expect(noticeCategory(kind, "/opportunities")).toBe("opportunities");
    expect(noticeCategory(kind, "/estimate?bid=abc")).toBe("bids");
    expect(noticeCategory(kind, "/estimate")).toBe("bids");
    // Anywhere else, or nowhere: no switch governs it.
    expect(noticeCategory(kind, "/my-work")).toBeNull();
    expect(noticeCategory(kind, "/prospect/leads?roof=1")).toBeNull();
    expect(noticeCategory(kind, "/account")).toBeNull();
    expect(noticeCategory(kind, "/")).toBeNull();
    expect(noticeCategory(kind, "")).toBeNull();
    expect(noticeCategory(kind, null)).toBeNull();
    expect(noticeCategory(kind, undefined)).toBeNull();
  });

  it("the prefix table is /service, /opportunities, /estimate", () => {
    expect(URL_CATEGORIES).toEqual([
      { prefix: "/service", category: "service" },
      { prefix: "/opportunities", category: "opportunities" },
      { prefix: "/estimate", category: "bids" },
    ]);
  });
});

describe("noticeCategory: always shown", () => {
  it.each([
    ["task", "/my-work"],
    ["task_today", "/my-work"],
    ["task_overdue", "/my-work"],
    ["mention", "/service?id=1"],
    ["test", "/account"],
    ["note", null],
    ["whatever_a_later_module_adds", "/estimate?bid=1"],
  ])("%s (%s) → null", (kind, url) => {
    expect(noticeCategory(kind, url)).toBeNull();
  });

  it("no kind at all → null", () => {
    expect(noticeCategory(null, "/service?id=1")).toBeNull();
    expect(noticeCategory(undefined, "/service?id=1")).toBeNull();
    expect(noticeCategory("", "/service?id=1")).toBeNull();
  });

  it("every labelled kind of the inbox is either placed or deliberately unplaced", () => {
    const unplaced = ["mention", "task", "task_today", "task_overdue"];
    const legacy = ["rescheduled", "back_from_hold", "hold_over", "unhold"];
    for (const kind of Object.keys(KIND_LABELS)) {
      if (unplaced.includes(kind) || legacy.includes(kind)) {
        expect(noticeCategory(kind, null)).toBeNull();
        continue;
      }
      const placed =
        noticeCategory(kind, null) !== null || (SHARED_KINDS as readonly string[]).includes(kind);
      expect(placed, kind).toBe(true);
    }
  });
});

describe("the helpers the sender and the inbox reads use", () => {
  it("kindsOfCategory: the kind-only kinds; leads and storms have no link prefix, the others one each", () => {
    expect(kindsOfCategory("bids")).toEqual(["bid_due", "bid_overdue", "bid_reminder"]);
    expect(kindsOfCategory("leads")).toEqual(["lead", "bid", "rfp"]);
    expect(kindsOfCategory("storms")).toEqual(["storm"]);
    expect(kindsOfCategory("service")).toEqual([
      "ticket_done",
      "ticket_authorized",
      "ready_to_invoice",
      "reassigned",
      "date_moved",
    ]);
    expect(kindsOfCategory("opportunities")).toEqual([]);
    expect(urlPrefixOfCategory("leads")).toBeNull();
    expect(urlPrefixOfCategory("storms")).toBeNull();
    expect(urlPrefixOfCategory("opportunities")).toBe("/opportunities");
    expect(urlPrefixOfCategory("service")).toBe("/service");
    expect(urlPrefixOfCategory("bids")).toBe("/estimate");
  });

  it("wantsNotice: no category always; otherwise the flag, and a missing flag is on", () => {
    const all = {
      notify_leads: false,
      notify_opportunities: false,
      notify_service: false,
      notify_bids: false,
      notify_storms: false,
    };
    expect(wantsNotice(all, null)).toBe(true);
    for (const c of NOTICE_CATEGORIES) expect(wantsNotice(all, c)).toBe(false);
    expect(wantsNotice({ ...all, notify_service: true }, "service")).toBe(true);
    expect(wantsNotice({}, "service")).toBe(true);
    expect(wantsNotice({ notify_service: null }, "service")).toBe(true);
    expect(wantsNotice({ notify_leads: null }, "leads")).toBe(true);
    expect(wantsNotice({ notify_storms: null }, "storms")).toBe(true);
    expect(wantsNotice({ notify_storms: false }, "storms")).toBe(false);
  });

  it("offCategories: false only, in category order", () => {
    expect(offCategories({})).toEqual([]);
    expect(
      offCategories({
        notify_leads: true,
        notify_opportunities: true,
        notify_service: true,
        notify_bids: true,
        notify_storms: true,
      }),
    ).toEqual([]);
    expect(offCategories({ notify_bids: false, notify_leads: false })).toEqual(["leads", "bids"]);
    expect(offCategories({ notify_storms: false, notify_leads: false })).toEqual([
      "leads",
      "storms",
    ]);
    expect(offCategories({ notify_service: false, notify_opportunities: null })).toEqual([
      "service",
    ]);
  });

  it("noticeExclusions: the kind list and the url prefixes of what is off", () => {
    expect(noticeExclusions([])).toEqual({ kinds: [], urlPrefixes: [] });
    expect(noticeExclusions(["opportunities"])).toEqual({
      kinds: [],
      urlPrefixes: ["/opportunities"],
    });
    expect(noticeExclusions(["leads"])).toEqual({
      kinds: ["lead", "bid", "rfp"],
      urlPrefixes: [],
    });
    expect(noticeExclusions(["storms"])).toEqual({ kinds: ["storm"], urlPrefixes: [] });
    expect(noticeExclusions(["service", "bids"])).toEqual({
      kinds: [
        "ticket_done",
        "ticket_authorized",
        "ready_to_invoice",
        "reassigned",
        "date_moved",
        "bid_due",
        "bid_overdue",
        "bid_reminder",
      ],
      urlPrefixes: ["/service", "/estimate"],
    });
  });

  it("is pure: no imports", () => {
    expect(readFileSync("src/lib/notice-categories.ts", "utf8")).not.toMatch(/^import /m);
  });
});
