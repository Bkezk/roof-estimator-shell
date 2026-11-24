/**
 * Which notices, one by one (owner, Nov 24: "can you also add an ability to select which
 * notifications they want on more granularly like under ticket notifications you can choose to
 * be notified at open and closed but not scheduled?", then "Option A on notifications plz").
 *
 *   1. The map: every notice the site sends is one tick under its switch, or follows its switch
 *      alone, or is under no switch and always sent. Walked from the modules that send.
 *   2. The rule (takesNotice): the switch is on AND the type is not in the person's off list.
 *      With nothing off it is the old rule exactly; with anything off it only ever takes away.
 *   3. The same rule as SQL for the inbox reads (noticeFilters, noticeRuleFilter).
 *   4. The words on the Account page.
 *   5. The migration, read as text: the column, the database's own list of keys, the save and
 *      the recipients read (the Oct 13 definition with one column added).
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  KIND_CATEGORIES,
  NOTICE_CATEGORIES,
  NOTICE_CATEGORY_COLUMNS,
  SHARED_KINDS,
  URL_CATEGORIES,
  noticeCategory,
  urlPrefixOfCategory,
  wantsNotice,
  type NoticeCategory,
  type NoticeFlags,
} from "@/lib/notice-categories";
import {
  CATEGORIES_WITH_CHOICES,
  NOTICE_CHOICES_BUTTON,
  NOTICE_CHOICES_NOT_READY,
  NOTICE_CHOICES_NOT_SAVED,
  NOTICE_TYPES,
  NOTICE_TYPE_KEYS,
  cleanNotifyOff,
  isNoticeTypeKey,
  noticeChoiceFailure,
  noticeChoicesLine,
  noticeChoicesPausedLine,
  noticeFilters,
  noticeRuleFilter,
  noticeType,
  offCountOf,
  takesNotice,
  titleLike,
  typesOfCategory,
  withNoticeChoice,
} from "@/lib/notice-types";
import {
  careAssignedNotice,
  careOpenedNotice,
  type CareTicketToAnnounce,
} from "@/lib/roof-care-ticket-announce";
import { dispatchWatchNotice, stageWatchNotice, TICKET_WATCH_KIND } from "@/lib/ticket-watch";
import { BID_WATCH_KIND, OPPORTUNITY_WATCH_KIND } from "@/lib/work-steps";

const read = (p: string) => readFileSync(p, "utf8");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");

/* ---- 1. the map --------------------------------------------------------------------------- */

const labelsOf = (c: NoticeCategory) => typesOfCategory(c).map((t) => `${t.key} = ${t.label}`);

describe("the ticks under each switch", () => {
  it("Service notices: the life of a ticket, fifteen ticks", () => {
    expect(labelsOf("service")).toEqual([
      "service_opened = Opened",
      "service_assigned_me = Assigned to me",
      "service_reassigned = Reassigned",
      "service_scheduled = Scheduled",
      "service_date_moved = Date moved",
      "service_reminders = Reminders",
      "service_not_started = Not started",
      "service_nobody = Nobody on it",
      "service_done = Done",
      "service_authorized = Authorized",
      "service_ready_to_invoice = Ready to invoice",
      "service_invoiced = Invoiced",
      "service_closed = Closed",
      "service_moved_back = Reopened or moved back",
      "service_deleted = Deleted",
    ]);
  });

  it("Opportunity notices: five ticks", () => {
    expect(labelsOf("opportunities")).toEqual([
      "opportunities_assigned_me = Assigned to me",
      "opportunities_follow_up = Follow-up due",
      "opportunities_not_started = Not started",
      "opportunities_nobody = Nobody on it",
      "opportunities_steps = Each step",
    ]);
  });

  it("Bid notices: four ticks", () => {
    expect(labelsOf("bids")).toEqual([
      "bids_due_soon = Due soon",
      "bids_past_due = Past due",
      "bids_my_reminders = My reminders",
      "bids_steps = Each step",
    ]);
  });

  it("leads and storms are one notice each: no ticks, so no list", () => {
    expect(typesOfCategory("leads")).toEqual([]);
    expect(typesOfCategory("storms")).toEqual([]);
    expect(CATEGORIES_WITH_CHOICES).toEqual(["opportunities", "service", "bids"]);
  });

  it("every key is its own, plain, and starts with its switch; twenty-four in all", () => {
    expect(NOTICE_TYPE_KEYS).toHaveLength(24);
    expect(new Set(NOTICE_TYPE_KEYS).size).toBe(24);
    for (const t of NOTICE_TYPES) {
      expect(t.key).toMatch(/^[a-z][a-z0-9_]{2,39}$/);
      expect(t.key.startsWith(`${t.category}_`)).toBe(true);
      expect(isNoticeTypeKey(t.key)).toBe(true);
      // A key is never a kind: `ticket_authorized` the kind is "ready to invoice", not the tick.
      expect(KIND_CATEGORIES[t.key]).toBeUndefined();
    }
    expect(isNoticeTypeKey("ticket_watch")).toBe(false);
    expect(isNoticeTypeKey(7)).toBe(false);
  });

  it("every way a tick is told apart belongs to the tick's own switch", () => {
    for (const t of NOTICE_TYPES) {
      expect(t.match.length).toBeGreaterThan(0);
      for (const m of t.match) {
        expect(m.kinds.length).toBeGreaterThan(0);
        if (m.urlPrefix !== undefined) {
          // The kinds several kinds of work share: placed by where the link opens.
          for (const k of m.kinds) expect(SHARED_KINDS as readonly string[]).toContain(k);
          expect(m.urlPrefix).toBe(urlPrefixOfCategory(t.category));
          expect(m.titles).toBeUndefined();
        } else {
          for (const k of m.kinds) expect(KIND_CATEGORIES[k]).toBe(t.category);
        }
        // A title pattern is plain words with % for "anything": nothing a LIKE or a PostgREST
        // filter reads as special (no _ \ , ( ) or quote).
        for (const p of m.titles ?? []) {
          expect(p).toMatch(/^[A-Za-z0-9 :%]+$/);
          expect(p).toContain("%");
        }
      }
    }
  });

  it("no two ticks claim the same kind, or the same kind and link", () => {
    const seen = new Map<string, string>();
    for (const t of NOTICE_TYPES)
      for (const m of t.match)
        for (const k of m.kinds)
          for (const title of m.titles ?? ["*"]) {
            const at = `${k} ${m.urlPrefix ?? "*"} ${title}`;
            expect(seen.get(at), at).toBeUndefined();
            seen.set(at, t.key);
          }
    // Only the ticket steps are told by their title; every other kind has one tick at most.
    const byTitle = NOTICE_TYPES.flatMap((t) => t.match).filter((m) => m.titles);
    expect(new Set(byTitle.flatMap((m) => m.kinds))).toEqual(new Set([TICKET_WATCH_KIND]));
  });
});

