/**
 * Owner, Oct 13: "On CenterPoint you can create a shareable link for the invoice, can we have
 * that as well?" A customer with the link opens the invoice PDF in a browser, no login; the
 * office makes the link from the invoice, copies it, sees whether it was viewed, turns it off.
 *
 *  1. The pure helpers (invoice-share.ts): the token shape, the URL, which statuses share, the
 *     wording of the views line, the email line, the log line.
 *  2. The migration: four columns, the unique partial index, invoice_share_viewed for the
 *     service role alone; audit_row() untouched.
 *  3. The public route (src/routes/i.$token.ts), run for real against an in-memory admin client:
 *     GET serves the stored PDF inline, private, unindexed, and counts the view; a bad or unknown
 *     token, a turned-off link and a void invoice are the plain 404 page; POST is 405; the log
 *     never carries the token.
 *  4. The server functions (invoices.functions.ts) on the fake client: create (office only, a
 *     draft and a void refused, the same token twice), revoke (counts kept), and Send — the link
 *     made on send and its line appended only when APP_URL is set.
 *  5. The editor: Create share link / Copy / Turn off link, hidden on a draft and a void, the
 *     Send dialog's note.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const admin = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    if (!admin.db) throw new Error("Missing Supabase environment variable(s)");
    return admin.db;
  },
}));
const emails: Array<{ to: string[]; text: string; pdf: Uint8Array }> = [];
vi.mock("@/lib/invoices.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/invoices.server")>()),
  renderInvoicePdf: vi.fn(async () => new Uint8Array([1, 2, 3])),
  emailInvoice: vi.fn(async (i: { to: string[]; text: string; pdf: Uint8Array }) => {
    emails.push({ to: i.to, text: i.text, pdf: i.pdf });
    return { ok: true };
  }),
}));

import {
  canShareInvoice,
  isShareToken,
  SHARE_GONE_TEXT,
  SHARE_PATH,
  SHARE_TOKEN_BYTES,
  SHAREABLE_STATUSES,
  shareBase,
  shareGonePage,
  shareLinkLine,
  shareLogLine,
  shareProblem,
  shareStateOf,
  shareUrl,
  shareViewsText,
} from "@/lib/invoice-share";
import {
  createInvoiceShareLink,
  INVOICE_STATUSES,
  revokeInvoiceShareLink,
  sendInvoice,
} from "@/lib/invoices.functions";
import { Route as ShareRoute } from "@/routes/i.$token";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const MIGRATION = "supabase/migrations/20261013140000_invoice_share_links.sql";
const ROUTE = "src/routes/i.$token.ts";
const EDITOR = "src/components/service/invoice-editor.tsx";
const FUNCTIONS = "src/lib/invoices.functions.ts";

/** A token of the right shape (32 bytes as base64url = 43 chars), fixed for the fixtures. */
const TOKEN = Buffer.alloc(32, 7).toString("base64url");
const OTHER = Buffer.alloc(32, 9).toString("base64url");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INV = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const STORED_PATH = `invoices/6012.2-${INV.slice(0, 8)}.pdf`;
const STORED = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]);

// ---------------------------------------------------------------------------------------------

