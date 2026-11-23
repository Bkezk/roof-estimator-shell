/**
 * The two emails a Roof Care customer gets (owner, Nov 19: "the terms need to be emailed to the
 * customer at signup as well as a receipt ideally"): the agreement when they sign up, with what
 * the plan includes and every term they agreed to, and the receipt when their payment is
 * received. The words only; lib/roof-care-email.server.ts sends them.
 */
import { longDay } from "@/lib/followup-rules";
import {
  everythingIncluded,
  PLAN_FOOTNOTES,
  type PlanBenefitNumbers,
} from "@/lib/roof-care-benefits";
import {
  firstVisitWords,
  PAY_METHOD_WORDS,
  planName,
  planNumberLabel,
  ROOF_CARE_TERMS,
  ROOF_CARE_TERMS_VERSION,
  type FirstVisit,
  type PayMethod,
} from "@/lib/roof-care-plan";
import { money0, PLAN_NAMES, type PlanKey } from "@/lib/roof-care-price";

/** The terms by the version a plan agreed to. Only versions listed here can be emailed. */
export const TERMS_BY_VERSION: Readonly<Record<string, readonly string[]>> = {
  [ROOF_CARE_TERMS_VERSION]: ROOF_CARE_TERMS,
};
export const TERMS_NOT_ON_FILE =
  "The terms this plan agreed to are an older set that cannot be emailed from here";

export interface PlanEmailFacts {
  plan: PlanKey;
  plan_number: number | null;
  /** The property's name, and its address on one line ("" when it has none). */
  site: string;
  address: string;
  agreed_by: string;
  signed_on: string;
  price: number;
  pay_method: PayMethod | null;
  first_visit: FirstVisit;
  first_days: number | null;
  terms_version: string;
  benefits: PlanBenefitNumbers | null;
  /** The company's name, and how to reach it ("" when not on file). */
  company: string;
  contact: string;
  /**
   * The customer's own card payment link (Nov 23), when the plan pays by card, still waits for
   * its payment, and paying by card online is set up. Null or left out: no link is printed.
   */
  pay_link?: string | null;
}

export interface Email {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "link"; text: string; url: string }
  | { kind: "ul" | "ol"; items: string[] };

function render(subject: string, blocks: Block[]): Email {
  const text = blocks
    .map((b) =>
      b.kind === "p"
        ? b.text
        : b.kind === "h"
          ? b.text.toUpperCase()
          : b.kind === "link"
            ? `${b.text}: ${b.url}`
            : b.items.map((t, i) => (b.kind === "ol" ? `${i + 1}. ${t}` : `- ${t}`)).join("\n"),
    )
    .join("\n\n");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:640px">` +
    blocks
      .map((b) =>
        b.kind === "p"
          ? `<p>${esc(b.text)}</p>`
          : b.kind === "h"
            ? `<h3 style="margin:20px 0 6px;font-size:16px">${esc(b.text)}</h3>`
            : b.kind === "link"
              ? `<p><a href="${esc(b.url)}" style="display:inline-block;padding:10px 18px;background:#1f4e9c;color:#ffffff;font-weight:bold;text-decoration:none;border-radius:6px">${esc(b.text)}</a></p><p style="font-size:13px;color:#555555">Or open this address: ${esc(b.url)}</p>`
              : `<${b.kind} style="margin:0;padding-left:22px">${b.items.map((t) => `<li style="margin-bottom:4px">${esc(t)}</li>`).join("")}</${b.kind}>`,
      )
      .join("") +
    `</div>`;
  return { subject, text, html };
}

const label = (f: Pick<PlanEmailFacts, "plan_number">) =>
  f.plan_number != null ? ` (${planNumberLabel(f.plan_number)})` : "";
const place = (f: Pick<PlanEmailFacts, "site" | "address">) =>
  [f.site.trim(), f.address.trim()].filter(Boolean).join(", ") || "your property";
const signOff = (f: Pick<PlanEmailFacts, "company" | "contact">): Block[] => [
  {
    kind: "p",
    text: f.contact
      ? `Questions? Reply to this email or reach us at ${f.contact}.`
      : "Questions? Reply to this email.",
  },
  { kind: "p", text: `Thank you,\n${f.company}` },
];

/** The card payment link, where there is one to give. */
const payBlocks = (f: Pick<PlanEmailFacts, "pay_link">): Block[] =>
  f.pay_link
    ? [
        { kind: "h", text: "Pay by card" },
        {
          kind: "p",
          text: "You chose to pay by card. Use the button below to pay on our secure payment page. Your plan starts the day we receive your payment.",
        },
        { kind: "link", text: "Pay by card", url: f.pay_link },
      ]
    : [];

