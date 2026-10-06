/**
 * Nightly read of the city bid lists that only render in a browser (src/lib/leads-browser.ts
 * has the background): Metro Nashville's and the City of Chattanooga's Oracle Cloud procurement
 * portals (Tennessee leads, round three) and Louisville Metro's Bonfire portal (Kentucky, Sep
 * 29). All are public read-only lists; this never signs in or registers anywhere.
 *
 * Louisville (Bonfire): open the list once and keep the JSON the page itself asks its server
 * for (the open-opportunities list: reference, name, close date in UTC, department); nothing
 * else is requested. The per-row opportunity pages sit behind a Cloudflare robot check and are
 * never opened (the lead links them). The table the page draws must state its Eastern zone.
 *
 * Oracle, for each portal: open the list once, scroll the table until no more rows load (the page
 * fetches about 20 at a time), keep each solicitation's current round and drop the closed
 * ones, open the Details abstract once per open row (buyer, full title, attachments, and in
 * Chattanooga the synopsis and pre-bid meeting), then POST the rows to the app:
 *   POST ${APP_URL}/api/cron/leads-import   Authorization: Bearer ${CRON_SECRET}
 *   { ok: true, source, portalTimeZone, fetchedAt, rows: [...] }        (one POST per portal)
 * A portal that fails (or runs past its 90 s budget) posts nothing, so the app marks nothing
 * gone; the script then exits non-zero so the GitHub run turns red.
 *
 *   npx vite-node scripts/browser-bids.ts             read all three and post (needs APP_URL, CRON_SECRET)
 *   npx vite-node scripts/browser-bids.ts --dry-run   read all three and print the rows; posts nothing
 *   … --source louisville_bids  (or --portal …)        one portal only
 *
 * Env: APP_URL, CRON_SECRET; for local runs CHROMIUM_PATH (a Chromium binary) and PW_ARGS
 * (extra browser flags, e.g. "--ignore-certificate-errors --no-sandbox" behind a proxy).
 */
import { isRetiredLeadSource } from "../src/lib/leads-retired";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import {
  BONFIRE_ASSET_HOST,
  BONFIRE_OPEN_PATH,
  BROWSER_PORTALS,
  BROWSER_SOURCES,
  bonfireRows,
  browserImportSchema,
  currentRounds,
  type BrowserPortal,
  type BrowserSource,
  type PortalRow,
} from "../src/lib/leads-browser";

