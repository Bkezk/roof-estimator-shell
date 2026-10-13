/**
 * POST /api/restore — the office server's restore script (scripts/backup/jbk-restore.ps1) puts a
 * nightly backup back through here. Owner, Oct 13: "go ahead and build it … it needs to be as
 * robust and safe, and get all info where it needs to go accurately."
 *
 * The door opens to RESTORE_SECRET alone — its own password, never BACKUP_SECRET (a backup
 * password only reads; this one writes) — set by the owner in Lovable Cloud › Secrets and in the
 * script's config as RestoreSecret. Unset or wrong: 403 and nothing happens. The writing itself
 * is done by three SECURITY DEFINER functions the door calls with the service role
 * (supabase/migrations/20261013100000_restore_door.sql): restore_rows() maps each backup row onto
 * the live table (columns the table lost are ignored, new ones take their default), inserts
 * `on conflict do nothing` (skip) or `do update` (replace) with the table's user triggers off for
 * the transaction (no notices, audit rows, follow-up syncs or stamps are re-fired), and never
 * deletes; restore_finish() resets the sequences and re-enables anything left disabled.
 *
 * Every op but `identify` must name the project (`project`, identify's own label: the company
 * name and the Supabase project ref) or it is refused 412, so a backup can never be poured into
 * the wrong project by a mistyped address. Every call is logged with counts only, never a row.
 *
 * Ops (JSON body { op, project, … }; `file` alone sends raw bytes with x-restore-op headers):
 *   identify                      the label, live counts, the catalog, the order, the auth users
 *   plan { tables, profiles }     the dry run's schema findings and the user id map
 *   exists { table, keys }        which keys already exist live (primary-key clashes)
 *   rows { table, rows, mode, id_map }   restore_rows(); the id map is applied here first
 *   create_user { email, full_name, password? }   a missing account (see createUserOp)
 *   files_exist { bucket, paths } which stored files already exist, with their size
 *   file (raw body)               one stored file, upsert off: { stored } or { skipped: exists }
 *   finish                        restore_finish(): sequences, triggers, live counts
 */
import { isPlainName, RESTORE_DENY } from "@/lib/backup-tables";
import { bearerMatches, MIN_SECRET_LENGTH } from "@/lib/backup-export.server";
import {
  applyIdMap,
  buildIdMap,
  dependencyOrder,
  authDependentTables,
  formatPlan,
  planTables,
  projectLabel,
  readCatalog,
  sameLabel,
  userIdColumns,
  type BackupProfile,
  type BackupTableInput,
  type Catalog,
  type LiveUser,
} from "@/lib/restore";

export const RESTORE_BATCH = 1000;
export const RESTORE_OPS = [
  "identify",
  "plan",
  "exists",
  "rows",
  "create_user",
  "files_exist",
  "file",
  "finish",
] as const;
export type RestoreOp = (typeof RESTORE_OPS)[number];

export interface RestoreEnv {
  /** RESTORE_SECRET — the password the script sends. */
  secret?: string | undefined;
  /** SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, set by Lovable Cloud on this server. */
  url?: string | undefined;
  key?: string | undefined;
}
export const restoreEnvFromProcess = (): RestoreEnv => ({
  secret: process.env["RESTORE_SECRET"]?.trim() || undefined,
  url: process.env["SUPABASE_URL"],
  key: process.env["SUPABASE_SERVICE_ROLE_KEY"],
});

/** What the door needs from the database and storage; tests hand in fakes. */
export interface RestoreDeps {
  /** A database function call with the service role; throws with the database's message. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  companyName: () => Promise<string | null>;
  /** How many live profiles are admins (the first-admin rule of create_user). */
  adminCount: () => Promise<number>;
  listAuthUsers: () => Promise<LiveUser[]>;
  createAuthUser: (
    email: string,
    fullName: string | null,
    password: string,
  ) => Promise<{ id: string }>;
  /** Storage, through the REST API like the backup door (never a client that could delete). */
  fetchImpl: typeof fetch;
  log: (line: string) => void;
}

const SECRET_OFF = "Restores are off: RESTORE_SECRET is not set in Lovable Cloud › Secrets";
const SECRET_SHORT = `Restores are off: RESTORE_SECRET must be at least ${MIN_SECRET_LENGTH} characters`;
const WRONG = "Wrong restore password";
const NO_KEY = "SUPABASE_SERVICE_ROLE_KEY: the server key is not set";
const NOT_PROJECT = "That is not the project you named";

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/** The one password the door accepted this process — see createUserOp. */
let firstAdminPasswordUsed = false;
/** Test hook: a fresh process. */
export const resetFirstAdminGuard = () => {
  firstAdminPasswordUsed = false;
};

