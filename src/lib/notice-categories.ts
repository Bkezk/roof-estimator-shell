/**
 * Notice categories (owner, Oct 13): "on notifications on the account, be able to toggle if
 * they see lead notices, opportunity notices, service notices, and bid notices on their
 * notifications bell, so that people who don't deal with those things don't see them."
 *
 * Five per-person switches on the Account page, one profiles column each (notify_leads stays
 * the Oct 12 opt-in, off by default; storm alerts are opt-in too — "storms should also be a
 * toggle as well and defaulted to off", owner, Oct 13; opportunities, service and bids default
 * on; migration 20261013170000_notice_categories.sql). A notice's category comes from its kind, and for the
 * kinds several modules share (assigned / followup / reminder / untouched) from where its link
 * opens: /service is a service notice, /opportunities an opportunity notice, /estimate a bid
 * notice. Tasks, mentions, the Account page's test and anything unplaced have no category and
 * are always shown. Pure: no imports, shared by the sender (notify.server.ts), the inbox reads
 * (notifications.functions.ts), the Account page and the tests.
 */

export const NOTICE_CATEGORIES = ["leads", "opportunities", "service", "bids", "storms"] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

/** The switch labels, in NOTICE_CATEGORIES order on the Account page. */
export const NOTICE_CATEGORY_LABELS: Readonly<Record<NoticeCategory, string>> = {
  leads: "Lead notices",
  opportunities: "Opportunity notices",
  service: "Service notices",
  bids: "Bid notices",
  storms: "Storm alerts",
};

/** One line under each switch. */
export const NOTICE_CATEGORY_HELP: Readonly<Record<NoticeCategory, string>> = {
  leads: "New leads from the bid boards. Off unless you work them.",
  opportunities: "Follow-ups, untouched and assignment notices on opportunities.",
  service: "Ticket assignments, date moves, done and ready-to-invoice notices.",
  bids: "Bid due, past due and your own bid reminders.",
  storms: "Storm reports for roofs in your counties. Off unless you work them.",
};

/** The profiles column that holds each switch. */
export const NOTICE_CATEGORY_COLUMNS = {
  leads: "notify_leads",
  opportunities: "notify_opportunities",
  service: "notify_service",
  bids: "notify_bids",
  storms: "notify_storms",
} as const satisfies Record<NoticeCategory, string>;
export type NoticeFlagColumn = (typeof NOTICE_CATEGORY_COLUMNS)[NoticeCategory];
/** The five flags as a profiles row (or notify_recipients row) carries them; absent = unknown. */
export type NoticeFlags = Partial<Record<NoticeFlagColumn, boolean | null>>;

/**
 * Kinds that belong to one category whatever their link. The kind strings are the ones the
 * modules hand notify(): bids-notify.server.ts (bid_due / bid_overdue / bid_reminder),
 * leads.server.ts (lead) with the older lead kinds bid / rfp, storms.server.ts (storm: its own
 * "Storm alerts" switch, off by default, not a lead notice), ticket-events.server.ts
 * (ticket_done / ticket_authorized / reassigned / date_moved) and the office's ready_to_invoice.
 */
export const KIND_CATEGORIES: Readonly<Record<string, NoticeCategory>> = {
  bid_due: "bids",
  bid_overdue: "bids",
  bid_reminder: "bids",
  lead: "leads",
  bid: "leads",
  rfp: "leads",
  storm: "storms",
  ticket_done: "service",
  ticket_authorized: "service",
  ready_to_invoice: "service",
  reassigned: "service",
  date_moved: "service",
};

/**
 * Kinds the follow-up machinery sends about tickets, opportunities and bids alike
 * (followups.server.ts "assigned", notify.server.ts "followup" / "reminder" / "untouched"):
 * their category is where the link opens.
 */
export const SHARED_KINDS = ["assigned", "followup", "reminder", "untouched"] as const;

/** Link prefix → category for the shared kinds (a prefix match, as SQL `like 'prefix%'`). */
export const URL_CATEGORIES: readonly { prefix: string; category: NoticeCategory }[] = [
  { prefix: "/service", category: "service" },
  { prefix: "/opportunities", category: "opportunities" },
  { prefix: "/estimate", category: "bids" },
];

const isSharedKind = (kind: string): boolean => (SHARED_KINDS as readonly string[]).includes(kind);

/**
 * Which switch governs a notice: by kind first, then (for the shared kinds) by its link; null
 * when no switch does, so it is always delivered and always shown.
 */
export function noticeCategory(
  kind: string | null | undefined,
  url: string | null | undefined,
): NoticeCategory | null {
  if (!kind) return null;
  const byKind = KIND_CATEGORIES[kind];
  if (byKind) return byKind;
  if (!isSharedKind(kind) || !url) return null;
  return URL_CATEGORIES.find((u) => url.startsWith(u.prefix))?.category ?? null;
}

/** The kind-only kinds of a category (the shared kinds are placed by their link, not here). */
export const kindsOfCategory = (category: NoticeCategory): string[] =>
  Object.keys(KIND_CATEGORIES).filter((k) => KIND_CATEGORIES[k] === category);

/** The link prefix that puts a shared kind in this category, or null (leads and storms have none). */
export const urlPrefixOfCategory = (category: NoticeCategory): string | null =>
  URL_CATEGORIES.find((u) => u.category === category)?.prefix ?? null;

/**
 * Whether someone with these flags takes a notice of this category: no category, or the flag
 * anything but false (a missing flag — a row read before the migration is applied — is on).
 */
export const wantsNotice = (flags: NoticeFlags, category: NoticeCategory | null): boolean =>
  category === null || flags[NOTICE_CATEGORY_COLUMNS[category]] !== false;

/** The categories these flags have turned off (false only; null / missing is on). */
export const offCategories = (flags: NoticeFlags): NoticeCategory[] =>
  NOTICE_CATEGORIES.filter((c) => flags[NOTICE_CATEGORY_COLUMNS[c]] === false);

/**
 * What the inbox reads leave out for someone with these categories off, as two SQL-shaped
 * rules: `kinds` the row's kind must not be in, and `urlPrefixes` a shared-kind row's url must
 * not start with (a shared-kind row with no url, or another url, stays).
 */
export function noticeExclusions(off: readonly NoticeCategory[]): {
  kinds: string[];
  urlPrefixes: string[];
} {
  const kinds: string[] = [];
  const urlPrefixes: string[] = [];
  for (const c of off) {
    kinds.push(...kindsOfCategory(c));
    const prefix = urlPrefixOfCategory(c);
    if (prefix) urlPrefixes.push(prefix);
  }
  return { kinds, urlPrefixes };
}
