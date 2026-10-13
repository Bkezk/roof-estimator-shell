/**
 * The invoice share link (owner, Oct 13: "On CenterPoint you can create a shareable link for the
 * invoice, can we have that as well?"). A final / sent / paid invoice can carry one token
 * (invoices.share_token, migration 20261013140000); `${origin}/i/<token>` serves its stored PDF
 * in the browser with no login (src/routes/i.$token.ts). The office makes the link from the
 * invoice, copies it, sees whether it was viewed, and turns it off (invoices.functions.ts
 * createInvoiceShareLink / revokeInvoiceShareLink); Send puts the link in the email.
 *
 * Pure: the token shape, the URL, which statuses may be shared, the wording. Tested in
 * invoice-share.test.ts. Nothing here touches the database or the window.
 */

/** Random bytes in a token; as base64url that is 43 characters. */
export const SHARE_TOKEN_BYTES = 32;
/** The public path; the token follows it: /i/<token>. */
export const SHARE_PATH = "/i";
/** Statuses whose invoice may be shared: frozen, with a stored PDF. A draft or a void is not. */
export const SHAREABLE_STATUSES = ["final", "sent", "paid"] as const;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Does `v` look like a token this app made: base64url of 32 bytes, 43 characters, nothing else. */
export function isShareToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN.test(v);
}

/** The link the customer opens: `${origin}/i/<token>` (a trailing slash on the origin is dropped). */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}${SHARE_PATH}/${token}`;
}

/** The base for a link built on the server: APP_URL without its trailing slash, or null when unset. */
export function shareBase(appUrl: string | null | undefined): string | null {
  const base = (appUrl ?? "").trim().replace(/\/+$/, "");
  return base ? base : null;
}

/** May an invoice at `status` have a share link? final / sent / paid yes; draft / void no. */
export function canShareInvoice(status: string | null | undefined): boolean {
  return (SHAREABLE_STATUSES as readonly string[]).includes(status ?? "");
}

/** Why an invoice at `status` cannot be shared, or null when it can (plain words for a toast). */
export function shareProblem(status: string | null | undefined): string | null {
  if (canShareInvoice(status)) return null;
  if (status === "draft") return "A draft has no share link; finalise the invoice first";
  if (status === "void") return "A void invoice has no share link";
  return "This invoice cannot be shared";
}

const dayOf = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });

/**
 * The views line beside the link: "Not viewed yet" / "Viewed once, Oct 13" / "Viewed 3 times,
 * last Oct 14". `timeZone` is for tests; the screen uses the browser's.
 */
export function shareViewsText(
  views: number | null | undefined,
  lastViewedAt: string | null | undefined,
  opts: { timeZone?: string } = {},
): string {
  const n = Math.max(0, Math.floor(Number(views ?? 0) || 0));
  if (n === 0) return "Not viewed yet";
  const when = lastViewedAt ? dayOf(lastViewedAt, opts.timeZone) : "";
  if (n === 1) return when ? `Viewed once, ${when}` : "Viewed once";
  return when ? `Viewed ${n} times, last ${when}` : `Viewed ${n} times`;
}

/** The sentence appended to the invoice email when the link exists. */
export function shareLinkLine(url: string): string {
  return `View or download this invoice online: ${url}`;
}

/** What the share link's view state looks like on the wire (the server fns return it). */
export interface InvoiceShareState {
  token: string | null;
  share_created_at: string | null;
  share_views: number;
  share_last_viewed_at: string | null;
}

/** The share state of an invoice row (an older row without the columns reads as no link). */
export function shareStateOf(inv: {
  share_token?: string | null;
  share_created_at?: string | null;
  share_views?: number | null;
  share_last_viewed_at?: string | null;
}): InvoiceShareState {
  return {
    token: inv.share_token ?? null,
    share_created_at: inv.share_created_at ?? null,
    share_views: Number(inv.share_views ?? 0) || 0,
    share_last_viewed_at: inv.share_last_viewed_at ?? null,
  };
}

/** What a visitor reads when the link is not live (unknown, turned off, or the invoice is void). */
export const SHARE_GONE_TEXT = "This invoice link is no longer active. Please contact the office.";

/** The small plain 404 page for a link that is not live. */
export function shareGonePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Invoice link</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f7f9;color:#1f2937}main{max-width:28rem;padding:2rem;text-align:center}p{font-size:1.05rem;line-height:1.5}</style>
</head>
<body><main><p>${SHARE_GONE_TEXT}</p></main></body>
</html>
`;
}

/** The outcomes the public route logs, one line per request. */
export type ShareLogOutcome =
  "served" | "malformed token" | "no active link" | "method not allowed" | "failed";

/**
 * The route's one log line: the invoice number (when known) and the outcome — never the token,
 * which would make the server log a list of open invoices.
 */
export function shareLogLine(outcome: ShareLogOutcome, label?: string | null, detail?: string) {
  const who = label ? `invoice #${label}` : "no invoice";
  return `Invoice share link: ${who} — ${outcome}${detail ? ` (${detail})` : ""}`;
}
