/**
 * The public pages audit, Nov 24, 2026 (owner: "Go" on each): what the two public pages and
 * their server now do. Each test here failed on the code of Nov 23.
 *
 *  1. Request service: a few words with no box ticked is a request, filed as "Other".
 *  2. What is in the boxes is read from the page itself, at load and at every press.
 *  6. A building outside the usual area is a custom quote, said in its own words.
 *  8. A price belongs to one building: the city, the state and the zip are checked on the server.
 *  9. One-line boxes are one line; a link is made only from a plain number or a plain address.
 *  12. A dropped form is counted; the same request twice is one request.
 *
 * Every dollar figure here is made up and matches no plan price.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  notify: async () => 1,
  serverClient: async (sb: unknown) => sb,
  hasServiceRole: () => true,
  appUrl: () => "",
}));

import {
  PUBLIC_NEED_WHAT,
  manyLines,
  oneLine,
  publicEmailOk,
  publicStateOk,
  publicZipOk,
  type PublicQuote,
} from "@/lib/public-forms";
import {
  PUBLIC_EMAIL_WRONG,
  PUBLIC_NEED_STATE,
  PUBLIC_NEED_ZIP,
  quoteFor,
  sendCare,
  sendService,
  type PublicDeps,
} from "@/lib/public-forms.functions";
import {
  FAR_QUOTE_LINE,
  PUBLIC_COMPANY,
  ROBOT_TRAP_ID,
  adoptBuilding,
  adoptCareRest,
  adoptContact,
  adoptService,
  adoptTrap,
  buildingProblems,
  careRequest,
  emailOk,
  quoteAsk,
  typedBoxes,
  type BoxLike,
  type CareAnswers,
  type CareBuilding,
  type ServiceAnswers,
} from "@/lib/public-pages";
import {
  REQUEST_OTHER_ASK,
  customQuoteWhy,
  emailLink,
  phoneLink,
  requestAsk,
} from "@/lib/public-requests";
import { ROOF_CARE_TERMS_VERSION } from "@/lib/roof-care-plan";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

type RpcCall = { fn: string; args: Record<string, unknown> | undefined };
function deps(answers: Record<string, (a: Record<string, unknown> | undefined) => unknown> = {}) {
  const calls: RpcCall[] = [];
  const all: Record<string, (a: Record<string, unknown> | undefined) => unknown> = {
    public_form_take2: () => ({ ok: true }),
    public_form_dropped: () => null,
    public_care_quote: () => ({ quote_token: "tok-1", custom_quote: false, plans: [] }),
    public_request_submit: () => "R-4321",
    ...answers,
  };
  const admin = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      const a = all[fn];
      if (!a) return { data: null, error: { message: `no such function ${fn}`, code: "42883" } };
      return { data: a(args), error: null };
    },
  };
  const full: PublicDeps = {
    admin: admin as never,
    key: "k".repeat(40),
    sample: false,
    drive: async () =>
      ({
        hours: 3.4,
        miles: 171.2,
        source: "routed",
        note: "",
        placed_by: "street",
        place: null,
      }) as never,
    mapSize: async () => null,
    tell: async () => undefined,
  };
  return { deps: full, calls };
}

const ASK = { address: "120 Mill St", city: "London", state: "KY", zip: "40741" };
const SERVICE = {
  ...ASK,
  contact_name: "Pat Smith",
  company: "",
  phone: "606-555-0142",
  email: "",
  building_name: "",
  referred_by: "",
  services: [] as string[],
  details: "Water is coming in over the dock.",
  website: "",
  open_ms: 30_000,
};
const CARE = {
  ...ASK,
  contact_name: "Pat Smith",
  company: "Smith Widgets",
  phone: "606-555-0142",
  email: "",
  building_name: "",
  referred_by: "",
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

describe("1. Request service: words alone are a request", () => {
  it("is sent on with no box ticked, and is refused only when there is neither", async () => {
    const ok = deps();
    expect(await sendService(SERVICE, ok.deps)).toEqual({ reference: "R-4321" });
    expect(ok.calls.map((c) => c.fn)).toEqual(["public_form_take2", "public_request_submit"]);
    expect(ok.calls[1]!.args!["p"]).toMatchObject({ kind: "service", services: [] });
    const none = deps();
    await expect(sendService({ ...SERVICE, details: "" }, none.deps)).rejects.toThrow(
      PUBLIC_NEED_WHAT,
    );
    // Refused before anything is counted against the connection.
    expect(none.calls).toEqual([]);
  });
  it("the office reads it as Other, with what was written", () => {
    expect(REQUEST_OTHER_ASK).toBe("Other (see what they wrote)");
    expect(
      requestAsk({
        kind: "service",
        plan: null,
        services: [],
        several_buildings: false,
        shown_price: null,
      }),
    ).toBe(REQUEST_OTHER_ASK);
    const sql = read("supabase/migrations/20261124600000_public_pages_audit_fixes.sql");
    expect(sql).toContain("raise exception 'Tick a service, or tell us what is going on.'");
    expect(sql).not.toContain("Tick at least one service.");
    expect(sql).toContain("v_title := v_from || ': Other';");
    expect(sql).toContain("'They wrote: ' || left(public.public_form_line(t_details), 400)");
  });
});

/** A form as the browser holds it: boxes with what is in them. */
const form = (boxes: BoxLike[]) => ({ querySelectorAll: () => boxes });
const EMPTY: CareBuilding = {
  address: "",
  city: "",
  state: "KY",
  zip: "",
  building_name: "",
  sqft: "",
  size_range: null,
  several_buildings: false,
};

