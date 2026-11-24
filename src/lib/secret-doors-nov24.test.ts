// Nov 24 (public pages audit, B4): the doors that open to a secret (the scheduled runs, the
// backup, the restore) give a caller without the right secret ONE plain answer, whether the
// secret is missing on the server, too short, or just not the one sent. The answer names no
// secret and says nothing of the set-up; the reason is written to the server log. A secret that
// is too short is treated as not set.
// EVERY SECRET HERE IS MADE UP.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backupRequest, MIN_SECRET_LENGTH } from "@/lib/backup-export.server";
import { authenticateCron, MIN_CRON_SECRET_LENGTH } from "@/lib/cron-auth";
import { restoreRequest } from "@/lib/restore-door.server";
import { Route as BackupRoute } from "@/routes/api.backup";
import { Route as RestoreRoute } from "@/routes/api.restore";

const read = (p: string) => readFileSync(p, "utf8");

/** Everything a caller can see of an answer. */
const seen = async (r: Response | null) => ({
  status: r?.status,
  type: r?.headers.get("content-type") ?? null,
  body: await r?.text(),
});
/** Words that would tell a stranger about the set-up. */
const TELLING = /SECRET|not set|is off|are off|too short|at least|characters|Lovable|configur/i;

const NAMES = [
  "CRON_SECRET",
  "LOVABLE_CRON_SECRET",
  "LOVABLE_CRON_SECRET_PREVIOUS",
  "BACKUP_SECRET",
  "RESTORE_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const saved: Record<string, string | undefined> = {};
const logged: string[] = [];
beforeEach(() => {
  for (const n of NAMES) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
  logged.length = 0;
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    logged.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

describe("the scheduled runs (/api/cron/*)", () => {
  const GOOD = "a-made-up-cron-secret-of-length";
  const cron = (token?: string) =>
    new Request("https://app.test/api/cron/leads", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it("no secret on the server, a short one, and a wrong one all get the same answer", async () => {
    const missing = await seen(await authenticateCron(cron("anything")));
    process.env["CRON_SECRET"] = "short";
    const short = await seen(await authenticateCron(cron("anything")));
    process.env["CRON_SECRET"] = GOOD;
    const wrong = await seen(await authenticateCron(cron("anything")));
    const none = await seen(await authenticateCron(cron()));
    expect(missing).toEqual({
      status: 401,
      type: "text/plain;charset=UTF-8",
      body: "Unauthorized",
    });
    expect(short).toEqual(missing);
    expect(wrong).toEqual(missing);
    expect(none).toEqual(missing);
    expect(missing.body).not.toMatch(TELLING);
  });

  it("with Lovable's own secret set too, a wrong caller still gets that same answer", async () => {
    process.env["LOVABLE_CRON_SECRET"] = "lovable-made-up-value";
    const lovableOnly = await seen(await authenticateCron(cron("anything")));
    process.env["CRON_SECRET"] = GOOD;
    const both = await seen(await authenticateCron(cron("anything")));
    expect(lovableOnly).toEqual({
      status: 401,
      type: "text/plain;charset=UTF-8",
      body: "Unauthorized",
    });
    expect(both).toEqual(lovableOnly);
  });

  it("the reason is in the server log: nothing set", async () => {
    await authenticateCron(cron("anything"));
    expect(logged).toEqual([
      "Cron: refused. No usable CRON_SECRET or LOVABLE_CRON_SECRET is set on this server (Lovable Cloud › Secrets), so no scheduled run can start.",
    ]);
  });

  it("a CRON_SECRET shorter than 16 characters is treated as not set: even the caller who knows it is refused", async () => {
    expect(MIN_CRON_SECRET_LENGTH).toBe(16);
    const fifteen = "abcdefghijklmno";
    expect(fifteen).toHaveLength(15);
    process.env["CRON_SECRET"] = fifteen;
    expect((await authenticateCron(cron(fifteen)))?.status).toBe(401);
    expect(logged[0]).toBe(
      "Cron: CRON_SECRET is shorter than 16 characters, so it is treated as not set. Set a longer one in Lovable Cloud › Secrets and in the GitHub repository's Actions secrets.",
    );
    // Never the secret itself in the log.
    expect(logged.join("\n")).not.toContain(fifteen);
    // One character more and it is a secret.
    const sixteen = `${fifteen}p`;
    process.env["CRON_SECRET"] = sixteen;
    expect(await authenticateCron(cron(sixteen))).toBeNull();
    // A space or a line end from a paste does not count towards the length.
    process.env["CRON_SECRET"] = `  ${fifteen}\n`;
    expect((await authenticateCron(cron(fifteen)))?.status).toBe(401);
  });

  it("a short CRON_SECRET does not close the door to Lovable's own scheduling", async () => {
    process.env["CRON_SECRET"] = "short";
    process.env["LOVABLE_CRON_SECRET"] = "lovable-made-up-value";
    expect(await authenticateCron(cron("lovable-made-up-value"))).toBeNull();
    expect((await authenticateCron(cron("short")))?.status).toBe(401);
  });

  it("the right secret still opens it, and nothing is logged", async () => {
    process.env["CRON_SECRET"] = GOOD;
    expect(await authenticateCron(cron(GOOD))).toBeNull();
    expect(logged).toEqual([]);
  });

  it("every scheduled route asks this one check first", () => {
    for (const f of ["api.cron.leads.ts", "api.cron.storms.ts", "api.cron.reminders.ts"]) {
      const src = read(`src/routes/${f}`);
      expect(src, f).toContain('import { authenticateCron } from "@/lib/cron-auth";');
      expect(src, f).toMatch(/const denied = await authenticateCron\(request[^)]*\);/);
    }
    expect(read("src/lib/leads-import.server.ts")).toContain(
      "const denied = await authenticateCron(request);",
    );
    // No route asks Lovable's generated check directly: it answers a missing secret differently.
    for (const f of readdirSync("src/routes"))
      expect(read(`src/routes/${f}`), f).not.toContain("authenticateCronRequest");
  });

  it("the GitHub jobs fail on any refusal, whatever its number", () => {
    for (const f of ["leads.yml", "reminders.yml", "storms.yml"])
      expect(read(`.github/workflows/${f}`), f).toMatch(
        /curl -sS -f -X POST "\$APP_URL\/api\/cron\//,
      );
  });
});

describe("the backup door (/api/backup)", () => {
  const SECRET = "a-long-backup-password-the-owner-made-up";
  const ENV = { secret: SECRET, url: "https://proj.supabase.co/", key: "service-key-xyz" };
  const get = (auth: string | null) =>
    new Request("https://portal.example/api/backup?what=tables", {
      method: "GET",
      headers: auth === null ? {} : { Authorization: auth },
    });
  const never = (async () => {
    throw new Error("nothing upstream may be asked");
  }) as unknown as typeof fetch;

  it("no password on the server, a short one, and a wrong one all get the same answer", async () => {
    const quiet = () => {};
    const warned: string[] = [];
    const warn = (l: string) => warned.push(l);
    const ask = (secret: string | undefined, auth: string | null) =>
      backupRequest(get(auth), { ...ENV, secret }, never, quiet, warn).then(seen);
    const missing = await ask(undefined, "Bearer anything");
    const short = await ask("short", "Bearer short");
    const wrong = await ask(SECRET, "Bearer anything");
    const none = await ask(SECRET, null);
    expect(missing).toEqual({
      status: 401,
      type: "text/plain;charset=UTF-8",
      body: "Unauthorized",
    });
    expect(short).toEqual(missing);
    expect(wrong).toEqual(missing);
    expect(none).toEqual(missing);
    expect(missing.body).not.toMatch(TELLING);
    // The reason is in the server log, once for each of the two set-up faults.
    expect(warned).toEqual([
      "[backup] BACKUP_SECRET is not set on this server (Lovable Cloud › Secrets): every call is refused until it is",
      "[backup] BACKUP_SECRET is shorter than 24 characters: every call is refused until it is longer",
    ]);
  });

  it("a password shorter than the shortest length is treated as not set, even for the caller who knows it", async () => {
    expect(MIN_SECRET_LENGTH).toBeGreaterThanOrEqual(16);
    const fifteen = "abcdefghijklmno";
    const r = await backupRequest(
      get(`Bearer ${fifteen}`),
      { ...ENV, secret: fifteen },
      never,
      () => {},
      () => {},
    );
    expect(r.status).toBe(401);
  });

  it("through the route itself, with nothing set on the server: the plain answer, the reason logged as an error", async () => {
    const handlers = (
      BackupRoute as unknown as {
        options: { server: { handlers: { GET: (a: { request: Request }) => Promise<Response> } } };
      }
    ).options.server.handlers;
    const r = await seen(await handlers.GET({ request: get("Bearer anything") }));
    expect(r).toEqual({ status: 401, type: "text/plain;charset=UTF-8", body: "Unauthorized" });
    expect(logged).toEqual([
      "[backup] BACKUP_SECRET is not set on this server (Lovable Cloud › Secrets): every call is refused until it is",
    ]);
  });
});

describe("the restore door (/api/restore)", () => {
  const SECRET = "a-long-restore-password-the-owner-made-up";
  const ENV = { secret: SECRET, url: "https://abcdefgh.supabase.co", key: "service-key-xyz" };
  const post = (auth: string | null) =>
    new Request("https://portal.example/api/restore", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth === null ? {} : { Authorization: auth }),
      },
      body: JSON.stringify({ op: "identify" }),
    });
  const REFUSED = {
    status: 403,
    type: "application/json",
    body: JSON.stringify({ ok: false, error: "Restore refused" }),
  };

  it("no password on the server, a short one, and a wrong one all get the same answer", async () => {
    const lines: string[] = [];
    // Only the log is handed in: a refused call must never reach the database or storage.
    const deps = { log: (l: string) => lines.push(l) } as never;
    const ask = (secret: string | undefined, auth: string | null) =>
      restoreRequest(post(auth), { ...ENV, secret }, deps).then(seen);
    const missing = await ask(undefined, "Bearer anything");
    const short = await ask("short", "Bearer short");
    const wrong = await ask(SECRET, "Bearer anything");
    const none = await ask(SECRET, null);
    expect(missing).toEqual(REFUSED);
    expect(short).toEqual(missing);
    expect(wrong).toEqual(missing);
    expect(none).toEqual(missing);
    expect(missing.body).not.toMatch(TELLING);
    // The log tells the three apart.
    expect(lines[0]).toContain("Restores are off: RESTORE_SECRET is not set");
    expect(lines[1]).toContain("Restores are off: RESTORE_SECRET is shorter than 24 characters");
    expect(lines[2]).toContain("(wrong password)");
  });

  it("a password shorter than the shortest length is treated as not set, even for the caller who knows it", async () => {
    const fifteen = "abcdefghijklmno";
    const deps = { log: () => {} } as never;
    const r = await restoreRequest(post(`Bearer ${fifteen}`), { ...ENV, secret: fifteen }, deps);
    expect(await seen(r)).toEqual(REFUSED);
  });

  it("through the route itself, with nothing set on the server: the plain answer, the reason logged as an error", async () => {
    const handlers = (
      RestoreRoute as unknown as {
        options: { server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } } };
      }
    ).options.server.handlers;
    const r = await seen(await handlers.POST({ request: post(null) }));
    expect(r).toEqual(REFUSED);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(
      "Restores are off: RESTORE_SECRET is not set in Lovable Cloud › Secrets. Every call is refused until it is.",
    );
  });

  it("the words that name the secret are for the log only", () => {
    const src = read("src/lib/restore-door.server.ts");
    expect(src).toContain('const REFUSED = "Restore refused";');
    expect(src.split("return fail(403, REFUSED);").length - 1).toBe(3);
    expect(src).not.toContain("fail(403, SECRET_OFF)");
    expect(src).not.toContain("fail(403, SECRET_SHORT)");
  });
});