/* ---- every notice the site sends, from the modules that send them -------------------------- */

const T = "/service?id=t1";
const O = "/opportunities?id=o1";
const B = "/estimate?bid=b1";
const TRADE = "/trade-bids?bid=b2";

interface Sent {
  from: string;
  kind: string;
  url: string | null;
  title: string;
  /** A tick's key, "switch" (its switch alone), or "always" (under no switch). */
  expect: string;
  /** The text that must be in the sending module (omit: the kind's own literal). */
  pin?: string;
}

const SENT: Sent[] = [
  // followups.server.ts announce(), roof-care-ticket-announce.server.ts
  {
    from: "src/lib/followups.server.ts",
    kind: "assigned",
    url: T,
    title: "Assigned to you: Ticket #12 Acme",
    expect: "service_assigned_me",
  },
  {
    from: "src/lib/followups.server.ts",
    kind: "assigned",
    url: T,
    title: "Reopened: Ticket #12 Acme",
    expect: "service_assigned_me",
  },
  {
    from: "src/lib/followups.server.ts",
    kind: "assigned",
    url: T,
    title: "Authorize Ticket #12 Acme — ready for your review",
    expect: "service_assigned_me",
  },
  {
    from: "src/lib/followups.server.ts",
    kind: "assigned",
    url: O,
    title: "Opportunity assigned to you: New roof",
    expect: "opportunities_assigned_me",
  },
  // notify.server.ts: the reminder pass, the not-started and the nobody-on-it alerts
  {
    from: "src/lib/notify.server.ts",
    kind: "followup",
    url: T,
    title: "Ticket #12 Acme is due tomorrow",
    expect: "service_reminders",
  },
  {
    from: "src/lib/notify.server.ts",
    kind: "followup",
    url: O,
    title: "New roof is past due",
    expect: "opportunities_follow_up",
  },
  {
    from: "src/lib/notify.server.ts",
    kind: "untouched",
    url: T,
    title: "Not started: Ticket #12 Acme",
    expect: "service_not_started",
  },
  {
    from: "src/lib/notify.server.ts",
    kind: "untouched",
    url: O,
    title: "No contact logged: New roof",
    expect: "opportunities_not_started",
  },
  {
    from: "src/lib/notify.server.ts",
    kind: "ticket_unassigned",
    url: T,
    title: "Nobody on Ticket #12",
    expect: "service_nobody",
    pin: "kind: `${type}_unassigned`",
  },
  {
    from: "src/lib/notify.server.ts",
    kind: "opportunity_unassigned",
    url: O,
    title: "Nobody on New roof",
    expect: "opportunities_nobody",
    pin: "kind: `${type}_unassigned`",
  },
  // ticket-events.server.ts
  {
    from: "src/lib/ticket-events.server.ts",
    kind: "ticket_done",
    url: T,
    title: "Ticket #12 Acme is done, ready for your review",
    expect: "service_done",
  },
  {
    from: "src/lib/ticket-events.server.ts",
    kind: "ticket_authorized",
    url: T,
    title: "Ticket #12 Acme authorized — ready to invoice",
    expect: "service_ready_to_invoice",
  },
  {
    from: "src/lib/ticket-events.server.ts",
    kind: "ticket_authorized",
    url: T,
    title: "Ticket #12 Acme back to Authorized — its invoice was voided by Brandon.",
    expect: "service_ready_to_invoice",
  },
  {
    from: "src/lib/ticket-events.server.ts",
    kind: "reassigned",
    url: T,
    title: "Ticket #12 was reassigned",
    expect: "service_reassigned",
  },
  {
    from: "src/lib/ticket-events.server.ts",
    kind: "date_moved",
    url: T,
    title: "Ticket #12 moved to Friday, Nov 27, 2026",
    expect: "service_date_moved",
  },
  // work-steps.ts through opportunities.functions.ts, bids.functions.ts, trade-bids.functions.ts
  {
    from: "src/lib/work-steps.ts",
    kind: OPPORTUNITY_WATCH_KIND,
    url: O,
    title: "Won: New roof",
    expect: "opportunities_steps",
    pin: 'OPPORTUNITY_WATCH_KIND = "opportunity_watch"',
  },
  {
    from: "src/lib/work-steps.ts",
    kind: BID_WATCH_KIND,
    url: B,
    title: "Started: Bid Acme",
    expect: "bids_steps",
    pin: 'BID_WATCH_KIND = "bid_watch"',
  },
  {
    from: "src/lib/trade-bids.functions.ts",
    kind: BID_WATCH_KIND,
    url: TRADE,
    title: "Started: Bid Gutters",
    expect: "bids_steps",
    pin: "kind: BID_WATCH_KIND",
  },
  // bids-notify.server.ts: a trade bid's notice opens Trade Bids and is the same notice
  {
    from: "src/lib/bids-notify.server.ts",
    kind: "bid_due",
    url: B,
    title: "Bid due tomorrow: Acme",
    expect: "bids_due_soon",
    pin: "kind bid_due",
  },
  {
    from: "src/lib/bids-notify.server.ts",
    kind: "bid_due",
    url: TRADE,
    title: "Bid due tomorrow: Gutters",
    expect: "bids_due_soon",
    pin: "kind bid_due",
  },
  {
    from: "src/lib/bids-notify.server.ts",
    kind: "bid_overdue",
    url: B,
    title: "Bid past due: Acme",
    expect: "bids_past_due",
    pin: "kind bid_overdue",
  },
  {
    from: "src/lib/bids-notify.server.ts",
    kind: "bid_reminder",
    url: B,
    title: "Bid reminder: Acme",
    expect: "bids_my_reminders",
    pin: "kind bid_reminder",
  },
  // One notice under its switch: the switch is the whole choice.
  {
    from: "src/lib/leads.server.ts",
    kind: "lead",
    url: "/prospect/leads?roof=1",
    title: "3 new leads",
    expect: "switch",
  },
  {
    from: "src/lib/storms.server.ts",
    kind: "storm",
    url: "/prospect?storm=1",
    title: "Hail in Jefferson County",
    expect: "switch",
  },
  // Under no switch: always sent, as before.
  {
    from: "src/lib/tasks-notify.server.ts",
    kind: "task",
    url: "/my-work",
    title: "New task: Call Acme",
    expect: "always",
    pin: 'created: "task"',
  },
  {
    from: "src/lib/tasks-notify.server.ts",
    kind: "task_today",
    url: "/my-work",
    title: "Due today: Call Acme",
    expect: "always",
    pin: 'morning: "task_today"',
  },
  {
    from: "src/lib/tasks-notify.server.ts",
    kind: "task_overdue",
    url: "/my-work",
    title: "Overdue: Call Acme",
    expect: "always",
    pin: 'overdue: "task_overdue"',
  },
  {
    from: "src/lib/service-field.functions.ts",
    kind: "mention",
    url: T,
    title: "Sam mentioned you on Ticket #12 Acme",
    expect: "always",
  },
  {
    from: "src/lib/followups.functions.ts",
    kind: "test",
    url: "/account",
    title: "Test notification",
    expect: "always",
  },
  {
    from: "src/lib/public-requests.ts",
    kind: "public_request",
    url: O,
    title: "Service request from the public page: Acme",
    expect: "always",
  },
  {
    from: "src/lib/roof-care-notify.server.ts",
    kind: "plan_expired",
    url: "/properties/p1",
    title: "Guard plan expired: Acme",
    expect: "always",
    pin: 'PLAN_EXPIRED_KIND = "plan_expired"',
  },
  {
    from: "src/lib/roof-care-no-access.functions.ts",
    kind: "care_no_access",
    url: T,
    title: "No access for a Guard inspection: Acme",
    expect: "always",
  },
  {
    from: "src/lib/roof-care-checkout.ts",
    kind: "plan_card_paid",
    url: "/properties/p1",
    title: "Card payment to send back: Acme",
    expect: "always",
  },
  {
    from: "src/routes/api.stripe.webhook.ts",
    kind: "plan_card_paid",
    url: "/properties/p1",
    title: "A card payment could not be recorded: Acme",
    expect: "always",
  },
];

