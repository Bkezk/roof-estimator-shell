/**
 * Which notices, one by one (owner, Nov 24: "can you also add an ability to select which
 * notifications they want on more granularly like under ticket notifications you can choose to
 * be notified at open and closed but not scheduled?", then "Option A on notifications plz").
 *
 * Under each of the three switches that cover several notices (Service, Opportunity and Bid
 * notices; notice-categories.ts) there is a list of ticks on My account, one per notice type.
 * A tick turned off stops that one notice everywhere: the bell, the phone and email. Lead
 * notices and storm alerts are one notice each, so the switch is the whole choice.
 *
 * Only what is turned OFF is kept (profiles.notify_off, a list of the keys below; migration
 * 20261124700000_notice_fine_choices.sql). So nobody's notices changed the day this shipped, a
 * type added later is on for everyone, and a key this list no longer knows is ignored.
 *
 * The one rule is `takesNotice`: the switch is on AND the type is not in the person's off
 * list. The sender (notify.server.ts) asks it for each person; the inbox reads
 * (notifications.functions.ts) ask `noticeFilters` for the same rule as SQL. A switch that is
 * off still wins: nothing of its kind is sent, whatever the ticks say.
 *
 * What tells two notices apart is only what an inbox row holds: its kind, where its link opens
 * and, for the "each step" notices of a ticket, how its title starts (ticket-watch.ts writes
 * "Opened: Ticket #12 …", "Closed: Ticket #12 …"). Two notices a row cannot tell apart are
 * one tick. A notice of a switch that fits no type here follows the switch alone.
 *
 * Under no switch, so always sent, as before: tasks, mentions and the Account page's test.
 * (Until Nov 24 a request from the public pages and the Roof Care plan notices were too: the
 * owner put them under the Opportunity and Service switches, each with a tick of its own.)
 *
 * Nov 26 (the audit of Nov 25, number 26): a Roof Care plan's money alarms are under no switch
 * and no tick either (`PLAN_MONEY_ALARM_KIND`, `ALWAYS_SENT_KINDS` below), like the notices
 * about a limit. Until then they wore the kind of the ordinary "paid by card" notice, so a
 * manager who unticked "Roof Care plan" to stop the every-two-days "still not paid" reminder
 * stopped the alarms with it.
 *
 * Pure: it imports only notice-categories.ts. Shared by the sender, the inbox reads, the
 * Account page and the tests.
 */
import {
  NOTICE_CATEGORIES,
  NOTICE_CATEGORY_LABELS,
  noticeCategory,
  noticeExclusions,
  offCategories,
  wantsNotice,
  type NoticeCategory,
  type NoticeFlags,
} from "@/lib/notice-categories";

/** One way a notice shows it is of a type. Every part given must fit. */
export interface NoticeMatch {
  /** The row's kind is one of these. */
  kinds: readonly string[];
  /** For the kinds several kinds of work share: the link opens here (as SQL `like 'prefix%'`). */
  urlPrefix?: string;
  /** The title is like one of these (SQL LIKE where % is any run of letters; nothing else special). */
  titles?: readonly string[];
}

export interface NoticeType {
  /** What profiles.notify_off holds. Never reused for another meaning. */
  key: string;
  category: NoticeCategory;
  /** The tick's name. */
  label: string;
  /** One plain line under it. */
  help: string;
  match: readonly NoticeMatch[];
}

const SERVICE = "/service";
const OPPORTUNITIES = "/opportunities";
/** The "each step" notices of a ticket: one kind, the step is how the title starts. */
const step = (...titles: string[]): NoticeMatch => ({ kinds: ["ticket_watch"], titles });

/**
 * Every notice type, in the order the Account page lists them (the life of a ticket, then the
 * reminder lines). The kinds are the ones the modules hand notify(): ticket-events.server.ts,
 * ticket-watch.ts, roof-care-ticket-announce.ts, followups.server.ts, notify.server.ts,
 * work-steps.ts and bids-notify.server.ts.
 */