describe("2. What is in the boxes is what the page works on", () => {
  it("reads every box by its id: what is typed, or whether it is ticked", () => {
    expect(
      typedBoxes(
        form([
          { id: "address", type: "text", value: "120 Mill St" },
          { id: "agreed", type: "checkbox", value: "on", checked: true },
          { id: "size-25k_50k", type: "radio", value: "on", checked: false },
          { id: "", type: "text", value: "no id, left out" },
          { id: "notes", value: "a text area has no type" },
        ]),
      ),
    ).toEqual({
      address: "120 Mill St",
      agreed: true,
      "size-25k_50k": false,
      notes: "a text area has no type",
    });
    expect(typedBoxes(null)).toEqual({});
  });
  it("an address typed before the page was ready is the address asked about", () => {
    // The page's own memory is still blank; the boxes hold what the visitor typed.
    const boxes = typedBoxes(
      form([
        { id: "address", type: "text", value: "120 Mill St" },
        { id: "city", type: "text", value: "London" },
        { id: "state", type: "text", value: "KY" },
        { id: "zip", type: "text", value: "40741" },
        { id: "sqft", type: "text", value: "21,000" },
        { id: "several_buildings", type: "checkbox", value: "on", checked: false },
      ]),
    );
    expect(Object.keys(buildingProblems(EMPTY))).toContain("address");
    const now = adoptBuilding(EMPTY, boxes);
    expect(buildingProblems(now)).toEqual({});
    expect(quoteAsk(now)).toEqual({ ...ASK, sqft: 21000, size_range: null });
    // Nothing differs: the very same object, so the page does not draw itself again.
    expect(adoptBuilding(now, boxes)).toBe(now);
    // A size ticked in the page with the size box blank.
    const ranged = adoptBuilding(EMPTY, { "size-25k_50k": true, sqft: "" });
    expect(ranged.size_range).toBe("25k_50k");
  });
  it("the same for who is asking, how to pay, the agreement and the hidden box", () => {
    const blank = { contact_name: "", company: "", phone: "", email: "" };
    const c = adoptContact(blank, { contact_name: "Pat Smith", phone: "606 555 0142" });
    expect(c).toEqual({ contact_name: "Pat Smith", company: "", phone: "606 555 0142", email: "" });
    expect(adoptContact(c, {})).toBe(c);
    const rest = { pay_method: null, referred_by: "", notes: "", agreed: false, agreed_by: "" };
    expect(
      adoptCareRest(rest, { "pay-card": true, agreed: true, agreed_by: "Pat Smith", notes: "x" }),
    ).toEqual({
      pay_method: "card",
      referred_by: "",
      notes: "x",
      agreed: true,
      agreed_by: "Pat Smith",
    });
    expect(adoptCareRest(rest, {})).toBe(rest);
    expect(adoptTrap("", { [ROBOT_TRAP_ID]: "filled" })).toBe("filled");
    expect(adoptTrap("", {})).toBe("");
  });
  it("the request page: its boxes and its ticks, in the office's order", () => {
    const blank: ServiceAnswers = {
      address: "",
      city: "",
      state: "KY",
      zip: "",
      building_name: "",
      services: [],
      details: "",
      contact: { contact_name: "", company: "", phone: "", email: "" },
      referred_by: "",
    };
    const choices = ["Roof leak", "Roof inspection", "Something else"];
    const now = adoptService(
      blank,
      { address: "120 Mill St", details: "It drips.", "service-2": true, "service-0": true },
      choices,
    );
    expect(now.address).toBe("120 Mill St");
    expect(now.details).toBe("It drips.");
    expect(now.services).toEqual(["Roof leak", "Something else"]);
    expect(adoptService(now, {}, choices)).toBe(now);
  });
  it("both pages read their boxes when the script is ready and at every press", () => {
    const care = flat(read("src/components/public/care-page.tsx"));
    const request = flat(read("src/components/public/request-page.tsx"));
    for (const page of [care, request]) {
      expect(page).toContain("const formRef = useRef<HTMLFormElement>(null);");
      expect(page).toContain("ref={formRef}");
      expect(page).toContain("const boxes = typedBoxes(formRef.current);");
    }
    // At load: with what the boxes hold, whatever the page's own memory says.
    expect(care).toContain("setBuilding((x) => adoptBuilding(x, boxes));");
    expect(request).toContain("setA((x) => adoptService(x, boxes, []));");
    // At Show my price: the problems and the question come from the boxes, not from memory.
    expect(care).toContain("const now = adoptBuilding(building, typedBoxes(formRef.current));");
    expect(care).toContain("if (Object.keys(buildingProblems(now)).length > 0 || busy.current)");
    expect(care).toContain("const ask = quoteAsk(now);");
    // At Send.
    expect(care).toContain("const data = careRequest(nowAnswers, {");
    expect(request).toContain("const data = serviceRequest(now, choices, {");
  });
});