export interface PayLinkFacts {
  plan: PlanKey;
  plan_number: number | null;
  site: string;
  address: string;
  agreed_by: string;
  /** Dollars still owed for the year. */
  owed: number;
  pay_link: string;
  company: string;
  contact: string;
}

/** The link by itself, when the office sends it again from the plan (Nov 23). */
export function payLinkEmail(f: PayLinkFacts): Email {
  const name = PLAN_NAMES[f.plan];
  const blocks: Block[] = [
    { kind: "p", text: `Hello ${f.agreed_by.trim() || "there"},` },
    {
      kind: "p",
      text: `Here is the link to pay for the ${name} plan${label(f)} at ${place(f)}: ${money0(f.owed)} for the year. It opens our secure card payment page. Your plan starts the day we receive your payment.`,
    },
    { kind: "link", text: "Pay by card", url: f.pay_link },
    ...signOff(f),
  ];
  return render(`Pay for your ${f.company} ${planName(f.plan)} plan${label(f)}`, blocks);
}

/**
 * The agreement: the plan, the price, what it includes, and the terms that were agreed to, word
 * for word. Null when the plan agreed to a set of terms that is not on file here.
 */
export function agreementEmail(f: PlanEmailFacts): Email | null {
  const terms = TERMS_BY_VERSION[f.terms_version];
  if (!terms) return null;
  const name = PLAN_NAMES[f.plan];
  const blocks: Block[] = [
    { kind: "p", text: `Hello ${f.agreed_by.trim() || "there"},` },
    {
      kind: "p",
      text: `Thank you for choosing the ${name} plan for ${place(f)}. This is your copy of the agreement you signed on ${longDay(f.signed_on)}.`,
    },
    { kind: "h", text: "Your plan" },
    {
      kind: "ul",
      items: [
        `Plan: ${name}${label(f)}`,
        `Property: ${place(f)}`,
        `Price: ${money0(f.price)} for the year, paid before the plan starts`,
        ...(f.pay_method ? [`Paying by: ${PAY_METHOD_WORDS[f.pay_method].toLowerCase()}`] : []),
        firstVisitWords(f.first_visit, f.first_days),
        "The plan runs for twelve months from the day we receive your payment.",
      ],
    },
    ...payBlocks(f),
    { kind: "h", text: `What ${name} includes` },
    { kind: "ul", items: everythingIncluded(f.plan, f.benefits) },
    { kind: "p", text: PLAN_FOOTNOTES.join(" ") },
    { kind: "h", text: "The terms you agreed to" },
    { kind: "ol", items: [...terms] },
    {
      kind: "p",
      text: `Agreed by ${f.agreed_by.trim()} on ${longDay(f.signed_on)}. Terms version ${f.terms_version}.`,
    },
    ...signOff(f),
  ];
  return render(`Your ${f.company} ${planName(f.plan)} plan agreement${label(f)}`, blocks);
}

export interface ReceiptFacts extends PlanEmailFacts {
  paid: number;
  paid_on: string;
  starts_on: string;
  renews_on: string;
  invoice_number: string | null;
}

/** The receipt: what was paid and when, and the plan year it bought. */
export function receiptEmail(f: ReceiptFacts): Email {
  const name = PLAN_NAMES[f.plan];
  const blocks: Block[] = [
    { kind: "p", text: `Hello ${f.agreed_by.trim() || "there"},` },
    {
      kind: "p",
      text: `We received your payment for the ${name} plan at ${place(f)}. Thank you. This is your receipt.`,
    },
    { kind: "h", text: "Receipt" },
    {
      kind: "ul",
      items: [
        `Amount paid: ${money0(f.paid)}`,
        `Received: ${longDay(f.paid_on)}`,
        ...(f.pay_method ? [`Paid by: ${PAY_METHOD_WORDS[f.pay_method].toLowerCase()}`] : []),
        ...(f.invoice_number ? [`Invoice: #${f.invoice_number}`] : []),
        `Plan: ${name}${label(f)}`,
      ],
    },
    { kind: "h", text: "Your plan year" },
    {
      kind: "p",
      // A renewal paid before the old year was over (Nov 20): the new year is dated from the
      // old year's last day, so no day is lost and none is given twice. It has not "started".
      text:
        f.starts_on > f.paid_on
          ? `Your new plan year starts ${longDay(f.starts_on)}, the day your current plan year ends, and runs until ${longDay(f.renews_on)}. You are covered without a break. We will be in touch to set the day of each inspection.`
          : `Your plan started ${longDay(f.starts_on)} and runs until ${longDay(f.renews_on)}. We will be in touch to set the day of each inspection.`,
    },
    ...signOff(f),
  ];
  return render(`Receipt: your ${f.company} ${planName(f.plan)} plan${label(f)}`, blocks);
}