export const NOTICE_TYPES: readonly NoticeType[] = [
  // ---- Service notices: tickets ---------------------------------------------------------------
  {
    key: "service_opened",
    category: "service",
    label: "Opened",
    help: "A new ticket was opened.",
    match: [step("Opened: %", "% Roof Care plan inspection tickets opened")],
  },
  {
    key: "service_assigned_me",
    category: "service",
    label: "Assigned to me",
    help: "A ticket was given to you, or one of yours was reopened.",
    match: [{ kinds: ["assigned"], urlPrefix: SERVICE }],
  },
  {
    key: "service_reassigned",
    category: "service",
    label: "Reassigned",
    help: "A ticket was given to a technician, moved to another, or taken off one.",
    match: [{ kinds: ["reassigned"] }, step("Assigned: %", "Reassigned: %", "Unassigned: %")],
  },
  {
    key: "service_scheduled",
    category: "service",
    label: "Scheduled",
    help: "A ticket was put on the schedule.",
    match: [step("Scheduled: %")],
  },
  {
    key: "service_date_moved",
    category: "service",
    label: "Date moved",
    help: "A ticket's day was set or changed.",
    match: [{ kinds: ["date_moved"] }, step("Date set: %", "Date moved: %")],
  },
  {
    key: "service_reminders",
    category: "service",
    label: "Reminders",
    help: "A ticket's date is coming up or has passed, or a done ticket still waits to be authorized.",
    match: [{ kinds: ["followup", "reminder"], urlPrefix: SERVICE }],
  },
  {
    key: "service_not_started",
    category: "service",
    label: "Not started",
    help: "A ticket's date has passed and nobody has started it.",
    match: [{ kinds: ["untouched"], urlPrefix: SERVICE }],
  },
  {
    key: "service_nobody",
    category: "service",
    label: "Nobody on it",
    help: "A ticket has had no technician for some days.",
    match: [{ kinds: ["ticket_unassigned"] }],
  },
  {
    key: "service_done",
    category: "service",
    label: "Done",
    help: "A technician marked a ticket done. It is ready for review.",
    match: [{ kinds: ["ticket_done"] }],
  },
  {
    key: "service_authorized",
    category: "service",
    label: "Authorized",
    help: "An inspection was authorized. That completes it.",
    match: [step("Authorized: %")],
  },
  {
    key: "service_ready_to_invoice",
    category: "service",
    label: "Ready to invoice",
    help: "A ticket was authorized, or its invoice was voided, and it waits for an invoice.",
    match: [{ kinds: ["ticket_authorized", "ready_to_invoice"] }],
  },
  {
    key: "service_invoiced",
    category: "service",
    label: "Invoiced",
    help: "A ticket was moved to Invoiced.",
    match: [step("Invoiced: %")],
  },
  {
    key: "service_closed",
    category: "service",
    label: "Closed",
    help: "A ticket was closed.",
    match: [step("Closed: %")],
  },
  {
    key: "service_moved_back",
    category: "service",
    label: "Reopened or moved back",
    help: "A ticket went back to an earlier step.",
    match: [step("Reopened: %", "Back to %")],
  },
  {
    key: "service_deleted",
    category: "service",
    label: "Deleted",
    help: "A ticket was deleted.",
    match: [step("Deleted: %")],
  },
  // Nov 24, the owner's addition ("3 go").
  {
    key: "service_care_no_access",
    category: "service",
    label: "Roof Care: no access",
    help: "A technician could not get on the roof for a plan inspection.",
    match: [{ kinds: ["care_no_access"] }],
  },
  // ---- Opportunity notices --------------------------------------------------------------------
  {
    key: "opportunities_assigned_me",
    category: "opportunities",
    label: "Assigned to me",
    help: "An opportunity was given to you, or one of yours was reopened.",
    match: [{ kinds: ["assigned"], urlPrefix: OPPORTUNITIES }],
  },
  {
    key: "opportunities_follow_up",
    category: "opportunities",
    label: "Follow-up due",
    help: "An opportunity's follow-up date is coming up or has passed.",
    match: [{ kinds: ["followup", "reminder"], urlPrefix: OPPORTUNITIES }],
  },
  {
    key: "opportunities_not_started",
    category: "opportunities",
    label: "Not started",
    help: "An opportunity has a person on it and no contact has been logged.",
    match: [{ kinds: ["untouched"], urlPrefix: OPPORTUNITIES }],
  },
  {
    key: "opportunities_nobody",
    category: "opportunities",
    label: "Nobody on it",
    help: "An opportunity has had nobody on it for some days.",
    match: [{ kinds: ["opportunity_unassigned"] }],
  },
  {
    key: "opportunities_steps",
    category: "opportunities",
    label: "Each step",
    help: "An opportunity was given to someone, changed status or was deleted.",
    match: [{ kinds: ["opportunity_watch"] }],
  },
  // Nov 24, the owner's additions. Added at the end of the switch's list so the keys above
  // keep their order.
  {
    key: "opportunities_new",
    category: "opportunities",
    label: "New opportunity",
    help: "Someone opened a new opportunity.",
    match: [{ kinds: ["opportunity_new"] }],
  },
  {
    key: "opportunities_public_request",
    category: "opportunities",
    label: "New QR page request",
    help: "A customer sent the Roof Care or Request service form from a QR code.",
    match: [{ kinds: ["public_request"] }],
  },
  // Nov 26: money to send back, a failed bank payment and a payment that could not be recorded
  // left this tick. They are alarms now and always sent (PLAN_MONEY_ALARM_KIND).
  {
    key: "opportunities_care_plan",
    category: "opportunities",
    label: "Roof Care plan",
    help: "A plan is signed and not paid, was paid by card or from a bank account, or expired.",
    match: [{ kinds: ["plan_needs_payment", "plan_card_paid", "plan_expired"] }],
  },
  // ---- Bid notices ----------------------------------------------------------------------------
  {
    key: "bids_due_soon",
    category: "bids",
    label: "Due soon",
    help: "A bid is due soon.",
    match: [{ kinds: ["bid_due"] }],
  },
  {
    key: "bids_past_due",
    category: "bids",
    label: "Past due",
    help: "A bid is past its due date.",
    match: [{ kinds: ["bid_overdue"] }],
  },
  {
    key: "bids_my_reminders",
    category: "bids",
    label: "My reminders",
    help: "The Remind me on date you set on a bid.",
    match: [{ kinds: ["bid_reminder"] }],
  },
  {
    key: "bids_steps",
    category: "bids",
    label: "Each step",
    help: "A bid was started, changed status or was deleted. Trade bids too.",
    match: [{ kinds: ["bid_watch"] }],
  },
];

