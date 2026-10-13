/**
 * The restore door (owner, Oct 13): /api/restore opens only to RESTORE_SECRET, writes only
 * through the restore functions of 20261013100000_restore_door.sql with the service role, refuses
 * the wrong project (412), logs counts and never rows. The migration is pinned here (functions,
 * grants to service_role alone, triggers off and on, on conflict, jsonb_populate_record, no
 * delete / truncate), the route too, and two walks over supabase/migrations keep the future
 * honest: every table the migrations create is restorable unless it is on the one deny list,
 * and every user-id column either has a foreign key to profiles or is in
 * USER_ID_COLUMNS_WITHOUT_FK, so the id map can never miss one.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import { NAME_RE, RESTORE_DENY } from "./backup-tables";
import { USER_COLUMN_NAME_RE, USER_ID_COLUMNS_WITHOUT_FK } from "./restore";
import {
  resetFirstAdminGuard,
  RESTORE_OPS,
  restoreRequest,
  type RestoreDeps,
  type RestoreEnv,
} from "./restore-door.server";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(here(rel), "utf8");
const MIG_DIR = here("../../supabase/migrations");
const MIGRATION = "20261013100000_restore_door.sql";

const SECRET = "a-long-restore-password-the-owner-made-up";
const ENV: RestoreEnv = {
  secret: SECRET,
  url: "https://abcdefghijkl.supabase.co",
  key: "service-key-xyz",
};
const LABEL = "JBK Roofing @ abcdefghijkl";

const CATALOG = {
  tables: [
    {
      name: "profiles",
      restorable: true,
      pk: ["id"],
      columns: [
        { name: "id", type: "uuid", nullable: false, default: null, is_pk: true, generated: false },
        {
          name: "email",
          type: "text",
          nullable: false,
          default: null,
          is_pk: false,
          generated: false,
        },
      ],
    },
    {
      name: "service_jobs",
      restorable: true,
      pk: ["id"],
      columns: [
        { name: "id", type: "uuid", nullable: false, default: null, is_pk: true, generated: false },
        {
          name: "technician_id",
          type: "uuid",
          nullable: true,
          default: null,
          is_pk: false,
          generated: false,
        },
        {
          name: "created_by",
          type: "uuid",
          nullable: true,
          default: null,
          is_pk: false,
          generated: false,
        },
      ],
    },
    {
      name: "secret_table",
      restorable: false,
      pk: ["key"],
      columns: [
        {
          name: "key",
          type: "text",
          nullable: false,
          default: null,
          is_pk: true,
          generated: false,
        },
      ],
    },
  ],
  foreign_keys: [
    {
      constraint: "p",
      table: "profiles",
      columns: ["id"],
      ref_schema: "auth",
      ref_table: "users",
      ref_columns: ["id"],
    },
    {
      constraint: "t",
      table: "service_jobs",
      columns: ["technician_id"],
      ref_schema: "public",
      ref_table: "profiles",
      ref_columns: ["id"],
    },
  ],
};

interface Call {
  url: string;
  init: RequestInit;
}
function fakeDeps(over: Partial<RestoreDeps> & { admins?: number } = {}) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const lines: string[] = [];
  const fetches: Call[] = [];
  const created: { email: string; fullName: string | null; password: string }[] = [];
  const deps: RestoreDeps = {
    rpc: async (fn, args) => {
      rpcs.push({ fn, args });
      if (fn === "restore_catalog") return CATALOG;
      if (fn === "restore_live_counts") return { profiles: 2, service_jobs: 5 };
      if (fn === "restore_exists") return { existing: 1, indices: [0] };
      if (fn === "restore_rows") {
        const rows = args["p_rows"] as unknown[];
        return {
          inserted: rows.length - 1,
          replaced: 0,
          skipped: 1,
          dropped_columns: ["old"],
          errors: [],
          no_pk: false,
        };
      }
      if (fn === "restore_finish")
        return {
          sequences: [{ sequence: "s" }],
          triggers_enabled: [],
          live_counts: { profiles: 3 },
        };
      throw new Error(`unexpected rpc ${fn}`);
    },
    companyName: async () => "JBK Roofing",
    adminCount: async () => over.admins ?? 1,
    listAuthUsers: async () => [{ id: "live-brad", email: "brad@jbk.com" }],
    createAuthUser: async (email, fullName, password) => {
      created.push({ email, fullName, password });
      return { id: `new-${email}` };
    },
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      fetches.push({ url, init: init ?? {} });
      if (url.includes("/object/list/"))
        return Response.json([
          { name: "a.jpg", id: "x", metadata: { size: 8 } },
          { name: "folder", id: null },
        ]);
      if (url.includes("/storage/v1/object/service/dup.jpg"))
        return new Response(
          '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}',
          { status: 400 },
        );
      return Response.json({ Key: "ok" });
    }) as typeof fetch,
    log: (l) => lines.push(l),
    ...over,
  };
  return { deps, rpcs, lines, fetches, created };
}
const post = (
  body: unknown,
  auth: string | null = `Bearer ${SECRET}`,
  headers: Record<string, string> = {},
) =>
  new Request("https://portal.example/api/restore", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.5",
      ...(auth === null ? {} : { Authorization: auth }),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => resetFirstAdminGuard());

describe("/api/restore — who gets in", () => {
  it("403 'Restores are off' while RESTORE_SECRET is unset or short, 403 'Wrong restore password' otherwise, 405 for GET — nothing touched", async () => {
    const { deps, rpcs, lines } = fakeDeps();
    const off = await restoreRequest(post({ op: "identify" }), { ...ENV, secret: undefined }, deps);
    expect(off.status).toBe(403);
    expect(((await off.json()) as { error: string }).error).toBe(
      "Restores are off: RESTORE_SECRET is not set in Lovable Cloud › Secrets",
    );
    const short = await restoreRequest(
      post({ op: "identify" }, "Bearer short"),
      { ...ENV, secret: "short" },
      deps,
    );
    expect(short.status).toBe(403);
    expect(await short.text()).toContain("Restores are off");
    for (const auth of ["Bearer nope", null, `Bearer ${SECRET}x`, `Basic ${SECRET}`]) {
      const r = await restoreRequest(post({ op: "identify" }, auth), ENV, deps);
      expect(r.status, String(auth)).toBe(403);
      expect(((await r.json()) as { error: string }).error).toBe("Wrong restore password");
    }
    const get = new Request("https://portal.example/api/restore", {
      method: "GET",
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect((await restoreRequest(get, ENV, deps)).status).toBe(405);
    expect(rpcs).toHaveLength(0);
    expect(lines.filter((l) => l.includes("refused 403"))).toHaveLength(6);
    expect(lines.join("\n")).toContain("10.0.0.5");
  });
  it("503 'the server key is not set' without the service role, before any op", async () => {
    const { deps, rpcs } = fakeDeps();
    const r = await restoreRequest(post({ op: "identify" }), { ...ENV, key: undefined }, deps);
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("the server key is not set");
    expect(
      (await restoreRequest(post({ op: "identify" }), { ...ENV, url: undefined }, deps)).status,
    ).toBe(503);
    expect(rpcs).toHaveLength(0);
  });
  it("400 for an unknown op or a non-JSON body", async () => {
    const { deps } = fakeDeps();
    expect((await restoreRequest(post({ op: "drop" }), ENV, deps)).status).toBe(400);
    expect((await restoreRequest(post("not json"), ENV, deps)).status).toBe(400);
    expect((await restoreRequest(post([1]), ENV, deps)).status).toBe(400);
  });
  it("412 'That is not the project you named' on every op but identify when the label differs", async () => {
    const { deps, rpcs } = fakeDeps();
    for (const op of RESTORE_OPS.filter((o) => o !== "identify" && o !== "file")) {
      const r = await restoreRequest(
        post({
          op,
          project: "JBK Roofing @ other",
          table: "profiles",
          rows: [],
          keys: [],
          paths: [],
          bucket: "service",
          email: "a@b.c",
        }),
        ENV,
        deps,
      );
      expect(r.status, op).toBe(412);
      expect(((await r.json()) as { error: string }).error).toBe(
        "That is not the project you named",
      );
    }
    const file = await restoreRequest(
      post("bytes", `Bearer ${SECRET}`, {
        "x-restore-op": "file",
        "x-project": encodeURIComponent("wrong @ x"),
        "x-bucket": "service",
        "x-path": "a.jpg",
      }),
      ENV,
      deps,
    );
    expect(file.status).toBe(412);
    // Only the company-name lookup ran: no restore function, no storage call.
    expect(rpcs.filter((c) => c.fn.startsWith("restore_"))).toHaveLength(0);
  });
});

describe("/api/restore — the ops", () => {
  it("identify: the label, live counts, the catalog, the order, auth users, user columns, the admin count", async () => {
    const { deps } = fakeDeps({ admins: 0 });
    const r = await restoreRequest(post({ op: "identify" }), ENV, deps);
    expect(r.status).toBe(200);
    const b = (await r.json()) as Record<string, unknown>;
    expect(b["project"]).toBe(LABEL);
    expect(b["ref"]).toBe("abcdefghijkl");
    expect(b["live_counts"]).toEqual({ profiles: 2, service_jobs: 5 });
    expect(b["order"]).toEqual(["profiles", "secret_table", "service_jobs"]);
    expect(b["denied"]).toEqual(["secret_table"]);
    expect(b["deny_list"]).toEqual(RESTORE_DENY);
    expect(b["auth_dependent"]).toEqual([{ table: "profiles", columns: ["id"] }]);
    expect(b["user_columns"]).toEqual({
      profiles: ["id"],
      service_jobs: ["created_by", "technician_id"],
    });
    expect(b["auth_users"]).toEqual([{ id: "live-brad", email: "brad@jbk.com" }]);
    expect(b["live_admins"]).toBe(0);
    expect((b["schema"] as unknown[]).length).toBe(3);
  });
  it("plan: the schema findings, the id map by email and the text", async () => {
    const { deps } = fakeDeps();
    const r = await restoreRequest(
      post({
        op: "plan",
        project: LABEL,
        tables: [
          { table: "service_jobs", columns: ["id", "technician_id", "old"], rows: 7 },
          { table: "gone", columns: ["id"], rows: 1 },
          { table: "bad name", columns: [], rows: 0 },
        ],
        profiles: [
          { id: "old-brad", email: "BRAD@jbk.com", role: "admin" },
          { id: "old-amy", email: "amy@jbk.com", role: "user", full_name: "Amy" },
        ],
      }),
      ENV,
      deps,
    );
    expect(r.status).toBe(200);
    const b = (await r.json()) as {
      tables: { table: string; blocked: boolean; dropped_columns: string[] }[];
      users: { id_map: Record<string, string>; missing: { email: string }[] };
      text: string;
    };
    expect(b.tables.map((t) => t.table)).toEqual(["service_jobs", "gone"]);
    expect(b.tables[0]!.dropped_columns).toEqual(["old"]);
    expect(b.tables[1]!.blocked).toBe(true);
    expect(b.users.id_map).toEqual({ "old-brad": "live-brad" });
    expect(b.users.missing.map((m) => m.email)).toEqual(["amy@jbk.com"]);
    expect(b.text).toContain("amy@jbk.com (user): no live account");
  });
  it("exists: restore_exists with the keys, at most 1,000 a call, plain table names only", async () => {
    const { deps, rpcs } = fakeDeps();
    const r = await restoreRequest(
      post({ op: "exists", project: LABEL, table: "profiles", keys: [{ id: "a" }, { id: "b" }] }),
      ENV,
      deps,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, existing: 1, indices: [0] });
    expect(rpcs.at(-1)).toEqual({
      fn: "restore_exists",
      args: { p_table: "profiles", p_keys: [{ id: "a" }, { id: "b" }] },
    });
    expect(
      (
        await restoreRequest(
          post({ op: "exists", project: LABEL, table: "Bad;", keys: [] }),
          ENV,
          deps,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await restoreRequest(
          post({ op: "exists", project: LABEL, table: "profiles", keys: new Array(1001).fill(1) }),
          ENV,
          deps,
        )
      ).status,
    ).toBe(400);
  });
  it("rows: applies the id map to the user columns from the catalog, then restore_rows; logs counts, never a row", async () => {
    const { deps, rpcs, lines } = fakeDeps();
    const rows = [
      {
        id: "t1",
        technician_id: "old-brad",
        created_by: "old-brad",
        site_id: "old-brad",
        secret_note: "ROW-CONTENT-NEVER-LOGGED",
      },
      { id: "t2", technician_id: "kept", created_by: null },
    ];
    const r = await restoreRequest(
      post({
        op: "rows",
        project: LABEL,
        table: "service_jobs",
        rows,
        mode: "skip",
        id_map: { "old-brad": "live-brad", same: "same" },
      }),
      ENV,
      deps,
    );
    expect(r.status).toBe(200);
    const b = (await r.json()) as Record<string, unknown>;
    expect(b).toMatchObject({
      ok: true,
      inserted: 1,
      skipped: 1,
      dropped_columns: ["old"],
      remapped: 2,
      user_columns: ["created_by", "technician_id"],
    });
    const call = rpcs.find((c) => c.fn === "restore_rows")!;
    expect(call.args["p_mode"]).toBe("skip");
    expect(call.args["p_table"]).toBe("service_jobs");
    const sent = call.args["p_rows"] as Record<string, unknown>[];
    expect(sent[0]).toEqual({ ...rows[0], technician_id: "live-brad", created_by: "live-brad" });
    expect(sent[0]!["site_id"]).toBe("old-brad");
    expect(sent[1]).toEqual(rows[1]);
    expect(lines.join("\n")).toContain(
      "op=rows table=service_jobs rows=2 mode=skip inserted=1 replaced=0 skipped=1 errors=0 remapped=2",
    );
    expect(lines.join("\n")).not.toContain("ROW-CONTENT-NEVER-LOGGED");
    // Without an id map the catalog is not even read.
    rpcs.length = 0;
    await restoreRequest(
      post({ op: "rows", project: LABEL, table: "service_jobs", rows, mode: "replace" }),
      ENV,
      deps,
    );
    expect(rpcs.map((c) => c.fn)).toEqual(["restore_rows"]);
    expect(rpcs[0]!.args["p_mode"]).toBe("replace");
  });
  it("rows: refuses a bad mode, too many rows, a non-plain table, and a deny-listed table (403)", async () => {
    const { deps, rpcs } = fakeDeps();
    expect(
      (
        await restoreRequest(
          post({ op: "rows", project: LABEL, table: "profiles", rows: [], mode: "delete" }),
          ENV,
          deps,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await restoreRequest(
          post({
            op: "rows",
            project: LABEL,
            table: "profiles",
            rows: new Array(1001).fill({}),
            mode: "skip",
          }),
          ENV,
          deps,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await restoreRequest(
          post({ op: "rows", project: LABEL, table: "../x", rows: [], mode: "skip" }),
          ENV,
          deps,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await restoreRequest(
          post({ op: "rows", project: LABEL, table: "profiles", rows: "no", mode: "skip" }),
          ENV,
          deps,
        )
      ).status,
    ).toBe(400);
    expect(rpcs.filter((c) => c.fn === "restore_rows")).toHaveLength(0);
    if (RESTORE_DENY.length) {
      const denied = await restoreRequest(
        post({ op: "rows", project: LABEL, table: RESTORE_DENY[0], rows: [], mode: "skip" }),
        ENV,
        deps,
      );
      expect(denied.status).toBe(403);
    }
  });
  it("finish: restore_finish, with the counts", async () => {
    const { deps, lines } = fakeDeps();
    const r = await restoreRequest(post({ op: "finish", project: LABEL }), ENV, deps);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      ok: true,
      sequences: [{ sequence: "s" }],
      triggers_enabled: [],
      live_counts: { profiles: 3 },
    });
    expect(lines.at(-1)).toContain("op=finish sequences=1 triggers_enabled=0");
  });
  it("files_exist: one storage listing per folder, sizes back; file: upsert off, 'exists' when it is", async () => {
    const { deps, fetches } = fakeDeps();
    const r = await restoreRequest(
      post({
        op: "files_exist",
        project: LABEL,
        bucket: "service",
        paths: ["tickets/12/a.jpg", "tickets/12/b.jpg", "top.jpg"],
      }),
      ENV,
      deps,
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, exists: { "tickets/12/a.jpg": 8 } });
    expect(fetches.map((f) => f.url)).toEqual([
      "https://abcdefghijkl.supabase.co/storage/v1/object/list/service",
      "https://abcdefghijkl.supabase.co/storage/v1/object/list/service",
    ]);
    expect(JSON.parse(String(fetches[0]!.init.body))).toMatchObject({
      prefix: "tickets/12",
      limit: 1000,
      offset: 0,
    });
    expect(
      (
        await restoreRequest(
          post({ op: "files_exist", project: LABEL, bucket: "service", paths: ["../x"] }),
          ENV,
          deps,
        )
      ).status,
    ).toBe(400);

    fetches.length = 0;
    const hdr = (path: string) => ({
      "x-restore-op": "file",
      "x-project": encodeURIComponent(LABEL),
      "x-bucket": "service",
      "x-path": encodeURIComponent(path),
      "content-type": "image/jpeg",
    });
    const up = await restoreRequest(
      post("JPEGDATA", `Bearer ${SECRET}`, hdr("tickets/12/a b.jpg")),
      ENV,
      deps,
    );
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ ok: true, stored: true, bytes: 8 });
    expect(fetches[0]!.url).toBe(
      "https://abcdefghijkl.supabase.co/storage/v1/object/service/tickets/12/a%20b.jpg",
    );
    const h = new Headers(fetches[0]!.init.headers);
    expect(h.get("x-upsert")).toBe("false");
    expect(h.get("content-type")).toBe("image/jpeg");
    expect(h.get("authorization")).toBe("Bearer service-key-xyz");
    const dup = await restoreRequest(
      post("JPEGDATA", `Bearer ${SECRET}`, hdr("dup.jpg")),
      ENV,
      deps,
    );
    expect(await dup.json()).toEqual({ ok: true, stored: false, skipped: "exists" });
    expect(
      (await restoreRequest(post("x", `Bearer ${SECRET}`, hdr("../etc")), ENV, deps)).status,
    ).toBe(400);
  });
  it("create_user: no password unless the first-admin rule allows exactly one, never returned or logged", async () => {
    const { deps, created, lines } = fakeDeps({ admins: 0 });
    const plain = await restoreRequest(
      post({ op: "create_user", project: LABEL, email: "Amy@JBK.com", full_name: "Amy" }),
      ENV,
      deps,
    );
    expect(plain.status).toBe(200);
    expect(await plain.json()).toEqual({
      ok: true,
      id: "new-amy@jbk.com",
      email: "amy@jbk.com",
      created: true,
      initial_password: false,
    });
    expect(created[0]!.password.length).toBeGreaterThanOrEqual(30);
    // The first admin of a fresh project may get the operator's password — once.
    const first = await restoreRequest(
      post({
        op: "create_user",
        project: LABEL,
        email: "owner@jbk.com",
        password: "Operator-Typed-1",
      }),
      ENV,
      deps,
    );
    expect(first.status).toBe(200);
    expect(((await first.json()) as { initial_password: boolean }).initial_password).toBe(true);
    expect(created[1]!.password).toBe("Operator-Typed-1");
    const second = await restoreRequest(
      post({ op: "create_user", project: LABEL, email: "two@jbk.com", password: "Another-One-22" }),
      ENV,
      deps,
    );
    expect(second.status).toBe(409);
    expect(created).toHaveLength(2);
    // An existing account is answered, not re-created.
    const dup = await restoreRequest(
      post({ op: "create_user", project: LABEL, email: "brad@jbk.com" }),
      ENV,
      deps,
    );
    expect(await dup.json()).toEqual({
      ok: true,
      id: "live-brad",
      email: "brad@jbk.com",
      created: false,
    });
    expect(
      (await restoreRequest(post({ op: "create_user", project: LABEL, email: "nope" }), ENV, deps))
        .status,
    ).toBe(400);
    expect(
      (
        await restoreRequest(
          post({ op: "create_user", project: LABEL, email: "x@y.z", password: "short" }),
          ENV,
          deps,
        )
      ).status,
    ).toBe(400);
    const all = lines.join("\n") + JSON.stringify(created.map((c) => ({ ...c, password: "" })));
    expect(all).not.toContain("Operator-Typed-1");
    expect(all).not.toContain(created[0]!.password);
  });
  it("create_user: a project that already has an admin takes no password at all", async () => {
    resetFirstAdminGuard();
    const { deps, created } = fakeDeps({ admins: 1 });
    const r = await restoreRequest(
      post({
        op: "create_user",
        project: LABEL,
        email: "owner@jbk.com",
        password: "Operator-Typed-1",
      }),
      ENV,
      deps,
    );
    expect(r.status).toBe(409);
    expect(await r.text()).toContain("already has an admin");
    expect(created).toHaveLength(0);
  });
  it("a database error comes back as 500 with the message, logged without the body", async () => {
    const { deps, lines } = fakeDeps({
      rpc: async () => {
        throw new Error("restore: p_mode must be skip or replace");
      },
    });
    const r = await restoreRequest(post({ op: "finish", project: LABEL }), ENV, deps);
    expect(r.status).toBe(500);
    expect(await r.text()).toContain("p_mode must be skip or replace");
    expect(lines.at(-1)).toContain("failed 500");
  });
});

describe("the route and the shared sources", () => {
  it("api.restore.ts loads the door lazily, POST and GET both reach it (GET is 405 inside)", () => {
    const route = read("../routes/api.restore.ts");
    expect(route).toContain('createFileRoute("/api/restore")');
    expect(route).toContain('await import("@/lib/restore-door.server")');
    expect(route).not.toMatch(/^import .*restore-door\.server/m);
    expect(route).toContain("POST: ({ request }) => run(request)");
  });
  it("the door reads RESTORE_SECRET (never BACKUP_SECRET), uses the backup door's constant-time compare, and never deletes", () => {
    const src = read("./restore-door.server.ts");
    expect(src).toContain('process.env["RESTORE_SECRET"]');
    expect(src).not.toMatch(/process\.env\["BACKUP_SECRET"\]/);
    expect(src).toContain("bearerMatches");
    expect(src).toMatch(/import \{[^}]*bearerMatches[^}]*\} from "@\/lib\/backup-export\.server"/);
    expect(src).toContain("fail(403, SECRET_OFF)");
    expect(src).toContain("fail(403, WRONG)");
    expect(src).toContain("fail(503, NO_KEY)");
    expect(src).toContain("fail(412, NOT_PROJECT)");
    expect(src).not.toMatch(/\.delete\(|\.remove\(|method:\s*"DELETE"|\.truncate/);
    expect(src).not.toMatch(/method:\s*"(PUT|PATCH)"/);
    // Logging: counts and names, never the body, a row or a password.
    expect(src).not.toMatch(/log\([^)]*JSON\.stringify\(rows/);
    // The password value is never interpolated anywhere (a log line, an answer).
    expect(src).not.toMatch(/\$\{(password|given)\}/);
    expect(src).toContain('"x-upsert": "false"');
  });
  it("the backup door and the restore door share one name check and one deny list (src/lib/backup-tables.ts)", () => {
    const backup = read("./backup-export.server.ts");
    const restore = read("./restore-door.server.ts");
    expect(backup).toMatch(/import \{ NAME_RE \} from "@\/lib\/backup-tables"/);
    expect(backup).not.toMatch(/const NAME_RE\s*=/);
    expect(restore).toMatch(/from "@\/lib\/backup-tables"/);
    expect(restore).toContain("RESTORE_DENY");
    expect(String(NAME_RE)).toBe("/^[a-z][a-z0-9_]{0,62}$/");
    // The backup door's behaviour is unchanged: the same regex it had.
    expect(NAME_RE.test("bids")).toBe(true);
    expect(NAME_RE.test("Bad Name")).toBe(false);
  });
});

/** Every `create table [if not exists] public.<x>` in the migrations, and every column declared. */
function walkMigrations() {
  const files = readdirSync(MIG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const tables = new Set<string>();
  // table → column → { type, fk: whether the declaration or a later constraint points at profiles / auth.users }
  const columns = new Map<string, Map<string, { type: string; fk: boolean }>>();
  const col = (t: string, c: string, type: string, fk: boolean) => {
    const m = columns.get(t) ?? new Map();
    const prev = m.get(c);
    m.set(c, { type, fk: fk || prev?.fk === true });
    columns.set(t, m);
  };
  const userFk = (s: string) =>
    /references\s+(public\.)?profiles\s*\(|references\s+auth\.users\s*\(/i.test(s);
  for (const f of files) {
    const sql = readFileSync(`${MIG_DIR}/${f}`, "utf8").replace(/--[^\n]*/g, "");
    const statements = sql.split(";");
    for (const st of statements) {
      const s = st.replace(/\s+/g, " ").trim();
      const ct = /^create table (?:if not exists )?(?:public\.)?([a-z_0-9]+) \((.*)\)$/i.exec(s);
      if (ct) {
        tables.add(ct[1]!);
        // Split the body on commas at depth 0.
        let depth = 0;
        let cur = "";
        const parts: string[] = [];
        for (const ch of ct[2]!) {
          if (ch === "(") depth++;
          if (ch === ")") depth--;
          if (ch === "," && depth === 0) {
            parts.push(cur);
            cur = "";
          } else cur += ch;
        }
        parts.push(cur);
        for (const p of parts) {
          const d = /^\s*([a-z_0-9]+)\s+(uuid(?:\[\])?)\b(.*)$/i.exec(p);
          if (d) col(ct[1]!, d[1]!, d[2]!, userFk(d[3]!));
        }
        continue;
      }
      const at = /^alter table (?:only )?(?:public\.)?([a-z_0-9]+) (.*)$/i.exec(s);
      if (at) {
        const t = at[1]!;
        for (const m of at[2]!.matchAll(
          /add column (?:if not exists )?([a-z_0-9]+) (uuid(?:\[\])?)\b([^,]*)/gi,
        ))
          col(t, m[1]!, m[2]!, userFk(m[3]!));
        for (const m of at[2]!.matchAll(/foreign key \(([a-z_0-9]+)\) (references[^,]*)/gi))
          if (userFk(m[2]!)) col(t, m[1]!, "uuid", true);
      }
    }
  }
  return { tables, columns };
}

describe("the migration 20261013100000_restore_door.sql", () => {
  const sql = read(`../../supabase/migrations/${MIGRATION}`);
  const flat = sql.replace(/\s+/g, " ");
  it("defines the restore functions, SECURITY DEFINER with search_path public, executable by service_role alone", () => {
    for (const fn of [
      "restore_assert_system()",
      "restore_deny_list()",
      "restore_catalog()",
      "restore_live_counts()",
      "restore_table_oid(text)",
      "restore_exists(text, jsonb)",
      "restore_rows(text, jsonb, text)",
      "restore_finish()",
    ]) {
      expect(flat, fn).toContain(
        `revoke all on function public.${fn} from public, anon, authenticated;`,
      );
      expect(flat, fn).toContain(`grant execute on function public.${fn} to service_role;`);
      expect(flat, fn).not.toMatch(
        new RegExp(
          `grant execute on function public\\.${fn.replace(/[()]/g, "\\$&").replace(/, /g, ",? ")} to [^;]*(authenticated|anon|public)`,
        ),
      );
    }
    for (const fn of [
      "restore_catalog()",
      "restore_live_counts()",
      "restore_table_oid(p_table text)",
      "restore_exists(p_table text, p_keys jsonb)",
      "restore_rows(p_table text, p_rows jsonb, p_mode text)",
      "restore_finish()",
    ]) {
      const at = flat.indexOf(`create or replace function public.${fn}`);
      expect(at, fn).toBeGreaterThan(-1);
      const head = flat.slice(at, flat.indexOf("$$", at));
      expect(head, fn).toContain("security definer");
      expect(head, fn).toContain("set search_path = public");
    }
    expect((flat.match(/perform public\.restore_assert_system\(\)/g) ?? []).length).toBe(6);
  });
  it("restore_rows validates the table against pg_catalog, the mode, 1,000 rows, maps with jsonb_populate_record, upserts on the primary key with user triggers off, per-row errors, never deletes", () => {
    const body = flat.slice(
      flat.indexOf("create or replace function public.restore_rows("),
      flat.indexOf("revoke all on function public.restore_rows("),
    );
    expect(body).toContain("v_oid := public.restore_table_oid(p_table)");
    expect(flat).toContain(
      "where n.nspname = 'public' and c.relname = p_table and c.relkind in ('r', 'p')",
    );
    expect(flat).toContain("p_table !~ '^[a-z][a-z0-9_]{0,62}$'");
    expect(flat).toContain("p_table = any(public.restore_deny_list())");
    expect(body).toContain("p_mode not in ('skip', 'replace')");
    expect(body).toContain("if v_n > 1000 then");
    expect(body).toContain("jsonb_populate_record(null::public.%I, $1)");
    expect(body).toContain("on conflict (%s) do nothing");
    expect(body).toContain("on conflict (%s) do update set %s");
    expect(body).toContain("%I = excluded.%I");
    const disable = body.indexOf("disable trigger user");
    const enable = body.indexOf("enable trigger user");
    const loop = body.indexOf("for v_i in 0 .. v_n - 1 loop");
    expect(disable).toBeGreaterThan(0);
    expect(loop).toBeGreaterThan(disable);
    expect(enable).toBeGreaterThan(loop);
    expect(body).toContain("exception when others then");
    expect(body).toContain("'index', v_i, 'message', sqlerrm, 'code', sqlstate");
    expect(body).toContain("'dropped_columns', coalesce(to_jsonb(v_dropped), '[]'::jsonb)");
    expect(body).toContain("'no_pk', v_pk is null");
    // Every identifier goes through format() with %I; nothing is concatenated raw.
    expect(body).not.toMatch(/'\s*\|\|\s*p_table/);
    expect(body).toContain("filter (where a.attgenerated = '')");
  });
  it("holds no delete, truncate or drop of data anywhere", () => {
    const code = flat.replace(/comment on function[^;]*;/g, "");
    expect(code).not.toMatch(/\bdelete from\b|\btruncate\b|\bdrop table\b|\bdrop column\b/i);
    expect(code).not.toMatch(/on delete/i);
  });
  it("restore_finish resets every sequence found through pg_depend past max(column), never below its start and never backwards, and re-enables disabled user triggers", () => {
    const body = flat.slice(
      flat.indexOf("create or replace function public.restore_finish()"),
      flat.indexOf("revoke all on function public.restore_finish()"),
    );
    expect(body).toContain("from pg_depend d");
    expect(body).toContain("d.deptype in ('a', 'i')");
    expect(body).toContain("join pg_attrdef ad on d.classid = 'pg_attrdef'::regclass");
    expect(body).toContain("select max(%I)::bigint from public.%I");
    // Never backwards (a live project whose tickets 6019–6020 were deleted must not hand 6019
    // out again after a restore): the sequence's own last_value is the third floor.
    expect(body).toContain("q.last_value");
    expect(body).toContain(
      "v_set := greatest(coalesce(v_max, 0) + 1, r.start_value, coalesce(r.last_value, 0) + 1)",
    );
    expect(body).toContain(
      "perform setval(format('public.%I', r.seq_name)::regclass, v_set, false)",
    );
    expect(body).toContain("not t.tgisinternal and t.tgenabled = 'D'");
    expect(body).toContain("alter table public.%I enable trigger %I");
    expect(body).toContain("'live_counts', public.restore_live_counts()");
  });
  it("restore_catalog reads tables, columns, primary keys and foreign keys from pg_catalog — no table list", () => {
    const body = flat.slice(
      flat.indexOf("create or replace function public.restore_catalog()"),
      flat.indexOf("revoke all on function public.restore_catalog()"),
    );
    expect(body).toContain("where n.nspname = 'public' and c.relkind in ('r', 'p')");
    expect(body).toContain("format_type(a.atttypid, a.atttypmod)");
    expect(body).toContain("pg_get_expr(d.adbin, d.adrelid)");
    expect(body).toContain("i.indisprimary");
    expect(body).toContain("con.contype = 'f'");
    expect(body).toContain("'ref_schema', rn.nspname");
    for (const t of ["bids", "service_jobs", "profiles", "invoices", "crm_accounts"])
      expect(body).not.toContain(`'${t}'`);
  });
  it("the deny list in the migration equals RESTORE_DENY in backup-tables.ts", () => {
    const m =
      /create or replace function public\.restore_deny_list\(\) returns text\[\] language sql immutable as \$\$ select (.*?) \$\$;/.exec(
        flat,
      );
    expect(m).not.toBeNull();
    const expr = m![1]!;
    const names = [...expr.matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]).sort();
    expect(names).toEqual([...RESTORE_DENY].sort());
    if (!RESTORE_DENY.length) expect(expr).toContain("array[]::text[]");
  });
  it("runs after every table it restores exists (no later migration creates a table)", () => {
    const files = readdirSync(MIG_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files).toContain(MIGRATION);
    // Later migrations (the Oct 13 CenterPoint import adds columns and indexes) may follow, but
    // none may create a table the door would not know to restore.
    for (const f of files.slice(files.indexOf(MIGRATION) + 1))
      expect(readFileSync(`${MIG_DIR}/${f}`, "utf8"), f).not.toMatch(/create\s+table/i);
  });
});

describe("every table the migrations create is restorable unless it is on the deny list", () => {
  const { tables, columns } = walkMigrations();
  it("found the tables", () => {
    expect(tables.size).toBeGreaterThan(80);
    for (const t of ["bids", "service_jobs", "profiles", "app_secrets", "audit_log", "invoices"])
      expect(tables.has(t), t).toBe(true);
  });
  it("app_secrets is restored (the push-signing pair), and the only refusals are the deny list", () => {
    expect(RESTORE_DENY).not.toContain("app_secrets");
    for (const t of tables) {
      expect(NAME_RE.test(t), `${t} would be refused as not a plain name`).toBe(true);
    }
    for (const d of RESTORE_DENY)
      expect(tables.has(d), `${d} on the deny list is not a table`).toBe(true);
  });
  it("every uuid user-id column has a foreign key to profiles or is in USER_ID_COLUMNS_WITHOUT_FK, and that list names only real columns", () => {
    const unexplained: string[] = [];
    for (const [t, cols] of columns) {
      for (const [c, { fk }] of cols) {
        if (!USER_COLUMN_NAME_RE.test(c)) continue;
        if (fk) continue;
        if ((USER_ID_COLUMNS_WITHOUT_FK[t] ?? []).includes(c)) continue;
        unexplained.push(`${t}.${c}`);
      }
    }
    expect(
      unexplained,
      "add a foreign key to profiles(id) or list the column in USER_ID_COLUMNS_WITHOUT_FK (restore.ts)",
    ).toEqual([]);
    for (const [t, cols] of Object.entries(USER_ID_COLUMNS_WITHOUT_FK)) {
      expect(tables.has(t), t).toBe(true);
      for (const c of cols) {
        const known = columns.get(t)?.get(c);
        expect(known, `${t}.${c} is not a uuid column in the migrations`).toBeDefined();
        expect(known!.type.startsWith("uuid"), `${t}.${c}`).toBe(true);
        expect(
          known!.fk,
          `${t}.${c} has a foreign key: the catalog covers it, drop it from the list`,
        ).toBe(false);
      }
    }
    // The ones the owner asked about are covered one way or the other.
    expect(columns.get("service_job_techs")?.get("technician_id")?.fk).toBe(true);
    expect(columns.get("crm_followups")?.get("held_by")?.fk).toBe(true);
    expect(columns.get("crm_followups")?.get("assignee_id")?.fk).toBe(true);
    expect(USER_ID_COLUMNS_WITHOUT_FK["service_jobs"]).toContain("created_by");
    expect(USER_ID_COLUMNS_WITHOUT_FK["audit_log"]).toContain("by_user");
  });
});