/** A ticket the site made for a Roof Care plan (roof-care-ticket-announce.ts). */
const care = (id: string): CareTicketToAnnounce => ({
  id,
  number: 40,
  customer_name: "Acme",
  site_name: "Acme HQ",
  description: "Roof Care inspection",
  stage: "open",
  account_id: "a1",
  technician_id: null,
  scheduled_date: null,
  plan: "guard",
  visit_kind: "visit1",
  due_from: null,
  due_by: null,
});

/** Every title the "each step" notices of a ticket can carry, from the functions that write them. */
function ticketStepTitles(): { title: string; url: string }[] {
  const STAGES = ["open", "scheduled", "done", "authorized", "invoiced", "closed"];
  const row = (stage: string, tech: string | null = "tech-1") => ({
    number: 12,
    customer_name: "Acme",
    description: "Leak at the drain",
    stage,
    technician_id: tech,
    scheduled_date: "2026-11-27",
  });
  const out: { title: string; url: string }[] = [];
  for (const stage of STAGES) {
    for (const prevStage of [null, ...STAGES])
      for (const deleted of [false, true])
        for (const endsHere of [false, true]) {
          const n = stageWatchNotice({
            row: row(stage),
            prevStage,
            deleted,
            who: "Sam",
            techName: "Garry",
            endsHere,
          });
          if (n) out.push({ title: n.title, url: T });
        }
  }
  const people: (string | null)[] = [null, "tech-1", "tech-2"];
  const days: (string | null)[] = [null, "2026-11-27", "2026-11-30"];
  for (const oldTech of people)
    for (const newTech of people)
      for (const oldDay of days)
        for (const newDay of days) {
          const n = dispatchWatchNotice({
            row: { ...row("scheduled", newTech), scheduled_date: newDay },
            before: { technician_id: oldTech, scheduled_date: oldDay },
            who: "Sam",
            techName: "Garry",
            oldTechName: "Lee",
          });
          if (n) out.push({ title: n.title, url: T });
        }
  // roof-care-ticket-announce.ts: the tickets the site makes for a Roof Care plan.
  for (const list of [[care("c1")], [care("c1"), care("c2"), care("c3")]]) {
    const n = careOpenedNotice(list);
    if (n) out.push({ title: n.title, url: n.url });
  }
  return out;
}

