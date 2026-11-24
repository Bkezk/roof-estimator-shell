// Nov 24 (public pages audit, B2): two checks on the card payment set-up.
//
//   1. Test and live are kept apart. A payment notice counts only when it is from the same side
//      of Stripe as the site's own key: a live key takes live notices only, a test key takes
//      test notices only. A notice from the other side records nothing, Stripe is answered 200
//      (so it is not sent again for days), and the server log and the admins are told.
//   2. The two secrets are used with any space or line end from a paste taken off.
//
// Stripe is not set up on the live site yet, so all of this is proven here and nowhere else.
// EVERY KEY AND NUMBER HERE IS MADE UP.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const told: unknown[][] = [];
const hold = { admin: null as unknown, service: true };
const made: unknown[][] = [];
const mailed: unknown[] = [];
vi.mock("@/lib/notify.server", () => ({
  notify: async (...a: unknown[]) => {
    told.push(a);
    return 1;
  },
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => hold.service,
  appUrl: () => "",
  emailConfigured: () => false,
  sendEmail: async () => ({ ok: false, error: "none here" }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: new Proxy(
    {},
    { get: (_t, k) => (hold.admin as Record<string | symbol, unknown>)[k] },
  ),
}));
vi.mock("@/lib/roof-care-email.server", () => ({
  dispatchPlanEmails: async (_sb: unknown, a: unknown) => {
    mailed.push(a);
    return { agreements_sent: 0, receipts_sent: 0, email_errors: 0, held: null };
  },
}));
vi.mock("@/lib/roof-care-plan-invoice.functions", () => ({
  makePlanInvoice: async (...a: unknown[]) => {
    made.push(a.slice(1));
    return { id: "inv-made", made: true };
  },
}));

import {
  CARD_MODE_REFUSED,
  cardModeLogLine,
  cardModeNotice,
  eventMode,
  eventModeFits,
  stripeKeyMode,
} from "@/lib/roof-care-checkout";
import {
  createCheckoutSession,
  stripeConfigured,
  stripeSecretKey,
  stripeWebhookSecret,
} from "@/lib/roof-care-checkout.server";
import { Route } from "@/routes/api.stripe.webhook";
import { fakeSupabase } from "@/test/fake-supabase";

const flat = (p: string) => readFileSync(p, "utf8").replace(/\s+/g, " ");
const PLAN = "7b1e9f0e-6f0c-4a3e-9d5f-2f6c1b9a4e11";
const SECRET = "whsec_made_up_for_tests";
const sign = (body: string, t: number, secret = SECRET) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex")}`;
const nowS = () => Math.floor(Date.now() / 1000);

/** A paid Roof Care checkout as Stripe sends it. `livemode` left out: the event does not say. */
const paidEvent = (livemode?: boolean) => ({
  type: "checkout.session.completed",
  ...(livemode === undefined ? {} : { livemode }),
  data: {
    object: {
      id: "cs_1",
      payment_status: "paid",
      currency: "usd",
      amount_total: 84000,
      payment_intent: "pi_9",
      metadata: { kind: "roof_care_plan", plan_id: PLAN },
      customer_details: { email: "pat@example.com" },
    },
  },
});

const post = (body: string, header: string | null) =>
  (
    Route as unknown as {
      options: { server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } } };
    }
  ).options.server.handlers.POST({
    request: new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      body,
      headers: header ? { "stripe-signature": header } : {},
    }),
  });

/** A site with one waiting plan. `calls`: every time the database was asked to record a payment. */
const world = (plans: Record<string, unknown>[] | null = null) => {
  const calls: Record<string, unknown>[] = [];
  const env = fakeSupabase(
    {
      roof_care_plans: plans ?? [
        {
          id: PLAN,
          plan: "care",
          site_id: "s1",
          customer_email: null,
          status: "awaiting_payment",
          sold_by: "t1",
        },
      ],
      crm_sites: [{ id: "s1", name: "Main Plant" }],
      profiles: [
        { id: "a1", role: "admin" },
        { id: "m1", role: "manager" },
        { id: "t1", role: "user" },
      ],
      roof_care_card_payments: [],
    },
    {
      rpcs: {
        roof_care_card_paid: (a: Record<string, unknown>) => {
          calls.push(a);
          return "started";
        },
      },
    },
  );
  hold.admin = env.db;
  return { env, calls };
};

const logged: string[] = [];
beforeEach(() => {
  told.length = 0;
  made.length = 0;
  mailed.length = 0;
  logged.length = 0;
  hold.service = true;
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    logged.push(a.map(String).join(" "));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env["STRIPE_SECRET_KEY"];
  delete process.env["STRIPE_WEBHOOK_SECRET"];
});