/** Whole-portal budget: list, scrolling and abstracts. */
const PORTAL_BUDGET_MS = 90_000;
/** The list must be read to its end by then (else the portal fails: a short list would mark rows gone). */
const LIST_BUDGET_MS = 65_000;
/** Pause between two requests the script causes (a scroll page, an abstract). */
const PAUSE_MS = 800;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyIdx = Math.max(args.indexOf("--source"), args.indexOf("--portal"));
const only = onlyIdx >= 0 ? (args[onlyIdx + 1] ?? "") : undefined;
if (only !== undefined && !(BROWSER_SOURCES as readonly string[]).includes(only)) {
  console.error(`--source (or --portal) must be one of ${BROWSER_SOURCES.join(", ")}`);
  process.exit(2);
}
const appUrl = (process.env["APP_URL"] ?? "").trim().replace(/\/+$/, "");
const secret = (process.env["CRON_SECRET"] ?? "").trim();
if (!dryRun && (!appUrl || !secret)) {
  console.error("APP_URL and CRON_SECRET are required (or pass --dry-run)");
  process.exit(2);
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const secs = (t0: number) => `${((Date.now() - t0) / 1000).toFixed(1)} s`;

interface ListRow {
  /** The table's row key: the Details link's id is built from it. */
  key: string;
  number: string;
  title: string;
  type: string | null;
  status: string;
  postingDate: string | null;
  openDate: string | null;
  closeDate: string | null;
  detailsLinkId: string | null;
}

/**
 * The rows the table holds now. Columns are found by their header labels, so a reordered
 * table still reads; a missing essential column throws (the layout changed).
 */
async function readTable(
  page: Page,
): Promise<{ rows: ListRow[]; domRows: number; empty: boolean; text: string }> {
  return page.evaluate(() => {
    const scroller = [...document.querySelectorAll('[id$="::scroller"]')].find((s) =>
      document.getElementById(s.id.replace(/::scroller$/, "::db"))?.querySelector("tr[_afrrk]"),
    );
    const anyDb = [...document.querySelectorAll('[id$="::db"]')].find((d) =>
      d.querySelector('table[summary="Search Results"]'),
    );
    const prefix = scroller
      ? scroller.id.replace(/::scroller$/, "")
      : anyDb
        ? anyDb.id.replace(/::db$/, "")
        : null;
    if (!prefix) throw new Error("no results table on the page (layout changed?)");
    const db = document.getElementById(`${prefix}::db`)!;
    const head = document.getElementById(`${prefix}::ch::t`);
    // The header's real cells carry _d_index (the column's position in the data rows); the
    // first header row is only there to size the columns.
    const labels: string[] = [];
    for (const th of head ? head.querySelectorAll("th[_d_index]") : [])
      labels[Number(th.getAttribute("_d_index"))] = (
        th.querySelector(".af_column_label-text")?.textContent ?? ""
      ).trim();
    const col = (re: RegExp) => labels.findIndex((l) => re.test(l));
    const idx = {
      number: col(/^(Negotiation|Solicitation)$/i),
      title: col(/^Title$/i),
      type: col(/Type$/i),
      status: col(/^Status$/i),
      posting: col(/^Posting Date$/i),
      open: col(/^Open Date$/i),
      close: col(/^Close Date$/i),
    };
    if (idx.number < 0 || idx.title < 0 || idx.status < 0 || idx.close < 0)
      throw new Error(`table columns not recognised: ${labels.join(" | ") || "(no header)"}`);
    const trs = [...db.querySelectorAll("tr[_afrrk]")];
    const rows = trs.map((tr) => {
      const cells = [...(tr as HTMLTableRowElement).cells].map((c) =>
        (c as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
      );
      const cell = (i: number) => (i >= 0 ? cells[i] || null : null);
      const link = tr.querySelector('a[id$=":commandLink1"]') ?? tr.querySelector("a[id]");
      return {
        key: tr.getAttribute("_afrrk") ?? "",
        number: cell(idx.number) ?? "",
        title: cell(idx.title) ?? "",
        type: cell(idx.type),
        status: cell(idx.status) ?? "",
        postingDate: cell(idx.posting),
        openDate: cell(idx.open),
        closeDate: cell(idx.close),
        detailsLinkId: link?.id ?? null,
      };
    });
    const text = db.innerText.replace(/\s+/g, " ").trim();
    const empty = !trs.length && /No data to display|No results found|No rows/i.test(text);
    return { rows, domRows: trs.length, empty, text: trs.length ? "" : text };
  });
}

/** The table has rows below what is loaded or shown (its scroller is not at the bottom). */
async function canScroll(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[id$="::scroller"]')].some(
      (s) =>
        s.scrollHeight > s.clientHeight + 4 && s.scrollTop + s.clientHeight < s.scrollHeight - 4,
    ),
  );
}

/**
 * Ask the page for open solicitations only — its own Status filter set to Active, the default
 * "posted in the last year" date cleared — so the list is a handful of rows instead of 200-500
 * fetched twenty at a time (three small requests instead of twenty). Best effort: when the
 * filter does not take, the whole list is read and the round rule sorts it out.
 */
