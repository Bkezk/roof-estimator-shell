/**
 * A card payment page that can be closed (the audit of Nov 25, numbers 1, 4 and 28; owner:
 * "go on 1, 2, 3 ... 4 ... 28").
 *
 * Until this a page stayed open for a day and the site threw its name away, so nothing could
 * close one: a page opened before a roof size was corrected still charged the old price. And
 * the key Stripe knows an ask by left out the customer's email, so an email corrected within
 * the hour made Stripe refuse the page.
 *
 *   1. Every page closes by itself, 60 to 75 minutes after it is asked for, and the key and the
 *      closing time come from the same quarter hour.
 *   2. The key holds a mark of the whole ask.
 *   3. Every page is kept on its plan, and expirePlanCardPages closes the open ones.
 *   4. openPlanCardPage, the one door: closes pages for another amount first, makes a new page
 *      when Stripe hands back one the site closed, and hands out no page it could not keep.
 *   5. The price is in US dollars for everyone (adaptive pricing off).
 *
 * Every test of the server fails on the code of Nov 25. Amounts and names are made up.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CARD_PAGE_BUCKET_S,
  CARD_PAGE_LIFE_S,
  CARD_PAGE_NOT_KEPT,
  cardPageKey,
  cardPageTimes,
  checkoutForm,
  openCardSessions,
  readCardSessions,
  type CheckoutAsk,
} from "@/lib/roof-care-checkout";
import {
  createCheckoutSession,
  expirePlanCardPages,
  openPlanCardPage,
  planCardState,
} from "@/lib/roof-care-checkout.server";
import { fakeSupabase } from "@/test/fake-supabase";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const sqlFlat = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const PLAN = "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e26";
/** 10:07:30 of some day: seven and a half minutes into a quarter hour. */
const NOW = 1_800_000_000 - (1_800_000_000 % 900) + 450;
const BUCKET_START = NOW - 450;

const ask = (over: Partial<CheckoutAsk> = {}): CheckoutAsk => ({
  plan_id: PLAN,
  plan: "care",
  plan_number: 1077,
  site_name: "Main Plant",
  cents: 84000,
  email: "pat@example.com",
  success_url: "https://portal.example.com/properties/s1",
  cancel_url: "https://portal.example.com/properties/s1",
  ...over,
});

interface Call {
  url: string;
  method: string;
  key: string;
  body: URLSearchParams;
}
/** Stripe, stood in for: it makes pages, remembers keys, and closes or refuses to close. */
function stripe(opts: { status?: Record<string, string>; down?: boolean } = {}) {
  const calls: Call[] = [];
  const byKey = new Map<string, string>();
  let n = 0;
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = {
      url,
      method: init.method ?? "GET",
      key: headers["Idempotency-Key"] ?? "",
      body: new URLSearchParams(String(init.body ?? "")),
    };
    calls.push(call);
    if (opts.down) throw new Error("network down");
    const json = (status: number, body: unknown) => ({
      ok: status < 300,
      status,
      json: async () => body,
    });
    if (url.endsWith("/checkout/sessions") && call.method === "POST") {
      // The same key hands back the same page, as Stripe does.
      let id = byKey.get(call.key);
      if (!id) {
        n += 1;
        id = `cs_test_page${n}`;
        byKey.set(call.key, id);
      }
      return json(200, { id, url: `https://card.example.com/pay/${id}` });
    }
    const id = decodeURIComponent(url.split("/sessions/")[1]!.replace("/expire", ""));
    const state = opts.status?.[id] ?? "open";
    if (url.endsWith("/expire")) {
      if (state === "open") return json(200, { id, status: "expired" });
      return json(400, { error: { message: "Only open sessions can be expired" } });
    }
    if (state === "gone") return json(404, { error: { message: "No such session" } });
    return json(200, { id, status: state });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

/** The database's two functions for the kept pages, stood in for as the migration writes them. */
const world = (sessions: Record<string, unknown>[] = [], opts: { keepFails?: boolean } = {}) =>
  fakeSupabase(
    { roof_care_plans: [{ id: PLAN, card_sessions: sessions }] },
    {
      rpcs: {
        roof_care_card_session_keep: (a, t) => {
          if (opts.keepFails) throw new Error("could not reach the database");
          const row = t["roof_care_plans"]![0]!;
          const list = row["card_sessions"] as Record<string, unknown>[];
          if (!list.some((e) => e["id"] === a["p_id"]))
            row["card_sessions"] = [
              ...list,
              { id: a["p_id"], cents: a["p_cents"], via: a["p_via"], expires: a["p_expires"] },
            ];
          return (row["card_sessions"] as unknown[]).length;
        },
        roof_care_card_sessions_closed: (a, t) => {
          const row = t["roof_care_plans"]![0]!;
          const ids = a["p_ids"] as string[];
          row["card_sessions"] = (row["card_sessions"] as Record<string, unknown>[]).map((e) =>
            ids.includes(String(e["id"])) && !e["closed_at"]
              ? { ...e, closed_at: "2026-11-26T15:00:00Z" }
              : e,
          );
          return ids.length;
        },
      },
    },
  );
const kept = (env: ReturnType<typeof world>) =>
  readCardSessions(env.tables["roof_care_plans"]![0]!["card_sessions"]);

let noisy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_made_up_for_tests");
  noisy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  noisy.mockRestore();
});