async function defaultDeps(): Promise<RestoreDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // The restore functions are not in the generated types until the migration is applied and
  // the types regenerated; the one cast keeps the calls honest about that.
  const admin = supabaseAdmin as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    from: (t: string) => {
      select: (
        cols: string,
        opts?: { count?: "exact"; head?: boolean },
      ) => {
        eq: (
          c: string,
          v: unknown,
        ) => PromiseLike<{
          data: unknown;
          error: { message: string } | null;
          count: number | null;
        }> & {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    auth: {
      admin: {
        listUsers: (o: { page: number; perPage: number }) => Promise<{
          data: { users: { id: string; email?: string | null }[] };
          error: { message: string } | null;
        }>;
        createUser: (o: {
          email: string;
          password: string;
          email_confirm: boolean;
          user_metadata: Record<string, unknown>;
        }) => Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
      };
    };
  };
  return {
    rpc: async (fn, args) => {
      const { data, error } = await admin.rpc(fn, args);
      if (error) throw new Error(error.message);
      return data;
    },
    companyName: async () => {
      const { data, error } = await admin
        .from("company_settings")
        .select("company_name")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const v = data?.["company_name"];
      return typeof v === "string" ? v : null;
    },
    adminCount: async () => {
      const { count, error } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    listAuthUsers: async () => {
      const out: LiveUser[] = [];
      for (let page = 1; page < 1000; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(error.message);
        for (const u of data.users) out.push({ id: u.id, email: u.email ?? "" });
        if (data.users.length < 1000) break;
      }
      return out;
    },
    createAuthUser: async (email, fullName, password) => {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error || !data.user) throw new Error(error?.message ?? "Could not create the user");
      return { id: data.user.id };
    },
    fetchImpl: fetch,
    log: (line) => console.log(line),
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function restoreRequest(
  request: Request,
  env: RestoreEnv = restoreEnvFromProcess(),
  deps?: RestoreDeps,
): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const who =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const log = deps?.log ?? ((line: string) => console.log(line));

  // 1. The password. Off (unset / short) and wrong are both 403; nothing upstream is touched.
  if (!env.secret) {
    log(`[restore] refused 403 ${who} (RESTORE_SECRET unset)`);
    return fail(403, SECRET_OFF);
  }
  if (env.secret.length < MIN_SECRET_LENGTH) {
    log(`[restore] refused 403 ${who} (RESTORE_SECRET too short)`);
    return fail(403, SECRET_SHORT);
  }
  if (!(await bearerMatches(request, env.secret))) {
    log(`[restore] refused 403 ${who} (wrong password)`);
    return fail(403, WRONG);
  }
  // 2. The server key (the way api.cron.reminders.ts checks hasServiceRole()).
  if (!env.url || !env.key) {
    log(`[restore] refused 503 ${who} (no service role)`);
    return fail(503, NO_KEY);
  }

  // 3. The op: raw bytes for `file`, JSON for everything else.
  const rawOp = request.headers.get("x-restore-op");
  let op: string;
  let body: Record<string, unknown> = {};
  if (rawOp === "file") {
    op = "file";
    body = {
      project: safeDecode(request.headers.get("x-project")),
      bucket: request.headers.get("x-bucket") ?? "",
      path: safeDecode(request.headers.get("x-path")),
      content_type: request.headers.get("content-type") ?? "application/octet-stream",
    };
  } else {
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return fail(400, "the body must be a JSON object with an op");
      body = parsed as Record<string, unknown>;
    } catch {
      return fail(400, "the body must be JSON");
    }
    op = str(body["op"]);
  }
  if (!(RESTORE_OPS as readonly string[]).includes(op)) {
    log(`[restore] refused 400 ${who} op=${op || "(none)"}`);
    return fail(400, `op must be one of ${RESTORE_OPS.join(", ")}`);
  }

  const d = deps ?? (await defaultDeps());
  try {
    // 4. The project guard: every writing or reading op but identify echoes identify's label.
    const label = projectLabel(await d.companyName(), env.url);
    if (op !== "identify" && !sameLabel(body["project"], label)) {
      log(`[restore] refused 412 ${who} op=${op} (project mismatch)`);
      return fail(412, NOT_PROJECT);
    }
    const res = await dispatch(op as RestoreOp, body, request, env, d, label, (detail) =>
      log(`[restore] ok ${who} op=${op} ${detail}`),
    );
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`[restore] failed 500 ${who} op=${op}: ${msg.slice(0, 300)}`);
    return fail(500, msg);
  }
}

