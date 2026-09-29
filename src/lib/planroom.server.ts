/**
 * Planroom sign-in — SERVER ONLY. Owner, Sep 29: the state planroom and Lynn Imaging's planroom
 * (the same Lynn software) show a job's owner contact, architect, dates and plan-holder list
 * only after a free sign-in, and "we really need it to show relevant info on who to contact
 * to bid". With PLANROOM_EMAIL / PLANROOM_PASSWORD set in Lovable Cloud (a dedicated login
 * the owner registered on both sites), the nightly refresh signs in, reads each open roof
 * job's page, and writes what it finds into the lead's contact line and raw.details.
 *
 * The sites are ASP.NET WebForms: the login page carries __VIEWSTATE / __EVENTVALIDATION
 * tokens that must be posted back with the e-mail, password and the Log In button's name;
 * a good login answers 302 with the auth cookie. Node's fetch keeps no cookies, so a small
 * jar rides along. Nothing here is imported by browser code.
 */

export interface PlanroomSite {
  /** "https://www.stateofkyplanroom.com/View" or "https://www.lynnimaging.com/distribution/View" */
  base: string;
  label: string;
}
export const STATE_PLANROOM: PlanroomSite = {
  base: "https://www.stateofkyplanroom.com/View",
  label: "State planroom",
};
export const LYNN_PLANROOM: PlanroomSite = {
  base: "https://www.lynnimaging.com/distribution/View",
  label: "Lynn planroom",
};

const UA = "Mozilla/5.0 (compatible; JBK Portal construction leads)";

/** Enough of a cookie jar for one host: name=value pairs, latest wins. */
export class CookieJar {
  private cookies = new Map<string, string>();
  absorb(res: Response) {
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    const list = headers.getSetCookie
      ? headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""].filter(Boolean);
    for (const line of list) {
      const first = line.split(";")[0] ?? "";
      const eq = first.indexOf("=");
      if (eq > 0) this.cookies.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  has(name: string): boolean {
    return this.cookies.has(name);
  }
}

/** The hidden WebForms fields a post-back must echo. */
export function aspHiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    const value = /value="([^"]*)"/.exec(m[0])?.[1] ?? "";
    if (name) out[name] = value.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  }
  return out;
}

/** The login form's field names (found by suffix so a control-tree rename does not break it). */
export function loginFieldNames(html: string): {
  user: string;
  pass: string;
  button: string;
  action: string;
} | null {
  const names = [...html.matchAll(/<input[^>]*name="([^"]+)"/gi)].map((m) => m[1]!);
  const user = names.find((n) => /\$UserName$/.test(n));
  const pass = names.find((n) => /\$Password$/.test(n));
  const button = names.find((n) => /\$LoginButton$/.test(n));
  const action = /<form[^>]*action="([^"]+)"/i.exec(html)?.[1] ?? "";
  return user && pass && button ? { user, pass, button, action } : null;
}

export interface PlanroomSession {
  site: PlanroomSite;
  jar: CookieJar;
}

async function get(url: string, jar: CookieJar): Promise<Response> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Cookie: jar.header() },
    redirect: "manual",
  });
  jar.absorb(res);
  return res;
}

/** Follow up to five redirects by hand so every hop's cookies are kept. */
async function getFollow(url: string, jar: CookieJar): Promise<{ res: Response; url: string }> {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const res = await get(current, jar);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).href;
      continue;
    }
    return { res, url: current };
  }
  throw new Error("too many redirects");
}

/** Sign in; throws with the site's own words when the login is refused. */
export async function planroomSignIn(
  site: PlanroomSite,
  email: string,
  password: string,
): Promise<PlanroomSession> {
  const jar = new CookieJar();
  const loginUrl = `${site.base}/Login.aspx`;
  const { res: page, url: pageUrl } = await getFollow(loginUrl, jar);
  const html = await page.text();
  const fields = loginFieldNames(html);
  if (!fields) throw new Error(`${site.label}: login form not found (page layout changed?)`);
  const body = new URLSearchParams({
    ...aspHiddenFields(html),
    [fields.user]: email,
    [fields.pass]: password,
    [fields.button]: "Log In",
  });
  const res = await fetch(new URL(fields.action || loginUrl, pageUrl).href, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Cookie: jar.header(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    redirect: "manual",
  });
  jar.absorb(res);
  if (res.status >= 300 && res.status < 400) return { site, jar };
  const text = decodeText(await res.text());
  const why =
    /login attempt was not successful[^.]*\.?|invalid[^.]{0,80}\.?|incorrect[^.]{0,80}\.?/i.exec(
      text,
    )?.[0] ?? `HTTP ${res.status}`;
  throw new Error(`${site.label}: sign-in refused — ${why.trim()}`);
}

const decodeText = (s: string) =>
  s
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

