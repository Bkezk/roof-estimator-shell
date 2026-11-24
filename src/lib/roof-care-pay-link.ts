/**
 * A Roof Care customer's own card payment link (owner, Nov 23: "1. A go"). A customer who signs
 * up away from us, through the QR page, has nobody holding a screen out to them. So each plan
 * has a link of its own: the office signs the plan, the customer gets the link by email (in the
 * agreement, or sent again from the plan), opens it on their phone, and pays by card. The
 * payment starts the plan exactly as it does today.
 *
 * The link is the site's address, /pay/, and a long random token that belongs to one plan. The
 * page it opens shows that plan's name, property and the amount, and one button. It never asks
 * for a sign-in and never shows anything else of the customer.
 *
 * Pure: no database, no server. roof-care-pay-link.functions.ts reads and sends.
 */

/** Where the public payment pages live: the token follows. */
export const PUBLIC_PAY_PREFIX = "/pay/";

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A token as it is kept, or null for anything that is not one. */
export function cleanPayToken(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return TOKEN.test(t) ? t : null;
}

/** The token in a path that is exactly /pay/<token> (a slash at the end is allowed). */
export function payTokenFromPath(pathname: string): string | null {
  if (!pathname.startsWith(PUBLIC_PAY_PREFIX)) return null;
  return cleanPayToken(pathname.slice(PUBLIC_PAY_PREFIX.length).replace(/\/+$/, ""));
}

/**
 * Is this a payment link's page? Only then may it open without a sign-in.
 *
 * Nov 24 (the public pages audit): any address of the shape /pay/<one piece>, whether or not
 * the piece is a whole token. A customer whose link lost a letter on the way (a wrapped line in
 * an email, a bad paste) used to land on the office's sign-in screen. They now get the payment
 * page, which says the link is not active and gives the office's number. Nothing more is opened
 * by this: the page shows a plan only for a token that is one plan's own.
 */
export function isPublicPayPath(pathname: string): boolean {
  if (!pathname.startsWith(PUBLIC_PAY_PREFIX)) return false;
  const rest = pathname.slice(PUBLIC_PAY_PREFIX.length).replace(/\/+$/, "");
  return rest.length > 0 && !rest.includes("/");
}

/** The link a customer is sent. */
export const payLinkFor = (base: string, token: string): string =>
  `${base.replace(/\/+$/, "")}${PUBLIC_PAY_PREFIX}${token}`;

/**
 * What the page shows: the button ("pay"), thanks ("paid"), card payment not available on this
 * site just now ("offline"), or a link that opens nothing any more ("closed").
 */
export type PayPageState = "pay" | "paid" | "offline" | "closed";

export function payPageState(
  status: string | null | undefined,
  owedCents: number | null,
  ready: boolean,
): PayPageState {
  if (status === "active") return "paid";
  if (status !== "awaiting_payment") return "closed";
  // Nothing is owed although the plan has not started: the office is sorting it out.
  if (owedCents == null) return "closed";
  return ready ? "pay" : "offline";
}

/** What the public page is told. Nothing of the customer beyond their own plan. */
export interface PublicPayFacts {
  state: PayPageState;
  /** "Roof Guard". Empty for a closed link. */
  plan_name: string;
  /** "RC-1004", or "". */
  plan_label: string;
  /** The property's name, or "". */
  site: string;
  /** Dollars owed for the year; null unless there is something to pay. */
  amount: number | null;
  /** The last day of the plan year, once it is paid. */
  runs_until: string | null;
  /** True on the local test server only: made-up facts, and nothing can be paid. */
  sample?: boolean;
}

export const PAY_PAGE_TITLE = "Pay for your Roof Care plan";
export const PAY_PAGE_LEAD =
  "One payment for the year, by card, on our secure payment page. Your plan starts the day we receive it.";
export const PAY_BUTTON = "Pay by card";
export const PAY_CLOSED =
  "This payment link is not active. Your plan may already be paid, or the link may be an old one. Please call us and we will sort it out.";
export const PAY_OFFLINE =
  "Paying by card online is not available right now. Please call us and we will take your payment by phone.";
export const PAY_THANKS_TITLE = "Thank you. We have your payment.";
export const PAY_JUST_PAID =
  "Thank you. Your payment is being confirmed. This page will say so in a moment, and your receipt is on its way by email.";
export const PAY_SAMPLE_START = "Test server: this is a sample page, and nothing can be paid here.";

/** Under the thanks: when the plan year runs to. `day` words a date. */
export const payThanksWords = (runsUntil: string | null, day: (ymd: string) => string): string =>
  runsUntil
    ? `Your plan has started and runs until ${day(runsUntil)}. Your receipt is on its way by email. We will be in touch to set the day of each inspection.`
    : "Your plan has started. Your receipt is on its way by email. We will be in touch to set the day of each inspection.";

// ── The office's side ────────────────────────────────────────────────────────────────────────

export const PAY_LINK_BUTTON = "Card payment link";
export const PAY_LINK_COPY = "Copy the link";
export const PAY_LINK_COPIED = "Link copied. Paste it into a text or an email to the customer.";
export const PAY_LINK_NOTE =
  "The customer opens this link on their own phone or computer and pays by card. The payment starts the plan. It works only while this plan waits for its payment.";
export const PAY_LINK_NO_EMAIL =
  "This plan has no email address for the customer. Add one under the plan, or copy the link and send it yourself.";

/** What the office's box is told about one plan's link. */
export interface PlanPayLink {
  /** The link, or null with `reason` when there is none to give. */
  url: string | null;
  reason: string | null;
  /** The customer's email on the plan, or null. */
  to: string | null;
  /** When the link was last emailed by the site, or null. */
  sent_at: string | null;
  /** Why the site cannot email it just now (email not set up, no address), or null. */
  email_reason: string | null;
}

/** "Emailed to pat@example.com on Monday, November 23, 2026." or "". */
export function payLinkSentWords(
  l: Pick<PlanPayLink, "to" | "sent_at">,
  day: (ymd: string) => string,
): string {
  if (!l.sent_at) return "";
  return `Emailed${l.to ? ` to ${l.to}` : ""} on ${day(l.sent_at.slice(0, 10))}.`;
}

/**
 * What the sign-up says when a plan signed from a public request pays by card: the customer is
 * not at the screen, so no card page is opened here.
 */
export const SIGNED_PAY_BY_LINK =
  "The customer has not been sent a payment link. Check the roof size, then send it from Card payment link on the plan. The plan starts when the payment is received.";

/** In the office's box, while the link has never been emailed (owner, Nov 24). */
export const PAY_LINK_NOT_SENT =
  "Not emailed to the customer yet. The agreement does not hold this link: send it when the roof size is right.";