function safeDecode(v: string | null): string {
  if (!v) return "";
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

async function catalogOf(d: RestoreDeps): Promise<Catalog> {
  return readCatalog(await d.rpc("restore_catalog", {}));
}

async function dispatch(
  op: RestoreOp,
  body: Record<string, unknown>,
  request: Request,
  env: RestoreEnv,
  d: RestoreDeps,
  label: string,
  ok: (detail: string) => void,
): Promise<Response> {
  switch (op) {
    case "identify": {
      const [catalog, counts, users, admins] = await Promise.all([
        catalogOf(d),
        d.rpc("restore_live_counts", {}),
        d.listAuthUsers(),
        d.adminCount(),
      ]);
      const { order, cycles } = dependencyOrder(catalog);
      const noPk = catalog.tables.filter((t) => !t.pk.length).map((t) => t.name);
      const denied = catalog.tables.filter((t) => !t.restorable).map((t) => t.name);
      const userColumns: Record<string, string[]> = {};
      for (const t of catalog.tables) {
        const cols = userIdColumns(t.name, catalog);
        if (cols.length) userColumns[t.name] = cols;
      }
      ok(`tables=${catalog.tables.length} users=${users.length} admins=${admins}`);
      return Response.json({
        ok: true,
        project: label,
        ref: label.slice(label.lastIndexOf(" @ ") + 3),
        live_counts: counts ?? {},
        schema: catalog.tables,
        foreign_keys: catalog.foreign_keys,
        order,
        cycles,
        no_pk_tables: noPk,
        denied,
        deny_list: RESTORE_DENY,
        auth_dependent: authDependentTables(catalog),
        user_columns: userColumns,
        auth_users: users,
        live_admins: admins,
      });
    }

    case "plan": {
      const inputsRaw = Array.isArray(body["tables"]) ? (body["tables"] as unknown[]) : [];
      const inputs: BackupTableInput[] = inputsRaw
        .map((t) => (t ?? {}) as Record<string, unknown>)
        .filter((t) => isPlainName(t["table"]))
        .map((t) => ({
          table: str(t["table"]),
          columns: Array.isArray(t["columns"]) ? (t["columns"] as unknown[]).map(String) : [],
          rows: num(t["rows"]),
        }));
      const profilesRaw = Array.isArray(body["profiles"]) ? (body["profiles"] as unknown[]) : null;
      const [catalog, counts, liveUsers] = await Promise.all([
        catalogOf(d),
        d.rpc("restore_live_counts", {}),
        profilesRaw ? d.listAuthUsers() : Promise.resolve([] as LiveUser[]),
      ]);
      const plan = planTables(catalog, inputs, (counts ?? {}) as Record<string, number>);
      let users = null;
      if (profilesRaw) {
        const profiles: BackupProfile[] = profilesRaw
          .map((p) => (p ?? {}) as Record<string, unknown>)
          .filter((p) => typeof p["id"] === "string" && typeof p["email"] === "string")
          .map((p) => ({
            id: str(p["id"]),
            email: str(p["email"]),
            full_name: typeof p["full_name"] === "string" ? p["full_name"] : null,
            role: typeof p["role"] === "string" ? p["role"] : null,
          }));
        users = buildIdMap(profiles, liveUsers);
      }
      ok(
        `tables=${inputs.length} blocked=${plan.tables.filter((t) => t.blocked).length} missing_users=${users?.missing.length ?? 0}`,
      );
      return Response.json({
        ok: true,
        project: label,
        ...plan,
        users,
        text: formatPlan(plan, users, label),
      });
    }

    case "exists": {
      const table = str(body["table"]);
      if (!isPlainName(table)) return fail(400, "table must be a plain table name");
      const keys = Array.isArray(body["keys"]) ? (body["keys"] as unknown[]) : null;
      if (!keys) return fail(400, "keys must be an array");
      if (keys.length > RESTORE_BATCH) return fail(400, `at most ${RESTORE_BATCH} keys a call`);
      const result = (await d.rpc("restore_exists", { p_table: table, p_keys: keys })) as {
        existing?: number;
      };
      ok(`table=${table} keys=${keys.length} existing=${result?.existing ?? 0}`);
      return Response.json({ ok: true, ...result });
    }

    case "rows": {
      const table = str(body["table"]);
      if (!isPlainName(table)) return fail(400, "table must be a plain table name");
      if (RESTORE_DENY.includes(table)) return fail(403, `${table} is on the restore deny list`);
      const mode = str(body["mode"]) || "skip";
      if (mode !== "skip" && mode !== "replace") return fail(400, "mode must be skip or replace");
      const rowsRaw = Array.isArray(body["rows"]) ? (body["rows"] as unknown[]) : null;
      if (!rowsRaw) return fail(400, "rows must be an array");
      if (rowsRaw.length > RESTORE_BATCH) return fail(400, `at most ${RESTORE_BATCH} rows a call`);
      const idMapRaw = body["id_map"];
      const idMap: Record<string, string> = {};
      if (idMapRaw && typeof idMapRaw === "object" && !Array.isArray(idMapRaw)) {
        for (const [k, v] of Object.entries(idMapRaw as Record<string, unknown>))
          if (typeof v === "string" && k !== v) idMap[k] = v;
      }
      let rows = rowsRaw.map((r) =>
        r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : {},
      );
      let remapped = 0;
      let userColumns: string[] = [];
      if (Object.keys(idMap).length) {
        // The user-id columns come from the live catalog (foreign keys to profiles / auth.users
        // plus USER_ID_COLUMNS_WITHOUT_FK), never a list typed here.
        userColumns = userIdColumns(table, await catalogOf(d));
        ({ rows, remapped } = applyIdMap(rows, userColumns, idMap));
      }
      const result = (await d.rpc("restore_rows", {
        p_table: table,
        p_rows: rows,
        p_mode: mode,
      })) as Record<string, unknown>;
      const errors = Array.isArray(result?.["errors"]) ? (result["errors"] as unknown[]).length : 0;
      ok(
        `table=${table} rows=${rows.length} mode=${mode} inserted=${num(result?.["inserted"])} replaced=${num(result?.["replaced"])} skipped=${num(result?.["skipped"])} errors=${errors} remapped=${remapped}`,
      );
      return Response.json({ ok: errors === 0, ...result, remapped, user_columns: userColumns });
    }

    case "create_user":
      return createUserOp(body, d, ok);

    case "files_exist": {
      const bucket = str(body["bucket"]);
      if (!isPlainName(bucket)) return fail(400, "bucket must be a plain bucket name");
      const paths = Array.isArray(body["paths"]) ? (body["paths"] as unknown[]).map(String) : null;
      if (!paths) return fail(400, "paths must be an array");
      if (paths.length > 2000) return fail(400, "at most 2000 paths a call");
      for (const p of paths) if (!goodPath(p)) return fail(400, `not a file path: ${p}`);
      const exists = await filesExist(env, d.fetchImpl, bucket, paths);
      ok(`bucket=${bucket} paths=${paths.length} exist=${Object.keys(exists).length}`);
      return Response.json({ ok: true, exists });
    }

    case "file": {
      const bucket = str(body["bucket"]);
      const path = str(body["path"]);
      if (!isPlainName(bucket)) return fail(400, "x-bucket must be a plain bucket name");
      if (!goodPath(path)) return fail(400, "x-path must be a file path inside the bucket");
      const bytes = await request.arrayBuffer();
      const enc = path.split("/").map(encodeURIComponent).join("/");
      const res = await d.fetchImpl(`${base(env)}/storage/v1/object/${bucket}/${enc}`, {
        method: "POST",
        headers: {
          ...upstream(env),
          "content-type": str(body["content_type"]) || "application/octet-stream",
          "x-upsert": "false",
        },
        body: bytes,
      });
      if (res.ok) {
        ok(`bucket=${bucket} stored bytes=${bytes.byteLength}`);
        return Response.json({ ok: true, stored: true, bytes: bytes.byteLength });
      }
      const text = await res.text().catch(() => "");
      if (res.status === 400 || res.status === 409) {
        if (/already exists|Duplicate|"409"/i.test(text)) {
          ok(`bucket=${bucket} skipped=exists`);
          return Response.json({ ok: true, stored: false, skipped: "exists" });
        }
      }
      return fail(
        res.status >= 400 && res.status < 600 ? res.status : 502,
        `Storage refused ${bucket}/${path}: ${res.status} ${text.slice(0, 300)}`.trim(),
      );
    }

    case "finish": {
      const result = (await d.rpc("restore_finish", {})) as Record<string, unknown>;
      const seqs = Array.isArray(result?.["sequences"])
        ? (result["sequences"] as unknown[]).length
        : 0;
      const trig = Array.isArray(result?.["triggers_enabled"])
        ? (result["triggers_enabled"] as unknown[]).length
        : 0;
      ok(`sequences=${seqs} triggers_enabled=${trig}`);
      return Response.json({ ok: true, ...result });
    }
  }
}

/**
 * A backup user with no live account (the script's -CreateUsers): the account is created with
 * the email confirmed and a random throwaway password nobody ever sees (passwords are in no
 * backup; the admin sets each person's from Admin › Users & access afterwards). The one
 * exception is the chicken-and-egg of a fresh project, where nobody can sign in to do that: the
 * script may send `password` for ONE account (the admin who signs in first), honoured only while
 * the project has no admin profile yet and once per server process. The password is used for
 * the one create call and is never returned, logged or stored anywhere else.
 */
async function createUserOp(
  body: Record<string, unknown>,
  d: RestoreDeps,
  ok: (detail: string) => void,
): Promise<Response> {
  const email = str(body["email"]).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, "email must be an address");
  const fullName = typeof body["full_name"] === "string" ? body["full_name"].trim() || null : null;
  const given = body["password"];
  let password: string;
  let initial = false;
  if (given !== undefined && given !== null && given !== "") {
    if (typeof given !== "string" || given.length < 8)
      return fail(400, "password must be at least 8 characters");
    if (firstAdminPasswordUsed)
      return fail(
        409,
        "a first-admin password was already set this run; set the rest from Admin › Users & access",
      );
    if ((await d.adminCount()) > 0)
      return fail(
        409,
        "the project already has an admin: sign in as them and set passwords from Admin › Users & access",
      );
    password = given;
    initial = true;
  } else {
    const { randomBytes } = await import("node:crypto");
    password = randomBytes(30).toString("base64url");
  }
  const existing = (await d.listAuthUsers()).find((u) => u.email.trim().toLowerCase() === email);
  if (existing) {
    ok(`user exists`);
    return Response.json({ ok: true, id: existing.id, email, created: false });
  }
  const { id } = await d.createAuthUser(email, fullName, password);
  if (initial) firstAdminPasswordUsed = true;
  ok(`user created initial_password=${initial ? "operator" : "none"}`);
  return Response.json({ ok: true, id, email, created: true, initial_password: initial });
}