describe("1. the pure helpers", () => {
  it("isShareToken: base64url of 32 bytes, 43 characters, nothing else", () => {
    expect(SHARE_TOKEN_BYTES).toBe(32);
    expect(TOKEN).toHaveLength(43);
    expect(isShareToken(TOKEN)).toBe(true);
    expect(isShareToken("a".repeat(43))).toBe(true);
    expect(isShareToken("A-Z_a-z0-9".padEnd(43, "x"))).toBe(true);
    // The wrong length.
    expect(isShareToken("a".repeat(42))).toBe(false);
    expect(isShareToken("a".repeat(44))).toBe(false);
    expect(isShareToken("")).toBe(false);
    // The wrong alphabet: plain base64 (+ / =), spaces, a dot, a slash (a path).
    expect(isShareToken("a".repeat(42) + "+")).toBe(false);
    expect(isShareToken("a".repeat(42) + "/")).toBe(false);
    expect(isShareToken("a".repeat(42) + "=")).toBe(false);
    expect(isShareToken("a".repeat(42) + " ")).toBe(false);
    expect(isShareToken("a".repeat(42) + ".")).toBe(false);
    // Not a string.
    expect(isShareToken(null)).toBe(false);
    expect(isShareToken(undefined)).toBe(false);
    expect(isShareToken(42)).toBe(false);
    expect(isShareToken(["a".repeat(43)])).toBe(false);
  });
  it("shareUrl: `${origin}/i/${token}`, a trailing slash on the origin dropped", () => {
    expect(SHARE_PATH).toBe("/i");
    expect(shareUrl("https://portal.example.com", TOKEN)).toBe(
      `https://portal.example.com/i/${TOKEN}`,
    );
    expect(shareUrl("https://portal.example.com/", TOKEN)).toBe(
      `https://portal.example.com/i/${TOKEN}`,
    );
    expect(shareUrl("http://localhost:8080", TOKEN)).toBe(`http://localhost:8080/i/${TOKEN}`);
  });
  it("shareBase: APP_URL without its trailing slash; null when unset or blank", () => {
    expect(shareBase("https://portal.example.com/")).toBe("https://portal.example.com");
    expect(shareBase("https://portal.example.com")).toBe("https://portal.example.com");
    expect(shareBase("")).toBeNull();
    expect(shareBase("   ")).toBeNull();
    expect(shareBase(undefined)).toBeNull();
    expect(shareBase(null)).toBeNull();
  });
  it("canShareInvoice: final / sent / paid yes; draft / void no; every status covered", () => {
    expect(SHAREABLE_STATUSES).toEqual(["final", "sent", "paid"]);
    const expected: Record<string, boolean> = {
      draft: false,
      final: true,
      sent: true,
      paid: true,
      void: false,
    };
    expect(Object.keys(expected).sort()).toEqual([...INVOICE_STATUSES].sort());
    for (const s of INVOICE_STATUSES) expect(canShareInvoice(s), s).toBe(expected[s]);
    expect(canShareInvoice(null)).toBe(false);
    expect(canShareInvoice(undefined)).toBe(false);
    expect(canShareInvoice("")).toBe(false);
  });
  it("shareProblem: plain words for a draft and a void; null when it can be shared", () => {
    expect(shareProblem("final")).toBeNull();
    expect(shareProblem("sent")).toBeNull();
    expect(shareProblem("paid")).toBeNull();
    expect(shareProblem("draft")).toBe("A draft has no share link; finalise the invoice first");
    expect(shareProblem("void")).toBe("A void invoice has no share link");
    expect(shareProblem("odd")).toBe("This invoice cannot be shared");
  });
  it("shareViewsText: Not viewed yet / Viewed once, Oct 13 / Viewed 3 times, last Oct 14", () => {
    const tz = { timeZone: "UTC" };
    expect(shareViewsText(0, null, tz)).toBe("Not viewed yet");
    expect(shareViewsText(null, null, tz)).toBe("Not viewed yet");
    expect(shareViewsText(undefined, undefined, tz)).toBe("Not viewed yet");
    expect(shareViewsText(1, "2026-10-13T15:00:00Z", tz)).toBe("Viewed once, Oct 13");
    expect(shareViewsText(3, "2026-10-14T15:00:00Z", tz)).toBe("Viewed 3 times, last Oct 14");
    expect(shareViewsText(2, "2026-10-14T15:00:00Z", tz)).toBe("Viewed 2 times, last Oct 14");
    // A count with no stamp (never written by the app; a hand edit): no dangling comma.
    expect(shareViewsText(1, null, tz)).toBe("Viewed once");
    expect(shareViewsText(5, null, tz)).toBe("Viewed 5 times");
    // Never negative or fractional.
    expect(shareViewsText(-2, "2026-10-14T15:00:00Z", tz)).toBe("Not viewed yet");
    expect(shareViewsText(2.7, "2026-10-14T15:00:00Z", tz)).toBe("Viewed 2 times, last Oct 14");
  });
  it("shareLinkLine: the sentence appended to the invoice email", () => {
    expect(shareLinkLine("https://portal.example.com/i/abc")).toBe(
      "View or download this invoice online: https://portal.example.com/i/abc",
    );
  });
  it("shareStateOf: the four columns on the wire; an older row without them reads as no link", () => {
    expect(
      shareStateOf({
        share_token: TOKEN,
        share_created_at: "2026-10-13T10:00:00Z",
        share_views: 2,
        share_last_viewed_at: "2026-10-13T11:00:00Z",
      }),
    ).toEqual({
      token: TOKEN,
      share_created_at: "2026-10-13T10:00:00Z",
      share_views: 2,
      share_last_viewed_at: "2026-10-13T11:00:00Z",
    });
    expect(shareStateOf({})).toEqual({
      token: null,
      share_created_at: null,
      share_views: 0,
      share_last_viewed_at: null,
    });
  });
  it("the 404 page and the log line: plain words, no token anywhere", () => {
    expect(SHARE_GONE_TEXT).toBe(
      "This invoice link is no longer active. Please contact the office.",
    );
    const page = shareGonePage();
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain(SHARE_GONE_TEXT);
    expect(page).toContain('<meta name="robots" content="noindex">');
    expect(shareLogLine("served", "6012.2")).toBe("Invoice share link: invoice #6012.2 — served");
    expect(shareLogLine("no active link")).toBe("Invoice share link: no invoice — no active link");
    expect(shareLogLine("malformed token")).toBe(
      "Invoice share link: no invoice — malformed token",
    );
    expect(shareLogLine("failed", "6012", "storage down")).toBe(
      "Invoice share link: invoice #6012 — failed (storage down)",
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("2. the migration, 20261013140000_invoice_share_links.sql", () => {
  const flat = flatSql(MIGRATION);
  it("adds the four columns (idempotent), with comments", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(flat).toContain(
      "alter table public.invoices add column if not exists share_token text, add column if not exists share_created_at timestamptz, add column if not exists share_views integer not null default 0, add column if not exists share_last_viewed_at timestamptz;",
    );
    for (const c of ["share_token", "share_created_at", "share_views", "share_last_viewed_at"])
      expect(flat, c).toContain(`comment on column public.invoices.${c} is`);
  });
  it("a live token is unique: the partial unique index", () => {
    expect(flat).toContain(
      "create unique index if not exists invoices_share_token_key on public.invoices (share_token) where share_token is not null;",
    );
  });
  it("invoice_share_viewed(p_token): security definer, bumps the two counters on a live link only, the service role's alone", () => {
    expect(flat).toContain("create or replace function public.invoice_share_viewed(p_token text)");
    expect(flat).toContain("returns void language sql security definer set search_path = public");
    expect(flat).toMatch(
      /update public\.invoices set share_views = share_views \+ 1, share_last_viewed_at = now\(\) where share_token = p_token and status in \('final', 'sent', 'paid'\)/,
    );
    expect(flat).toContain("coalesce(auth.role(), '') = 'service_role'");
    expect(flat).toContain("revoke all on function public.invoice_share_viewed(text) from public;");
    expect(flat).toContain("revoke all on function public.invoice_share_viewed(text) from anon;");
    expect(flat).toContain(
      "revoke all on function public.invoice_share_viewed(text) from authenticated;",
    );
    expect(flat).toContain(
      "grant execute on function public.invoice_share_viewed(text) to service_role;",
    );
    expect(flat).not.toMatch(
      /grant execute on function public\.invoice_share_viewed\(text\) to [^;]*(anon|authenticated|public)/,
    );
    expect(flat).toContain("comment on function public.invoice_share_viewed(text) is");
  });
  it("audit_row() and the table's triggers are left alone (no rewrite, no disable)", () => {
    expect(flat).not.toContain("audit_row()");
    expect(flat).not.toMatch(/disable trigger/i);
    expect(flat).not.toMatch(/create trigger|drop trigger/i);
    expect(flat.match(/create or replace function/g)).toHaveLength(1);
    // The header points at the migration that makes a view silent (v_skip + the updated_at
    // trigger's WHEN clause): 20261013150000_audit_skip_share_views.sql, pinned by
    // src/lib/invoice-share-audit.test.ts.
    const src = read(MIGRATION);
    expect(src).toContain("20261013150000_audit_skip_share_views.sql");
    expect(src).toContain("is silent: no audit row");
  });
  it("the generated types carry the columns and the rpc", () => {
    const types = read("src/integrations/supabase/types.ts");
    const inv = types.slice(
      types.indexOf("      invoices: {\n        Row: {"),
      types.indexOf("      inspection_checklist_items: {"),
    );
    expect(inv).toContain("share_token: string | null;");
    expect(inv).toContain("share_created_at: string | null;");
    expect(inv).toContain("share_views: number;");
    expect(inv).toContain("share_last_viewed_at: string | null;");
    expect(inv).toContain("share_token?: string | null;");
    expect(inv).toContain("share_views?: number;");
    expect(types).toContain(
      "invoice_share_viewed: { Args: { p_token: string }; Returns: undefined };",
    );
  });
});

// ---------------------------------------------------------------------------------------------

const manager = {
  id: ME,
  role: "manager",
  access: [],
  technician: false,
  full_name: "Mo Manager",
  email: "mo@example.com",
};
const invoice = (over: Row = {}): Row => ({
  id: INV,
  service_job_id: JOB,
  number: null,
  display_number: "6012.2",
  status: "final",
  total: 391,
  tax_rate: 0.06,
  payment_terms: "Due on receipt",
  property: { name: "Main St" },
  bill_to: { name: "Acme" },
  finalized_at: "2026-10-01T00:00:00Z",
  pdf_path: STORED_PATH,
  sent_at: null,
  created_at: "2026-10-01T00:00:00Z",
  share_token: null,
  share_created_at: null,
  share_views: 0,
  share_last_viewed_at: null,
  ...over,
});

let env: ReturnType<typeof fakeSupabase>;
function setup(opts: { invoices?: Row[]; objects?: Record<string, Uint8Array> } = {}) {
  emails.length = 0;
  env = fakeSupabase(
    {
      profiles: [manager],
      invoices: opts.invoices ?? [invoice()],
      invoice_lines: [{ id: 1, invoice_id: INV, sort: 0, kind: "labor", description: "Repair" }],
      service_jobs: [
        {
          id: JOB,
          number: 6012,
          customer_name: "Acme",
          stage: "invoiced",
          account_id: null,
          technician_id: null,
          invoice_id: INV,
        },
      ],
      service_settings: [
        { id: 1, tax_rate: 0.06, email_subject: "Invoice #{number}", email_message: "Ready." },
      ],
    },
    {
      objects: opts.objects ?? { [STORED_PATH]: STORED },
      rpcs: {
        // The database function, as the migration writes it: a live link only.
        invoice_share_viewed: (args, tables) => {
          for (const r of tables["invoices"] ?? [])
            if (
              r["share_token"] === args["p_token"] &&
              ["final", "sent", "paid"].includes(String(r["status"]))
            ) {
              r["share_views"] = Number(r["share_views"] ?? 0) + 1;
              r["share_last_viewed_at"] = "2026-10-13T16:00:00Z";
            }
          return null;
        },
      },
    },
  );
  admin.db = env.db;
}
const ctx = () => ({ supabase: env.db, userId: ME });
const call = <T>(fn: unknown, data: Row) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({ data, context: ctx() });
const inv = () => env.tables["invoices"]!.find((r) => r["id"] === INV)!;
const viewRpcs = () => env.rpcCalls.filter((r) => r.fn === "invoice_share_viewed");

type Handler = (a: { request: Request; params: Record<string, string> }) => Promise<Response>;
const handlers = (
  ShareRoute.options as unknown as { server: { handlers: Record<string, Handler> } }
).server.handlers;
const get = (token: string) =>
  handlers["GET"]!({
    request: new Request(`https://portal.example.com/i/${token}`),
    params: { token },
  });

let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  setup();
});
afterEach(() => {
  info.mockRestore();
  warn.mockRestore();
  vi.unstubAllEnvs();
  admin.db = null;
});
const logged = () =>
  [...info.mock.calls, ...warn.mock.calls].map((c) => c.map(String).join(" ")).join("\n");

describe("3. the public route, GET /i/<token>", () => {
  it("is a server-handler route with no component: outside the sign-in gate by construction", () => {
    const src = read(ROUTE);
    expect(src).toContain('createFileRoute("/i/$token")');
    expect(src).not.toMatch(/component:/);
    expect(src).not.toMatch(/\bANY\b/);
    expect(Object.keys(handlers).sort()).toEqual(["DELETE", "GET", "PATCH", "POST", "PUT"]);
    // The route is in the generated tree, and the gate's page map knows nothing of it.
    expect(read("src/routeTree.gen.ts")).toContain("'/i/$token'");
    expect(read("src/lib/access.ts")).not.toContain('"/i/');
  });
  it("serves the stored PDF inline, private, unindexed — and counts the view", async () => {
    setup({ invoices: [invoice({ share_token: TOKEN })] });
    const res = await get(TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="Invoice-6012.2.pdf"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(STORED));
    expect(viewRpcs()).toEqual([{ fn: "invoice_share_viewed", args: { p_token: TOKEN } }]);
    expect(inv()["share_views"]).toBe(1);
    expect(inv()["share_last_viewed_at"]).toBe("2026-10-13T16:00:00Z");
    // Nothing drawn, nothing written through the table (the counter is the rpc's).
    expect(env.uploads).toEqual([]);
    expect(env.writes).toEqual([]);
    expect(info).toHaveBeenCalledWith("Invoice share link: invoice #6012.2 — served");
  });
  for (const status of ["sent", "paid"]) {
    it(`a ${status} invoice's link works too`, async () => {
      setup({ invoices: [invoice({ status, share_token: TOKEN })] });
      expect((await get(TOKEN)).status).toBe(200);
    });
  }
  it("a view whose counter failed is still served; the failure is a warning", async () => {
    setup({ invoices: [invoice({ share_token: TOKEN })] });
    env = fakeSupabase(env.tables, {
      objects: env.objects,
      rpc: (fn) =>
        fn === "invoice_share_viewed"
          ? { data: null, error: { message: "function not in schema cache" } }
          : undefined,
    });
    admin.db = env.db;
    const res = await get(TOKEN);
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledWith(
      "Invoice share link: invoice #6012.2 — view not counted (function not in schema cache)",
    );
  });
  const expectGone = async (res: Response) => {
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(await res.text()).toContain(SHARE_GONE_TEXT);
    expect(viewRpcs()).toEqual([]);
  };
  it("a token of the wrong shape: 404, nothing looked up", async () => {
    await expectGone(await get("not-a-token"));
    await expectGone(await get("a".repeat(42)));
    expect(info).toHaveBeenCalledWith("Invoice share link: no invoice — malformed token");
  });
  it("a token nobody holds: 404", async () => {
    setup({ invoices: [invoice({ share_token: TOKEN })] });
    await expectGone(await get(OTHER));
    expect(info).toHaveBeenCalledWith("Invoice share link: no invoice — no active link");
  });
  it("a turned-off link (token cleared) and a void invoice's link: 404", async () => {
    setup({ invoices: [invoice({ share_token: null })] });
    await expectGone(await get(TOKEN));
    setup({ invoices: [invoice({ status: "void", share_token: TOKEN })] });
    await expectGone(await get(TOKEN));
    setup({ invoices: [invoice({ status: "draft", share_token: TOKEN })] });
    await expectGone(await get(TOKEN));
  });
  it("the admin client unavailable (no service role): 404, a warning, never a crash", async () => {
    admin.db = null;
    await expectGone(await get(TOKEN));
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/^Invoice share link: no invoice — failed \(/),
    );
  });
  it("POST (and the rest) is 405 Method Not Allowed", async () => {
    setup({ invoices: [invoice({ share_token: TOKEN })] });
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await handlers[m]!({
        request: new Request(`https://portal.example.com/i/${TOKEN}`, { method: m }),
        params: { token: TOKEN },
      });
      expect(res.status, m).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
    }
    expect(viewRpcs()).toEqual([]);
  });
  it("the log never carries the token: one line per request, the invoice number and the outcome", async () => {
    setup({ invoices: [invoice({ share_token: TOKEN })] });
    await get(TOKEN);
    await get(OTHER);
    await get("junk");
    const lines = logged();
    expect(lines).not.toContain(TOKEN);
    expect(lines).not.toContain(OTHER);
    expect(lines).not.toContain("junk");
    expect(info).toHaveBeenCalledTimes(3);
    // The source: every console call goes through shareLogLine or a fixed sentence, never `token`.
    const src = read(ROUTE);
    expect(src).not.toMatch(/console\.\w+\([^)]*\btoken\b/);
    expect(src).toContain("shareLogLine(");
    expect(src).toContain('"cache-control": "private, no-store"');
    expect(src).toContain('"x-robots-tag": "noindex"');
    expect(src).toContain('inline; filename="Invoice-${invoiceFileStem(inv)}.pdf"');
    expect(src).toContain("shareGonePage()");
    expect(src).toContain('.in("status", [...SHAREABLE_STATUSES])');
    expect(src).toContain('supabaseAdmin.rpc("invoice_share_viewed", { p_token: token })');
  });
});