const STEP_TICK: Readonly<Record<string, string>> = {
  "Opened:": "service_opened",
  "3 Roof": "service_opened",
  "Assigned:": "service_reassigned",
  "Reassigned:": "service_reassigned",
  "Unassigned:": "service_reassigned",
  "Scheduled:": "service_scheduled",
  "Date set:": "service_date_moved",
  "Date moved:": "service_date_moved",
  "Authorized:": "service_authorized",
  "Invoiced:": "service_invoiced",
  "Closed:": "service_closed",
  "Reopened:": "service_moved_back",
  "Back to": "service_moved_back",
  "Deleted:": "service_deleted",
};

describe("every notice the site sends lands in one tick, its switch alone, or always sent", () => {
  it("the list is the modules' own: each kind is in the file that sends it", () => {
    for (const s of SENT)
      expect(read(s.from), `${s.from} ${s.kind}`).toContain(s.pin ?? `kind: "${s.kind}"`);
  });

  it("each lands where it should", () => {
    for (const s of SENT) {
      const category = noticeCategory(s.kind, s.url);
      const type = noticeType(s.kind, s.url, s.title);
      const at = `${s.kind} ${s.url} "${s.title}"`;
      if (s.expect === "always") {
        expect(category, at).toBeNull();
        expect(type, at).toBeNull();
      } else if (s.expect === "switch") {
        expect(category, at).not.toBeNull();
        expect(type, at).toBeNull();
      } else {
        expect(type?.key, at).toBe(s.expect);
        expect(type?.category, at).toBe(category);
      }
    }
  });

  it("every kind a switch covers is in the walk: none was left out", () => {
    const walked = new Set([...SENT.map((s) => s.kind), TICKET_WATCH_KIND]);
    // Kinds no module sends any more, kept for the rows already in people's inboxes.
    const OLD = ["bid", "rfp", "ready_to_invoice", "reminder"];
    for (const k of [...Object.keys(KIND_CATEGORIES), ...SHARED_KINDS])
      expect(walked.has(k) || OLD.includes(k), k).toBe(true);
    // The old kinds still follow today's ticks where there is one.
    expect(noticeType("ready_to_invoice", T, "x")?.key).toBe("service_ready_to_invoice");
    expect(noticeType("reminder", T, "x")?.key).toBe("service_reminders");
    expect(noticeType("reminder", O, "x")?.key).toBe("opportunities_follow_up");
    expect(noticeType("bid", "/prospect/leads", "x")).toBeNull();
  });

  it("each step of a ticket: every title ticket-watch.ts and the Roof Care tickets can write is one tick", () => {
    const titles = ticketStepTitles();
    const starts = new Set<string>();
    for (const { title, url } of titles) {
      const start = Object.keys(STEP_TICK).find((s) => title.startsWith(s));
      expect(start, title).toBeDefined();
      starts.add(start!);
      expect(noticeCategory(TICKET_WATCH_KIND, url)).toBe("service");
      expect(noticeType(TICKET_WATCH_KIND, url, title)?.key, title).toBe(STEP_TICK[start!]);
      // One tick only: no title fits two.
      const fitting = NOTICE_TYPES.filter(
        (t) => !takesNotice({ notify_off: [t.key] }, { kind: TICKET_WATCH_KIND, url, title }),
      );
      expect(fitting.map((t) => t.key)).toEqual([STEP_TICK[start!]]);
    }
    // Every start in the table was really written by the code (Done has no step notice: every
    // admin and manager already gets "is done, ready for your review").
    expect([...starts].sort()).toEqual(Object.keys(STEP_TICK).sort());
    expect(titles.some((t) => t.title.startsWith("Done"))).toBe(false);
  });

  it("the technician's own Roof Care notice for several tickets is Assigned to me", () => {
    const n = careAssignedNotice([care("c1"), care("c2")]);
    expect(n?.url).toBe("/service/today");
    expect(noticeType("assigned", n!.url, n!.title)?.key).toBe("service_assigned_me");
  });

  it("a step title this file does not know follows the Service switch alone", () => {
    const odd = { kind: TICKET_WATCH_KIND, url: T, title: "On hold: Ticket #12 Acme" };
    expect(noticeType(odd.kind, odd.url, odd.title)).toBeNull();
    expect(takesNotice({ notify_off: [...NOTICE_TYPE_KEYS] }, odd)).toBe(true);
    expect(takesNotice({ notify_service: false }, odd)).toBe(false);
  });

  it("a bid follow-up kind nobody sends today (a shared kind opening /estimate) follows the Bid switch alone", () => {
    for (const kind of SHARED_KINDS) {
      expect(noticeCategory(kind, B)).toBe("bids");
      expect(noticeType(kind, B, "x")).toBeNull();
    }
  });
});

/* ---- 2. the rule -------------------------------------------------------------------------- */

