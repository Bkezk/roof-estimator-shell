/**
 * Tennessee leads, round three (Sep 29): the two city bid lists that live in Oracle Cloud
 * procurement portals — Metro Nashville's and the City of Chattanooga's. Their pages are built
 * by scripts in the browser, so the app's plain server fetch gets an empty shell. A nightly
 * GitHub Actions job (.github/workflows/browser-bids.yml → scripts/browser-bids.ts) opens each
 * public list in a real headless browser, reads the rows, and posts them to the app
 * (/api/cron/leads-import), which saves them like every other source (leads.server.ts,
 * `importBrowserBids`). No login, no registration: both lists are public read-only pages.
 *
 * This file is shared by the script, the route and the tests: the portals, the payload the
 * script sends (checked with zod on arrival), and the amendment rule. Pure: zod only.
 *
 * What the lists look like (checked from the sandbox with headless Chromium, Sep 29): an ADF
 * table with Negotiation (Nashville) / Solicitation (Chattanooga) number, Title (cut at 80
 * characters), Negotiation / Solicitation Type, Status (Active, Amended, Closed, Awarded,
 * Canceled), Posting Date, Open Date, Close Date and a Details icon that opens the abstract
 * (full title, buyer and e-mail, attachments; Chattanooga adds the synopsis and the pre-bid
 * meeting). The number carries the round after a comma ("GG000106,2", "200999,2"): every
 * amendment posts a new row and marks the one before it Amended, so the base number is the
 * solicitation and its highest round is the current state of it. The lists hold the last
 * year's postings (220 rows in Nashville, 9 open; about 500 in Chattanooga, 8 open).
 */
import { z } from "zod";

export const BROWSER_SOURCES = ["nashville_bids", "chattanooga_bids"] as const;
export type BrowserSource = (typeof BROWSER_SOURCES)[number];

export interface BrowserPortal {
  source: BrowserSource;
  /** In logs and the failure line: "Metro Nashville bids". */
  label: string;
  /** The public list (no per-row public page exists: the abstract opens in a dialog). */
  url: string;
  /** The zone the page states in its header ("Time Zone US Central Time"). */
  timeZone: "America/Chicago" | "America/New_York";
  /** How the header words it, checked by the script before a row is read. */
  timeZoneText: RegExp;
  zone: "CT" | "ET";
  agency: string;
  city: string;
  county: string;
}

export const BROWSER_PORTALS: Record<BrowserSource, BrowserPortal> = {
  nashville_bids: {
    source: "nashville_bids",
    label: "Metro Nashville bids",
    url: "https://ibqhjb.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000006739049",
    timeZone: "America/Chicago",
    timeZoneText: /US Central Time/i,
    zone: "CT",
    agency: "Metro Nashville",
    city: "Nashville",
    county: "Davidson",
  },
  chattanooga_bids: {
    source: "chattanooga_bids",
    label: "Chattanooga city bids",
    url: "https://fa-eqto-saasfaprod1.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000003584083",
    timeZone: "America/New_York",
    timeZoneText: /US Eastern Time/i,
    zone: "ET",
    agency: "City of Chattanooga",
    city: "Chattanooga",
    county: "Hamilton",
  },
};

const text = (max: number) => z.string().trim().max(max);

/** One row as the script read it: the list's cells as shown, plus the abstract when read. */
export const portalRowSchema = z.object({
  /** "GG000106,2" / "200999,2" / "200966-2": the number with its round. */
  number: text(40).min(1),
  /** The abstract's full title when it was read, else the list's (cut at 80). */
  title: text(500).min(1),
  /** "RFQ", "Construction Bid", "Invitation for Bid", "Request for Proposal", … */
  type: text(80).nullable(),
  /** "Active", "Amended", … */
  status: text(40),
  /** "9/28/26 11:58 AM" (Chattanooga) / "9/28/2026 3:24 PM" (Nashville), as shown. */
  postingDate: text(40).nullable(),
  openDate: text(40).nullable(),
  closeDate: text(40).nullable(),
  /** The abstract's synopsis and amendment description, when there are any. */
  description: text(4000).nullable(),
  buyer: text(120).nullable(),
  email: text(200).nullable(),
  /** The abstract's pre-bid date and time as shown (Chattanooga). */
  prebid: text(40).nullable(),
  /** The abstract's attachment file names. */
  attachments: z.array(text(300)).max(60),
  /** Every labelled field of the abstract, as shown (kept in raw). */
  details: z
    .record(text(100), text(2000))
    .nullable()
    .refine((d) => !d || Object.keys(d).length <= 40, "at most 40 detail fields"),
  /** The abstract was opened and read for this row. */
  detailsRead: z.boolean(),
});
export type PortalRow = z.infer<typeof portalRowSchema>;

/**
 * What the script posts, one portal at a time. `ok: true` is the script saying the list was
 * read to its end: an empty `rows` then means nothing is open (and that source's leads are
 * marked gone). A script that fails posts nothing.
 */
export const browserImportSchema = z
  .object({
    ok: z.literal(true),
    source: z.enum(BROWSER_SOURCES),
    portalTimeZone: text(60),
    fetchedAt: z.string().datetime(),
    rows: z.array(portalRowSchema).max(500),
  })
  .superRefine((p, ctx) => {
    const want = BROWSER_PORTALS[p.source].timeZone;
    if (p.portalTimeZone !== want)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["portalTimeZone"],
        message: `${p.source} is read in ${want}, not ${p.portalTimeZone}`,
      });
  });
export type BrowserImportPayload = z.infer<typeof browserImportSchema>;

/** "GG000106,2" → { base: "GG000106", round: 2 }; "GG000111" → round 0. */
export function negotiationRound(number: string): { base: string; round: number } {
  const m = /^(.*\S)\s*,\s*(\d+)$/.exec(number.trim());
  return m ? { base: m[1]!, round: Number(m[2]) } : { base: number.trim(), round: 0 };
}

/** A status that means the solicitation takes no more bids. */
export const isClosedStatus = (status: string) =>
  /^(closed|awarded|canceled|cancelled|completed)$/i.test(status.trim());

/**
 * The current round of each solicitation (the highest number after the comma), kept only
 * while it is open: a base whose latest round is Closed, Awarded or Canceled is dropped, and
 * the older Amended rounds of an open one are dropped with it.
 */
export function currentRounds<T extends { number: string; status: string }>(rows: T[]): T[] {
  const best = new Map<string, { row: T; round: number }>();
  for (const row of rows) {
    const { base, round } = negotiationRound(row.number);
    const cur = best.get(base);
    if (!cur || round > cur.round) best.set(base, { row, round });
  }
  return [...best.values()].map((x) => x.row).filter((r) => !isClosedStatus(r.status));
}