describe("which side of Stripe a key and a notice are from", () => {
  it("a key says it by how it starts", () => {
    expect(stripeKeyMode("sk_live_made_up")).toBe("live");
    expect(stripeKeyMode("rk_live_made_up")).toBe("live");
    expect(stripeKeyMode("sk_test_made_up")).toBe("test");
    expect(stripeKeyMode("rk_test_made_up")).toBe("test");
    // A space or a line end from a paste does not change it.
    expect(stripeKeyMode("  sk_live_made_up\n")).toBe("live");
    // Anything else cannot be told: a publishable key, a webhook secret, nothing at all.
    for (const k of ["pk_live_made_up", "whsec_made_up", "sk_made_up", "live", "", null, undefined])
      expect(stripeKeyMode(k), String(k)).toBeNull();
  });

  it("a notice says it in `livemode`, and only true or false count", () => {
    expect(eventMode({ livemode: true })).toBe("live");
    expect(eventMode({ livemode: false })).toBe("test");
    for (const e of [{}, { livemode: "true" }, { livemode: 1 }, { livemode: null }, null, "x"])
      expect(eventMode(e), JSON.stringify(e)).toBeNull();
  });

  it("a notice fits only the key of its own side", () => {
    expect(eventModeFits({ livemode: true }, "live")).toBe(true);
    expect(eventModeFits({ livemode: false }, "test")).toBe(true);
    expect(eventModeFits({ livemode: false }, "live")).toBe(false);
    expect(eventModeFits({ livemode: true }, "test")).toBe(false);
    // A notice that does not say, or a key that cannot be told: neither fits.
    expect(eventModeFits({}, "live")).toBe(false);
    expect(eventModeFits({}, "test")).toBe(false);
    expect(eventModeFits({ livemode: true }, null)).toBe(false);
    expect(eventModeFits({ livemode: false }, null)).toBe(false);
  });
});

describe("the route Stripe calls keeps test and live apart", () => {
  const refused = { ok: false, handled: true, error: CARD_MODE_REFUSED };

  it("a live key takes a live notice and records it", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_live_made_up";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
    const { calls } = world();
    const body = JSON.stringify(paidEvent(true));
    const res = await post(body, sign(body, nowS()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, handled: true, result: "started" });
    expect(calls).toEqual([{ p_plan: PLAN, p_amount: 840, p_ref: "pi_9" }]);
    expect(logged).toEqual([]);
  });

  it("a test key takes a test notice and records it", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_made_up";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
    const { calls } = world();
    const body = JSON.stringify(paidEvent(false));
    expect(await (await post(body, sign(body, nowS()))).json()).toEqual({
      ok: true,
      handled: true,
      result: "started",
    });
    expect(calls).toHaveLength(1);
  });

  it("a live key refuses a test notice: nothing recorded, no invoice, no email, one log line, the admins told", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_live_made_up";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
    const { env, calls } = world();
    const body = JSON.stringify(paidEvent(false));
    const res = await post(body, sign(body, nowS()));
    // Stripe is not to send it again.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(refused);
    expect(calls).toEqual([]);
    expect(made).toEqual([]);
    expect(mailed).toEqual([]);
    expect(env.tables["roof_care_plans"]![0]!["customer_email"]).toBeNull();
    expect(env.tables["roof_care_plans"]![0]!["status"]).toBe("awaiting_payment");
    expect(logged).toEqual([
      `Stripe webhook: refused a test payment notice: the site's Stripe key is a live key. Plan ${PLAN}, reference pi_9. Nothing was recorded.`,
    ]);
    expect(told).toHaveLength(1);
    expect(told[0]![0]).toEqual(["a1", "m1"]);
    expect(told[0]![1]).toEqual({
      kind: "plan_card_paid",
      title: "A card payment notice was refused: Main Plant",
      body: "Stripe sent a test payment notice, but the site is set up with a live Stripe key. Nothing was recorded and the plan is not changed. Reference pi_9. In Lovable Cloud › Secrets, the Stripe key and the Stripe webhook secret must both come from the same side of Stripe: both test, or both live.",
      url: "/properties/s1",
    });
  });

  it("a test key refuses a live notice the same way", async () => {
    process.env["STRIPE_SECRET_KEY"] = "rk_test_made_up";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
    const { calls } = world();
    const body = JSON.stringify(paidEvent(true));
    const res = await post(body, sign(body, nowS()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(refused);
    expect(calls).toEqual([]);
    expect(made).toEqual([]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(
      "refused a live payment notice: the site's Stripe key is a test key.",
    );
    expect((told[0]![1] as { body: string }).body).toContain(
      "Stripe sent a live payment notice, but the site is set up with a test Stripe key.",
    );
  });

  it("a notice that does not say its side is refused under either key", async () => {
    for (const key of ["sk_live_made_up", "sk_test_made_up"]) {
      process.env["STRIPE_SECRET_KEY"] = key;
      process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
      const { calls } = world();
      const body = JSON.stringify(paidEvent());
      expect(await (await post(body, sign(body, nowS()))).json(), key).toEqual(refused);
      expect(calls, key).toEqual([]);
    }
    expect(logged[0]).toContain("refused a payment notice with no mode:");
  });

  it("a key whose side cannot be told takes no notice at all", async () => {
    process.env["STRIPE_SECRET_KEY"] = "made_up_key_of_no_kind";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
    for (const live of [true, false]) {
      const { calls } = world();
      const body = JSON.stringify(paidEvent(live));
      expect(await (await post(body, sign(body, nowS()))).json()).toEqual(refused);
      expect(calls).toEqual([]);
    }
    expect(logged[0]).toContain("the site's Stripe key does not start like a test or a live key.");
  });

  it("a refused notice for a plan that is not there is still answered as refused, and nobody is told", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_live_made_up";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
    const { calls } = world([]);
    const body = JSON.stringify(paidEvent(false));
    const res = await post(body, sign(body, nowS()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(refused);
    expect(calls).toEqual([]);
    expect(told).toEqual([]);
    expect(logged).toHaveLength(1);
  });

  it("the signature is checked first: an unsigned notice of the other side is a plain 400", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_live_made_up";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
    const { calls } = world();
    const body = JSON.stringify(paidEvent(false));
    expect((await post(body, null)).status).toBe(400);
    expect((await post(body, sign(body, nowS(), "whsec_someone_else"))).status).toBe(400);
    expect(calls).toEqual([]);
    expect(told).toEqual([]);
    expect(logged).toEqual([]);
  });

  it("another kind of event is acknowledged and left alone, whatever its side", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_live_made_up";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
    const { calls } = world();
    const body = JSON.stringify({ type: "invoice.paid", livemode: false, data: { object: {} } });
    expect(await (await post(body, sign(body, nowS()))).json()).toEqual({
      ok: true,
      handled: false,
    });
    expect(calls).toEqual([]);
    expect(logged).toEqual([]);
  });

  it("the words", () => {
    expect(CARD_MODE_REFUSED).toBe(
      "Refused: this notice and the site's Stripe key are not both test or both live. Nothing was recorded.",
    );
    expect(cardModeLogLine("test", "live")).toBe(
      "refused a test payment notice: the site's Stripe key is a live key.",
    );
    expect(cardModeLogLine(null, null)).toBe(
      "refused a payment notice with no mode: the site's Stripe key does not start like a test or a live key.",
    );
    const n = cardModeNotice({ site_id: null, site: " ", event: null, key: null, ref: "pi_1" });
    expect(n.title).toBe("A card payment notice was refused: a property");
    expect(n.url).toBeNull();
    expect(n.body).toContain(
      "Stripe sent a payment notice, but the site's Stripe key is not a test key or a live key.",
    );
    // Never a key or a secret, only a reference.
    expect(JSON.stringify(n)).not.toMatch(/sk_|rk_|whsec_/);
  });
});

