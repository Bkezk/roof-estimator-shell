/**
 * Tennessee leads, round three (Sep 29): the two city bid lists that live in Oracle Cloud
 * procurement portals — Metro Nashville's and the City of Chattanooga's. Their pages are built
 * by scripts in the browser, so the app's plain server fetch gets an empty shell. A nightly
 * GitHub Actions job (.github/workflows/browser-bids.yml → scripts/browser-bids.ts) opens each
 * public list in a real headless browser, reads the rows, and posts them to the app
 * (/api/cron/leads-import), which saves them like every other source (leads.server.ts,
 * `importBrowserBids`). No login, no registration: every list here is a public read-only page.
 *
 * Kentucky (Sep 29): Louisville Metro's bids sit in a Bonfire portal, built by scripts the same
 * way, so it is the job's third portal (`louisville_bids`; see `bonfireRows` below).
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
 *
 * Louisville's Bonfire portal (Sep 29): the Open Public Opportunities tab asks its own server
 * for the list (GET /PublicPortal/getOpenPublicOpportunitiesSectionData → JSON: per project
 * ProjectID, ReferenceID "IFB270050", ProjectName, DateClose in UTC "2026-10-02 20:30:00",
 * DepartmentID, and a departments map) and draws a table from it (Status OPEN, Ref. #,
 * Project, Department, Close Date "Oct 2nd 2026, 4:30 PM EDT"). 12 open that day. Each row's
 * "View Opportunity" page (/opportunities/<ProjectID>) sits behind a Cloudflare robot check,
 * so it is linked but never read.
 */
import { z } from "zod";

export const BROWSER_SOURCES = ["nashville_bids", "chattanooga_bids", "louisville_bids"] as const;
export type BrowserSource = (typeof BROWSER_SOURCES)[number];

export interface BrowserPortal {
  source: BrowserSource;
  /** How the script reads the list: an Oracle ADF table, or a Bonfire portal's own JSON. */
  kind: "oracle" | "bonfire";
  /** In logs and the failure line: "Metro Nashville bids". */
  label: string;
  /**
   * The public list. Oracle has no per-row public page (the abstract opens in a dialog), so
   * those leads link here; a Bonfire row links its own opportunity page.
   */
  url: string;
  /** The zone the page states in its header ("Time Zone US Central Time"). */
  timeZone: "America/Chicago" | "America/New_York";
  /** How the header words it, checked by the script before a row is read. */
  timeZoneText: RegExp;
  zone: "CT" | "ET";
  agency: string;
  city: string;
  county: string;
  state: "TN" | "KY";
}

