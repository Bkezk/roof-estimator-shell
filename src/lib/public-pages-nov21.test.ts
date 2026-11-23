/**
 * Roof Care step 4, the two public pages (owner, Nov 18: "Two public pages, opened by QR codes
 * on printed leave-behinds, with no sign-in"; Nov 20: "id like the public page to mimic that
 * sign up process and style"). /care and /request open with no sign-in and nothing else does;
 * no price shows before the address is sent; what each form still needs is said in the
 * visitor's words; what is sent is the agreed shape (lib/public-forms.ts).
 *
 * The dollar figures here are made up and match no plan price.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PUBLIC_CARE_PATH,
  PUBLIC_REQUEST_PATH,
  isPublicFormPath,
  type PublicQuote,
} from "@/lib/public-forms";
import {
  PUBLIC_COMPANY,
  buildingProblems,
  careMissing,
  careRequest,
  contactProblems,
  emailOk,
  missingLine,
  phoneDigits,
  phoneOk,
  quoteAsk,
  quoteHasPrices,
  sameAsk,
  serviceMissing,
  serviceRequest,
  sqftTyped,
  wholeDollars,
  type CareAnswers,
  type CareBuilding,
  type ServiceAnswers,
} from "@/lib/public-pages";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("only the two pages are public", () => {
  it("the paths are short, and they are these two", () => {
    expect(PUBLIC_CARE_PATH).toBe("/care");
    expect(PUBLIC_REQUEST_PATH).toBe("/request");
  });
  it("exactly those paths, a slash at the end allowed, and nothing near them", () => {
    for (const p of ["/care", "/request", "/care/", "/request/"])
      expect(isPublicFormPath(p)).toBe(true);
    for (const p of [
      "/",
      "/login",
      "/carex",
      "/requests",
      "/care/plans",
      "/request/1",
      "/service",
      "/owner",
      "/admin/roof-care",
      "/Care",
      "",
    ])
      expect(isPublicFormPath(p)).toBe(false);
  });
  it("the gate lets a signed-out visitor stay on them, bare, and sends every other path to the sign-in", () => {
    const gate = flat(read("src/components/auth-gate.tsx"));
    // Nov 23: and a Roof Care customer's own card payment link, a path that is exactly
    // /pay/<token> (roof-care-pay-link-nov23.test.ts proves nothing else gets through).
    expect(gate).toContain(
      "const isPublicForm = isPublicFormPath(pathname) || isPublicPayPath(pathname);",
    );
    expect(gate).toContain(
      'if (!session && !isLogin && !isReset && !isPublicForm) { navigate({ to: "/login" });',
    );
    expect(gate).toContain("if (isLogin || isReset || isPublicForm) return <>{children}</>;");
    // The bare render comes before the app's shell, so no menu, search or bell is drawn.
    expect(gate.indexOf("if (isLogin || isReset || isPublicForm) return")).toBeLessThan(
      gate.indexOf("return <AuthedShell>{children}</AuthedShell>;"),
    );
  });
  it("each route is its own page, kept out of search results", () => {
    for (const [file, path] of [
      ["src/routes/care.tsx", "/care"],
      ["src/routes/request.tsx", "/request"],
    ] as const) {
      const r = read(file);
      expect(r).toContain(`createFileRoute("${path}")`);
      expect(r).toContain('{ name: "robots", content: "noindex" }');
      expect(r).not.toContain("requireSupabaseAuth");
    }
  });
});

const building = (over: Partial<CareBuilding> = {}): CareBuilding => ({
  address: "100 Made Up Road",
  city: "Corbin",
  state: "ky",
  zip: "40701",
  building_name: "Main plant",
  sqft: "21,000",
  size_range: null,
  several_buildings: false,
  ...over,
});
const quote = (over: Partial<PublicQuote> = {}): PublicQuote => ({
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
      price: 1111,
      benefits: { allowance: 0, leak_calls: 0, storm: 0 },
    },
    {
      plan: "care",
      name: "Roof Care",
      price: 2222,
      benefits: { allowance: 444, leak_calls: 0, storm: 0 },
    },
    {
      plan: "guard",
      name: "Roof Guard",
      price: 3333,
      benefits: { allowance: 1444, leak_calls: 2, storm: 1 },
    },
  ],
  quote_token: "tok-1",
  ...over,
});
const answers = (over: Partial<CareAnswers> = {}): CareAnswers => ({
  building: building(),
  quote: quote(),
  plan: "care",
  contact: {
    contact_name: "Pat Example",
    company: "Example Co",
    phone: "(606) 555-0100",
    email: "pat@example.com",
  },
  pay_method: "check",
  referred_by: "Tyler",
  notes: "",
  agreed: true,
  agreed_by: "Pat Example",
  ...over,
});
const EXTRA = { terms_version: "2026-11-20.1", website: "", open_ms: 42_000 };

describe("the building, and the size", () => {
  it("a size as people type it", () => {
    expect(sqftTyped("21,000")).toBe(21000);
    expect(sqftTyped(" 21000 ")).toBe(21000);
    expect(sqftTyped("0")).toBeNull();
    expect(sqftTyped("big")).toBeNull();
    expect(sqftTyped("-5")).toBeNull();
  });
  it("what is wrong is said under its own box", () => {
    expect(buildingProblems(building())).toEqual({});
    expect(
      buildingProblems(
        building({ address: "", city: " ", state: "Kentucky", zip: "4070", sqft: "" }),
      ),
    ).toEqual({
      address: "Type the street address.",
      city: "Type the city.",
      state: "Two letters, like KY.",
      zip: "Five digits.",
      size: "Type the roof's size, or pick the closest size below.",
    });
    expect(buildingProblems(building({ sqft: "lots" })).size).toBe(
      "Type the roof's size as a number, like 20,000, or pick a size below.",
    );
    // A size range stands in for the number.
    expect(buildingProblems(building({ sqft: "", size_range: "10k_25k" }))).toEqual({});
  });
  it("what is asked of the server: tidy, and a typed size wins over a range", () => {
    expect(quoteAsk(building({ size_range: "25k_50k" }))).toEqual({
      address: "100 Made Up Road",
      city: "Corbin",
      state: "KY",
      zip: "40701",
      sqft: 21000,
      size_range: null,
    });
    expect(quoteAsk(building({ sqft: "", size_range: "25k_50k" })).size_range).toBe("25k_50k");
  });
  it("prices belong to the building they were asked for", () => {
    const a = quoteAsk(building());
    expect(sameAsk(a, quoteAsk(building()))).toBe(true);
    expect(sameAsk(a, quoteAsk(building({ zip: "40702" })))).toBe(false);
    expect(sameAsk(a, quoteAsk(building({ sqft: "22000" })))).toBe(false);
  });
});

describe("who is asking", () => {
  it("a phone number is ten digits however it is typed", () => {
    expect(phoneDigits("(606) 555-0100")).toBe("6065550100");
    expect(phoneDigits("1-606-555-0100")).toBe("6065550100");
    expect(phoneOk("606.555.0100")).toBe(true);
    expect(phoneOk("555-0100")).toBe(false);
  });
  it("an email looks like one", () => {
    expect(emailOk("pat@example.com")).toBe(true);
    expect(emailOk("pat@example")).toBe(false);
    expect(emailOk("pat example.com")).toBe(false);
  });
  it("what is wrong is said under its own box", () => {
    expect(contactProblems({ contact_name: "", company: "", phone: "12", email: "x" })).toEqual({
      contact_name: "Type your name.",
      phone: "Type a phone number with its area code.",
      email: "Type an email address, like name@company.com.",
    });
  });
});

describe("the Roof Care page: what it still needs, and what it sends", () => {
  it("before the address is sent there is nothing to pick: the price comes first", () => {
    expect(careMissing(answers({ quote: null, plan: null }))).toEqual([
      "your price (press Show my price)",
    ]);
    expect(quoteHasPrices(null)).toBe(false);
  });
  it("an address that is not on the map stops there", () => {
    expect(careMissing(answers({ quote: quote({ found: false, plans: [] }) }))).toEqual([
      "an address we can find on the map",
    ]);
  });
  it("the rest, in the order of the page and in the visitor's words", () => {
    const empty = answers({
      plan: null,
      contact: { contact_name: "", company: "", phone: "", email: "" },
      pay_method: null,
      agreed: false,
      agreed_by: "",
    });
    expect(careMissing(empty)).toEqual([
      "the plan you want",
      "your name",
      "your phone number",
      "your email",
      "how you would like to pay",
      "your name as your signature",
      "the tick that you agree to the terms",
    ]);
    expect(missingLine(careMissing(empty))).toBe(
      "Still needed: the plan you want; your name; your phone number; your email; how you would like to pay; your name as your signature; the tick that you agree to the terms.",
    );
    expect(careMissing(answers())).toEqual([]);
    expect(missingLine([])).toBe("");
  });
  it("sends the plan picked at the price that was shown, with the terms' date and the signature", () => {
    const r = careRequest(answers(), EXTRA)!;
    expect(r).toMatchObject({
      contact_name: "Pat Example",
      company: "Example Co",
      phone: "6065550100",
      email: "pat@example.com",
      address: "100 Made Up Road",
      city: "Corbin",
      state: "KY",
      zip: "40701",
      building_name: "Main plant",
      plan: "care",
      sqft: 21000,
      size_range: null,
      shown_price: 2222,
      quote_token: "tok-1",
      pay_method: "check",
      agreed: true,
      terms_version: "2026-11-20.1",
      agreed_by: "Pat Example",
      referred_by: "Tyler",
      several_buildings: false,
      website: "",
      open_ms: 42_000,
    });
  });
  it("sends nothing while something is missing", () => {
    expect(careRequest(answers({ agreed: false }), EXTRA)).toBeNull();
    expect(careRequest(answers({ plan: null }), EXTRA)).toBeNull();
    expect(careRequest(answers({ quote: null }), EXTRA)).toBeNull();
    expect(
      careRequest(
        answers({ contact: { contact_name: "P", company: "", phone: "1", email: "a@b.co" } }),
        EXTRA,
      ),
    ).toBeNull();
  });
  it("a roof that gets a custom quote can still be sent: who to call, no price, no agreement", () => {
    const custom = answers({
      quote: quote({ custom_quote: true, plans: [], sqft: null }),
      plan: null,
      pay_method: null,
      agreed: false,
      agreed_by: "",
      building: building({ sqft: "", size_range: "over_75k", several_buildings: true }),
    });
    expect(careMissing(custom)).toEqual([]);
    const r = careRequest(custom, EXTRA)!;
    expect(r.shown_price).toBe(0);
    expect(r.size_range).toBe("over_75k");
    expect(r.several_buildings).toBe(true);
    expect(r.notes).toBe("Custom quote asked for: no price was shown.");
    expect(r.agreed_by).toBe("Pat Example");
  });
  it("a price reads as the flyer prints it", () => {
    expect(wholeDollars(2222)).toBe("$2,222");
    expect(wholeDollars(1110.6)).toBe("$1,111");
  });
});

const service = (over: Partial<ServiceAnswers> = {}): ServiceAnswers => ({
  address: "100 Made Up Road",
  city: "Corbin",
  state: "KY",
  zip: "40701",
  building_name: "",
  services: ["Roof inspection"],
  details: "",
  contact: {
    contact_name: "Pat Example",
    company: "",
    phone: "606-555-0100",
    email: "pat@example.com",
  },
  referred_by: "",
  ...over,
});
const LIST = ["Roof leak", "Roof inspection", "Something else"];

describe("the request page: what it still needs, and what it sends", () => {
  it("a service ticked, or what is going on in words, is enough to say what is wanted", () => {
    expect(serviceMissing(service(), LIST)).toEqual([]);
    expect(serviceMissing(service({ services: [], details: "Water over the dock" }), LIST)).toEqual(
      [],
    );
    expect(serviceMissing(service({ services: [] }), LIST)).toEqual([
      "what you need (tick a service or tell us what is going on)",
    ]);
  });
  it("with no list to tick from (it could not be read) the words carry it", () => {
    expect(serviceMissing(service({ services: [] }), [])).toEqual(["what is going on"]);
    expect(serviceMissing(service({ services: [], details: "Leak" }), [])).toEqual([]);
  });
  it("the address and who to call, in the page's order", () => {
    expect(
      serviceMissing(
        service({ zip: "", contact: { contact_name: "", company: "", phone: "", email: "" } }),
        LIST,
      ),
    ).toEqual(["the building's address", "your name", "your phone number", "your email"]);
  });
  it("sends only services from the office's list, in the list's order, each once", () => {
    const r = serviceRequest(
      service({ services: ["Something else", "Made up by a robot", "Roof leak", "Roof leak"] }),
      LIST,
      { website: "", open_ms: 9000 },
    )!;
    expect(r.services).toEqual(["Roof leak", "Something else"]);
    expect(r.phone).toBe("6065550100");
    expect(serviceRequest(service({ zip: "" }), LIST, { website: "", open_ms: 9000 })).toBeNull();
  });
});

describe("the pages themselves", () => {
  const care = flat(read("src/components/public/care-page.tsx"));
  const request = flat(read("src/components/public/request-page.tsx"));
  const fields = flat(read("src/components/public/fields.tsx"));
  it("no price shows until the address has been sent, and it goes when the building changes", () => {
    expect(care).toContain(
      "const quote = answer && sameAsk(answer.ask, quoteAsk(building)) ? answer.quote : null;",
    );
    expect(care).toContain(
      "const offerOf = (k: PublicPlanKey) => priced ? quote!.plans.find((o) => o.plan === k) : undefined;",
    );
    expect(care).toContain("price={o ? wholeDollars(o.price) : null}");
    expect(care).toContain("waiting={PRICE_AFTER_ADDRESS}");
    expect(care).toContain("disabled={!o}");
    // No figure is written into the page: every price is the server's answer.
    expect(care).not.toMatch(/\$\d/);
    expect(request).not.toMatch(/\$\d/);
  });
  it("the same terms as the sign-up, by name, with the tick and the typed name", () => {
    expect(care).toContain("{ROOF_CARE_TERMS.map((t) => ( <li key={t}>{t}</li> ))}");
    expect(care).toContain("terms_version: ROOF_CARE_TERMS_VERSION,");
    expect(care).toContain("{AGREE_WORDS}");
    expect(care).toContain('label="Type your full name as your signature"');
  });
  it("says plainly that nobody is charged, that the price is an estimate, and what happens next", () => {
    for (const k of [
      "{NOBODY_CHARGED}",
      "{PRICE_IS_ESTIMATE}",
      "{CUSTOM_QUOTE_LINE}",
      "{NOT_FOUND_LINE}",
      "{SEVERAL_BUILDINGS_LINE}",
      "WHAT_HAPPENS_NEXT.map",
    ])
      expect(care).toContain(k);
    expect(care).toContain("{roughPlaceLine(quote.place)}");
  });
  it("two presses in the same instant send once, and a failed send keeps the typing", () => {
    for (const page of [care, request]) {
      expect(page).toContain("if (!data || busy.current) return; busy.current = true;");
      expect(page).toContain("SEND_FAILED_LINE");
      expect(page).toContain("<RobotTrap value={website} onChange={setWebsite} />");
      expect(page).toContain("open_ms: Date.now() - opened.current");
    }
  });
  it("the robot's box is off the screen, out of the tab order and hidden from a screen reader", () => {
    expect(fields).toContain(
      '<div aria-hidden className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">',
    );
    // Later on Nov 21: the box's own name is one no browser fills in by itself ("website" is
    // autofilled by some). The request still carries it as `website`.
    expect(fields).toContain('name="jbk_leave_blank" type="text" tabIndex={-1} autoComplete="off"');
  });
  it("every box is 48 px tall with a 16 px letter, and says what it is to the keyboard", () => {
    expect(fields).toContain("block h-[48px] w-full");
    expect(fields).toContain("text-[16px]");
    expect(fields).toContain("min-h-[54px]");
    for (const page of [care, request]) {
      expect(page).toContain('type="tel" inputMode="tel" autoComplete="tel"');
      expect(page).toContain('type="email" inputMode="email" autoComplete="email"');
      expect(page).toContain('inputMode="numeric" autoComplete="postal-code"');
      expect(page).toContain('autoComplete="street-address"');
    }
  });
  it("the pages are the white sheet on every phone, with the logo, the green band and the blue band", () => {
    expect(fields).toContain('<div className="jbk-public min-h-svh" {...rest}>');
    expect(fields).toContain("<FlyerMasthead />");
    expect(fields).toContain("<FlyerBand title={`${title}.`} lead={lead} />");
    expect(fields).toContain("<FlyerFoot title={footTitle}>");
    const css = read("src/styles.css");
    const pub = css.slice(css.indexOf("\n.jbk-public {"));
    for (const v of [
      "color-scheme: light;",
      "--background: #ffffff;",
      "--color-card: #ffffff;",
      "--flyer-name: #014b96;",
      "background-color: #ffffff;",
    ])
      expect(pub).toContain(v);
  });
  it("nothing of the signed-in site is on them, and nothing is loaded from another site", () => {
    const files = readdirSync(join(process.cwd(), "src/components/public")).map((f) =>
      read(`src/components/public/${f}`),
    );
    files.push(read("src/components/roof-care/flyer-look.tsx"));
    for (const f of files) {
      expect(f).not.toMatch(
        /useAuth|auth-store|AppSidebar|@tanstack\/react-router|supabase\/client/,
      );
      expect(f).not.toMatch(/https?:\/\//);
      expect(f).not.toMatch(/document\.cookie|localStorage|sessionStorage/);
    }
  });
  it("the four calls are the server's own, and nothing else is called", () => {
    const api = flat(read("src/components/public/api.ts"));
    expect(api).toContain(
      'import { publicRoofCareQuote, publicServiceChoices, submitRoofCareRequest, submitServiceRequest, } from "@/lib/public-forms.functions";',
    );
    expect(api).not.toMatch(/stand-?in/i);
  });
  it("the company's own phone and email, as printed on the flyer", () => {
    expect(PUBLIC_COMPANY.phone).toBe("606-523-9000");
    expect(PUBLIC_COMPANY.phoneHref).toBe("tel:+16065239000");
    expect(PUBLIC_COMPANY.email).toBe("Sales@flatroofonline.com");
  });
});