/**
 * A Roof Care plan's money alarms (Nov 26; the words are in roof-care-checkout.ts): card or bank
 * money that has to go back to a customer, a bank payment that failed, a payment the site could
 * not record or could not match to a plan, and a payment notice that was refused. Money is at
 * stake in each, so they sit under NO switch and NO tick: every admin and manager asked is
 * told, whatever they turned off on My account. The ordinary "paid" notice is not one of
 * these: it keeps its kind (plan_card_paid) and its tick.
 */
export const PLAN_MONEY_ALARM_KIND = "plan_money_alarm";

/**
 * The kinds that are sent whatever a person's switches and ticks say, by design and not by
 * oversight. None of them may be given a switch (notice-categories.ts) or a tick above: a test
 * says so.
 */
export const ALWAYS_SENT_KINDS: readonly string[] = [PLAN_MONEY_ALARM_KIND];

/** Every key, in list order: what the save accepts and what the database's own list holds. */
export const NOTICE_TYPE_KEYS: readonly string[] = NOTICE_TYPES.map((t) => t.key);
const BY_KEY: ReadonlyMap<string, NoticeType> = new Map(NOTICE_TYPES.map((t) => [t.key, t]));
export const isNoticeTypeKey = (key: unknown): key is string =>
  typeof key === "string" && BY_KEY.has(key);