async function filterActive(page: Page): Promise<boolean> {
  try {
    const ids = await page.evaluate(() => {
      const sel = [...document.querySelectorAll("select")].find((s) => {
        const opts = [...s.options].map((o) => o.text.trim());
        return opts.includes("Active") && opts.includes("Closed");
      });
      const posted = document.querySelector('input[aria-label*="Posted on or After" i]');
      const search = [...document.querySelectorAll('button[id$="::search"]')].find(
        (b) => (b.textContent ?? "").trim() === "Search",
      );
      const show = [...document.querySelectorAll("button")].find((b) =>
        /^Show Filters$/i.test((b.textContent ?? "").trim()),
      );
      return {
        status: sel?.id ?? null,
        posted: posted?.id ?? null,
        search: search?.id ?? null,
        show: show?.id ?? null,
      };
    });
    if (!ids.status || !ids.search) throw new Error("no Status filter on the page");
    const status = page.locator(`[id="${ids.status}"]`);
    if (!(await status.isVisible()) && ids.show) {
      await page.locator(`[id="${ids.show}"]`).click({ timeout: 8000 });
      await status.waitFor({ state: "visible", timeout: 15000 });
    }
    await status.selectOption({ label: "Active" }, { timeout: 8000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 });
    if (ids.posted) await page.locator(`[id="${ids.posted}"]`).fill("", { timeout: 5000 });
    await pause(PAUSE_MS);
    await page.locator(`[id="${ids.search}"]`).click({ timeout: 8000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 });
    await pause(1500);
    return true;
  } catch (e) {
    console.log(
      `  the Active filter did not take (${e instanceof Error ? e.message : e}); reading the whole list`,
    );
    return false;
  }
}

/** Scroll the table's own scroller to the bottom; true when more rows arrived. */
async function loadMore(page: Page, before: number, ms: number): Promise<boolean> {
  await page.evaluate(() => {
    for (const s of document.querySelectorAll('[id$="::scroller"]')) s.scrollTop = s.scrollHeight;
  });
  try {
    await page.waitForFunction((n) => document.querySelectorAll("tr[_afrrk]").length > n, before, {
      timeout: ms,
      polling: 250,
    });
    return true;
  } catch {
    return false;
  }
}

interface Abstract {
  title: string | null;
  fields: Record<string, string>;
  attachments: string[];
}

/** Open one row's Details dialog, read it, close it. Null when it did not open in time. */
async function readAbstract(page: Page, linkId: string, number: string): Promise<Abstract | null> {
  await page.locator(`[id="${linkId}"]`).click({ timeout: 10000 });
  const titleHandle = await page
    .waitForFunction(
      (n) =>
        [...document.querySelectorAll('[id$="::_ttxt"]')].find(
          (e) =>
            (e as HTMLElement).offsetParent !== null &&
            /Abstract/i.test(e.textContent ?? "") &&
            (e.textContent ?? "").includes(n),
        ) ?? null,
      number,
      { timeout: 20000, polling: 250 },
    )
    .catch(() => null);
  if (!titleHandle) return null;
  const read = await page.evaluate((n) => {
    const t = [...document.querySelectorAll('[id$="::_ttxt"]')].find(
      (e) =>
        (e as HTMLElement).offsetParent !== null &&
        /Abstract/i.test(e.textContent ?? "") &&
        (e.textContent ?? "").includes(n),
    )!;
    const dialogId = t.id.replace(/::_ttxt$/, "");
    const box: ParentNode = document.getElementById(dialogId) ?? document;
    const fields: Record<string, string> = {};
    for (const lab of box.querySelectorAll("label")) {
      const name = (lab.textContent ?? "").replace(/\s+/g, " ").trim();
      const td = lab.closest("td");
      const tr = lab.closest("tr") as HTMLTableRowElement | null;
      if (!name || !td || !tr || name in fields) continue;
      const cells = [...tr.cells];
      const valueCell = cells[cells.indexOf(td as HTMLTableCellElement) + 1];
      if (!valueCell) continue;
      const input = valueCell.querySelector("textarea, input:not([type=hidden])") as
        HTMLTextAreaElement | HTMLInputElement | null;
      const value = (input ? input.value : valueCell.innerText).replace(/\s+/g, " ").trim();
      fields[name] = value;
    }
    const attachments = [
      ...box.querySelectorAll('[title="Attachment List"] [data-afrrk][title]'),
    ].map((e) => e.getAttribute("title") ?? "");
    return { dialogId, fields, attachments: attachments.filter(Boolean) };
  }, number);
  // Close it (the OK button, else the title bar's close) and wait until it is gone.
  const ok = page.locator(`[id="${read.dialogId}::ok"]`);
  const close = page.locator(`[id="${read.dialogId}::close"]`);
  if (await ok.count()) await ok.click({ timeout: 5000 }).catch(() => undefined);
  else if (await close.count()) await close.click({ timeout: 5000 }).catch(() => undefined);
  await page
    .waitForFunction(
      (id) => {
        const t = document.getElementById(`${id}::_ttxt`);
        return !t || (t as HTMLElement).offsetParent === null;
      },
      read.dialogId,
      { timeout: 8000, polling: 250 },
    )
    .catch(() => undefined);
  // "Name.pdf(739.12 KB) Other name.pdf(83.54 KB)": the file names (the list items' own
  // titles are sometimes a category, "IT Environment").
  const listed = [
    ...(read.fields["Attachments"] ?? "").matchAll(/\s*(.+?)\s*\(([\d.,]+\s*[KMGT]?B)\)/gi),
  ].map((m) => m[1]!.trim());
  return {
    title: read.fields["Title"] || null,
    fields: read.fields,
    attachments: listed.length ? listed : read.attachments,
  };
}

