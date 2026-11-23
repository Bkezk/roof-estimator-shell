/**
 * Roof Care emails wear the handout's look (owner, Nov 23, on the first agreement that reached
 * his inbox: "id rather it be more visual like the handout i gave you for reference").
 *
 * Before this the agreement was plain paragraphs and lists. It was also telling a Roof Watch
 * customer about gutters, storm inspections and minor repairs, none of which Roof Watch has.
 *
 * THE NUMBERS HERE ARE MADE UP.
 */
import { describe, expect, it } from "vitest";

import { PLAN_FOOTNOTES, PLAN_PITCH } from "@/lib/roof-care-benefits";
import {
  agreementEmail,
  footnotesFor,
  payLinkEmail,
  receiptEmail,
  type PlanEmailFacts,
} from "@/lib/roof-care-email";
import {
  EMAIL_BLUE,
  EMAIL_GREEN,
  EMAIL_MAST_LINE,
  flyerEmailHtml,
} from "@/lib/roof-care-email-look";
import { ROOF_CARE_TERMS, ROOF_CARE_TERMS_VERSION } from "@/lib/roof-care-plan";

const guard: PlanEmailFacts = {
  plan: "guard",
  plan_number: 1234,
  site: "Main Plant",
  address: "1 Mill St, Corbin, KY 40701",
  agreed_by: "Pat <Smith>",
  signed_on: "2027-01-05",
  price: 4321,
  pay_method: "check",
  first_visit: "days",
  first_days: 21,
  terms_version: ROOF_CARE_TERMS_VERSION,
  benefits: { allowance: 1110, leak_calls: 2, storm: 1 },
  company: "JBK Test Roofing",
  contact: "555-0100",
};
const watch: PlanEmailFacts = {
  ...guard,
  plan: "watch",
  first_visit: "window",
  first_days: null,
  benefits: { allowance: 0, leak_calls: 0, storm: 0 },
};