/** The ticks under one switch, in list order (none for leads and storms: one notice each). */
export const typesOfCategory = (category: NoticeCategory): NoticeType[] =>
  NOTICE_TYPES.filter((t) => t.category === category);

/** The switches that have a list of ticks: more than one notice type under them. */
export const CATEGORIES_WITH_CHOICES: readonly NoticeCategory[] = NOTICE_CATEGORIES.filter(
  (c) => typesOfCategory(c).length > 1,
);

/** SQL LIKE, with % the only wildcard: the same answer the inbox reads get from the database. */
export function titleLike(title: string, pattern: string): boolean {
  const parts = pattern.split("%");
  if (parts.length === 1) return title === pattern;
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  if (!title.startsWith(first)) return false;
  let at = first.length;
  for (const mid of parts.slice(1, -1)) {
    const found = title.indexOf(mid, at);
    if (found < 0) return false;
    at = found + mid.length;
  }
  return title.length - at >= last.length && title.endsWith(last);
}

const fits = (
  m: NoticeMatch,
  kind: string,
  url: string | null | undefined,
  title: string | null | undefined,
): boolean => {
  if (!m.kinds.includes(kind)) return false;
  if (m.urlPrefix !== undefined && !(url ?? "").startsWith(m.urlPrefix)) return false;
  if (m.titles !== undefined) {
    if (typeof title !== "string") return false;
    return m.titles.some((p) => titleLike(title, p));
  }
  return true;
};

/**
 * The type a notice is, from what its inbox row holds; null when it fits none (it then follows
 * its switch alone, or nothing at all when no switch covers it).
 */
export function noticeType(
  kind: string | null | undefined,
  url: string | null | undefined,
  title: string | null | undefined,
): NoticeType | null {
  if (!kind) return null;
  return NOTICE_TYPES.find((t) => t.match.some((m) => fits(m, kind, url, title))) ?? null;
}

/** A person's choices as their profiles row (or notify_recipients row) carries them. */
export type NoticePrefs = NoticeFlags & { notify_off?: readonly unknown[] | null | undefined };

/**
 * The off list as kept, cleaned: the keys this file knows, each once, in list order. Anything
 * else (not a list, a key from a newer or an older version) turns nothing off.
 */
export function cleanNotifyOff(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const held = new Set(list.filter(isNoticeTypeKey));
  return NOTICE_TYPE_KEYS.filter((k) => held.has(k));
}

/**
 * THE rule, for the sender and the inbox alike: does someone with these choices get this
 * notice? Its switch must be on (a notice under no switch always goes), and its type must not
 * be in their off list (a notice that fits no type follows the switch alone).
 */
export function takesNotice(
  prefs: NoticePrefs,
  notice: { kind: string; url?: string | null | undefined; title?: string | null | undefined },
): boolean {
  const category = noticeCategory(notice.kind, notice.url ?? null);
  if (!wantsNotice(prefs, category)) return false;
  if (category === null) return true;
  const off = cleanNotifyOff(prefs.notify_off);
  if (!off.length) return true;
  // "Fits a type that is off", not "the first type it fits is off": exactly what the inbox
  // reads' SQL says, one rule per off type, so the two agree even on a title that fits two.
  return !NOTICE_TYPES.some(
    (t) =>
      off.includes(t.key) && t.match.some((m) => fits(m, notice.kind, notice.url, notice.title)),
  );
}

/** One "leave these rows out" rule for the inbox reads: every part given must fit a row. */
export interface NoticeRule {
  kinds: string[];
  urlPrefix: string | null;
  /** A LIKE pattern for the title, or null. */
  title: string | null;
}

/**
 * The same rule as SQL, for the inbox reads (the list is paged and the count is a head request,
 * so rows cannot be dropped after the read): `kinds` a row's kind must not be in, `urlPrefixes`
 * as noticeExclusions has them (a shared-kind row whose link opens there goes), and `rules`,
 * each naming rows to leave out by kind together with link or title. A type whose switch is
 * off adds nothing: the switch already leaves all of it out.
 */