export interface JobDetails {
  /** Every "Label: value" pair the page shows, label lower-cased. */
  fields: Record<string, string>;
  emails: string[];
  phones: string[];
  /** Company names from a plan-holder table when the page (or its plan-holder view) has one. */
  planHolders: string[];
  /** The page as text, for the note and for the next parser fix. */
  text: string;
}

const LABELS =
  /^(owner|owner contact|contact|contact name|contact person|architect|engineer|architect\/engineer|a\/e|design professional|bid date|bid due|bids due|pre-?bid|pre-?bid date|pre-?bid meeting|estimate|estimated cost|construction cost|project cost|location|project location|description|scope|phone|email|e-mail|fax|address|city|county|state|job type|project type|status|bid time|plans available|plans from|deposit|refundable)$/i;

/** Read "Label: value" lines and the table rows shaped that way. */
export function parseJobDetails(html: string): JobDetails {
  const text = decodeText(html);
  const fields: Record<string, string> = {};
  // Table cells: <td>Label:</td><td>Value</td>
  for (const m of html.matchAll(
    /<t[dh][^>]*>\s*([^<:]{2,40}):?\s*<\/t[dh]>\s*<td[^>]*>([\s\S]*?)<\/td>/gi,
  )) {
    const label = decodeText(m[1]!).replace(/:$/, "").trim().toLowerCase();
    const value = decodeText(m[2]!);
    if (LABELS.test(label) && value && !fields[label]) fields[label] = value.slice(0, 400);
  }
  // Plain "Label: value" lines.
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z][A-Za-z /-]{1,40}):\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const label = m[1]!.trim().toLowerCase();
    if (LABELS.test(label) && !fields[label]) fields[label] = m[2]!.trim().slice(0, 400);
  }
  const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? [])].filter(
    (e) => !/lynnimaging\.com$/i.test(e),
  );
  const phones = [...new Set(text.match(/\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/g) ?? [])];
  // Plan holders: a table whose heading says so; company = first cell of each row.
  const planHolders: string[] = [];
  const ph = /plan\s*holders?[\s\S]{0,400}?<table[\s\S]*?<\/table>/i.exec(html);
  if (ph) {
    for (const row of ph[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const cell = /<td[^>]*>([\s\S]*?)<\/td>/i.exec(row);
      const name = cell ? decodeText(cell[1]!) : "";
      if (name && !/^(company|name|plan ?holder)/i.test(name)) planHolders.push(name.slice(0, 80));
    }
  }
  return { fields, emails, phones, planHolders, text: text.slice(0, 4000) };
}

/** One line for the card: owner / architect / contact, e-mail, phone, then the plan holders. */
export function contactLine(d: JobDetails): string | null {
  const f = d.fields;
  const parts: string[] = [];
  const who = f["owner contact"] ?? f["contact"] ?? f["contact name"] ?? f["contact person"];
  if (f["owner"]) parts.push(`Owner ${f["owner"]}`);
  if (who && who !== f["owner"]) parts.push(who);
  const ae =
    f["architect"] ??
    f["engineer"] ??
    f["architect/engineer"] ??
    f["a/e"] ??
    f["design professional"];
  if (ae) parts.push(`A/E ${ae}`);
  if (d.emails[0]) parts.push(d.emails[0]);
  if (f["phone"]) parts.push(f["phone"]);
  else if (d.phones[0]) parts.push(d.phones[0]);
  if (d.planHolders.length) {
    const shown = d.planHolders.slice(0, 4).join(", ");
    parts.push(
      `Plan holders: ${shown}${d.planHolders.length > 4 ? ` (+${d.planHolders.length - 4})` : ""}`,
    );
  }
  return parts.length ? parts.join(" — ") : null;
}

/** Fetch a job page (and its plan-holder view when linked) with the signed-in session. */
export async function fetchJobDetails(
  session: PlanroomSession,
  jobId: string,
): Promise<JobDetails> {
  const url = `${session.site.base}/ViewJob.aspx?job_id=${jobId}`;
  const { res, url: finalUrl } = await getFollow(url, session.jar);
  if (/Login\.aspx/i.test(finalUrl)) throw new Error(`${session.site.label}: session expired`);
  let html = await res.text();
  // A "Plan Holders" link on the page: pull that view too and append it.
  const link = /<a[^>]*href="([^"]*(?:PlanHolder|view=ph)[^"]*)"[^>]*>/i.exec(html);
  if (link) {
    try {
      const { res: r2 } = await getFollow(
        new URL(link[1]!.replace(/&amp;/g, "&"), finalUrl).href,
        session.jar,
      );
      html += `\n<!-- plan holders -->\n<p>Plan Holders</p>\n${await r2.text()}`;
    } catch {
      /* the main page is still worth parsing */
    }
  }
  return parseJobDetails(html);
}

export const planroomCredentials = (): { email: string; password: string } | null => {
  const email = process.env["PLANROOM_EMAIL"]?.trim();
  const password = process.env["PLANROOM_PASSWORD"];
  return email && password ? { email, password } : null;
};
