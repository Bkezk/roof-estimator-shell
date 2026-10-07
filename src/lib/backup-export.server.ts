/**
 * GET /api/backup — what the office server's nightly backup script (scripts/backup/jbk-backup.ps1)
 * reads. Lovable Cloud does not hand out the project's service role key (Supabase: "Service role
 * and API keys are not accessible for Lovable Cloud–managed projects"), but this server already
 * holds it (SUPABASE_SERVICE_ROLE_KEY, the way the cron routes use it). Owner, Oct 7: "could we
 * not do the portal side backup door and i just set the password?" — so the script never sees
 * the key: it sends `Authorization: Bearer <BACKUP_SECRET>`, a password the owner makes up and
 * sets in Lovable Cloud › Secrets and in the script's config on the server, and this route reads
 * on its behalf.
 *
 * Four read-only questions, all GET (`what=`):
 *   tables                          every table the data API describes ({ name, hasId }) + schema
 *   buckets                         every storage bucket's name
 *   rows&table=&offset=&order=id    one page of up to 1,000 rows, Content-Range passed through
 *   files&bucket=&prefix=&offset=   one page of a storage folder listing
 *   file&bucket=&path=              one stored file, streamed
 *
 * It never writes: every upstream call is a GET, except the storage listing, whose endpoint is
 * a POST that only reads. BACKUP_SECRET is its own secret (not CRON_SECRET): the cron secret is
 * also in GitHub Actions, and a backup password reads every table. Every call is logged to the
 * server console with the caller's address, so a leaked password shows up in Lovable's logs.
 */

export const BACKUP_PAGE = 1000;
const NAME_RE = /^[a-z][a-z0-9_]{0,62}$/;

export interface BackupEnv {
  /** BACKUP_SECRET — the password the script sends. */
  secret?: string | undefined;
  /** SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, set by Lovable Cloud on this server. */
  url?: string | undefined;
  key?: string | undefined;
}

export const backupEnvFromProcess = (): BackupEnv => ({
  secret: process.env["BACKUP_SECRET"]?.trim() || undefined,
  url: process.env["SUPABASE_URL"],
  key: process.env["SUPABASE_SERVICE_ROLE_KEY"],
});

/** Shorter than this and the password is too easy to guess: refuse to serve at all. */
export const MIN_SECRET_LENGTH = 24;

/** null when the caller holds the backup password, else the response to send. */
export async function authorizeBackup(request: Request, secret?: string): Promise<Response | null> {
  if (!secret) {
    return Response.json(
      { ok: false, error: "BACKUP_SECRET is not set on this server (Lovable Cloud › Secrets)" },
      { status: 500 },
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return Response.json(
      {
        ok: false,
        error: `BACKUP_SECRET must be at least ${MIN_SECRET_LENGTH} characters; the backup is refused until it is`,
      },
      { status: 500 },
    );
  }
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1];
  if (token) {
    const { createHash, timingSafeEqual } = await import("node:crypto");
    const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
    if (timingSafeEqual(digest(token), digest(secret))) return null;
  }
  return new Response("Unauthorized", { status: 401 });
}

type Defs = Record<string, { properties?: Record<string, unknown> }>;

export function tableList(api: unknown): {
  tables: { name: string; hasId: boolean }[];
  schema: Defs;
} {
  const a = (api ?? {}) as { definitions?: Defs; components?: { schemas?: Defs } };
  const defs = a.definitions ?? a.components?.schemas ?? {};
  const tables = Object.keys(defs)
    .filter((n) => NAME_RE.test(n))
    .sort()
    .map((name) => ({ name, hasId: !!defs[name]?.properties?.["id"] }));
  return { tables, schema: defs };
}

const bad = (msg: string) => Response.json({ ok: false, error: msg }, { status: 400 });

function intParam(v: string | null, fallback: number): number | null {
  if (v === null || v === "") return fallback;
  if (!/^\d{1,9}$/.test(v)) return null;
  return Number(v);
}