const field = (a: Abstract | null, re: RegExp): string | null => {
  if (!a) return null;
  const k = Object.keys(a.fields).find((x) => re.test(x));
  return k ? a.fields[k] || null : null;
};

/** One Oracle portal, start to finish, inside its budget. Throws on anything that is not a full read. */
async function readOracle(
  context: BrowserContext,
  portal: BrowserPortal,
  t0: number,
): Promise<{ rows: PortalRow[]; listed: number; requests: number; scrolls: number }> {
  const host = new URL(portal.url).host;
  let requests = 0;
  const page = await context.newPage();
  // Only the portal itself: the page's third-party helpers (Oracle's guided-learning player)
  // are not needed to read the list.
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.protocol.startsWith("http") && u.host !== host) return route.abort();
    return route.continue();
  });
  page.on("request", (r) => {
    const type = r.resourceType();
    if (type === "document" || type === "xhr" || type === "fetch") requests++;
  });
  await page.goto(portal.url, { waitUntil: "networkidle", timeout: 45000 });
  await pause(3000);
  const body = await page.evaluate(() => document.body.innerText);
  if (/Sign In/i.test(body) && !/Abstracts/i.test(body))
    throw new Error("the page asks for a sign-in instead of showing the list (not attempted)");
  if (!portal.timeZoneText.test(body))
    throw new Error(
      `the page does not state ${portal.timeZoneText.source} (dates would be read in the wrong zone)`,
    );

  let filtered = await filterActive(page);

  // Scroll until the row count stops growing (with the filter on, one screen holds it all).
  const listed = new Map<string, ListRow>();
  let scrolls = 0;
  let domMax = 0;
  for (;;) {
    const t = await readTable(page);
    domMax = Math.max(domMax, t.domRows);
    for (const r of t.rows) if (r.number && !listed.has(r.number)) listed.set(r.number, r);
    if (t.empty) break;
    if (!t.domRows)
      throw new Error(
        `the table shows no rows and no empty-list message: "${t.text.slice(0, 200)}"`,
      );
    if (Date.now() - t0 > LIST_BUDGET_MS)
      throw new Error(
        `list not read to its end in ${LIST_BUDGET_MS / 1000} s (${listed.size} rows so far)`,
      );
    if (!(await canScroll(page))) break;
    scrolls++;
    let more = await loadMore(page, t.domRows, 6000);
    // One more try before calling it the end (a slow answer is not the end of the list).
    if (!more) more = await loadMore(page, t.domRows, 4000);
    if (!more) break;
    await pause(PAUSE_MS);
  }
  const rows = [...listed.values()];
  // Rows on screen but none read: the cells moved, and posting nothing-open would mark every
  // lead of this source gone.
  if (!rows.length && domMax > 0)
    throw new Error("rows on the page but none read (layout changed?)");
  if (rows.some((r) => !r.status || !r.title))
    throw new Error("rows without a status or title (layout changed?)");
  // The filter took only when every row it left is Active; otherwise the list is the whole
  // year's and the round rule below picks the open ones (either way the result is the same).
  if (filtered && rows.some((r) => !/^Active$/i.test(r.status))) filtered = false;
  const open = currentRounds(rows);
  console.log(
    `${portal.label}: ${rows.length} rows listed (${filtered ? "Active filter" : "whole list"}, ${scrolls} scrolls, ${secs(t0)}), ${open.length} open after the round rule`,
  );

  // One abstract per open row, while the budget lasts (a row without it keeps the list's cells).
  const out: PortalRow[] = [];
  for (const r of open) {
    let a: Abstract | null = null;
    if (r.detailsLinkId && Date.now() - t0 < PORTAL_BUDGET_MS - 12000) {
      try {
        a = await readAbstract(page, r.detailsLinkId, r.number);
      } catch (e) {
        console.log(`  ${r.number}: abstract not read (${e instanceof Error ? e.message : e})`);
      }
      await pause(PAUSE_MS);
    }
    // The list cuts titles at 80 characters; the abstract has the whole one.
    const listTitle = r.title.replace(/\s+/g, " ").trim();
    const fullTitle = a?.title && a.title.startsWith(listTitle.slice(0, 40)) ? a.title : null;
    const description =
      [field(a, /^Synopsis$/i), field(a, /^Amendment Description$/i), field(a, /^Description$/i)]
        .filter(Boolean)
        .join(" — ") || null;
    const details = a
      ? Object.fromEntries(
          Object.entries(a.fields)
            .filter(([k, v]) => k.length <= 100 && v)
            .slice(0, 40)
            .map(([k, v]) => [k, v.slice(0, 2000)]),
        )
      : null;
    out.push({
      number: r.number,
      title: (fullTitle ?? listTitle).slice(0, 500),
      type: r.type,
      status: r.status,
      postingDate: r.postingDate,
      openDate: r.openDate,
      closeDate: r.closeDate,
      description: description ? description.slice(0, 4000) : null,
      buyer: field(a, /^Buyer$/i)?.slice(0, 120) ?? null,
      email: field(a, /^E-?mail$/i)?.slice(0, 200) ?? null,
      prebid: field(a, /^Pre-?Bid Date/i)?.slice(0, 40) ?? null,
      attachments: (a?.attachments ?? []).slice(0, 60).map((x) => x.slice(0, 300)),
      details,
      detailsRead: !!a,
    });
  }
  await page.close();
  return { rows: out, listed: rows.length, requests, scrolls };
}