const ALL_ON: NoticeFlags = {
  notify_leads: true,
  notify_opportunities: true,
  notify_service: true,
  notify_bids: true,
  notify_storms: true,
};
/** Every notice of the walk, the ticket steps included. */
const EVERY: { kind: string; url: string | null; title: string }[] = [
  ...SENT.map(({ kind, url, title }) => ({ kind, url, title })),
  ...ticketStepTitles().map((t) => ({ kind: TICKET_WATCH_KIND, ...t })),
  { kind: "followup", url: null, title: "no link" },
  { kind: "followup", url: "/customers?id=a1", title: "elsewhere" },
];
/** The 32 ways the five switches can stand, and a few where a flag is missing or null. */
const FLAG_SETS: NoticeFlags[] = [
  {},
  { notify_service: null },
  ...Array.from(
    { length: 32 },
    (_, n) =>
      Object.fromEntries(
        NOTICE_CATEGORIES.map((c, i) => [NOTICE_CATEGORY_COLUMNS[c], ((n >> i) & 1) === 1]),
      ) as NoticeFlags,
  ),
];
/** A spread of off lists: none, each key alone, every key, and some mixes. */
const OFF_LISTS: string[][] = [
  [],
  ...NOTICE_TYPE_KEYS.map((k) => [k]),
  [...NOTICE_TYPE_KEYS],
  NOTICE_TYPE_KEYS.filter((_, i) => i % 2 === 0),
  NOTICE_TYPE_KEYS.filter((_, i) => i % 3 === 0),
  ["service_scheduled", "opportunities_nobody", "bids_steps"],
];

describe("takesNotice: the switch is on AND the type is not off", () => {
  it("the owner's own example: told when a ticket is opened and closed, not when it is scheduled", () => {
    const me = { ...ALL_ON, notify_off: ["service_scheduled"] };
    const step = (title: string) => takesNotice(me, { kind: TICKET_WATCH_KIND, url: T, title });
    expect(step("Opened: Ticket #12 Acme — Leak")).toBe(true);
    expect(step("Scheduled: Ticket #12 Acme — Leak")).toBe(false);
    expect(step("Closed: Ticket #12 Acme — Leak")).toBe(true);
    // Somebody with nothing off still gets all three.
    expect(
      takesNotice(ALL_ON, {
        kind: TICKET_WATCH_KIND,
        url: T,
        title: "Scheduled: Ticket #12 Acme",
      }),
    ).toBe(true);
  });

  it("nothing off is the old rule exactly: nobody's notices changed the day this shipped", () => {
    const empties: unknown[] = [undefined, null, [], "service_opened", ["nonsense", 4, null]];
    for (const flags of FLAG_SETS)
      for (const n of EVERY) {
        const before = wantsNotice(flags, noticeCategory(n.kind, n.url));
        // A row read before the migration (no notify_off at all) and every kind of empty.
        expect(takesNotice(flags, n)).toBe(before);
        for (const notify_off of empties)
          expect(takesNotice({ ...flags, notify_off } as never, n)).toBe(before);
      }
  });

  it("a tick only ever takes a notice away: never one more than the old rule sent", () => {
    for (const flags of FLAG_SETS)
      for (const notify_off of OFF_LISTS)
        for (const n of EVERY) {
          const before = wantsNotice(flags, noticeCategory(n.kind, n.url));
          const now = takesNotice({ ...flags, notify_off }, n);
          if (now) expect(before, `${n.kind} ${n.title}`).toBe(true);
        }
  });

  it("each tick turns off its own notices and no others", () => {
    for (const s of SENT) {
      for (const key of NOTICE_TYPE_KEYS)
        expect(takesNotice({ ...ALL_ON, notify_off: [key] }, s), `${s.kind} / ${key}`).toBe(
          key !== s.expect,
        );
    }
  });

  it("a switch that is off still wins, whatever the ticks say", () => {
    for (const n of EVERY) {
      const category = noticeCategory(n.kind, n.url);
      if (!category) continue;
      const off = { ...ALL_ON, [NOTICE_CATEGORY_COLUMNS[category]]: false };
      expect(takesNotice({ ...off, notify_off: [] }, n)).toBe(false);
      expect(takesNotice({ ...off, notify_off: [...NOTICE_TYPE_KEYS] }, n)).toBe(false);
    }
  });

  it("what is under no switch always goes: tasks, mentions, the test, public requests, Roof Care plan notices", () => {
    const hermit = {
      notify_leads: false,
      notify_opportunities: false,
      notify_service: false,
      notify_bids: false,
      notify_storms: false,
      notify_off: [...NOTICE_TYPE_KEYS],
    };
    const always = SENT.filter((s) => s.expect === "always");
    expect(always.map((s) => s.kind)).toEqual([
      "task",
      "task_today",
      "task_overdue",
      "mention",
      "test",
      "public_request",
      "plan_expired",
      "care_no_access",
      "plan_card_paid",
      "plan_card_paid",
    ]);
    for (const s of always) expect(takesNotice(hermit, s), s.kind).toBe(true);
  });

  it("the same kind is told apart by where its link opens", () => {
    const me = { ...ALL_ON, notify_off: ["service_reminders"] };
    expect(takesNotice(me, { kind: "followup", url: T, title: "x" })).toBe(false);
    expect(takesNotice(me, { kind: "followup", url: O, title: "x" })).toBe(true);
    expect(takesNotice(me, { kind: "followup", url: null, title: "x" })).toBe(true);
    expect(takesNotice(me, { kind: "assigned", url: T, title: "x" })).toBe(true);
  });

  it("the technician's own notice and the watchers' step are one tick: Date moved, Reassigned", () => {
    const date = { ...ALL_ON, notify_off: ["service_date_moved"] };
    expect(
      takesNotice(date, { kind: "date_moved", url: T, title: "Ticket #12 moved to Friday" }),
    ).toBe(false);
    expect(
      takesNotice(date, { kind: TICKET_WATCH_KIND, url: T, title: "Date moved: Ticket #12" }),
    ).toBe(false);
    expect(
      takesNotice(date, { kind: TICKET_WATCH_KIND, url: T, title: "Date set: Ticket #12" }),
    ).toBe(false);
    const re = { ...ALL_ON, notify_off: ["service_reassigned"] };
    expect(
      takesNotice(re, { kind: "reassigned", url: T, title: "Ticket #12 was reassigned" }),
    ).toBe(false);
    for (const start of ["Assigned", "Reassigned", "Unassigned"])
      expect(
        takesNotice(re, { kind: TICKET_WATCH_KIND, url: T, title: `${start}: Ticket #12` }),
      ).toBe(false);
    // "Assigned to me" is the person's own: another tick.
    expect(
      takesNotice(re, { kind: "assigned", url: T, title: "Assigned to you: Ticket #12" }),
    ).toBe(true);
  });

  it("Authorized and Ready to invoice are two notices in the code, so two ticks", () => {
    const inspection = { kind: TICKET_WATCH_KIND, url: T, title: "Authorized: Ticket #12 Acme" };
    const invoice = {
      kind: "ticket_authorized",
      url: T,
      title: "Ticket #12 Acme authorized — ready to invoice",
    };
    const a = { ...ALL_ON, notify_off: ["service_authorized"] };
    expect(takesNotice(a, inspection)).toBe(false);
    expect(takesNotice(a, invoice)).toBe(true);
    const b = { ...ALL_ON, notify_off: ["service_ready_to_invoice"] };
    expect(takesNotice(b, inspection)).toBe(true);
    expect(takesNotice(b, invoice)).toBe(false);
  });

  it("titleLike is SQL LIKE with % only, and minds capitals", () => {
    expect(titleLike("Opened: Ticket #1", "Opened: %")).toBe(true);
    expect(titleLike("Opened: ", "Opened: %")).toBe(true);
    expect(titleLike("opened: Ticket #1", "Opened: %")).toBe(false);
    expect(titleLike("Reopened: Ticket #1", "Opened: %")).toBe(false);
    expect(
      titleLike(
        "3 Roof Care plan inspection tickets opened",
        "% Roof Care plan inspection tickets opened",
      ),
    ).toBe(true);
    expect(
      titleLike(
        "Roof Care plan inspection tickets opened",
        "% Roof Care plan inspection tickets opened",
      ),
    ).toBe(false);
    expect(titleLike("abc", "abc")).toBe(true);
    expect(titleLike("abcd", "abc")).toBe(false);
    expect(titleLike("a-b-c", "a%b%c")).toBe(true);
    expect(titleLike("a-c-b", "a%b%c")).toBe(false);
    expect(titleLike("ab", "ab%ab")).toBe(false);
  });
});