describe("6. A building outside the usual area", () => {
  it("is a custom quote with no prices, marked far, not a refusal", async () => {
    const far = deps({
      public_care_quote: () => ({ quote_token: "tok-9", custom_quote: true, far: true, plans: [] }),
    });
    const q = await quoteFor({ ...ASK, sqft: 21000 }, far.deps);
    expect(q).toMatchObject({ found: true, custom_quote: true, far: true, plans: [] });
    // An ordinary answer carries no such mark.
    const near = await quoteFor({ ...ASK, sqft: 21000 }, deps().deps);
    expect("far" in near).toBe(false);
  });
  it("the page says so in its own words and the details can still be sent", () => {
    expect(FAR_QUOTE_LINE).toContain("outside our usual service area");
    expect(FAR_QUOTE_LINE).toContain(PUBLIC_COMPANY.phone);
    const quote: PublicQuote = {
      found: true,
      rough: false,
      place: null,
      sqft: 21000,
      sqft_source: "typed",
      custom_quote: true,
      far: true,
      plans: [],
      quote_token: "tok-9",
    };
    const answers: CareAnswers = {
      building: { ...EMPTY, ...ASK, sqft: "21000" },
      quote,
      plan: null,
      contact: { contact_name: "Pat Smith", company: "", phone: "6065550142", email: "p@x.co" },
      pay_method: null,
      referred_by: "",
      notes: "",
      agreed: false,
      agreed_by: "",
    };
    const sent = careRequest(answers, { terms_version: "t", website: "", open_ms: 9000 });
    expect(sent?.notes).toBe("Outside the usual service area: no price was shown.");
    expect(sent?.shown_price).toBe(0);
    expect(
      customQuoteWhy({ several_buildings: false, quote: { custom_quote: true, far: true } }),
    ).toBe("the building is outside the usual service area");
  });
  it("the database answers a round trip over the limit as far, before the price rule refuses it", () => {
    const sql = flat(read("supabase/migrations/20261124600000_public_pages_audit_fixes.sql"));
    expect(sql).toContain(
      "if v_found and (coalesce(p_hours, 0) > 24 or coalesce(p_miles, 0) > 2000) then v_far := true; v_custom := true; elsif v_found and v_sqft is not null then v_priced := public.roof_care_price(v_sqft, p_hours, p_miles);",
    );
    expect(sql).toContain("'quote_token', v_token, 'custom_quote', v_custom, 'far', v_far");
    expect(sql).toContain("', outside the usual service area'");
  });
});