/**
 * One Bonfire portal: load the list page once and keep the open-opportunities JSON the page
 * fetches for itself. Throws (nothing is posted) when that answer does not come, is not the
 * list, or the page does not show the portal's time zone next to its dates.
 */
async function readBonfire(
  context: BrowserContext,
  portal: BrowserPortal,
  t0: number,
): Promise<{ rows: PortalRow[]; listed: number; requests: number; scrolls: number }> {
  const host = new URL(portal.url).host;
  let requests = 0;
  const page = await context.newPage();
  // Only the portal and Bonfire's own script/style host: analytics, video and the robot-check
  // host are not needed (a list behind a robot check fails here instead of being solved), nor
  // are images and fonts.
  await page.route("**/*", (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.protocol.startsWith("http") && u.host !== host && u.host !== BONFIRE_ASSET_HOST)
      return route.abort();
    if (["image", "font", "media"].includes(req.resourceType())) return route.abort();
    return route.continue();
  });
  page.on("request", (r) => {
    const type = r.resourceType();
    if (type === "document" || type === "xhr" || type === "fetch") requests++;
  });
  const answer = page.waitForResponse(
    (r) => {
      const u = new URL(r.url());
      return u.host === host && u.pathname === BONFIRE_OPEN_PATH;
    },
    { timeout: 45000 },
  );
  // A failed load leaves `answer` waiting: settle it quietly, the goto error is the report.
  answer.catch(() => undefined);
  await page.goto(portal.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const res = await answer.catch(() => null);
  const body0 = await page.evaluate(() => document.body.innerText).catch(() => "");
  if (/Performing security verification|verify you are (not a bot|human)/i.test(body0))
    throw new Error("the list page shows a robot check (not attempted)");
  if (!res) throw new Error(`the page never asked for its open list (${BONFIRE_OPEN_PATH})`);
  if (!res.ok()) throw new Error(`the open list answered ${res.status()}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error("the open list is not JSON (API changed?)");
  }
  const rows = bonfireRows(json, portal);
  // The table the page draws from it: wait for it, check the zone its dates are shown in, and
  // that it shows the same references (a warning only: the JSON is what is posted).
  let shown = "";
  try {
    await page.waitForFunction(
      (n) =>
        n === 0
          ? /Close Date/i.test(document.body.innerText)
          : /View Opportunity/i.test(document.body.innerText),
      rows.length,
      { timeout: 15000, polling: 250 },
    );
    shown = await page.evaluate(() => document.body.innerText);
  } catch {
    throw new Error("the list table never appeared (layout changed?)");
  }
  if (/Log ?In/i.test(shown) && !/Open Public Opportunities/i.test(shown))
    throw new Error("the page asks for a sign-in instead of showing the list (not attempted)");
  if (rows.length && !portal.timeZoneText.test(shown))
    throw new Error(
      `the table does not show its dates in ${portal.timeZoneText.source} (dates would be read in the wrong zone)`,
    );
  const missing = rows.filter((r) => !shown.includes(r.number)).map((r) => r.number);
  if (missing.length)
    console.log(`  warning: in the JSON but not in the table: ${missing.slice(0, 10).join(", ")}`);
  console.log(`${portal.label}: ${rows.length} open in the list (${secs(t0)})`);
  await pause(PAUSE_MS);
  await page.close();
  return { rows, listed: rows.length, requests, scrolls: 0 };
}

/** One portal, start to finish, inside its budget. Throws on anything that is not a full read. */
function readPortal(context: BrowserContext, portal: BrowserPortal, t0: number) {
  return portal.kind === "bonfire"
    ? readBonfire(context, portal, t0)
    : readOracle(context, portal, t0);
}

async function withBudget<T>(
  ms: number,
  work: Promise<T>,
  onTimeout: () => Promise<void>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void onTimeout();
      reject(new Error(`over the ${ms / 1000} s budget`));
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function post(payload: unknown): Promise<string> {
  const res = await fetch(`${appUrl}/api/cron/leads-import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`the app answered ${res.status}: ${text.slice(0, 500)}`);
  return text;
}