describe("1. a page closes by itself", () => {
  it("60 to 75 minutes after it is asked for, wherever in the quarter hour that is", () => {
    expect(CARD_PAGE_BUCKET_S).toBe(900);
    expect(CARD_PAGE_LIFE_S).toBe(75 * 60);
    for (const into of [0, 1, 450, 899]) {
      const t = cardPageTimes(BUCKET_START + into);
      expect(t.expires_at).toBe(BUCKET_START + 75 * 60);
      const left = t.expires_at - (BUCKET_START + into);
      // Stripe refuses a page with less than 30 minutes. This always has an hour.
      expect(left).toBeGreaterThan(60 * 60);
      expect(left).toBeLessThanOrEqual(75 * 60);
    }
    // The next quarter hour is the next page's.
    expect(cardPageTimes(BUCKET_START + 900).bucket).toBe(cardPageTimes(BUCKET_START).bucket + 1);
  });
  it("the closing time goes to Stripe with the page", async () => {
    const s = stripe();
    await createCheckoutSession(ask(), s.fetcher, NOW);
    expect(s.calls[0]!.body.get("expires_at")).toBe(String(BUCKET_START + 75 * 60));
    // Until Nov 26 the form had no closing time at all: Stripe kept the page open for a day.
    expect(checkoutForm(ask()).has("expires_at")).toBe(false);
    expect(checkoutForm(ask({ expires_at: 123 })).get("expires_at")).toBe("123");
  });
  it("asked for twice in the same quarter hour it is one ask: the same key, the same closing time", async () => {
    const s = stripe();
    const a = await createCheckoutSession(ask(), s.fetcher, BUCKET_START + 5);
    const b = await createCheckoutSession(ask(), s.fetcher, BUCKET_START + 890);
    expect(s.calls[0]!.key).toBe(s.calls[1]!.key);
    expect(s.calls[0]!.body.toString()).toBe(s.calls[1]!.body.toString());
    expect(b.id).toBe(a.id);
    // In the next quarter hour it is a new page, which closes a quarter hour later.
    const c = await createCheckoutSession(ask(), s.fetcher, BUCKET_START + 900);
    expect(c.id).not.toBe(a.id);
    expect(s.calls[2]!.body.get("expires_at")).toBe(String(BUCKET_START + 900 + 75 * 60));
  });
});