describe("the two Stripe secrets are used with a pasted space or line end taken off", () => {
  it("a webhook secret pasted with a line end still proves Stripe's own message", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_made_up\n";
    process.env["STRIPE_WEBHOOK_SECRET"] = `  ${SECRET}\r\n`;
    expect(stripeWebhookSecret()).toBe(SECRET);
    expect(stripeSecretKey()).toBe("sk_test_made_up");
    const { calls } = world();
    const body = JSON.stringify(paidEvent(false));
    // Stripe signs with the secret as Stripe holds it: no space, no line end.
    const res = await post(body, sign(body, nowS(), SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, handled: true, result: "started" });
    expect(calls).toHaveLength(1);
  });

  it("the key goes to Stripe without the line end", async () => {
    process.env["STRIPE_SECRET_KEY"] = " sk_test_made_up \n";
    const seen: RequestInit[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response(JSON.stringify({ id: "cs_9", url: "https://checkout.example/c/9" }));
    }) as unknown as typeof fetch;
    await createCheckoutSession(
      {
        plan_id: PLAN,
        plan: "care",
        plan_number: null,
        site_name: "",
        cents: 5000,
        email: null,
        success_url: "https://s/x",
        cancel_url: "https://s/x",
      },
      fetcher,
    );
    expect((seen[0]!.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer sk_test_made_up",
    );
  });

  it("a secret that is only spaces is a secret that is not set", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_made_up";
    process.env["STRIPE_WEBHOOK_SECRET"] = " \n";
    expect(stripeConfigured()).toBe(false);
    world();
    const body = JSON.stringify(paidEvent(false));
    expect((await post(body, sign(body, nowS(), " \n"))).status).toBe(503);
    process.env["STRIPE_SECRET_KEY"] = "   ";
    process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
    expect(stripeConfigured()).toBe(false);
  });

  it("nothing reads either secret any other way", () => {
    const server = flat("src/lib/roof-care-checkout.server.ts");
    expect(server).toContain(
      'export const stripeSecretKey = () => (process.env["STRIPE_SECRET_KEY"] ?? "").trim();',
    );
    expect(server).toContain(
      'export const stripeWebhookSecret = () => (process.env["STRIPE_WEBHOOK_SECRET"] ?? "").trim();',
    );
    expect(server.split('process.env["STRIPE_SECRET_KEY"]').length - 1).toBe(1);
    expect(server.split('process.env["STRIPE_WEBHOOK_SECRET"]').length - 1).toBe(1);
    const route = flat("src/routes/api.stripe.webhook.ts");
    expect(route).not.toContain("process.env");
    expect(route).toContain(
      'verifyStripeSignature(raw, request.headers.get("stripe-signature"), stripeWebhookSecret())',
    );
  });
});