const goodPath = (p: string) =>
  !!p && !p.includes("..") && !p.startsWith("/") && !p.includes("\\") && p.length <= 1024;
const base = (env: RestoreEnv) => (env.url ?? "").replace(/\/+$/, "");
const upstream = (env: RestoreEnv) => ({
  apikey: env.key ?? "",
  Authorization: `Bearer ${env.key}`,
});

/** path → size for every path that exists, one storage listing per folder (the read the backup door uses). */
async function filesExist(
  env: RestoreEnv,
  fetchImpl: typeof fetch,
  bucket: string,
  paths: string[],
): Promise<Record<string, number>> {
  const byFolder = new Map<string, Set<string>>();
  for (const p of paths) {
    const i = p.lastIndexOf("/");
    const folder = i < 0 ? "" : p.slice(0, i);
    const name = i < 0 ? p : p.slice(i + 1);
    (byFolder.get(folder) ?? byFolder.set(folder, new Set()).get(folder)!).add(name);
  }
  const out: Record<string, number> = {};
  for (const [folder, names] of byFolder) {
    for (let offset = 0; ; offset += RESTORE_BATCH) {
      const res = await fetchImpl(`${base(env)}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: { ...upstream(env), "content-type": "application/json" },
        body: JSON.stringify({
          prefix: folder,
          limit: RESTORE_BATCH,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      });
      if (!res.ok) throw new Error(`Storage did not list ${bucket}/${folder}: ${res.status}`);
      const page = (await res.json()) as {
        name?: string;
        id?: string | null;
        metadata?: { size?: number };
      }[];
      for (const e of Array.isArray(page) ? page : []) {
        if (!e.name || e.id == null) continue; // a folder entry
        if (names.has(e.name)) out[folder ? `${folder}/${e.name}` : e.name] = num(e.metadata?.size);
      }
      if (!Array.isArray(page) || page.length < RESTORE_BATCH) break;
    }
  }
  return out;
}
