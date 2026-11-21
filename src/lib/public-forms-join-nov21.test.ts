/**
 * Roof Care step 4, Nov 21: what joining the public pages to the office's side added.
 *
 *  - A Roof Care request matched to a property opens the normal sign-up with what the customer
 *    typed already in it. It only fills boxes: the price is read fresh and every rule runs.
 *  - The hidden box that catches robots no longer has a name a browser fills in by itself.
 *  - The local test server, which keeps nothing, says so on the page.
 *
 * The dollar figures are made up and match no plan price.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PUBLIC_SAMPLE_LINE } from "@/lib/public-forms";
import {
  CARE_REQUEST_SEARCH,
  careRequestFromSearch,
  carePrefillNote,
  carePrefillWords,
  type CareSignUpPrefill,
} from "@/lib/public-requests";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");
const ID = "0b9c2f4e-1a2b-4c3d-8e9f-a0b1c2d3e4f5";

const prefill: CareSignUpPrefill = {
  request_id: ID,
  reference: "R-4821",
  plan: "care",
  sqft: 21400,
  pay_method: "check",
  agreed_by: "Pat Smith",
  referred_by: "Tom Tech",
  customer_email: "pat@example.com",
  shown_price: 1740,
  terms_version: "2026-11-20.1",
};

describe("the property page's search", () => {
  it("keeps a request's id and drops anything else", () => {
    expect(CARE_REQUEST_SEARCH).toBe("care_request");
    expect(careRequestFromSearch({ care_request: ID })).toEqual({ care_request: ID });
    expect(careRequestFromSearch({ care_request: ID.toUpperCase() })).toEqual({
      care_request: ID,
    });
    for (const bad of ["", "1", "R-4821", `${ID}x`, "<script>", 7, null, undefined, { a: 1 }])
      expect(careRequestFromSearch({ care_request: bad })).toEqual({});
    expect(careRequestFromSearch({})).toEqual({});
  });
  it("the route reads it and hands it to the page", () => {
    const route = flat(read("src/routes/properties_.$id.tsx"));
    expect(route).toContain("careRequestFromSearch(search)");
    expect(route).toContain("careRequest={care_request ?? null}");
  });
});

describe("what the office reads at the top of a sign-up opened from a request", () => {
  it("says where it came from, the price shown, the tick and who referred them", () => {
    expect(carePrefillWords(prefill, "2026-11-20.1")).toBe(
      "From the public Roof Care page, request R-4821. The page showed them $1,740 a year. They ticked these terms there, so the tick is already on. Referred by: Tom Tech. Check the roof size, press Show my price and choose when the first inspection is.",
    );
  });
  it("terms changed since their tick: they are read the new ones", () => {
    expect(carePrefillWords({ ...prefill, referred_by: " " }, "2027-01-05.1")).toBe(
      "From the public Roof Care page, request R-4821. The page showed them $1,740 a year. The terms have changed since they ticked them: read them the new ones and tick again. Check the roof size, press Show my price and choose when the first inspection is.",
    );
  });
  it("no price shown is not said as $0", () => {
    expect(carePrefillWords({ ...prefill, shown_price: null }, "2026-11-20.1")).not.toContain("$");
    expect(carePrefillWords({ ...prefill, shown_price: 0 }, "2026-11-20.1")).not.toContain("$");
  });
  it("the note kept on the plan names the request and the referrer", () => {
    expect(carePrefillNote(prefill)).toBe(
      "From the public Roof Care page, request R-4821. Referred by: Tom Tech.",
    );
    expect(carePrefillNote({ ...prefill, referred_by: "" })).toBe(
      "From the public Roof Care page, request R-4821.",
    );
  });
});

describe("the sign-up opened from a request", () => {
  const card = flat(read("src/components/roof-care/plan-card.tsx"));
  it("opens by itself once the request and the property's plans are read", () => {
    expect(card).toContain(
      "queryFn: () => prefillFn({ data: { id: careRequest!, site_id: siteId! } }),",
    );
    expect(card).toContain("if (!careRequest || !prefill.data || !q.data) return;");
    expect(card).toContain("if (openedFor.current === careRequest) return;");
    // A property that already has a plan still opens that plan: the same branch as the button.
    expect(card).toContain("prefill={careRequest ? (prefill.data ?? null) : null}");
  });
  it("only fills the boxes: size, plan, name, email, way of paying and the note", () => {
    expect(card).toContain(
      'prefill?.sqft != null && prefill.sqft > 0 ? String(Math.round(prefill.sqft)) : "",',
    );
    expect(card).toContain("useState<PlanKey | null>(prefill?.plan ?? null)");
    expect(card).toContain('useState(prefill?.agreed_by ?? "")');
    expect(card).toContain('useState(prefill?.customer_email ?? "")');
    expect(card).toContain("useState<PayMethod | null>(prefill?.pay_method ?? null)");
    expect(card).toContain('useState(() => (prefill ? carePrefillNote(prefill) : ""))');
    // The first inspection and the price are never taken from the request.
    expect(card).toContain("const [first, setFirst] = useState<FirstVisit | null>(null);");
    expect(card).toContain("const [offer, setOffer] = useState<RoofCareOffer | null>(null);");
    expect(card).not.toContain("prefill.shown_price,");
  });
  it("their tick stands only for the terms now in use", () => {
    expect(card).toContain("!!prefill && prefill.terms_version === ROOF_CARE_TERMS_VERSION,");
  });
  it("after the plan is signed the request is marked done, pointing at the plan", () => {
    expect(card).toContain(
      'data: { id: prefill.request_id, status: "matched", site_id: siteId, plan_id: made.id },',
    );
    // A request that could not be marked never undoes the sign-up: the office is told.
    expect(card).toContain("could not be marked as done");
  });
});

describe("the public pages", () => {
  const fields = flat(read("src/components/public/fields.tsx"));
  it("the robot box has a name no browser fills in, and is still sent as website", () => {
    expect(fields).toContain('id="jbk-leave-blank"');
    expect(fields).toContain('name="jbk_leave_blank"');
    expect(fields).not.toContain('name="website"');
    expect(fields).toContain("tabIndex={-1}");
    expect(flat(read("src/components/public/care-page.tsx"))).toContain("website,");
  });
  it("the test server's sample answer is said on the page", () => {
    expect(PUBLIC_SAMPLE_LINE).toBe("Test server: these are sample numbers, and nothing was sent.");
    expect(fields).toContain("{sample && <PublicSampleLine />}");
    const care = flat(read("src/components/public/care-page.tsx"));
    expect(care).toContain("{quote?.sample && <PublicSampleLine />}");
    expect(care).toContain("setSentSample(r.sample === true);");
    expect(flat(read("src/components/public/request-page.tsx"))).toContain(
      "setSentSample(r.sample === true);",
    );
  });
});