describe("2. the key holds a mark of the whole ask", () => {
  it("an email corrected within the quarter hour is a new page, not a refusal", async () => {
    const s = stripe();
    await createCheckoutSession(ask(), s.fetcher, NOW);
    await createCheckoutSession(ask({ email: "pat.smith@example.com" }), s.fetcher, NOW);
    await createCheckoutSession(ask({ site_name: "Main Plant North" }), s.fetcher, NOW);
    await createCheckoutSession(ask({ plan_number: 1078 }), s.fetcher, NOW);
    const keys = s.calls.map((c) => c.key);
    // On the code of Nov 25 all four keys were the same, with four different bodies: Stripe
    // answers that with "Keys for idempotent requests can only be used with the same
    // parameters".
    expect(new Set(keys).size).toBe(4);
    for (const k of keys)
      expect(k).toMatch(new RegExp(`^roof-care-${PLAN}-84000-\\d+-[0-9a-f]{16}$`));
  });
  it("the customer's page and the office's page stay apart, and so do two amounts", () => {
    expect(cardPageKey(ask(), 7, "abc")).toBe(`roof-care-${PLAN}-84000-7-abc`);
    expect(cardPageKey(ask({ via: "link" }), 7, "abc")).toBe(`roof-care-link-${PLAN}-84000-7-abc`);
    expect(cardPageKey(ask({ cents: 91000 }), 7, "abc")).toBe(`roof-care-${PLAN}-91000-7-abc`);
    expect(cardPageKey(ask(), 7, "abc", "again-9")).toBe(`roof-care-${PLAN}-84000-7-abc-again-9`);
  });
});

describe("3. the pages kept on a plan", () => {
  it("are read strictly: anything that is not a page is left out", () => {
    expect(
      readCardSessions([
        { id: "cs_test_abc123", cents: 84000, via: "link", expires: 1700, at: "x" },
        { id: "cs_test_def456", cents: "91000", via: "office", closed_at: "2026-11-26T15:00:00Z" },
        { id: "not a page", cents: 1 },
        { id: "cs_test_ghi789", cents: 0 },
        null,
        "cs_test_text",
      ]),
    ).toEqual([
      { id: "cs_test_abc123", cents: 84000, via: "link", expires: 1700, closed: false },
      { id: "cs_test_def456", cents: 91000, via: "office", expires: 0, closed: true },
    ]);
    expect(readCardSessions(null)).toEqual([]);
    expect(readCardSessions({ id: "cs_test_abc123" })).toEqual([]);
  });
  it("open means not closed and not over by itself", () => {
    const list = readCardSessions([
      { id: "cs_test_open01", cents: 1, expires: NOW + 10 },
      { id: "cs_test_over01", cents: 1, expires: NOW },
      { id: "cs_test_shut01", cents: 1, expires: NOW + 10, closed_at: "x" },
    ]);
    expect(openCardSessions(list, NOW).map((s) => s.id)).toEqual(["cs_test_open01"]);
  });
  it("expirePlanCardPages closes every open page at Stripe and marks them on the plan", async () => {
    const env = world([
      { id: "cs_test_first1", cents: 84000, via: "office", expires: NOW + 3000 },
      { id: "cs_test_second", cents: 84000, via: "link", expires: NOW + 3000 },
    ]);
    const s = stripe();
    expect(await expirePlanCardPages(env.db, PLAN, { fetcher: s.fetcher, nowS: NOW })).toEqual({
      closed: 2,
      failed: [],
    });
    expect(s.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://api.stripe.com/v1/checkout/sessions/cs_test_first1/expire",
      "POST https://api.stripe.com/v1/checkout/sessions/cs_test_second/expire",
    ]);
    expect(kept(env).every((x) => x.closed)).toBe(true);
    // A second call has nothing to close, and asks Stripe nothing.
    expect(await expirePlanCardPages(env.db, PLAN, { fetcher: s.fetcher, nowS: NOW })).toEqual({
      closed: 0,
      failed: [],
    });
    expect(s.calls).toHaveLength(2);
  });
  it("a page that was paid, expired by itself or is not there counts as done, not as a failure", async () => {
    const env = world([
      { id: "cs_test_paid01", cents: 84000, via: "office", expires: NOW + 3000 },
      { id: "cs_test_expd01", cents: 84000, via: "office", expires: NOW + 3000 },
      { id: "cs_test_gone01", cents: 84000, via: "office", expires: NOW + 3000 },
      // Over by its own clock: Stripe is not asked about it at all.
      { id: "cs_test_old001", cents: 84000, via: "office", expires: NOW - 5 },
    ]);
    const s = stripe({
      status: { cs_test_paid01: "complete", cs_test_expd01: "expired", cs_test_gone01: "gone" },
    });
    expect(await expirePlanCardPages(env.db, PLAN, { fetcher: s.fetcher, nowS: NOW })).toEqual({
      closed: 0,
      failed: [],
    });
    expect(s.calls.some((c) => c.url.includes("cs_test_old001"))).toBe(false);
    expect(kept(env).every((x) => x.closed)).toBe(true);
  });
  it("never throws: Stripe down, no key, or the plan unreadable are said in the answer", async () => {
    const env = world([{ id: "cs_test_first1", cents: 84000, via: "office", expires: NOW + 3000 }]);
    const down = stripe({ down: true });
    expect(await expirePlanCardPages(env.db, PLAN, { fetcher: down.fetcher, nowS: NOW })).toEqual({
      closed: 0,
      failed: ["cs_test_first1"],
    });
    // Not marked: the next call tries it again.
    expect(kept(env)[0]!.closed).toBe(false);
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const s = stripe();
    expect(await expirePlanCardPages(env.db, PLAN, { fetcher: s.fetcher, nowS: NOW })).toEqual({
      closed: 0,
      failed: ["cs_test_first1"],
    });
    expect(s.calls).toEqual([]);
    const broken = {
      from: () => {
        throw new Error("no database");
      },
    } as never;
    expect(await expirePlanCardPages(broken, PLAN)).toEqual({ closed: 0, failed: ["unread"] });
  });
});