describe("the off list as kept", () => {
  it("cleanNotifyOff: the keys this site knows, each once, in list order; anything else is nothing", () => {
    expect(cleanNotifyOff(undefined)).toEqual([]);
    expect(cleanNotifyOff(null)).toEqual([]);
    expect(cleanNotifyOff("service_opened")).toEqual([]);
    expect(cleanNotifyOff({ 0: "service_opened" })).toEqual([]);
    expect(
      cleanNotifyOff([
        "bids_steps",
        "nope",
        3,
        null,
        "service_opened",
        "bids_steps",
        "ticket_done",
      ]),
    ).toEqual(["service_opened", "bids_steps"]);
    expect(cleanNotifyOff([...NOTICE_TYPE_KEYS].reverse())).toEqual(NOTICE_TYPE_KEYS);
  });

  it("withNoticeChoice: one tick pressed; on takes the key out, off puts it in; junk changes nothing", () => {
    expect(withNoticeChoice([], "service_scheduled", false)).toEqual(["service_scheduled"]);
    expect(withNoticeChoice(["service_scheduled"], "service_opened", false)).toEqual([
      "service_opened",
      "service_scheduled",
    ]);
    expect(
      withNoticeChoice(["service_opened", "service_scheduled"], "service_opened", true),
    ).toEqual(["service_scheduled"]);
    expect(withNoticeChoice(["service_scheduled"], "service_scheduled", false)).toEqual([
      "service_scheduled",
    ]);
    expect(withNoticeChoice([], "service_scheduled", true)).toEqual([]);
    expect(withNoticeChoice(["service_scheduled", "old_key"], "made_up", false)).toEqual([
      "service_scheduled",
    ]);
  });
});

/* ---- 3. the same rule as SQL --------------------------------------------------------------- */