export function noticeFilters(prefs: NoticePrefs): {
  kinds: string[];
  urlPrefixes: string[];
  rules: NoticeRule[];
} {
  const offSwitches = offCategories(prefs);
  const { kinds, urlPrefixes } = noticeExclusions(offSwitches);
  const rules: NoticeRule[] = [];
  for (const key of cleanNotifyOff(prefs.notify_off)) {
    const type = BY_KEY.get(key);
    if (!type || offSwitches.includes(type.category)) continue;
    for (const m of type.match) {
      if (m.urlPrefix === undefined && m.titles === undefined) {
        kinds.push(...m.kinds.filter((k) => !kinds.includes(k)));
        continue;
      }
      for (const title of m.titles ?? [null])
        rules.push({ kinds: [...m.kinds], urlPrefix: m.urlPrefix ?? null, title });
    }
  }
  return { kinds, urlPrefixes, rules };
}

/**
 * One rule as a PostgREST `or(…)`: "not this kind, or not this link, or not this title", which
 * keeps every row but the ones the rule names. A title is quoted, as PostgREST asks for a
 * value with a colon in it; a row with no link or no title never fits a rule, so it stays.
 */
export function noticeRuleFilter(rule: NoticeRule): string {
  const parts = [`kind.not.in.(${rule.kinds.join(",")})`];
  if (rule.urlPrefix !== null) parts.push("url.is.null", `url.not.like.${rule.urlPrefix}%`);
  if (rule.title !== null) parts.push("title.is.null", `title.not.like."${rule.title}"`);
  return parts.join(",");
}

// ---- The Account page ---------------------------------------------------------------------------

/** The button that opens a switch's list of ticks. */
export const NOTICE_CHOICES_BUTTON = "Choose which";

/** How many of a switch's ticks are off, in a person's off list. */
export const offCountOf = (category: NoticeCategory, off: readonly unknown[]): number => {
  const held = cleanNotifyOff(off);
  return typesOfCategory(category).filter((t) => held.includes(t.key)).length;
};

/** The line next to the button: "All 15 on", or "2 of 15 off". */
export function noticeChoicesLine(category: NoticeCategory, off: readonly unknown[]): string {
  const total = typesOfCategory(category).length;
  const n = offCountOf(category, off);
  return n === 0 ? `All ${total} on` : `${n} of ${total} off`;
}

/** Said in the open list while the switch itself is off: the ticks are kept, and greyed. */
export const noticeChoicesPausedLine = (category: NoticeCategory): string =>
  `${NOTICE_CATEGORY_LABELS[category]} are off, so none of these are sent. Your ticks are kept for when you turn them back on.`;

/** The off list after one tick was pressed: `on` true takes the key out, false puts it in. */
export function withNoticeChoice(off: readonly unknown[], key: string, on: boolean): string[] {
  const held = new Set(cleanNotifyOff(off));
  if (!isNoticeTypeKey(key)) return cleanNotifyOff([...held]);
  if (on) held.delete(key);
  else held.add(key);
  return cleanNotifyOff([...held]);
}

/** Said when a tick could not be saved; the tick goes back to what it was. */
export const NOTICE_CHOICES_NOT_SAVED = "Your choice was not saved. Please try again.";
/** Said when the database does not have the choices yet (the change is still being put in). */
export const NOTICE_CHOICES_NOT_READY =
  "Your choice could not be saved yet. Nothing was changed. Please try again later.";

/**
 * What the page says when a tick could not be saved: one of the two lines above, never a
 * browser's or a server's own words (a dropped connection reads "Failed to fetch").
 */
export const noticeChoiceFailure = (e: unknown): string =>
  e instanceof Error && e.message.includes(NOTICE_CHOICES_NOT_READY)
    ? NOTICE_CHOICES_NOT_READY
    : NOTICE_CHOICES_NOT_SAVED;