describe("4. the one door a card page is made through", () => {
  it("keeps the page on its plan: its name, cents, way in and closing time", async () => {
    const env = world();
    const s = stripe();
    const made = await openPlanCardPage(env.db, ask({ via: "link" }), {
      fetcher: s.fetcher,
      nowS: NOW,
    });
    expect(made).toEqual({
      id: "cs_test_page1",
      url: "https://card.example.com/pay/cs_test_page1",
    });
    expect(env.rpcCalls).toEqual([
      {
        fn: "roof_care_card_session_keep",
        args: {
          p_plan: PLAN,
          p_id: "cs_test_page1",
          p_cents: 84000,
          p_via: "link",
          p_expires: BUCKET_START + 75 * 60,
        },
      },
    ]);
    expect(kept(env)).toEqual([
      {
        id: "cs_test_page1",
        cents: 84000,
        via: "link",
        expires: BUCKET_START + 75 * 60,
        closed: false,
      },
    ]);
    expect((await planCardState(env.db, PLAN)).sessions).toHaveLength(1);
  });
  it("closes the pages still open for another amount before it makes the new one", async () => {
    // The roof size was corrected: the plan owes 910.00 now, and a page for 840.00 is open.
    const env = world([{ id: "cs_test_oldamt", cents: 84000, via: "link", expires: NOW + 3000 }]);
    const s = stripe();
    const made = await openPlanCardPage(env.db, ask({ cents: 91000 }), {
      fetcher: s.fetcher,
      nowS: NOW,
    });
    expect(
      s.calls.map((c) => `${c.method} ${c.url.replace("https://api.stripe.com/v1", "")}`),
    ).toEqual(["POST /checkout/sessions/cs_test_oldamt/expire", "POST /checkout/sessions"]);
    const now = kept(env);
    expect(now.find((x) => x.id === "cs_test_oldamt")!.closed).toBe(true);
    expect(now.find((x) => x.id === made.id)).toMatchObject({ cents: 91000, closed: false });
  });
  it("leaves a page for the same amount open: the office's and the customer's can both be", async () => {
    const env = world([{ id: "cs_test_office", cents: 84000, via: "office", expires: NOW + 3000 }]);
    const s = stripe();
    await openPlanCardPage(env.db, ask({ via: "link" }), { fetcher: s.fetcher, nowS: NOW });
    expect(s.calls.some((c) => c.url.endsWith("/expire"))).toBe(false);
    expect(kept(env).map((x) => x.closed)).toEqual([false, false]);
  });
  it("a page the site closed is not handed out again: a new one is made", async () => {
    const env = world();
    const s = stripe();
    const o = { fetcher: s.fetcher, nowS: NOW };
    const first = await openPlanCardPage(env.db, ask(), o);
    // Pressed again a minute later: the same page, and it is kept once.
    expect((await openPlanCardPage(env.db, ask(), { ...o, nowS: NOW + 60 })).id).toBe(first.id);
    expect(kept(env)).toHaveLength(1);
    // The site closes it (a bank payment started, or the office corrected the size and back).
    await expirePlanCardPages(env.db, PLAN, o);
    // Pressed again in the same quarter hour: Stripe would hand the closed page back for the
    // same key. Without the second ask the customer would land on a dead page.
    const again = await openPlanCardPage(env.db, ask(), { ...o, nowS: NOW + 120 });
    expect(again.id).not.toBe(first.id);
    expect(s.calls.at(-1)!.key).toMatch(/-again-\d+$/);
    expect(kept(env).map((x) => [x.id, x.closed])).toEqual([
      [first.id, true],
      [again.id, false],
    ]);
  });
  it("a page that could not be kept is closed again and not handed out", async () => {
    const env = world([], { keepFails: true });
    const s = stripe();
    await expect(
      openPlanCardPage(env.db, ask(), { fetcher: s.fetcher, nowS: NOW }),
    ).rejects.toThrow(CARD_PAGE_NOT_KEPT);
    expect(CARD_PAGE_NOT_KEPT).toBe(
      "The card payment page could not be made just now. Nothing was charged. Please try again in a minute.",
    );
    expect(s.calls.at(-1)!.url).toBe(
      "https://api.stripe.com/v1/checkout/sessions/cs_test_page1/expire",
    );
  });
  it("both ways in go through it, and neither throws the page's name away any more", () => {
    const office = flat("src/lib/roof-care-checkout.functions.ts");
    expect(office).toContain("const made = await openPlanCardPage(admin, {");
    expect(office).not.toContain("createCheckoutSession");
    const link = flat("src/lib/roof-care-pay-link.functions.ts");
    expect(link).toContain("return checkout.openPlanCardPage(admin, ask);");
    expect(link).not.toContain("createCheckoutSession");
  });
  it("the route closes the plan's other pages once a payment is in, and when a bank payment starts", () => {
    const route = flat("src/routes/api.stripe.webhook.ts");
    expect(route.split("await expirePlanCardPages(supabaseAdmin, plan.id);")).toHaveLength(3);
  });
});