describe("8. A price belongs to one building", () => {
  it("the server asks for the city, a two letter state and a five digit zip", async () => {
    for (const [bad, words] of [
      [{ ...ASK, city: "" }, "Type the building's city."],
      [{ ...ASK, state: "Kentucky" }, PUBLIC_NEED_STATE],
      [{ ...ASK, state: "" }, PUBLIC_NEED_STATE],
      [{ ...ASK, zip: "" }, PUBLIC_NEED_ZIP],
      [{ ...ASK, zip: "4074" }, PUBLIC_NEED_ZIP],
    ] as const) {
      const d = deps();
      await expect(quoteFor({ ...bad, sqft: 21000 }, d.deps), JSON.stringify(bad)).rejects.toThrow(
        words,
      );
      // Refused before anything is counted or asked.
      expect(d.calls).toEqual([]);
      const s = deps();
      await expect(sendService({ ...SERVICE, ...bad }, s.deps)).rejects.toThrow(words);
      expect(s.calls).toEqual([]);
    }
    expect(publicZipOk("40741-1234")).toBe(true);
    expect(publicStateOk("ky")).toBe(true);
    const ok = deps();
    await quoteFor({ ...ASK, state: "ky", sqft: 21000 }, ok.deps);
    expect(ok.calls[1]!.args!["p"]).toMatchObject({ state: "KY", zip: "40741", city: "London" });
  });
  it("the database compares the request with the price on street, zip, city and state", () => {
    const sql = flat(read("supabase/migrations/20261124600000_public_pages_audit_fixes.sql"));
    expect(sql).toContain(
      "or public.public_form_norm(v_q.city) <> public.public_form_norm(t_city) or upper(btrim(coalesce(v_q.state, ''))) <> t_state",
    );
    expect(sql.match(/v_state !~ '\^\[A-Z\]\{2\}\$'|t_state !~ '\^\[A-Z\]\{2\}\$'/g)).toHaveLength(
      2,
    );
    expect(sql.match(/_zip !~ '\^\\d\{5\}\(-\\d\{4\}\)\?\$'/g)).toHaveLength(2);
  });
});