// ---------------------------------------------------------------------------------------------

describe("4. the server functions", () => {
  it("createInvoiceShareLink: a final invoice gets a 43-character token, stored with share_created_at", async () => {
    const r = await call<{ token: string | null; share_created_at: string | null }>(
      createInvoiceShareLink,
      { id: INV },
    );
    expect(isShareToken(r.token)).toBe(true);
    expect(r.share_created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r).toMatchObject({ share_views: 0, share_last_viewed_at: null });
    expect(inv()["share_token"]).toBe(r.token);
    expect(inv()["share_created_at"]).toBe(r.share_created_at);
    expect(inv()["updated_by_name"]).toBe("Mo Manager");
    // Only where the row still had none (two tabs at once end up with one token).
    expect(env.writes).toHaveLength(1);
    expect(env.writes[0]!.filters).toEqual([`eq id=${INV}`, "is share_token=null"]);
  });
  it("a second call returns the same token; nothing written", async () => {
    const a = await call<{ token: string }>(createInvoiceShareLink, { id: INV });
    const b = await call<{ token: string }>(createInvoiceShareLink, { id: INV });
    expect(b.token).toBe(a.token);
    expect(env.writes).toHaveLength(1);
  });
  it("two tokens are different", async () => {
    const a = await call<{ token: string }>(createInvoiceShareLink, { id: INV });
    await call(revokeInvoiceShareLink, { id: INV });
    const b = await call<{ token: string }>(createInvoiceShareLink, { id: INV });
    expect(b.token).not.toBe(a.token);
  });
  for (const status of ["sent", "paid"]) {
    it(`a ${status} invoice can be shared`, async () => {
      setup({ invoices: [invoice({ status })] });
      const r = await call<{ token: string }>(createInvoiceShareLink, { id: INV });
      expect(isShareToken(r.token)).toBe(true);
    });
  }
  it("a draft and a void invoice are refused with a plain message; nothing written", async () => {
    setup({ invoices: [invoice({ status: "draft", pdf_path: null })] });
    await expect(call(createInvoiceShareLink, { id: INV })).rejects.toThrow(
      "A draft has no share link; finalise the invoice first",
    );
    setup({ invoices: [invoice({ status: "void" })] });
    await expect(call(createInvoiceShareLink, { id: INV })).rejects.toThrow(
      "A void invoice has no share link",
    );
    expect(env.writes).toEqual([]);
  });
  it("office only: a technician is refused", async () => {
    env.tables["profiles"]![0] = {
      ...manager,
      role: "user",
      access: ["service"],
      technician: true,
    };
    await expect(call(createInvoiceShareLink, { id: INV })).rejects.toThrow(
      "Invoices are a manager's or sales'",
    );
    await expect(call(revokeInvoiceShareLink, { id: INV })).rejects.toThrow(
      "Invoices are a manager's or sales'",
    );
  });
  it("an unknown invoice: not found", async () => {
    await expect(
      call(createInvoiceShareLink, { id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
    ).rejects.toThrow("Invoice not found");
  });
  it("revokeInvoiceShareLink: the token (and its date) cleared, the view counts kept", async () => {
    setup({
      invoices: [
        invoice({
          share_token: TOKEN,
          share_created_at: "2026-10-13T10:00:00Z",
          share_views: 3,
          share_last_viewed_at: "2026-10-13T12:00:00Z",
        }),
      ],
    });
    const r = await call<Row>(revokeInvoiceShareLink, { id: INV });
    expect(r).toEqual({
      token: null,
      share_created_at: null,
      share_views: 3,
      share_last_viewed_at: "2026-10-13T12:00:00Z",
    });
    expect(inv()["share_token"]).toBeNull();
    expect(inv()["share_views"]).toBe(3);
    // And the link is dead from now on.
    await expect(get(TOKEN)).resolves.toMatchObject({ status: 404 });
  });
  it("revoking an invoice with no link changes nothing", async () => {
    const r = await call<Row>(revokeInvoiceShareLink, { id: INV });
    expect(r["token"]).toBeNull();
    expect(env.writes).toEqual([]);
  });
});

describe("4b. Send carries the link", () => {
  it("with APP_URL set: a token is made on send and the line appended to the email", async () => {
    vi.stubEnv("APP_URL", "https://portal.example.com/");
    const r = await call<{ invoice: Row }>(sendInvoice, {
      id: INV,
      to: ["ap@acme.example"],
      message: "Thanks!",
    });
    const token = inv()["share_token"];
    expect(isShareToken(token)).toBe(true);
    expect(r.invoice["share_token"]).toBe(token);
    expect(emails).toHaveLength(1);
    expect(emails[0]!.text).toBe(
      `Thanks!\n\nInvoice #6012.2 for Main St: $391.00.\nDue on receipt\n\nView or download this invoice online: https://portal.example.com/i/${token}`,
    );
    expect(Array.from(emails[0]!.pdf)).toEqual(Array.from(STORED));
    expect(r.invoice["status"]).toBe("sent");
  });
  it("an existing token is reused on send (no new one)", async () => {
    vi.stubEnv("APP_URL", "https://portal.example.com");
    setup({ invoices: [invoice({ share_token: TOKEN })] });
    await call(sendInvoice, { id: INV, to: ["ap@acme.example"] });
    expect(inv()["share_token"]).toBe(TOKEN);
    expect(emails[0]!.text).toContain(`https://portal.example.com/i/${TOKEN}`);
    expect(env.writes.filter((w) => w.payload && "share_token" in w.payload)).toEqual([]);
  });
  it("without APP_URL: the line is left out (never a broken link); the token still exists", async () => {
    vi.stubEnv("APP_URL", "");
    delete process.env["APP_URL"];
    await call(sendInvoice, { id: INV, to: ["ap@acme.example"] });
    expect(emails).toHaveLength(1);
    expect(emails[0]!.text).toBe("Ready.\n\nInvoice #6012.2 for Main St: $391.00.\nDue on receipt");
    expect(emails[0]!.text).not.toContain("online");
    expect(emails[0]!.text).not.toContain("undefined");
    expect(isShareToken(inv()["share_token"])).toBe(true);
  });
  it("the doc comment says so", () => {
    const src = read(FUNCTIONS);
    expect(src).toContain("when APP_URL is not set the line is left out altogether");
    expect(src).toContain("export async function invoicePdf(");
  });
});

// ---------------------------------------------------------------------------------------------

describe("5. the editor", () => {
  const ed = read(EDITOR);
  it("the share control sits beside Download, for final / sent / paid only (hidden on a draft and a void)", () => {
    expect(ed).toMatch(
      /Download PDF\s*<\/Button>\s*\{\/\*[^*]*\*\/\}\s*\{canShareInvoice\(status\) && <ShareLinkControl ctx=\{ctx\} data=\{data\} \/>\}/,
    );
    expect(ed).toContain(
      "function ShareLinkControl({ ctx, data }: { ctx: Ctx; data: InvoiceWithLines })",
    );
    // One place renders it, inside FinalInvoice; DraftInvoice never does (a draft is not shared).
    expect(ed.match(/<ShareLinkControl/g)).toHaveLength(1);
    const draft = ed.slice(
      ed.indexOf("function DraftInvoice("),
      ed.indexOf("function useAccount("),
    );
    expect(draft).not.toContain("ShareLinkControl");
  });
  it("no link yet → Create share link; with a link → the URL read-only, Copy (toast Link copied), the views text, Turn off link (confirmed)", () => {
    for (const a of ["Create share link", "Copy", "Turn off link"])
      expect(ed, a).toMatch(new RegExp(`[>}]\\s*${a}\\s*<`));
    expect(ed).toContain("shareUrl(origin, inv.share_token)");
    expect(ed).toMatch(/<Input\s+readOnly\s+value=\{url\}/);
    expect(ed).toContain("navigator.clipboard");
    expect(ed).toContain('toast.success("Link copied")');
    expect(ed).toContain("shareViewsText(inv.share_views, inv.share_last_viewed_at)");
    expect(ed).toContain("<AlertDialogTitle>Turn off the share link?</AlertDialogTitle>");
    expect(ed).toContain("useServerFn(createInvoiceShareLink)");
    expect(ed).toContain("useServerFn(revokeInvoiceShareLink)");
    expect(ed).toContain('toast.success("Share link turned off")');
  });
  it("the Send dialog notes that the email carries the link (a draft is finalised on send)", () => {
    expect(ed).toContain(
      '{(props.inv.status === "draft" || canShareInvoice(props.inv.status)) && (',
    );
    expect(ed).toContain("The email includes a link to view the invoice online.");
  });
});