describe("5. the price is in US dollars for everyone", () => {
  it("adaptive pricing is turned off on every page", () => {
    expect(checkoutForm(ask()).get("adaptive_pricing[enabled]")).toBe("false");
    expect(checkoutForm(ask()).get("line_items[0][price_data][currency]")).toBe("usd");
  });
});

describe("the database", () => {
  const sql = sqlFlat("supabase/migrations/20261125100000_card_and_bank_payments.sql");
  it("keeps the pages on the plan, in a column of its own", () => {
    expect(sql).toContain(
      "add column if not exists card_sessions jsonb not null default '[]'::jsonb,",
    );
  });
  it("a page is kept once, as it is, and the newest twenty stay", () => {
    expect(sql).toContain(
      "create or replace function public.roof_care_card_session_keep( p_plan uuid, p_id text, p_cents integer, p_via text, p_expires bigint)",
    );
    expect(sql).toContain(
      "if exists (select 1 from jsonb_array_elements(v_list) e where e->>'id' = v_id) then return jsonb_array_length(v_list); end if;",
    );
    expect(sql).toContain("order by t.n desc limit 20) x;");
  });
  it("closing marks the page and keeps it, so one handed back again is known", () => {
    expect(sql).toContain(
      "create or replace function public.roof_care_card_sessions_closed(p_plan uuid, p_ids text[])",
    );
    expect(sql).toContain("then t.e || jsonb_build_object('closed_at', now())");
  });
  it("only the site's own server runs the two", () => {
    expect(sql).toContain(
      "revoke all on function public.roof_care_card_session_keep(uuid, text, integer, text, bigint) from public, anon, authenticated; grant execute on function public.roof_care_card_session_keep(uuid, text, integer, text, bigint) to service_role;",
    );
    expect(sql).toContain(
      "revoke all on function public.roof_care_card_sessions_closed(uuid, text[]) from public, anon, authenticated; grant execute on function public.roof_care_card_sessions_closed(uuid, text[]) to service_role;",
    );
  });
});
