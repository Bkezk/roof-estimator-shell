/**
 * /api/backup (owner, Oct 7: "could we not do the portal side backup door and i just set the
 * password?"). The door opens only to BACKUP_SECRET, reads only, and never lets the master key
 * or the caller's password cross to the wrong side.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { backupRequest, MIN_SECRET_LENGTH, tableList } from "./backup-export.server";

const SECRET = "a-long-backup-password-the-owner-made-up";
const ENV = { secret: SECRET, url: "https://proj.supabase.co/", key: "service-key-xyz" };
const GET = (qs: string, auth: string | null = `Bearer ${SECRET}`) =>
  new Request(`https://portal.example/api/backup?${qs}`, {
    method: "GET",
    headers: auth === null ? {} : { Authorization: auth, "x-forwarded-for": "10.0.0.5, 1.2.3.4" },
  });

interface Call {
  url: string;
  init: RequestInit;
}
function fakeFetch(answer: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return answer(url, init ?? {});
  }) as typeof fetch;
  return { f, calls };
}
const openapi = {
  definitions: {
    bids: { properties: { id: {}, name: {} } },
    company_settings: { properties: { key: {} } },
    "Bad Name": { properties: {} },
    audit_log: { properties: { id: {} } },
  },
};
const headersOf = (c: Call) => new Headers(c.init.headers);

describe("/api/backup — who gets in", () => {
  it("answers 500 while BACKUP_SECRET is unset or too short, never serving", async () => {
    const { f, calls } = fakeFetch(() => Response.json(openapi));
    const unset = await backupRequest(GET("what=tables"), { ...ENV, secret: undefined }, f);
    expect(unset.status).toBe(500);
    expect(await unset.text()).toContain("BACKUP_SECRET is not set");
    const short = await backupRequest(
      GET("what=tables", "Bearer short"),
      { ...ENV, secret: "short" },
      f,
    );
    expect(short.status).toBe(500);
    expect(await short.text()).toContain(`at least ${MIN_SECRET_LENGTH} characters`);
    expect(calls).toHaveLength(0);
  });
  it("refuses a wrong or missing password (401) and anything but GET (405), touching nothing", async () => {
    const { f, calls } = fakeFetch(() => Response.json(openapi));
    expect((await backupRequest(GET("what=tables", "Bearer nope"), ENV, f)).status).toBe(401);
    expect((await backupRequest(GET("what=tables", null), ENV, f)).status).toBe(401);
    expect((await backupRequest(GET("what=tables", `Bearer ${SECRET}x`), ENV, f)).status).toBe(401);
    const post = new Request("https://portal.example/api/backup?what=tables", {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
    });
    expect((await backupRequest(post, ENV, f)).status).toBe(405);
    expect(calls).toHaveLength(0);
  });
  it("logs every call with the caller's address, refused or not", async () => {
    const { f } = fakeFetch(() => Response.json(openapi));
    const lines: string[] = [];
    await backupRequest(GET("what=tables"), ENV, f, (l) => lines.push(l));
    await backupRequest(GET("what=rows&table=bids", "Bearer nope"), ENV, f, (l) => lines.push(l));
    expect(lines[0]).toContain("ok 10.0.0.5 what=tables");
    expect(lines[1]).toContain("refused 401 10.0.0.5 what=rows table=bids");
  });
});

describe("/api/backup — what it reads", () => {
  it("tables: the data API's description, plain names sorted, hasId from the schema", async () => {
    const { f, calls } = fakeFetch(() => Response.json(openapi));
    const res = await backupRequest(GET("what=tables"), ENV, f);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReturnType<typeof tableList>;
    expect(body.tables).toEqual([
      { name: "audit_log", hasId: true },
      { name: "bids", hasId: true },
      { name: "company_settings", hasId: false },
    ]);
    expect(Object.keys(body.schema)).toContain("bids");
    expect(calls[0]!.url).toBe("https://proj.supabase.co/rest/v1/");
    const h = headersOf(calls[0]!);
    expect(h.get("apikey")).toBe("service-key-xyz");
    expect(h.get("authorization")).toBe("Bearer service-key-xyz");
  });
  it("buckets: every storage bucket's name, so a new bucket needs no config change", async () => {
    const { f, calls } = fakeFetch(() =>
      Response.json([
        { id: "takeoffs", name: "takeoffs", public: false },
        { id: "service", name: "service", public: false },
        { id: "x", name: "Bad Name" },
      ]),
    );
    const res = await backupRequest(GET("what=buckets"), ENV, f);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ buckets: ["service", "takeoffs"] });
    expect(calls[0]!.url).toBe("https://proj.supabase.co/storage/v1/bucket");
    expect(calls[0]!.init.method).toBe("GET");
  });
  it("rows: one page of up to 1,000 rows with the exact count passed through", async () => {
    const { f, calls } = fakeFetch(
      () =>
        new Response('[{"id":1}]', {
          headers: { "content-range": "2000-2000/2001", "content-type": "application/json" },
        }),
    );
    const res = await backupRequest(
      GET("what=rows&table=bids&offset=2000&order=id&limit=5000"),
      ENV,
      f,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-range")).toBe("2000-2000/2001");
    expect(await res.text()).toBe('[{"id":1}]');
    expect(calls[0]!.url).toBe(
      "https://proj.supabase.co/rest/v1/bids?select=*&limit=1000&offset=2000&order=id.asc",
    );
    expect(headersOf(calls[0]!).get("prefer")).toBe("count=exact");
    // No order when the script says the table has no id column.
    await backupRequest(GET("what=rows&table=company_settings"), ENV, f);
    expect(calls[1]!.url).toBe(
      "https://proj.supabase.co/rest/v1/company_settings?select=*&limit=1000&offset=0",
    );
  });
  it("rows: refuses anything but a plain table name or whole-number paging", async () => {
    const { f, calls } = fakeFetch(() => new Response("[]"));
    for (const qs of [
      "what=rows&table=bids;drop",
      "what=rows&table=../auth",
      "what=rows&table=bids&offset=-1",
      "what=rows&table=bids&offset=1.5",
      "what=rows&table=Bids",
      "what=rows",
    ]) {
      expect((await backupRequest(GET(qs), ENV, f)).status, qs).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
  it("files: the storage listing (the one POST, a read) with prefix and paging", async () => {
    const { f, calls } = fakeFetch(() => Response.json([{ name: "a.jpg", id: "x" }]));
    const res = await backupRequest(
      GET("what=files&bucket=service&prefix=tickets%2F12&offset=1000"),
      ENV,
      f,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ name: "a.jpg", id: "x" }]);
    expect(calls[0]!.url).toBe("https://proj.supabase.co/storage/v1/object/list/service");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      prefix: "tickets/12",
      limit: 1000,
      offset: 1000,
      sortBy: { column: "name", order: "asc" },
    });
    expect((await backupRequest(GET("what=files&bucket=Bad%20Bucket"), ENV, f)).status).toBe(400);
  });
  it("file: streams one stored file with its type and size, refusing paths that climb out", async () => {
    const { f, calls } = fakeFetch(
      () =>
        new Response("JPEGDATA", {
          headers: { "content-type": "image/jpeg", "content-length": "8" },
        }),
    );
    const res = await backupRequest(
      GET("what=file&bucket=service&path=tickets%2F12%2Fa%20b.jpg"),
      ENV,
      f,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(await res.text()).toBe("JPEGDATA");
    expect(calls[0]!.url).toBe(
      "https://proj.supabase.co/storage/v1/object/service/tickets/12/a%20b.jpg",
    );
    expect(calls[0]!.init.method).toBe("GET");
    for (const qs of [
      "what=file&bucket=service&path=..%2Fsecret",
      "what=file&bucket=service&path=%2Fetc",
      "what=file&bucket=service",
    ]) {
      expect((await backupRequest(GET(qs), ENV, f)).status, qs).toBe(400);
    }
    expect(calls).toHaveLength(1);
  });
  it("passes an upstream refusal through as an error, and 400 for an unknown question", async () => {
    const { f } = fakeFetch(() => new Response("relation does not exist", { status: 404 }));
    const res = await backupRequest(GET("what=rows&table=nope"), ENV, f);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("relation does not exist");
    expect((await backupRequest(GET("what=everything"), ENV, f)).status).toBe(400);
  });
  it("never forwards the caller's password upstream, and never uses a writing method", async () => {
    const { f, calls } = fakeFetch(() => new Response("[]"));
    await backupRequest(GET("what=rows&table=bids"), ENV, f);
    await backupRequest(GET("what=files&bucket=service"), ENV, f);
    await backupRequest(GET("what=file&bucket=service&path=a.jpg"), ENV, f);
    for (const c of calls) {
      expect(headersOf(c).get("authorization")).toBe("Bearer service-key-xyz");
      expect(JSON.stringify(c)).not.toContain(SECRET);
      expect(["GET", "POST"]).toContain(c.init.method);
    }
    const src = readFileSync(
      fileURLToPath(new URL("./backup-export.server.ts", import.meta.url)),
      "utf8",
    );
    expect(src).not.toMatch(/method:\s*"(PUT|PATCH|DELETE)"/);
    // No database client at all: the only writer-capable thing (createHash().update) is a hash.
    expect(src).not.toMatch(/supabaseAdmin|\.from\(|\.rpc\(|\.insert\(|\.upsert\(|\.delete\(/);
    expect((src.match(/method:\s*"POST"/g) ?? []).length).toBe(1);
    const route = readFileSync(
      fileURLToPath(new URL("../routes/api.backup.ts", import.meta.url)),
      "utf8",
    );
    expect(route).toContain('await import("@/lib/backup-export.server")');
    expect(route).not.toMatch(/^import .*backup-export\.server/m);
  });
});