export const BROWSER_PORTALS: Record<BrowserSource, BrowserPortal> = {
  nashville_bids: {
    source: "nashville_bids",
    kind: "oracle",
    label: "Metro Nashville bids",
    url: "https://ibqhjb.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000006739049",
    timeZone: "America/Chicago",
    timeZoneText: /US Central Time/i,
    zone: "CT",
    agency: "Metro Nashville",
    city: "Nashville",
    county: "Davidson",
    state: "TN",
  },
  chattanooga_bids: {
    source: "chattanooga_bids",
    kind: "oracle",
    label: "Chattanooga city bids",
    url: "https://fa-eqto-saasfaprod1.fa.ocs.oraclecloud.com/fscmUI/faces/NegotiationAbstracts?prcBuId=300000003584083",
    timeZone: "America/New_York",
    timeZoneText: /US Eastern Time/i,
    zone: "ET",
    agency: "City of Chattanooga",
    city: "Chattanooga",
    county: "Hamilton",
    state: "TN",
  },
  louisville_bids: {
    source: "louisville_bids",
    kind: "bonfire",
    label: "Louisville Metro bids",
    url: "https://louisvilleky.bonfirehub.com/portal/?tab=openOpportunities",
    timeZone: "America/New_York",
    // The table shows "Oct 2nd 2026, 4:30 PM EDT" (EST in winter).
    timeZoneText: /\b\d{1,2}:\d{2}\s*[AP]M\s+E[DS]T\b/,
    zone: "ET",
    agency: "Louisville Metro Government",
    city: "Louisville",
    county: "Jefferson",
    state: "KY",
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
  /**
   * The row's own public page on the portal (Bonfire's /opportunities/<id>), when it has one;
   * checked against the portal's host on arrival. Oracle rows have none.
   */
  url: text(300).nullable().optional(),
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
    // A row's link must be a page on that portal's own site (the card opens it).
    const host = new URL(BROWSER_PORTALS[p.source].url).host;
    p.rows.forEach((r, i) => {
      if (!r.url) return;
      let ok = false;
      try {
        const u = new URL(r.url);
        ok = u.protocol === "https:" && u.host === host;
      } catch {
        ok = false;
      }
      if (!ok)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rows", i, "url"],
          message: `not a page on ${host}`,
        });
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

/* ---- Bonfire (Louisville Metro) ------------------------------------------------------------ */

/** The request the Bonfire portal page makes for its Open Public Opportunities tab. */
export const BONFIRE_OPEN_PATH = "/PublicPortal/getOpenPublicOpportunitiesSectionData";
/** Where every Bonfire portal's own scripts and styles come from (the page is blank without). */
export const BONFIRE_ASSET_HOST = "assets.bonfirehub.com";

/** "2026-10-02 20:30:00" (UTC, as Bonfire sends it) → "10/2/2026 4:30 PM" on the portal's clock. */
export function bonfireCloseText(utc: string, timeZone: BrowserPortal["timeZone"]): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(utc.trim());
  if (!m) return null;
  const at = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, m[6] ? +m[6] : 0));
  if (Number.isNaN(at.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts["month"]}/${parts["day"]}/${parts["year"]} ${parts["hour"]}:${parts["minute"]} ${String(parts["dayPeriod"]).toUpperCase()}`;
}

interface BonfireProject {
  ProjectID?: unknown;
  ReferenceID?: unknown;
  ProjectName?: unknown;
  DateClose?: unknown;
  DepartmentID?: unknown;
  ProjectStatusID?: unknown;
}

const str = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v).trim() : "";

/**
 * The open-opportunities JSON a Bonfire portal page loads → the rows the script posts. Throws
 * when the answer is not that list (a changed API, an error page): nothing is posted then, so
 * nothing is marked gone. An empty `projects` ({} or []) with success is "nothing open".
 *
 * The close date is sent as the portal's wall clock ("10/2/2026 4:30 PM", Eastern for
 * Louisville), the way the Oracle rows are, and read back with parsePortalDate on arrival.
 * The type is the letters the reference starts with (IFB, RFP, RFQ, RFI, RFA): Bonfire's list
 * gives no type. The department goes into details (the card names it after the agency).
 */
export function bonfireRows(json: unknown, portal: BrowserPortal): PortalRow[] {
  const j = json as {
    success?: unknown;
    payload?: { projects?: unknown; departments?: unknown };
  } | null;
  if (!j || typeof j !== "object" || (j.success !== 1 && j.success !== true))
    throw new Error("the open-opportunities answer is not a success (API changed?)");
  const projects = j.payload?.projects;
  if (projects == null || typeof projects !== "object")
    throw new Error("the open-opportunities answer has no project list (API changed?)");
  const departments = (j.payload?.departments ?? {}) as Record<
    string,
    { DepartmentName?: unknown }
  >;
  const origin = new URL(portal.url).origin;
  const list = (Array.isArray(projects) ? projects : Object.values(projects)) as BonfireProject[];
  const rows = list.map((p): PortalRow => {
    const number = str(p.ReferenceID);
    const title = str(p.ProjectName).replace(/\s+/g, " ");
    const id = str(p.ProjectID);
    const close = str(p.DateClose);
    if (!number || !title)
      throw new Error("a project without a reference or a name (API changed?)");
    const closeDate = close ? bonfireCloseText(close, portal.timeZone) : null;
    if (close && !closeDate) throw new Error(`close date not understood: "${close.slice(0, 40)}"`);
    const dept = str(departments[str(p.DepartmentID)]?.DepartmentName);
    const details: Record<string, string> = {};
    if (dept) details["Department"] = dept.slice(0, 2000);
    if (close) details["Close Date (UTC)"] = close;
    if (id) details["Project ID"] = id;
    return {
      number: number.slice(0, 40),
      title: title.slice(0, 500),
      type: /^([A-Z]{2,4})(?=[-\s]?\d)/.exec(number)?.[1] ?? null,
      status: "Open",
      postingDate: null,
      openDate: null,
      closeDate,
      description: null,
      buyer: null,
      email: null,
      prebid: null,
      attachments: [],
      details: Object.keys(details).length ? details : null,
      detailsRead: false,
      url: /^\d+$/.test(id) ? `${origin}/opportunities/${id}` : null,
    };
  });
  return rows.sort((a, b) =>
    (a.details?.["Close Date (UTC)"] ?? "").localeCompare(b.details?.["Close Date (UTC)"] ?? ""),
  );
}