describe("the agreement looks like the handout", () => {
  const m = agreementEmail(guard)!;

  it("the company's name, then the green band with the plan as its headline", () => {
    expect(m.html).toContain(">JBK Test Roofing</td>");
    expect(m.html).toContain("Commercial &amp; Industrial Roofing");
    expect(EMAIL_MAST_LINE).toBe("Commercial & Industrial Roofing");
    expect(m.html).toContain(`background:${EMAIL_GREEN}`);
    expect(m.html).toContain(">Your Roof Guard plan.</div>");
    expect(m.html).toContain(">Your copy of the agreement.</div>");
  });

  it("the plan as a card: its name, what it is, the price, and this customer's facts", () => {
    expect(m.html).toContain(`border:2px solid ${EMAIL_BLUE}`);
    expect(m.html).toContain(">Roof Guard</div>");
    expect(m.html).toContain(`>${PLAN_PITCH.guard}</div>`);
    expect(m.html).toContain(">$4,321</div>");
    expect(m.html).toContain(">per year, paid before the plan starts</div>");
    for (const label of ["Plan number", "Property", "Paying by", "First inspection"])
      expect(m.html).toContain(`>${label}</td>`);
    expect(m.html).toContain(">RC-1234</td>");
    expect(m.html).toContain(
      ">21 days after the payment is received. We will do our best to come on that day, but we cannot guarantee the date.</td>",
    );
  });

  it("numbered headings, counted in order", () => {
    const heads = [
      ...m.html.matchAll(/line-height:32px;color:#15171b">(\d)<\/td><td[^>]*>([^<]+)</g),
    ];
    expect(heads.map((h) => `${h[1]} ${h[2]}`)).toEqual([
      "1 Your plan",
      "2 What Roof Guard includes",
      "3 The terms you agreed to",
    ]);
  });

  it("what it includes with green squares, the terms word for word, the sign-off in the blue band", () => {
    expect(m.html).toContain(`<div style="width:7px;height:7px;background:${EMAIL_GREEN}`);
    expect(m.html).toContain(`<li style="margin-bottom:4px">${ROOF_CARE_TERMS[0]}</li>`);
    const foot = m.html.slice(m.html.lastIndexOf(`background:${EMAIL_BLUE}`));
    expect(foot).toContain("Questions? Reply to this email or reach us at 555-0100.");
    expect(foot).toContain("Thank you,<br>JBK Test Roofing");
  });

  it("nothing a customer typed is taken for markup, and there is no picture to block", () => {
    expect(m.html).toContain("Hello Pat &lt;Smith&gt;,");
    expect(m.html).not.toContain("<Smith>");
    expect(m.html).not.toContain("<img");
    expect(m.html).not.toContain("<style");
  });

  it("the plain-text copy is what it was", () => {
    expect(m.text).toContain("Hello Pat <Smith>,");
    expect(m.text).toContain("YOUR PLAN");
    expect(m.text).toContain("- Plan: Roof Guard (RC-1234)");
    expect(m.text).toContain("- Price: $4,321 for the year, paid before the plan starts");
    expect(m.text).toContain(`1. ${ROOF_CARE_TERMS[0]}`);
    expect(m.text).toContain("Questions? Reply to this email or reach us at 555-0100.");
  });

  it("a card plan's payment button sits in the same look", () => {
    const c = agreementEmail({ ...guard, pay_method: "card", pay_link: "https://x.test/pay/abc" })!;
    expect(c.html).toContain('<a href="https://x.test/pay/abc"');
    expect(c.html).toContain(">Pay by card</a>");
    expect(c.html).toContain("Or open this address: https://x.test/pay/abc");
  });
});

describe("the notes under what a plan includes are that plan's own", () => {
  it("Roof Watch has no gutters, no storm inspection and no minor repairs: no notes", () => {
    const m = agreementEmail(watch)!;
    for (const n of PLAN_FOOTNOTES) {
      expect(m.text).not.toContain(n);
      expect(m.html).not.toContain(n.slice(2, 40));
    }
  });

  it("Roof Guard has all three", () => {
    const m = agreementEmail(guard)!;
    expect(m.text).toContain(PLAN_FOOTNOTES.join(" "));
  });

  it("each note follows its own mark", () => {
    expect(footnotesFor(["Gutters cleaned at both inspections*"])).toEqual([PLAN_FOOTNOTES[0]]);
    expect(footnotesFor(["1 storm inspection a year, after a major storm†"])).toEqual([
      PLAN_FOOTNOTES[1],
    ]);
    expect(footnotesFor(["$310 of minor repairs included each year"])).toEqual([PLAN_FOOTNOTES[2]]);
    expect(footnotesFor(["2 inspections a year, spring and fall"])).toEqual([]);
  });
});

describe("the receipt and the payment link wear it too", () => {
  it("the receipt: the amount as the card", () => {
    const m = receiptEmail({
      ...guard,
      paid: 4321,
      paid_on: "2027-01-08",
      starts_on: "2027-01-08",
      renews_on: "2028-01-08",
      invoice_number: "RC-1234",
    });
    expect(m.html).toContain(">Payment received.</div>");
    expect(m.html).toContain(">Paid</div>");
    expect(m.html).toContain(">$4,321</div>");
    expect(m.html).toContain(">received Jan 8, 2027</div>");
    expect(m.html).toContain(">#RC-1234</td>");
    expect(m.text).toContain("- Amount paid: $4,321");
  });

  it("the payment link by itself", () => {
    const m = payLinkEmail({
      plan: "guard",
      plan_number: 1234,
      site: "Main Plant",
      address: "",
      agreed_by: "Pat Smith",
      owed: 4321,
      pay_link: "https://x.test/pay/abc",
      company: "JBK Test Roofing",
      contact: "",
    });
    expect(m.html).toContain(">Pay for your plan.</div>");
    expect(m.html).toContain(">Pay by card</a>");
    expect(m.text).toContain("Pay by card: https://x.test/pay/abc");
  });
});

describe("the look by itself", () => {
  it("a line break in the sign-off is a line break, and markup in any block is shown as text", () => {
    const html = flyerEmailHtml({ company: "A & B", title: "T <b>" }, [
      { kind: "p", text: "one\ntwo <i>" },
      { kind: "ul", items: ["x <u>"] },
    ]);
    expect(html).toContain(">A &amp; B</td>");
    expect(html).toContain(">T &lt;b&gt;</div>");
    expect(html).toContain("one<br>two &lt;i&gt;");
    expect(html).toContain("x &lt;u&gt;");
  });
});