async function main() {
  // Retired portals (Metro Nashville, Louisville Metro — owner, Oct 6) are not read.
  const portals = BROWSER_SOURCES.filter(
    (s) => !isRetiredLeadSource(s) && (!only || s === only),
  ).map((s: BrowserSource) => BROWSER_PORTALS[s]);
  const browser: Browser = await chromium.launch({
    ...(process.env["CHROMIUM_PATH"] ? { executablePath: process.env["CHROMIUM_PATH"] } : {}),
    args: (process.env["PW_ARGS"] ?? "").split(/\s+/).filter(Boolean),
  });
  const failures: string[] = [];
  try {
    for (const portal of portals) {
      const t0 = Date.now();
      const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
      try {
        const r = await withBudget(PORTAL_BUDGET_MS, readPortal(context, portal, t0), () =>
          context.close().catch(() => undefined),
        );
        const payload = browserImportSchema.parse({
          ok: true,
          source: portal.source,
          portalTimeZone: portal.timeZone,
          fetchedAt: new Date().toISOString(),
          rows: r.rows,
        });
        const read = r.rows.filter((x) => x.detailsRead).length;
        console.log(
          `${portal.label}: ${r.rows.length} open, ${portal.kind === "oracle" ? `${read} abstracts read, ` : ""}${r.requests} page requests, ${secs(t0)}`,
        );
        if (dryRun) console.log(JSON.stringify(payload, null, 2));
        else console.log(`${portal.label}: posted → ${await post(payload)}`);
      } catch (e) {
        const msg = `${portal.label}: ${e instanceof Error ? e.message : String(e)} — nothing posted`;
        // A GitHub annotation, so the failure shows on the run's summary page.
        console.error(`::error::${msg}`);
        failures.push(msg);
      } finally {
        await context.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(
      `${failures.length} of ${portals.length} portals failed:\n${failures.join("\n")}`,
    );
    process.exit(1);
  }
}

await main();
