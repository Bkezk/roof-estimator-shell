/**
 * Roof Care step 4 (owner, Nov 18 and Nov 20): the two public pages opened by QR codes, with
 * no sign-in. This is the first door open to strangers, so these tests are mostly about what
 * it does NOT do:
 *
 *  - nothing in the database is given to the anonymous role; the public pages reach it through
 *    the site's own server and its own key
 *  - a public answer is prices and plain words: never a cost, a margin, a drive, or anything
 *    about who is already a customer
 *  - each connection, and everyone together, is limited
 *  - a robot is answered as if it worked and nothing is kept
 *  - the site asks Google for at most a set number of drives a day, then the free router
 *  - a printed QR code holds exactly the address saved, and no price is printed
 *
 * Every dollar figure here is made up and matches no plan price.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import jsQR from "jsqr";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const told: unknown[][] = [];
const notifyFails = { on: false };
vi.mock("@/lib/notify.server", () => ({
  notify: async (...a: unknown[]) => {
    if (notifyFails.on) throw new Error("push service down");
    told.push(a);
    return 1;
  },
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => true,
  appUrl: () => "",
}));

import { fakeSupabase } from "@/test/fake-supabase";
import { GOOGLE_ROUTES_URL, OSRM_ROUTE_BASE, googleGate, routedDriveVia } from "@/lib/drive-route";
import { ATTENTION_DEFAULTS, attentionList } from "@/lib/owner-attention";
import {
  PUBLIC_CARE_PATH,
  PUBLIC_MIN_OPEN_MS,
  PUBLIC_NOT_READY,
  PUBLIC_REQUEST_PATH,
  PUBLIC_SIZE_RANGE_SQFT,
  PUBLIC_TERMS_MOVED,
  PUBLIC_TOO_MANY,
  PUBLIC_TRY_AGAIN,
} from "@/lib/public-forms";
import {
  PUBLIC_NEED_CONTACT,
  looksLikeRobot,
  quoteFor,
  reachable,
  sampleQuote,
  sendCare,
  sendService,
  serviceChoices,
  type PublicDeps,
} from "@/lib/public-forms.functions";
import { connectionKey, dispatchPublicRequestNotices } from "@/lib/public-forms.server";
import {
  PUBLIC_REQUESTS_PATH,
  callBackDay,
  carePrefill,
  cleanQrAddress,
  customQuoteWhy,
  isCustomQuoteAsk,
  requestAsk,
  requestAskLine,
  cleanServices,
  matchWhyWords,
  opportunityFromRequest,
  publicRequestNotice,
  qrAddressIsBorrowed,
  qrSheets,
  readMatches,
  type PublicRequestRow,
} from "@/lib/public-requests";
import {
  PUBLIC_REQUESTS_NEED,
  PUBLIC_SETTINGS_NEED,
  handlePublicRequest,
  listPublicRequests,
  publicCarePrefill,
  savePublicFormSettings,
} from "@/lib/public-requests.functions";
import { QR_QUIET_CELLS, qrCells, qrPixels, qrSvg } from "@/lib/qr";
import { driveSourceWords } from "@/lib/roof-care-locate";
import { ROOF_CARE_TERMS_VERSION } from "@/lib/roof-care-plan";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const SQL = read("supabase/migrations/20261121100000_public_forms.sql");
const run = (fn: unknown, db: unknown, data: unknown, userId = "u1") =>
  (fn as (a: unknown) => Promise<unknown>)({ data, context: { supabase: db, userId } });

beforeEach(() => {
  told.length = 0;
  notifyFails.on = false;
});

// ── The database: nothing for a stranger ─────────────────────────────────────────────────────

describe("the database gives the anonymous role nothing", () => {
  const code = SQL.split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  it("no function and no table is granted to anon or to everyone", () => {
    expect(/grant\s+[^;]*\bto\b[^;]*\b(anon|public)\b/i.test(code)).toBe(false);
    for (const t of [
      "public_form_settings",
      "google_route_uses",
      "public_form_hits",
      "public_quotes",
      "public_requests",
    ]) {
      expect(code).toContain(`alter table public.${t} enable row level security;`);
      expect(new RegExp(`revoke all on public\\.${t} from anon`).test(code)).toBe(true);
    }
  });
  it("the three doors the public pages use are the site's own server's alone", () => {
    for (const sig of ["public_form_take(text, text)", "public_request_submit(text, jsonb)"]) {
      expect(code).toContain(
        `revoke all on function public.${sig} from public, anon, authenticated;`,
      );
      expect(code).toContain(`grant execute on function public.${sig} to service_role;`);
    }
    expect(flat(code)).toContain(
      "revoke all on function public.public_care_quote(text, jsonb, numeric, numeric) from public, anon, authenticated;",
    );
    // And each says so itself, whatever the grants say.
    expect(
      code.match(/coalesce\(auth\.role\(\), ''\) <> 'service_role'/g)!.length,
    ).toBeGreaterThanOrEqual(4);
  });
  it("the requests are read by the office only, and written by nobody directly", () => {
    expect(flat(code)).toContain(
      "create policy public_requests_read on public.public_requests for select to authenticated using ((select public.has_access('customers')));",
    );
    expect(code).toContain(
      "revoke insert, update, delete on public.public_requests from authenticated;",
    );
    expect(code).not.toMatch(
      /create policy \w+ on public\.public_requests\s+for (insert|update|delete|all)/,
    );
    for (const t of ["public_quotes", "public_form_hits", "google_route_uses"])
      expect(code).toContain(`revoke all on public.${t} from anon, authenticated;`);
  });
  it("the limits: 20 price questions and 5 requests an hour from a connection, 400 and 60 a day from everyone", () => {
    expect(code).toContain("v_one_cap := 20; v_all_cap := 400;");
    expect(code).toContain("v_one_cap := 5; v_all_cap := 60;");
  });
  it("a request is checked again in the database: lengths, a way to reach them, the plan, the tick, the price shown", () => {
    for (const words of [
      "Type a phone number with its area code, or an email address, so we can reach you.",
      "One of the boxes holds more than it can take. Shorten it and send again.",
      "Pick one of the three plans.",
      "Tick the box to agree to the plan''s terms.",
      "The price changed after it was shown. Press Show my prices again, then send.",
      "The address changed after the prices were shown. Press Show my prices again, then send.",
      "One of the services ticked is not on our list any more. Reload the page and try again.",
      "Tick at least one service.",
    ])
      expect(code).toContain(words);
  });
  it("the price answer is built from prices and what a plan includes, and nothing else", () => {
    const fn = code.slice(
      code.indexOf("create or replace function public.public_care_quote("),
      code.indexOf("revoke all on function public.public_care_quote("),
    );
    expect(flat(fn)).toContain(
      "return jsonb_build_object('quote_token', v_token, 'custom_quote', v_custom, 'plans', v_plans);",
    );
    // The engine's own answer carries the list price and the drive's share: neither is copied.
    expect(fn).not.toMatch(/'(list|travel|trips|visit1|visit2|baseline_hours|baseline_miles)'/);
    expect(fn).not.toMatch(/crew_cost|vehicle_cost|repair_cost|margin/);
  });
  it("the rule of Nov 14 stands: the older test that forbids any grant to anon is not loosened", () => {
    const older = read("src/lib/stranger-access-nov14.test.ts");
    expect(older).toContain("no migration after this one grants a function to anon or to public");
    expect(older).toContain("expect(offenders).toEqual([]);");
  });
});

// ── The key a connection is counted under ────────────────────────────────────────────────────

describe("the key a connection is counted under", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  it("is a keyed hash: the same connection the same key, another connection another, never the address", () => {
    const a = connectionKey(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), "secret-one");
    expect(a).toBe(connectionKey(h({ "x-forwarded-for": "203.0.113.7" }), "secret-one"));
    expect(a).not.toBe(connectionKey(h({ "x-forwarded-for": "203.0.113.8" }), "secret-one"));
    expect(a).not.toBe(connectionKey(h({ "x-forwarded-for": "203.0.113.7" }), "secret-two"));
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(a).not.toContain("203");
  });
  it("reads the real visitor first, and still gives a key when nothing says who it is", () => {
    expect(
      connectionKey(h({ "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "10.0.0.1" }), "s"),
    ).toBe(connectionKey(h({ "x-forwarded-for": "198.51.100.4" }), "s"));
    expect(connectionKey(h({}), "s")).toMatch(/^[0-9a-f]{40}$/);
  });
});

// ── The price question ───────────────────────────────────────────────────────────────────────

type RpcCall = { fn: string; args: Record<string, unknown> | undefined };
function door(answers: Record<string, (args: Record<string, unknown> | undefined) => unknown>) {
  const calls: RpcCall[] = [];
  const admin = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      const a = answers[fn];
      if (!a) return { data: null, error: { message: `no such function ${fn}`, code: "42883" } };
      const out = a(args);
      return out && typeof out === "object" && "error" in (out as object)
        ? (out as { data: unknown; error: unknown })
        : { data: out, error: null };
    },
  };
  return { admin, calls };
}
const drive = (over: Record<string, unknown> = {}) => ({
  hours: 3.4,
  miles: 171.2,
  source: "routed" as const,
  note: "",
  placed_by: "street" as const,
  place: null,
  ...over,
});
const PLANS_FROM_DB = [
  // What the database answers, with fields that must never leave the server added on purpose.
  {
    plan: "watch",
    name: "Roof Watch",
    price: 1310,
    list: 1200,
    travel: 110,
    cost: 800,
    benefits: { allowance: 0, leak_calls: 0, storm: 0 },
  },
  {
    plan: "care",
    name: "Roof Care",
    price: 2090,
    list: 1980,
    travel: 110,
    benefits: { allowance: 430, leak_calls: 0, storm: 0, secret: 1 },
  },
  {
    plan: "guard",
    name: "Roof Guard",
    price: 3870,
    benefits: { allowance: 1270, leak_calls: 2, storm: 1 },
  },
];
function deps(over: Partial<PublicDeps> & { answers?: Parameters<typeof door>[0] } = {}) {
  const d = door({
    public_form_take: () => true,
    public_care_quote: () => ({ quote_token: "tok-1", custom_quote: false, plans: PLANS_FROM_DB }),
    public_request_submit: () => "R-4321",
    public_service_choices: () => ["Roof inspection", "Storm damage"],
    ...(over.answers ?? {}),
  });
  const tellCalls: unknown[] = [];
  const full: PublicDeps = {
    admin: d.admin as never,
    key: "k".repeat(40),
    sample: false,
    drive: async () => drive() as never,
    mapSize: async () => null,
    tell: async (a) => {
      tellCalls.push(a);
    },
    ...over,
  };
  return { deps: full, calls: d.calls, tellCalls };
}
const ASK = { address: "120 Mill St", city: "London", state: "KY", zip: "40741" };

describe("the three prices for a building", () => {
  it("answers prices and what each plan includes, and nothing the database added beside them", async () => {
    const { deps: d, calls } = deps();
    const q = await quoteFor({ ...ASK, sqft: 21000 }, d);
    expect(q).toEqual({
      found: true,
      rough: false,
      place: null,
      sqft: 21000,
      sqft_source: "typed",
      custom_quote: false,
      plans: [
        {
          plan: "watch",
          name: "Roof Watch",
          price: 1310,
          benefits: { allowance: 0, leak_calls: 0, storm: 0 },
        },
        {
          plan: "care",
          name: "Roof Care",
          price: 2090,
          benefits: { allowance: 430, leak_calls: 0, storm: 0 },
        },
        {
          plan: "guard",
          name: "Roof Guard",
          price: 3870,
          benefits: { allowance: 1270, leak_calls: 2, storm: 1 },
        },
      ],
      quote_token: "tok-1",
    });
    const text = JSON.stringify(q);
    for (const never of ["list", "travel", "cost", "secret", "hours", "miles", "3.4", "171.2"])
      expect(text).not.toContain(never);
    // The drive goes to the database to work the price out, and the limit is asked first.
    expect(calls.map((c) => c.fn)).toEqual(["public_form_take", "public_care_quote"]);
    expect(calls[0]!.args).toEqual({ p_kind: "quote", p_key: "k".repeat(40) });
    expect(calls[1]!.args).toMatchObject({ p_hours: 3.4, p_miles: 171.2 });
  });
  it("the roof size: the map's outline first, then what was typed, then the middle of the range", async () => {
    const withMap = deps({ mapSize: async () => 22400 });
    const a = await quoteFor({ ...ASK, sqft: 9000, size_range: "10k_25k" }, withMap.deps);
    expect([a.sqft, a.sqft_source]).toEqual([22400, "map"]);
    const typed = deps();
    const b = await quoteFor({ ...ASK, sqft: 9000, size_range: "10k_25k" }, typed.deps);
    expect([b.sqft, b.sqft_source]).toEqual([9000, "typed"]);
    const ranged = deps();
    const c = await quoteFor({ ...ASK, size_range: "25k_50k" }, ranged.deps);
    expect([c.sqft, c.sqft_source]).toEqual([PUBLIC_SIZE_RANGE_SQFT["25k_50k"], "range"]);
    expect(ranged.calls[1]!.args!["p"]).toMatchObject({ sqft: 37500, sqft_source: "range" });
    // A map that cannot be read is no size, never an error.
    const down = deps({
      mapSize: async () => {
        throw new Error("state map server down");
      },
    });
    expect((await quoteFor({ ...ASK, sqft: 9000 }, down.deps)).sqft_source).toBe("typed");
  });
  it("over 75,000 sq ft, and a roof the database calls a custom quote, get no numbers", async () => {
    const over = deps();
    const a = await quoteFor({ ...ASK, size_range: "over_75k" }, over.deps);
    expect(a).toMatchObject({ custom_quote: true, plans: [], sqft: null, sqft_source: null });
    const big = deps({
      answers: { public_care_quote: () => ({ quote_token: "t", custom_quote: true, plans: [] }) },
    });
    expect(await quoteFor({ ...ASK, sqft: 400000 }, big.deps)).toMatchObject({
      custom_quote: true,
      plans: [],
    });
  });
  it("an address that is not on the map gets no price; one placed by its town is marked rough", async () => {
    const lost = deps({ drive: async () => null });
    const a = await quoteFor({ ...ASK, sqft: 21000 }, lost.deps);
    expect(a).toMatchObject({ found: false, plans: [], quote_token: "tok-1" });
    expect(lost.calls[1]!.args).toMatchObject({ p_hours: null, p_miles: null });
    const town = deps({
      drive: async () => drive({ placed_by: "town", place: "London, KY 40741" }) as never,
    });
    expect(await quoteFor({ ...ASK, sqft: 21000 }, town.deps)).toMatchObject({
      found: true,
      rough: true,
      place: "London, KY 40741",
    });
  });
  it("a connection over its limit is told to wait, and nothing more is asked", async () => {
    const { deps: d, calls } = deps({ answers: { public_form_take: () => false } });
    await expect(quoteFor({ ...ASK, sqft: 21000 }, d)).rejects.toThrow(PUBLIC_TOO_MANY);
    expect(calls.map((c) => c.fn)).toEqual(["public_form_take"]);
  });
  it("the database's own plain sentence is passed on; any other fault is never shown", async () => {
    const plain = deps({
      answers: {
        public_care_quote: () => ({
          data: null,
          error: { message: "The plan prices are not set up yet. Please call us.", code: "P0001" },
        }),
      },
    });
    await expect(quoteFor({ ...ASK, sqft: 21000 }, plain.deps)).rejects.toThrow(
      "The plan prices are not set up yet. Please call us.",
    );
    const fault = deps({
      answers: {
        public_care_quote: () => ({
          data: null,
          error: { message: 'relation "roof_care_settings" does not exist', code: "42P01" },
        }),
      },
    });
    const err = console.error;
    console.error = () => {};
    await expect(quoteFor({ ...ASK, sqft: 21000 }, fault.deps)).rejects.toThrow(PUBLIC_TRY_AGAIN);
    console.error = err;
  });
  it("what is typed is checked before anything is asked: a plain sentence, never a program's list", async () => {
    const { deps: d, calls } = deps();
    await expect(quoteFor({ ...ASK, address: "x" }, d)).rejects.toThrow(
      "Type the building's street address.",
    );
    await expect(quoteFor({ ...ASK, sqft: -5 }, d)).rejects.toThrow(
      "Check the form: one of the boxes is not filled in right.",
    );
    await expect(quoteFor({ ...ASK, address: "a".repeat(201) }, d)).rejects.toThrow();
    await expect(quoteFor({ ...ASK, size_range: "huge" }, d)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it("with no server key: sample numbers on the test server, a plain refusal anywhere else", async () => {
    const sample = await quoteFor(
      { ...ASK, sqft: 21000 },
      { ...deps().deps, admin: null, sample: true },
    );
    expect(sample).toMatchObject({ sample: true, quote_token: "sample" });
    expect(sample.plans.map((p) => p.price)).toEqual(
      sampleQuote({ ...ASK, sqft: 1 }).plans.map((p) => p.price),
    );
    await expect(
      quoteFor({ ...ASK, sqft: 21000 }, { ...deps().deps, admin: null, sample: false }),
    ).rejects.toThrow(PUBLIC_NOT_READY);
  });
});

// ── The two requests ─────────────────────────────────────────────────────────────────────────

const CARE = {
  ...ASK,
  contact_name: "Pat Smith",
  company: "Smith Widgets",
  phone: "606-555-0142",
  email: "",
  building_name: "Main plant",
  referred_by: "Tom Tech",
  plan: "care",
  sqft: 21000,
  size_range: null,
  shown_price: 2090,
  quote_token: "tok-1",
  pay_method: "check",
  agreed: true,
  terms_version: ROOF_CARE_TERMS_VERSION,
  agreed_by: "Pat Smith",
  several_buildings: false,
  notes: "",
  website: "",
  open_ms: 45_000,
};
const SERVICE = {
  ...ASK,
  contact_name: "Pat Smith",
  company: "",
  phone: "",
  email: "pat@example.com",
  building_name: "",
  referred_by: "",
  services: ["Roof inspection"],
  details: "It drips by the dock door.",
  website: "",
  open_ms: 30_000,
};

describe("a Roof Care request", () => {
  it("is checked, counted, kept by the database, and the office told", async () => {
    const { deps: d, calls, tellCalls } = deps();
    expect(await sendCare(CARE, d)).toEqual({ reference: "R-4321" });
    expect(calls.map((c) => c.fn)).toEqual(["public_form_take", "public_request_submit"]);
    expect(calls[0]!.args).toEqual({ p_kind: "request", p_key: "k".repeat(40) });
    const sent = calls[1]!.args!["p"] as Record<string, unknown>;
    expect(sent).toMatchObject({ kind: "care", plan: "care", shown_price: 2090, agreed: true });
    // The two robot checks are the server's own and are not kept.
    expect(sent).not.toHaveProperty("website");
    expect(sent).not.toHaveProperty("open_ms");
    expect(tellCalls).toHaveLength(1);
  });
  it("a robot is answered as if it worked, and nothing is asked of the database", async () => {
    for (const robot of [
      { ...CARE, website: "http://spam.example" },
      { ...CARE, open_ms: PUBLIC_MIN_OPEN_MS - 1 },
      { ...CARE, open_ms: 0 },
    ]) {
      const { deps: d, calls, tellCalls } = deps();
      const out = await sendCare(robot, d);
      // Three digits: a real reference has four or more, so the two are never confused.
      expect(out.reference).toMatch(/^R-\d{3}$/);
      expect(SQL).toContain("create sequence if not exists public.public_request_ref_seq");
      expect(SQL).toMatch(/public_request_ref_seq[^;]*start (with )?4001/);
      expect(calls).toEqual([]);
      expect(tellCalls).toEqual([]);
    }
    expect(looksLikeRobot({ website: "", open_ms: PUBLIC_MIN_OPEN_MS })).toBe(false);
    expect(looksLikeRobot({ website: " ", open_ms: 999_999 })).toBe(false);
    expect(looksLikeRobot({ website: "x", open_ms: 999_999 })).toBe(true);
  });
  it("is refused before the database when there is no way to reach them, no tick, or old terms", async () => {
    const { deps: d, calls } = deps();
    await expect(sendCare({ ...CARE, phone: "555", email: "" }, d)).rejects.toThrow(
      PUBLIC_NEED_CONTACT,
    );
    await expect(sendCare({ ...CARE, agreed: false }, d)).rejects.toThrow(
      "Tick the box to agree to the plan's terms.",
    );
    await expect(sendCare({ ...CARE, terms_version: "2026-01-01" }, d)).rejects.toThrow(
      PUBLIC_TERMS_MOVED,
    );
    await expect(sendCare({ ...CARE, plan: "gold" }, d)).rejects.toThrow();
    await expect(sendCare({ ...CARE, pay_method: "cash" }, d)).rejects.toThrow();
    await expect(sendCare({ ...CARE, notes: "n".repeat(2001) }, d)).rejects.toThrow();
    await expect(sendCare({ ...CARE, agreed_by: "" }, d)).rejects.toThrow(
      "Type your full name to agree to the terms.",
    );
    expect(calls).toEqual([]);
    expect(reachable("(606) 555-0142", "")).toBe(true);
    expect(reachable("", "pat@example.com")).toBe(true);
    expect(reachable("555-0142", "pat@example")).toBe(false);
  });
  it("over the limit: told to wait, nothing kept; the office not being told does not lose the request", async () => {
    const over = deps({ answers: { public_form_take: () => false } });
    await expect(sendCare(CARE, over.deps)).rejects.toThrow(PUBLIC_TOO_MANY);
    expect(over.calls.map((c) => c.fn)).toEqual(["public_form_take"]);
    const err = console.error;
    console.error = () => {};
    const untold = deps({
      tell: async () => {
        throw new Error("push service down");
      },
    });
    expect(await sendCare(CARE, untold.deps)).toEqual({ reference: "R-4321" });
    console.error = err;
  });
  it("the database's refusal reaches the visitor in its own plain words", async () => {
    const { deps: d } = deps({
      answers: {
        public_request_submit: () => ({
          data: null,
          error: {
            message: "The price changed after it was shown. Press Show my prices again, then send.",
            code: "P0001",
          },
        }),
      },
    });
    await expect(sendCare(CARE, d)).rejects.toThrow("The price changed after it was shown.");
  });
});

describe("a service request, and the list of services", () => {
  it("is kept with its services, and needs at least one", async () => {
    const { deps: d, calls } = deps();
    expect(await sendService(SERVICE, d)).toEqual({ reference: "R-4321" });
    expect(calls[1]!.args!["p"]).toMatchObject({
      kind: "service",
      services: ["Roof inspection"],
      details: "It drips by the dock door.",
    });
    const none = deps();
    await expect(sendService({ ...SERVICE, services: [] }, none.deps)).rejects.toThrow(
      "Tick at least one service.",
    );
    expect(none.calls).toEqual([]);
    const robot = deps();
    expect((await sendService({ ...SERVICE, website: "x" }, robot.deps)).reference).toMatch(/^R-/);
    expect(robot.calls).toEqual([]);
  });
  it("the services are the office's list, read through the server", async () => {
    const { deps: d } = deps();
    expect(await serviceChoices(d)).toEqual({ services: ["Roof inspection", "Storm damage"] });
    expect(
      (await serviceChoices({ ...d, admin: null, sample: true })).services.length,
    ).toBeGreaterThan(0);
    await expect(serviceChoices({ ...d, admin: null, sample: false })).rejects.toThrow(
      PUBLIC_NOT_READY,
    );
  });
});

describe("the public functions carry no sign-in, and reach the database with the site's own key", () => {
  const src = read("src/lib/public-forms.functions.ts");
  it("no auth middleware, no anonymous client, and the key is the server's", () => {
    expect(src).not.toContain("requireSupabaseAuth");
    expect(src).not.toMatch(/createClient\(|VITE_SUPABASE|PUBLISHABLE|ANON/);
    expect(src).toContain("admin: await server.publicAdmin(),");
    const server = read("src/lib/public-forms.server.ts");
    expect(server).toContain('await import("@/integrations/supabase/client.server")');
    expect(server).toContain("if (!hasServiceRole()) return null;");
    // Sample numbers only where there is no key AND it is not the published build.
    expect(flat(server)).toContain(
      '!hasServiceRole() && process.env["NODE_ENV"] !== "production";',
    );
  });
});

// ── The office is told once ──────────────────────────────────────────────────────────────────

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  reference: "R-4010",
  kind: "service",
  created_at: "2026-11-21T15:00:00Z",
  status: "new",
  contact_name: "Pat Smith",
  company: "Smith Widgets",
  city: "London",
  state: "KY",
  plan: null,
  services: ["Roof inspection", "Storm damage"],
  shown_price: null,
  told_at: null,
  ...over,
});

describe("the office is told about a request, once", () => {
  const people = [
    { id: "a1", role: "admin" },
    { id: "m1", role: "manager" },
    { id: "u9", role: "user" },
  ];
  it("admins and managers get one notice; a second run tells nobody", async () => {
    const env = fakeSupabase({ public_requests: [row()], profiles: people });
    const first = await dispatchPublicRequestNotices(
      env.db as never,
      new Date("2026-11-21T15:01:00Z"),
    );
    expect(first).toMatchObject({ requests_checked: 1, requests_notified: 1, requests_errors: 0 });
    expect(told).toHaveLength(1);
    expect(told[0]![0]).toEqual(["a1", "m1"]);
    expect(told[0]![1]).toEqual({
      kind: "public_request",
      title: "Service request from the public page: Smith Widgets",
      body: "Pat Smith in London, KY asked for Roof inspection, Storm damage. Reference R-4010. Open Requests from the public pages to match it to a customer.",
      url: PUBLIC_REQUESTS_PATH,
    });
    expect(env.tables["public_requests"]![0]!["told_at"]).toBe("2026-11-21T15:01:00.000Z");
    const second = await dispatchPublicRequestNotices(env.db as never);
    expect(second.requests_checked).toBe(0);
    expect(told).toHaveLength(1);
  });
  it("a notice that fails puts the request back for the next run", async () => {
    const env = fakeSupabase({ public_requests: [row()], profiles: people });
    notifyFails.on = true;
    const err = console.error;
    console.error = () => {};
    const out = await dispatchPublicRequestNotices(env.db as never);
    console.error = err;
    expect(out).toMatchObject({ requests_notified: 0, requests_errors: 1 });
    expect(env.tables["public_requests"]![0]!["told_at"]).toBeNull();
  });
  it("a Roof Care request says the plan, and a handled request is not announced", async () => {
    expect(
      publicRequestNotice({
        ...(row({
          kind: "care",
          plan: "guard",
          company: "",
          services: [],
        }) as unknown as PublicRequestRow),
        // A price was shown: without one this reads as a custom quote (the block at the end).
        shown_price: 3870,
        several_buildings: true,
      }),
    ).toMatchObject({
      title: "Roof Care request from the public page: Pat Smith",
      body: expect.stringContaining("asked for Roof Guard, several buildings."),
    });
    const env = fakeSupabase({ public_requests: [row({ status: "matched" })], profiles: people });
    expect((await dispatchPublicRequestNotices(env.db as never)).requests_checked).toBe(0);
  });
  it("the 8:00 run picks up what was not told where the request was made", () => {
    const cron = flat(read("src/routes/api.cron.reminders.ts"));
    expect(cron).toContain("const r = await dispatchPublicRequestNotices(supabaseAdmin);");
    expect(cron).toContain("public_requests: publicRequests,");
  });
});

// ── The daily limit of Google lookups ────────────────────────────────────────────────────────

describe("the site asks Google for a set number of drives a day, then the free router", () => {
  const A = { lat: 37.1287, lng: -84.0833 };
  const B = { lat: 36.9487, lng: -84.0969 };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  function routers() {
    const asked: string[] = [];
    const fetcher = async (url: string) => {
      if (url === GOOGLE_ROUTES_URL) {
        asked.push("google");
        return json({ routes: [{ distanceMeters: 40000, duration: "2400s" }] });
      }
      if (url.startsWith(OSRM_ROUTE_BASE)) {
        asked.push("free");
        return json({ code: "Ok", routes: [{ distance: 37015, duration: 2000, legs: [] }] });
      }
      throw new Error(`unexpected ${url}`);
    };
    return { asked, fetcher };
  }
  const KEY = { GOOGLE_MAPS_API_KEY: "made-up-key" };
  it("under the limit Google answers; at the limit the free router does, and says it was held", async () => {
    const open = routers();
    expect(await routedDriveVia(A, B, open.fetcher, KEY, async () => true)).toMatchObject({
      via: "google",
    });
    expect(open.asked).toEqual(["google"]);
    const shut = routers();
    expect(await routedDriveVia(A, B, shut.fetcher, KEY, async () => false)).toEqual({
      drive: { miles: 23, minutes: 35 },
      via: "free",
      held: true,
    });
    expect(shut.asked).toEqual(["free"]);
  });
  it("a limit that cannot be read fails to the free router, never to an error", async () => {
    const r = routers();
    const got = await routedDriveVia(A, B, r.fetcher, KEY, async () => {
      throw new Error("database down");
    });
    expect(got).toMatchObject({ via: "free", held: true });
    expect(r.asked).toEqual(["free"]);
  });
  it("with no key the limit is not even asked, and nothing is marked held", async () => {
    const r = routers();
    let askedGate = 0;
    const got = await routedDriveVia(A, B, r.fetcher, {}, async () => {
      askedGate++;
      return true;
    });
    expect(got).toEqual({ drive: { miles: 23, minutes: 35 }, via: "free" });
    expect(askedGate).toBe(0);
  });
  it("the gate is the database's count for the whole site: only a true answer opens it", async () => {
    const yes = googleGate({ rpc: async () => ({ data: true, error: null }) });
    const no = googleGate({ rpc: async () => ({ data: false, error: null }) });
    const broken = googleGate({ rpc: async () => ({ data: true, error: { message: "x" } }) });
    expect([await yes(), await no(), await broken()]).toEqual([true, false, false]);
    // Every caller of Google passes it: the Roof Care drive and the ticket's travel line.
    expect(flat(read("src/lib/roof-care.functions.ts"))).toContain(
      "googleGate(sb as unknown as Parameters<typeof googleGate>[0]), ).catch(() => null);",
    );
    expect(flat(read("src/lib/service-field.functions.ts"))).toContain(
      "googleGate(sb as unknown as Parameters<typeof googleGate>[0]), );",
    );
    expect(SQL).toContain("where day = v_day and used < v_cap");
    expect(SQL).toContain("google_daily_cap integer not null default 200");
  });
  it("the office's drive tool says when the day's limit was reached", () => {
    expect(driveSourceWords({ source: "routed", router: "free", google_held: true })).toBe(
      "by road, from the free router: today's limit of Google lookups is reached",
    );
    expect(driveSourceWords({ source: "routed", router: "free" })).toBe(
      "by road, from the free router",
    );
    expect(driveSourceWords({ source: "routed", router: "google", google_held: true })).toBe(
      "by road, from Google",
    );
    expect(read("src/lib/roof-care.functions.ts")).toContain(
      "...(byRoad && routed?.held ? { google_held: true } : {}),",
    );
  });
});

// ── The QR codes and the sheets ──────────────────────────────────────────────────────────────

describe("the QR codes are made by the site and hold exactly the saved address", () => {
  it("each code, read back by a QR reader, is the page's exact address", () => {
    for (const base of ["https://portal.example.com", "https://jbkroofcare.example"]) {
      const sheets = qrSheets(base);
      expect(sheets.map((s) => s.url)).toEqual([
        `${base}${PUBLIC_CARE_PATH}`,
        `${base}${PUBLIC_REQUEST_PATH}`,
      ]);
      for (const s of sheets) {
        const px = qrPixels(s.url, 6);
        const got = jsQR(px.data, px.width, px.height);
        expect(got?.data).toBe(s.url);
      }
    }
  });
  it("a trailing slash on the saved address does not double up", () => {
    expect(qrSheets("https://portal.example.com/")[0]!.url).toBe("https://portal.example.com/care");
  });
  it("the picture is drawn here: no link, no image fetched, a light edge round it", () => {
    const url = "https://portal.example.com/care";
    const svg = qrSvg(url, "Roof Care plans");
    expect(svg).not.toMatch(/href|<image|<script|url\(/);
    const { size } = qrCells(url);
    expect(svg).toContain(
      `viewBox="0 0 ${size + QR_QUIET_CELLS * 2} ${size + QR_QUIET_CELLS * 2}"`,
    );
    const src = read("src/lib/qr.ts");
    expect(src).not.toMatch(/fetch\(|https?:\/\/(?!www\.w3\.org)/);
  });
  it("no sheet prints a price", () => {
    for (const s of qrSheets("https://portal.example.com")) {
      expect(`${s.title} ${s.line}`).not.toMatch(/\$|\d/);
    }
    const page = read("src/components/public-forms-setup.tsx");
    expect(page).toContain("No prices are printed");
    expect(page).not.toMatch(/price\b[^.]*\{/i);
    // Only the sheets print, one to a page, and the buttons stay off the paper.
    expect(page).toContain("[data-qr-sheet] { break-after: page;");
    expect(page).toContain("[data-qr-no-print] { display: none !important; }");
  });
});

describe("the three settings", () => {
  it("the address for the codes: https and the host only, blank for the site's own", () => {
    expect(cleanQrAddress("")).toEqual({ ok: true, url: null });
    expect(cleanQrAddress(" Portal.Example.com ")).toEqual({
      ok: true,
      url: "https://portal.example.com",
    });
    expect(cleanQrAddress("https://portal.example.com/")).toEqual({
      ok: true,
      url: "https://portal.example.com",
    });
    for (const bad of [
      "http://portal.example.com",
      "https://portal.example.com/care",
      "https://portal.example.com?x=1",
      "portal",
      "javascript:alert(1)",
      "https://user:pw@portal.example.com",
    ])
      expect(cleanQrAddress(bad).ok).toBe(false);
    expect(SQL).toContain("qr_base_url ~ '^https://[a-z0-9.-]+(:[0-9]+)?$'");
  });
  it("an address the company does not own is called out before anything is printed", () => {
    expect(qrAddressIsBorrowed("https://something.lovable.app")).toBe(true);
    expect(qrAddressIsBorrowed("https://portal.example.com")).toBe(false);
  });
  it("the services list: trimmed, no blanks, no doubles, at least one", () => {
    expect(cleanServices(["  Roof  inspection ", "", "Storm damage"])).toEqual({
      ok: true,
      services: ["Roof inspection", "Storm damage"],
    });
    expect(cleanServices(["Leak", "leak"])).toMatchObject({ ok: false });
    expect(cleanServices(["", " "])).toMatchObject({ ok: false });
    expect(cleanServices(["x".repeat(81)])).toMatchObject({ ok: false });
  });
  const office = [
    {
      id: "u1",
      role: "admin",
      access: [],
      technician: false,
      full_name: "Ann Admin",
      email: "a@x",
    },
    {
      id: "u2",
      role: "user",
      access: ["customers"],
      technician: false,
      full_name: "Olga Office",
      email: "o@x",
    },
    {
      id: "u3",
      role: "user",
      access: ["service"],
      technician: true,
      full_name: "Tom Tech",
      email: "t@x",
    },
  ];
  const settingsRow = {
    id: 1,
    services: ["Roof inspection"],
    qr_base_url: null,
    google_daily_cap: 200,
    updated_at: "2026-11-21T00:00:00Z",
    updated_by_name: null,
  };
  it("an admin saves them; an office user and a technician cannot; a bad address is refused in words", async () => {
    const env = fakeSupabase(
      { profiles: office, public_form_settings: [{ ...settingsRow }] },
      { rpcs: { google_route_today: () => ({ used: 3, cap: 150, held: 0 }) } },
    );
    const saved = (await run(savePublicFormSettings, env.db, {
      services: ["Roof inspection", " Gutters "],
      qr_base_url: "portal.example.com",
      google_daily_cap: 150,
    })) as { services: string[]; qr_base_url: string; google_daily_cap: number; can_edit: boolean };
    expect(saved).toMatchObject({
      services: ["Roof inspection", "Gutters"],
      qr_base_url: "https://portal.example.com",
      google_daily_cap: 150,
      can_edit: true,
    });
    expect(env.tables["public_form_settings"]![0]!["updated_by_name"]).toBe("Ann Admin");
    await expect(
      run(
        savePublicFormSettings,
        env.db,
        { services: ["A"], qr_base_url: "", google_daily_cap: 1 },
        "u2",
      ),
    ).rejects.toThrow(PUBLIC_SETTINGS_NEED);
    await expect(
      run(
        savePublicFormSettings,
        env.db,
        { services: ["A"], qr_base_url: "", google_daily_cap: 1 },
        "u3",
      ),
    ).rejects.toThrow(PUBLIC_REQUESTS_NEED);
    await expect(
      run(savePublicFormSettings, env.db, {
        services: ["A"],
        qr_base_url: "http://portal.example.com",
        google_daily_cap: 1,
      }),
    ).rejects.toThrow("The address has to start with https://");
  });
});

// ── The office's list ────────────────────────────────────────────────────────────────────────

const full = (over: Partial<PublicRequestRow> = {}): PublicRequestRow => ({
  id: "0b6a3c1e-1111-4222-8333-444455556666",
  reference: "R-4010",
  kind: "care",
  created_at: "2026-11-21T15:00:00Z",
  status: "new",
  contact_name: "Pat Smith",
  company: "Smith Widgets",
  phone: "606-555-0142",
  email: "pat@example.com",
  address: "120 Mill St",
  city: "London",
  state: "KY",
  zip: "40741",
  building_name: "Main plant",
  referred_by: "Tom Tech",
  plan: "care",
  sqft: 21000,
  size_range: null,
  sqft_source: "typed",
  shown_price: 2090,
  quote: { found: true, rough: false, place: null, custom_quote: false },
  pay_method: "card",
  terms_version: ROOF_CARE_TERMS_VERSION,
  agreed_by: "Patricia Smith",
  several_buildings: false,
  notes: "",
  services: [],
  details: "",
  handled_at: null,
  handled_by_name: null,
  dismiss_reason: null,
  account_id: null,
  site_id: null,
  opportunity_id: null,
  roof_care_plan_id: null,
  ...over,
});

describe("the office's list of requests", () => {
  const people = [
    {
      id: "u1",
      role: "user",
      access: ["customers"],
      technician: false,
      full_name: "Olga Office",
      email: "o@x",
    },
    {
      id: "u3",
      role: "user",
      access: ["service"],
      technician: true,
      full_name: "Tom Tech",
      email: "t@x",
    },
  ];
  it("shows what is waiting with its possible matches, for someone with Customers access only", async () => {
    const env = fakeSupabase(
      {
        profiles: people,
        public_requests: [
          full(),
          full({
            id: "0b6a3c1e-1111-4222-8333-444455557777",
            reference: "R-4009",
            status: "dismissed",
            handled_at: "2026-11-20T10:00:00Z",
          }),
        ] as never,
      },
      {
        rpcs: {
          public_request_matches: () => [
            {
              account_id: "acc-1",
              account_name: "Smith Widgets LLC",
              why: ["phone", "name"],
              site_id: null,
            },
            { nonsense: true },
          ],
        },
      },
    );
    const out = (await run(listPublicRequests, env.db, undefined)) as {
      waiting: { reference: string; matches: unknown[] }[];
      handled: { reference: string }[];
    };
    expect(out.waiting.map((r) => r.reference)).toEqual(["R-4010"]);
    expect(out.waiting[0]!.matches).toEqual([
      {
        account_id: "acc-1",
        account_name: "Smith Widgets LLC",
        why: ["phone", "name"],
        site_id: null,
        site_name: null,
        site_address: null,
        phone: null,
        email: null,
      },
    ]);
    expect(out.handled.map((r) => r.reference)).toEqual(["R-4009"]);
    await expect(run(listPublicRequests, env.db, undefined, "u3")).rejects.toThrow(
      PUBLIC_REQUESTS_NEED,
    );
    expect(env.writes).toEqual([]);
  });
  it("the answer goes through the database's own function, which checks who and what", async () => {
    const env = fakeSupabase(
      { profiles: people },
      {
        rpcs: { public_request_handle: (a: unknown) => ({ ...(a as object), status: "matched" }) },
      },
    );
    await run(handlePublicRequest, env.db, {
      id: "0b6a3c1e-1111-4222-8333-444455556666",
      status: "matched",
      account_id: "1b6a3c1e-1111-4222-8333-444455556666",
      site_id: "2b6a3c1e-1111-4222-8333-444455556666",
    });
    expect(env.rpcCalls).toEqual([
      {
        fn: "public_request_handle",
        args: {
          p_id: "0b6a3c1e-1111-4222-8333-444455556666",
          p_status: "matched",
          p_account: "1b6a3c1e-1111-4222-8333-444455556666",
          p_site: "2b6a3c1e-1111-4222-8333-444455556666",
        },
      },
    ]);
    await expect(
      run(
        handlePublicRequest,
        env.db,
        { id: "0b6a3c1e-1111-4222-8333-444455556666", status: "dismissed", reason: "a test" },
        "u3",
      ),
    ).rejects.toThrow(PUBLIC_REQUESTS_NEED);
    // The database is where the rules live.
    for (const words of [
      "Type why the request is dismissed, in a few words",
      "This request is already matched to a customer, so it is not dismissed",
      "That property is not this customer''s",
      "Only the office handles the requests from the public pages",
    ])
      expect(SQL).toContain(words);
  });
  it("a match is only offered: the page makes the customer with the functions that already do", () => {
    const page = read("src/components/public-requests-page.tsx");
    expect(page).toContain('import { quickCreateAccount, saveSite } from "@/lib/crm.functions";');
    expect(page).toContain('import { saveOpportunity } from "@/lib/opportunities.functions";');
    expect(page).toContain("This is {m.account_name}");
    expect(page).toContain("New customer");
    // Nothing is matched by the site on its own: every path starts at a press.
    expect(page).not.toMatch(/useEffect\([^)]*existing\.mutate|useEffect\([^)]*fresh\.mutate/);
    const fns = read("src/lib/public-requests.functions.ts");
    expect(fns).not.toMatch(
      /from\("crm_accounts"\)\s*\.insert|from\("crm_sites"\)\s*\.insert|from\("crm_opportunities"\)\s*\.insert/,
    );
  });
  it("why a customer is offered is said in words", () => {
    expect(matchWhyWords(["phone", "address"])).toBe("same phone number, same street address");
    expect(readMatches("nonsense")).toEqual([]);
  });
});

describe("what a request becomes", () => {
  it("a Roof Care request hands the sign-up what they picked, with their own name as the one who agreed", async () => {
    expect(carePrefill(full())).toEqual({
      request_id: "0b6a3c1e-1111-4222-8333-444455556666",
      reference: "R-4010",
      plan: "care",
      sqft: 21000,
      pay_method: "card",
      agreed_by: "Patricia Smith",
      referred_by: "Tom Tech",
      customer_email: "pat@example.com",
      shown_price: 2090,
      terms_version: ROOF_CARE_TERMS_VERSION,
    });
    expect(carePrefill(full({ kind: "service", plan: null }))).toBeNull();
    const people = [
      {
        id: "u1",
        role: "user",
        access: ["customers"],
        technician: false,
        full_name: "O",
        email: "o@x",
      },
    ];
    const env = fakeSupabase({
      profiles: people,
      public_requests: [
        full({ status: "matched", site_id: "2b6a3c1e-1111-4222-8333-444455556666" }),
      ] as never,
    });
    const id = "0b6a3c1e-1111-4222-8333-444455556666";
    expect(
      await run(publicCarePrefill, env.db, { id, site_id: "2b6a3c1e-1111-4222-8333-444455556666" }),
    ).toMatchObject({ plan: "care", agreed_by: "Patricia Smith" });
    // Another property's page gets nothing.
    expect(
      await run(publicCarePrefill, env.db, { id, site_id: "9b6a3c1e-1111-4222-8333-444455556666" }),
    ).toBeNull();
  });
  it("a service request becomes an opportunity with the services, their words and who referred them", () => {
    const o = opportunityFromRequest(
      full({
        kind: "service",
        plan: null,
        services: ["Roof inspection", "Storm damage"],
        details: "It drips.",
      }),
    );
    expect(o.title).toBe("Smith Widgets: Roof inspection");
    expect(o.referred_by).toBe("Tom Tech");
    expect(o.description).toBe(
      [
        "From the public Request service page (R-4010).",
        "Services asked for: Roof inspection, Storm damage.",
        "What they wrote: It drips.",
        "Contact: Pat Smith, 606-555-0142, pat@example.com.",
        "Building: Main plant, 120 Mill St, London, KY 40741.",
      ].join("\n"),
    );
    expect(callBackDay(new Date(2026, 10, 30, 9))).toBe("2026-12-01");
  });
  it("an unanswered request is on the Needs attention list: amber, red after two days", () => {
    const base = {
      today: "2026-11-25",
      now: "2026-11-25T15:00:00Z",
      limits: ATTENTION_DEFAULTS,
      tickets: [],
      untouched: [],
      opps: [],
      bids: [],
      invoices: [],
      followups: [],
      repairFrom: [],
      bidFrom: [],
      names: {},
    };
    const list = attentionList({
      ...base,
      publicRequests: [
        {
          id: "r1",
          reference: "R-4010",
          from: "Smith Widgets",
          ask: "Roof Care",
          kind: "care",
          sent_on: "2026-11-24",
        },
        {
          id: "r2",
          reference: "R-4008",
          from: "Pat Smith",
          ask: "Roof inspection",
          kind: "service",
          sent_on: "2026-11-21",
        },
      ],
    });
    const rows = list.rows.filter((r) => r.kind === "public_request");
    expect(rows.map((r) => [r.key, r.tone, r.age, r.tag, r.href])).toEqual(
      expect.arrayContaining([
        ["public_request:r1", "amber", 1, "Roof Care request", PUBLIC_REQUESTS_PATH],
        ["public_request:r2", "red", 4, "Service request", PUBLIC_REQUESTS_PATH],
      ]),
    );
    expect(rows.find((r) => r.key === "public_request:r1")!.why).toBe(
      "Sent from the public Roof Care plans page, asking for Roof Care. Nobody has answered it. Open Requests from the public pages, say whose it is, and call them. Reference R-4010.",
    );
    expect(attentionList(base).rows.some((r) => r.kind === "public_request")).toBe(false);
    expect(flat(read("src/lib/owner-attention.functions.ts"))).toContain(
      "const publicRequests = await publicRequestsWaiting(sb);",
    );
  });
});

describe("the menu and the gate", () => {
  it("the list is a Customers page, the QR page a manager's; neither is a public address", () => {
    const side = read("src/components/app-sidebar.tsx");
    expect(side).toContain(
      '{ title: "Public requests", url: PUBLIC_REQUESTS_PATH, icon: Inbox, page: "customers" },',
    );
    expect(side).toContain("visible: managesTickets,");
    expect(read("src/routes/customers_.requests.tsx")).toContain(
      'createFileRoute("/customers_/requests")',
    );
    expect(read("src/routes/setup_.qr.tsx")).toContain('createFileRoute("/setup_/qr")');
    // The public page is /request; the office's list is under /customers so one can never be
    // taken for the other by a rule that looks at how an address starts.
    expect(PUBLIC_REQUESTS_PATH.startsWith(PUBLIC_REQUEST_PATH)).toBe(false);
    const gate = read("src/lib/access.ts");
    expect(gate).toContain('if (pathname.startsWith("/customers")) return "customers";');
    expect(gate).toContain(
      'if (pathname.startsWith("/setup") || pathname.startsWith("/admin/service-rates"))',
    );
  });
});

describe("a custom quote sent from the public page is a call to make, not a sign-up at nothing", () => {
  // What /care sends when no price was shown (public-pages.ts careRequest): the recommended
  // plan standing in, a price of 0, the tick, and a note saying so.
  const CUSTOM = {
    ...CARE,
    plan: "care",
    shown_price: 0,
    agreed: true,
    size_range: "over_75k",
    sqft: null,
    notes: "Custom quote asked for: no price was shown.",
  };
  it("the server takes it as the page sends it and hands it to the database whole", async () => {
    const { deps: d, calls } = deps();
    expect(await sendCare(CUSTOM, d)).toEqual({ reference: "R-4321" });
    expect(calls[1]!.args!["p"]).toMatchObject({
      kind: "care",
      shown_price: 0,
      notes: "Custom quote asked for: no price was shown.",
    });
    expect(await sendCare({ ...CUSTOM, size_range: null, several_buildings: true }, d)).toEqual({
      reference: "R-4321",
    });
  });
  it("the database decides from the price answer it kept, never from the form, whether a price was shown", () => {
    const flat = SQL.replace(/\s+/g, " ");
    expect(flat).toContain(
      "v_priced := v_q.found and not v_q.custom_quote and not v_several and v_q.sqft is not null and jsonb_typeof(v_q.plans) = 'array' and jsonb_array_length(v_q.plans) > 0;",
    );
    // Priced: the plan, the way of paying, the tick, the terms, the name and the price are all
    // still demanded. Not priced: none of them is kept, whatever the page sent.
    const priced = flat.slice(
      flat.indexOf("if v_priced then"),
      flat.indexOf("-- No price was shown"),
    );
    for (const words of [
      "Pick one of the three plans.",
      "Tick the box to agree to the plan''s terms.",
      "The price changed after it was shown.",
    ])
      expect(priced).toContain(words);
    const call = flat.slice(
      flat.indexOf("-- No price was shown"),
      flat.indexOf("select services into v_known"),
    );
    expect(call).toContain("v_shown := null; v_pay := null; v_terms := null; t_agreed_by := null;");
    expect(call).toContain("v_plan := null;");
    expect(call).not.toContain("raise exception");
  });
  it("the office reads it as a custom quote: in the list, the notice and Needs attention", () => {
    const asked = full({ plan: null, shown_price: null, pay_method: null, agreed_by: null });
    expect(isCustomQuoteAsk(asked)).toBe(true);
    expect(isCustomQuoteAsk(full())).toBe(false);
    expect(isCustomQuoteAsk(full({ kind: "service", plan: null, shown_price: null }))).toBe(false);
    expect(requestAsk(asked)).toBe("a custom quote for a Roof Care plan");
    expect(requestAskLine(asked)).toBe("A custom quote for a Roof Care plan");
    expect(requestAsk({ ...asked, plan: "guard", several_buildings: true })).toBe(
      "a custom quote for Roof Guard, several buildings",
    );
    expect(requestAsk(full())).toBe("Roof Care");
    expect(customQuoteWhy({ several_buildings: true, quote: null })).toBe(
      "they have several buildings",
    );
    expect(customQuoteWhy({ several_buildings: false, quote: { custom_quote: true } })).toBe(
      "the roof is over the size the plans are priced for",
    );
    expect(customQuoteWhy({ several_buildings: false, quote: { found: false } })).toBe(
      "the address was not found on the map",
    );
    expect(publicRequestNotice(asked).body).toContain(
      "asked for a custom quote for a Roof Care plan. Reference R-4010.",
    );
    const list = attentionList({
      today: "2026-11-25",
      now: "2026-11-25T15:00:00Z",
      limits: ATTENTION_DEFAULTS,
      tickets: [],
      untouched: [],
      opps: [],
      bids: [],
      invoices: [],
      followups: [],
      repairFrom: [],
      bidFrom: [],
      names: {},
      publicRequests: [
        {
          id: "q1",
          reference: "R-4010",
          from: "Smith Widgets",
          ask: requestAsk(asked),
          kind: "care",
          sent_on: "2026-11-25",
        },
      ],
    });
    const rowQ = list.rows.find((r) => r.key === "public_request:q1")!;
    expect(rowQ.tag).toBe("Custom quote request");
    expect(rowQ.why).toContain("asking for a custom quote for a Roof Care plan.");
  });
  it("the sign-up is never opened from it: there is no price and no agreement to carry over", async () => {
    expect(carePrefill(full({ shown_price: null }))).toBeNull();
    expect(carePrefill(full({ plan: null, shown_price: null }))).toBeNull();
    const page = read("src/components/public-requests-page.tsx").replace(/\s+/g, " ");
    expect(page).toContain("Asked for a custom quote.");
    expect(page).toContain(
      'if (isCustomQuoteAsk(r)) { toast.success("Matched. Call them with a price: nothing was signed on the page."); void nav({ to: "/properties/$id", params: { id: x.siteId } }); } else if (r.kind === "care") {',
    );
    // The Needs attention read and the notice both carry the price, so both can tell.
    expect(read("src/lib/owner-attention.functions.ts")).toContain(
      "several_buildings, shown_price",
    );
    expect(read("src/lib/public-forms.server.ts")).toContain("shown_price, several_buildings");
  });
});

describe("the words a page looks for when a connection is over its limit", () => {
  it("are exactly PUBLIC_TOO_MANY, as the whole message, for a price question and for a request", async () => {
    expect(PUBLIC_TOO_MANY).toBe(
      "Too many requests from this connection. Please wait a few minutes, or call us.",
    );
    const over = deps({ answers: { public_form_take: () => false } });
    const asked = await quoteFor({ ...ASK, sqft: 21000 }, over.deps).catch((e: Error) => e.message);
    expect(asked).toBe(PUBLIC_TOO_MANY);
    expect(await sendCare(CARE, over.deps).catch((e: Error) => e.message)).toBe(PUBLIC_TOO_MANY);
    expect(await sendService(SERVICE, over.deps).catch((e: Error) => e.message)).toBe(
      PUBLIC_TOO_MANY,
    );
  });
});