describe("9. What a visitor types is kept plain", () => {
  it("a one-line box is one line; a box of several lines keeps its line breaks only", () => {
    expect(oneLine("Pat\nSmith\t Jr x")).toBe("Pat Smith Jr x");
    expect(oneLine("  Plain Name  ")).toBe("Plain Name");
    expect(manyLines("line one\nline two\u0007!")).toBe("line one\nline two !");
  });
  it("the server sends the database one line for a name, and keeps the notes' lines", async () => {
    const d = deps();
    await sendCare(
      { ...CARE, contact_name: "Pat\nSmith", agreed_by: "Pat\r\nSmith", notes: "one\ntwo" },
      d.deps,
    );
    expect(d.calls[1]!.args!["p"]).toMatchObject({
      contact_name: "Pat Smith",
      agreed_by: "Pat Smith",
      notes: "one\ntwo",
    });
  });
  it("an email address is an address and nothing more", async () => {
    for (const good of ["pat@example.com", "o'brien+roof@sub.example.co"]) {
      expect(publicEmailOk(good), good).toBe(true);
      expect(emailOk(good), good).toBe(true);
      expect(emailLink(good)).toBe(`mailto:${good}`);
    }
    for (const bad of [
      "a@b.co?bcc=x@y.z&subject=hi",
      "a@b.co?subject=hi",
      "a b@c.co",
      "a@b",
      "a@b.c",
      "a@b.co/x",
      "",
    ]) {
      expect(publicEmailOk(bad), bad).toBe(false);
      expect(emailOk(bad), bad).toBe(false);
      expect(emailLink(bad), bad).toBeNull();
    }
    const d = deps();
    await expect(sendService({ ...SERVICE, email: "a@b.co?bcc=x@y.z" }, d.deps)).rejects.toThrow(
      PUBLIC_EMAIL_WRONG,
    );
    expect(d.calls).toEqual([]);
  });
  it("a phone link holds digits only", () => {
    expect(phoneLink("606-555-0142")).toBe("tel:6065550142");
    expect(phoneLink("+1 (606) 555-0142")).toBe("tel:+16065550142");
    expect(phoneLink("606555,,0100;ext=9 1234")).toBe("tel:606555010091234");
    expect(phoneLink("call me")).toBeNull();
    expect(phoneLink("12")).toBeNull();
    const strip = flat(read("src/components/opportunity-request-strip.tsx"));
    expect(strip).toContain("href={phoneLink(r.phone)!}");
    expect(strip).toContain("href={emailLink(r.email)!}");
    expect(strip).not.toContain("`tel:${r.phone}`");
    expect(strip).not.toContain("`mailto:${r.email}`");
  });
});

describe("12. The small points", () => {
  it("a form dropped as a robot's is counted, and nothing of it is kept", async () => {
    const d = deps();
    const out = await sendService({ ...SERVICE, website: "http://spam.example" }, d.deps);
    expect(out.reference).toMatch(/^R-\d{3}$/);
    expect(d.calls).toEqual([{ fn: "public_form_dropped", args: { p_key: "k".repeat(40) } }]);
    // The count failing changes nothing for the sender.
    const broken = deps({
      public_form_dropped: () => {
        throw new Error("down");
      },
    });
    expect((await sendCare({ ...CARE, open_ms: 0 }, broken.deps)).reference).toMatch(/^R-\d{3}$/);
  });
  it("the counter is the server's alone; daily totals are kept sixty days", () => {
    const sql = flat(read("supabase/migrations/20261124600000_public_pages_audit_fixes.sql"));
    expect(sql).toContain(
      "revoke all on function public.public_form_dropped(text) from public, anon, authenticated;",
    );
    expect(sql).toContain(
      "grant execute on function public.public_form_dropped(text) to service_role;",
    );
    expect(sql).toContain("array['quote'::text, 'request'::text, 'pay'::text, 'trap'::text]");
    expect(sql).toContain("where bucket < now() - interval '3 days' and key <> '*';");
    expect(sql).toContain("where bucket < now() - interval '60 days';");
    // Nothing is given to a visitor with no sign-in.
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\banon\b/);
  });
  it("the same request twice within ten minutes is one request", () => {
    const sql = flat(read("supabase/migrations/20261124600000_public_pages_audit_fixes.sql"));
    expect(sql).toContain("and q.created_at > now() - interval '10 minutes'");
    expect(sql).toContain("if v_ref is not null then return v_ref; end if;");
    // The look comes before a new reference is taken.
    expect(sql.indexOf("if v_ref is not null then return v_ref;")).toBeLessThan(
      sql.indexOf("v_ref := 'R-' || nextval('public.public_request_ref_seq');"),
    );
  });
  it("a request is pointed only at its own customer's opportunity and plan", () => {
    const sql = flat(read("supabase/migrations/20261124600000_public_pages_audit_fixes.sql"));
    expect(sql).toContain(
      "raise exception 'That opportunity is another customer''s, or is deleted'",
    );
    expect(sql).toContain("raise exception 'That Roof Care plan is not this customer''s'");
    expect(sql).toContain("where pl.id = p_plan and pl.account_id = v_account)");
  });
});