describe("noticeFilters: what the inbox reads leave out", () => {
  it("nothing off: nothing left out", () => {
    expect(noticeFilters({})).toEqual({ kinds: [], urlPrefixes: [], rules: [] });
    expect(noticeFilters({ ...ALL_ON, notify_off: [] })).toEqual({
      kinds: [],
      urlPrefixes: [],
      rules: [],
    });
  });

  it("a tick that is a kind of its own joins the kind list", () => {
    expect(noticeFilters({ notify_off: ["service_done", "bids_due_soon"] })).toEqual({
      kinds: ["ticket_done", "bid_due"],
      urlPrefixes: [],
      rules: [],
    });
    // Ready to invoice is two kinds (the older one too).
    expect(noticeFilters({ notify_off: ["service_ready_to_invoice"] }).kinds).toEqual([
      "ticket_authorized",
      "ready_to_invoice",
    ]);
  });

  it("a tick told by its link is a rule: these kinds AND that link", () => {
    expect(noticeFilters({ notify_off: ["service_reminders"] })).toEqual({
      kinds: [],
      urlPrefixes: [],
      rules: [{ kinds: ["followup", "reminder"], urlPrefix: "/service", title: null }],
    });
  });

  it("a ticket step is a rule per way its title can start; a tick with both is both", () => {
    expect(noticeFilters({ notify_off: ["service_scheduled"] }).rules).toEqual([
      { kinds: ["ticket_watch"], urlPrefix: null, title: "Scheduled: %" },
    ]);
    expect(noticeFilters({ notify_off: ["service_date_moved"] })).toEqual({
      kinds: ["date_moved"],
      urlPrefixes: [],
      rules: [
        { kinds: ["ticket_watch"], urlPrefix: null, title: "Date set: %" },
        { kinds: ["ticket_watch"], urlPrefix: null, title: "Date moved: %" },
      ],
    });
  });

  it("a switch that is off already leaves all of it out: its ticks add nothing", () => {
    expect(
      noticeFilters({
        notify_service: false,
        notify_off: ["service_scheduled", "service_done", "bids_past_due"],
      }),
    ).toEqual({
      kinds: [
        ...Object.keys(KIND_CATEGORIES).filter((k) => KIND_CATEGORIES[k] === "service"),
        "bid_overdue",
      ],
      urlPrefixes: ["/service"],
      rules: [],
    });
  });

  it("noticeRuleFilter: a PostgREST or() that keeps every row but the ones the rule names", () => {
    expect(
      noticeRuleFilter({ kinds: ["followup", "reminder"], urlPrefix: "/service", title: null }),
    ).toBe("kind.not.in.(followup,reminder),url.is.null,url.not.like./service%");
    expect(noticeRuleFilter({ kinds: ["ticket_watch"], urlPrefix: null, title: "Opened: %" })).toBe(
      'kind.not.in.(ticket_watch),title.is.null,title.not.like."Opened: %"',
    );
    expect(
      noticeRuleFilter({ kinds: ["x"], urlPrefix: URL_CATEGORIES[0]!.prefix, title: "A: %" }),
    ).toBe(
      'kind.not.in.(x),url.is.null,url.not.like./service%,title.is.null,title.not.like."A: %"',
    );
  });
});

/* ---- 4. the words on the Account page ------------------------------------------------------ */

describe("the words", () => {
  it("the button, and the line beside it", () => {
    expect(NOTICE_CHOICES_BUTTON).toBe("Choose which");
    expect(noticeChoicesLine("service", [])).toBe("All 15 on");
    expect(noticeChoicesLine("opportunities", [])).toBe("All 5 on");
    expect(noticeChoicesLine("bids", [])).toBe("All 4 on");
    expect(noticeChoicesLine("service", ["service_scheduled", "service_deleted"])).toBe(
      "2 of 15 off",
    );
    // Another switch's ticks, and keys nobody knows, are not counted here.
    expect(noticeChoicesLine("bids", ["service_scheduled", "bids_steps", "junk"])).toBe(
      "1 of 4 off",
    );
    expect(offCountOf("service", [...NOTICE_TYPE_KEYS])).toBe(15);
    expect(noticeChoicesLine("service", [...NOTICE_TYPE_KEYS])).toBe("15 of 15 off");
  });

  it("while the switch itself is off", () => {
    expect(noticeChoicesPausedLine("service")).toBe(
      "Service notices are off, so none of these are sent. Your ticks are kept for when you turn them back on.",
    );
    expect(noticeChoicesPausedLine("bids")).toContain("Bid notices are off");
  });

  it("when a tick cannot be saved", () => {
    expect(NOTICE_CHOICES_NOT_SAVED).toBe("Your choice was not saved. Please try again.");
    expect(NOTICE_CHOICES_NOT_READY).toBe(
      "Your choice could not be saved yet. Nothing was changed. Please try again later.",
    );
    // The page says one of the two, never a browser's or a server's own words.
    expect(noticeChoiceFailure(new Error(NOTICE_CHOICES_NOT_READY))).toBe(NOTICE_CHOICES_NOT_READY);
    expect(noticeChoiceFailure(new Error(NOTICE_CHOICES_NOT_SAVED))).toBe(NOTICE_CHOICES_NOT_SAVED);
    for (const e of [
      new TypeError("Failed to fetch"),
      new Error('new row violates row-level security policy for table "profiles"'),
      new Error(""),
      "Failed to fetch",
      null,
      undefined,
    ])
      expect(noticeChoiceFailure(e)).toBe(NOTICE_CHOICES_NOT_SAVED);
  });

  it("every line is plain: a name and one short sentence, no dashes, no arrows, no jargon", () => {
    const lines = [
      NOTICE_CHOICES_BUTTON,
      NOTICE_CHOICES_NOT_SAVED,
      NOTICE_CHOICES_NOT_READY,
      ...NOTICE_CATEGORIES.map(noticeChoicesPausedLine),
      ...NOTICE_TYPES.flatMap((t) => [t.label, t.help]),
    ];
    for (const s of lines) {
      expect(s, s).not.toMatch(/[—–→←⇒>]|->|\boffice\b|database|migration|kind\b/i);
      expect(s.length, s).toBeLessThanOrEqual(110);
    }
    for (const t of NOTICE_TYPES) {
      expect(t.label.length, t.label).toBeLessThanOrEqual(24);
      expect(t.help, t.help).toMatch(/^[A-Z].*\.$/);
    }
  });
});