export async function backupRequest(
  request: Request,
  env: BackupEnv = backupEnvFromProcess(),
  fetchImpl: typeof fetch = fetch,
  log: (line: string) => void = (line) => console.log(line),
): Promise<Response> {
  if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const denied = await authorizeBackup(request, env.secret);
  const q = new URL(request.url).searchParams;
  const what = q.get("what") ?? "";
  const who =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  log(
    `[backup] ${denied ? `refused ${denied.status}` : "ok"} ${who} what=${what} table=${q.get("table") ?? ""} bucket=${q.get("bucket") ?? ""}`,
  );
  if (denied) return denied;
  if (!env.url || !env.key) {
    return Response.json(
      { ok: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set on this server" },
      { status: 500 },
    );
  }
  const base = env.url.replace(/\/+$/, "");
  // The service key goes upstream only; the caller's bearer never does.
  const upstream = { apikey: env.key, Authorization: `Bearer ${env.key}` };

  if (what === "tables") {
    const res = await fetchImpl(`${base}/rest/v1/`, { method: "GET", headers: upstream });
    if (!res.ok) return passThrough(res, "The data API did not describe the tables");
    return Response.json(tableList(await res.json()));
  }

  if (what === "buckets") {
    // Every storage bucket, so a bucket added later is backed up without touching the config.
    const res = await fetchImpl(`${base}/storage/v1/bucket`, { method: "GET", headers: upstream });
    if (!res.ok) return passThrough(res, "Storage did not list the buckets");
    const list = (await res.json()) as { name?: unknown }[];
    const buckets = (Array.isArray(list) ? list : [])
      .map((b) => (typeof b.name === "string" ? b.name : ""))
      .filter((n) => NAME_RE.test(n))
      .sort();
    return Response.json({ buckets });
  }

  if (what === "rows") {
    const table = q.get("table") ?? "";
    if (!NAME_RE.test(table)) return bad("table must be a plain table name");
    const offset = intParam(q.get("offset"), 0);
    const limit = intParam(q.get("limit"), BACKUP_PAGE);
    if (offset === null || limit === null || limit < 1)
      return bad("offset and limit must be whole numbers");
    const order = q.get("order") === "id" ? "&order=id.asc" : "";
    const url = `${base}/rest/v1/${table}?select=*&limit=${Math.min(limit, BACKUP_PAGE)}&offset=${offset}${order}`;
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { ...upstream, Prefer: "count=exact" },
    });
    if (!res.ok) return passThrough(res, `The data API refused ${table}`);
    const headers = new Headers({ "content-type": "application/json" });
    const range = res.headers.get("content-range");
    if (range) headers.set("content-range", range);
    return new Response(await res.text(), { status: 200, headers });
  }

  if (what === "files") {
    const bucket = q.get("bucket") ?? "";
    if (!NAME_RE.test(bucket)) return bad("bucket must be a plain bucket name");
    const prefix = q.get("prefix") ?? "";
    const offset = intParam(q.get("offset"), 0);
    if (offset === null) return bad("offset must be a whole number");
    // The storage listing is the one POST: that endpoint only reads.
    const res = await fetchImpl(`${base}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...upstream, "content-type": "application/json" },
      body: JSON.stringify({
        prefix,
        limit: BACKUP_PAGE,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });
    if (!res.ok) return passThrough(res, `Storage did not list ${bucket}`);
    return new Response(await res.text(), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (what === "file") {
    const bucket = q.get("bucket") ?? "";
    const path = q.get("path") ?? "";
    if (!NAME_RE.test(bucket)) return bad("bucket must be a plain bucket name");
    if (!path || path.includes("..") || path.startsWith("/"))
      return bad("path must be a file path inside the bucket");
    const enc = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetchImpl(`${base}/storage/v1/object/${bucket}/${enc}`, {
      method: "GET",
      headers: upstream,
    });
    if (!res.ok) return passThrough(res, `Storage did not return ${bucket}/${path}`);
    const headers = new Headers();
    for (const h of ["content-type", "content-length", "etag", "last-modified"]) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(res.body, { status: 200, headers });
  }

  return bad("what must be tables, buckets, rows, files or file");
}

async function passThrough(res: Response, why: string): Promise<Response> {
  const text = await res.text().catch(() => "");
  return Response.json(
    { ok: false, error: `${why}: ${res.status} ${text.slice(0, 500)}`.trim() },
    { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
  );
}