/* ---- 5. the migration ---------------------------------------------------------------------- */

const MIGRATION = "supabase/migrations/20261124700000_notice_fine_choices.sql";
const OCT13 = "supabase/migrations/20261013170000_notice_categories.sql";

describe(`migration ${MIGRATION}`, () => {
  const sql = flatSql(MIGRATION);
  const fnFrom = (src: string, head: string) =>
    src.slice(src.indexOf(head), src.indexOf("$$;", src.indexOf(head)) + 3);

  it("adds one column, empty for everyone: only what is turned off is kept", () => {
    expect(sql).toContain(
      "alter table public.profiles add column if not exists notify_off text[] not null default '{}';",
    );
    expect(sql.match(/alter table/g)).toHaveLength(1);
    expect(sql).toMatch(/comment on column public\.profiles\.notify_off is 'Owner, Nov 24/);
    // No row is changed.
    expect(sql).not.toMatch(/\binsert into\b|\bdelete from\b/i);
    expect(sql.match(/\bupdate\b/g)).toHaveLength(1);
  });

  it("the database's own list of keys is the site's, in the same order", () => {
    const fn = fnFrom(sql, "create or replace function public.notice_fine_keys()");
    expect(fn).toMatch(
      /^create or replace function public\.notice_fine_keys\(\) returns text\[\] language sql stable set search_path = public as \$\$ select array\[/,
    );
    const keys = [...fn.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual(NOTICE_TYPE_KEYS);
    expect(sql).toContain(
      "revoke all on function public.notice_fine_keys() from public, anon, authenticated;",
    );
  });

  it("set_my_notify_off: the caller's own row, that one column, known keys only", () => {
    const fn = fnFrom(sql, "create or replace function public.set_my_notify_off(p_off text[])");
    expect(fn).toMatch(
      /^create or replace function public\.set_my_notify_off\(p_off text\[\]\) returns text\[\] language plpgsql security definer set search_path = public as \$\$/,
    );
    expect(fn).toContain(
      "if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;",
    );
    expect(fn).toContain("if p_off is null then raise exception");
    // Junk is refused before anything is written.
    expect(fn).toContain(
      "if exists ( select 1 from unnest(p_off) as k where k is null or not (k = any (public.notice_fine_keys())) ) then raise exception 'not a notice type' using errcode = '22023'; end if;",
    );
    expect(fn.indexOf("raise exception 'not a notice type'")).toBeLessThan(fn.indexOf("update "));
    expect(fn).toContain(
      "select coalesce(array_agg(distinct k order by k), '{}'::text[]) into v_clean from unnest(p_off) as k;",
    );
    expect(fn).toContain(
      "update public.profiles as p set notify_off = v_clean where p.id = auth.uid() returning p.notify_off into v_saved;",
    );
    expect(fn.match(/\bupdate\b/g)).toHaveLength(1);
    // Nothing else of the row can be changed through it.
    expect(fn.match(/\bset \w+ =/g)).toEqual(["set search_path =", "set notify_off ="]);
    expect(fn).not.toMatch(
      /\b(role|access|technician|email|notify_(email|push|leads|service))\s*=/,
    );
    expect(fn).toContain("if not found then raise exception 'Your profile was not found'");
    expect(fn).toContain("return v_saved;");
    expect(sql).toContain(
      "revoke all on function public.set_my_notify_off(text[]) from public, anon;",
    );
    expect(sql).toContain(
      "grant execute on function public.set_my_notify_off(text[]) to authenticated;",
    );
  });

  it("notify_recipients is the Oct 13 definition with the one column added, same rule, same grants", () => {
    const head = "create function public.notify_recipients(ids uuid[])";
    const before = fnFrom(flatSql(OCT13), head);
    const now = fnFrom(sql, head);
    expect(before).toContain("notify_storms boolean)");
    expect(now).toBe(
      before
        .replace("notify_storms boolean)", "notify_storms boolean, notify_off text[])")
        .replace("p.notify_storms from", "p.notify_storms, p.notify_off from"),
    );
    expect(now).toContain(
      "where p.id = any(ids) and (auth.role() = 'service_role' or auth.uid() is not null);",
    );
    expect(sql.indexOf("drop function if exists public.notify_recipients(uuid[]);")).toBeLessThan(
      sql.indexOf(head),
    );
    expect(sql).toContain("revoke all on function public.notify_recipients(uuid[]) from public;");
    expect(sql).toContain("revoke all on function public.notify_recipients(uuid[]) from anon;");
    expect(sql).toContain(
      "grant execute on function public.notify_recipients(uuid[]) to authenticated, service_role;",
    );
  });

  it("Oct 13 is still the most recent file before this one that defines notify_recipients", () => {
    const files = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) =>
        /create (or replace )?function public\.notify_recipients\(/.test(
          read(`supabase/migrations/${f}`),
        ),
      );
    expect(files.slice(-2)).toEqual([
      "20261013170000_notice_categories.sql",
      "20261124700000_notice_fine_choices.sql",
    ]);
  });

  it("touches nothing else: no policy, no table or column dropped, one function dropped", () => {
    expect(sql).not.toMatch(/\bcreate policy\b|\bdrop policy\b|\bdrop table\b|\bdrop column\b/i);
    expect(sql).not.toContain("set_my_notify_prefs");
    expect(sql).not.toContain("set_my_notify_own");
    expect(sql.match(/\bdrop function\b/g)).toHaveLength(1);
    expect(sql.match(/create or replace function/g)).toHaveLength(2);
    expect(sql.match(/create function/g)).toHaveLength(1);
  });
});
