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
  PLAN_PITCH,
  type PlanBenefitNumbers,
} from "@/lib/roof-care-benefits";
import { flyerEmailHtml, type EmailBlock, type EmailHead } from "@/lib/roof-care-email-look";
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
import { ROOF_CARE_TERMS_PAST } from "@/lib/roof-care-terms-history";

/**
 * The terms by the version a plan agreed to. Only versions listed here can be emailed: the set
 * now in use, and every set that was in use before it (roof-care-terms-history.ts; owner, Nov
 * 23: "2 go"), so a plan signed under older terms is still sent the words it agreed to.
 */
export const TERMS_BY_VERSION: Readonly<Record<string, readonly string[]>> = {
  ...ROOF_CARE_TERMS_PAST,
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
   * The plan pays by card online and still waits for its payment. The agreement then says the
   * payment link comes in an email of its own. It never holds the link: see AWAITS_CARD_WORDS.
   */
  awaits_card?: boolean;
}

/** In the agreement's plan card and its plain-text list. */
const RUNS_TWELVE_MONTHS = "The plan runs for twelve months from the day we receive your payment.";

export interface Email {
  subject: string;
  text: string;
  html: string;
}

type Block = EmailBlock;

/**
 * The email in its two copies. The plain-text one is what it always was. The HTML one wears the
 * look of the handout (owner, Nov 23: "more visual like the handout"; roof-care-email-look.ts).
 */
function render(subject: string, head: EmailHead, blocks: Block[]): Email {
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
  return { subject, text, html: flyerEmailHtml(head, blocks) };
}

const label = (f: Pick<PlanEmailFacts, "plan_number">) =>
  f.plan_number != null ? ` (${planNumberLabel(f.plan_number)})` : "";
const place = (f: Pick<PlanEmailFacts, "site" | "address">) =>
  [f.site.trim(), f.address.trim()].filter(Boolean).join(", ") || "your property";
const signOff = (f: Pick<PlanEmailFacts, "company" | "contact">): Block[] => [
  {
    kind: "p",
    role: "foot",
    text: f.contact
      ? `Questions? Reply to this email or reach us at ${f.contact}.`
      : "Questions? Reply to this email.",
  },
  { kind: "p", role: "foot", text: `Thank you,\n${f.company}` },
];

/**
 * The notes under what a plan includes, for the plan in hand: the gutters note only where a line
 * carries its mark, the storm note likewise, and the minor repairs note only where minor repairs
 * are included. The sign-up shows all three under its three plans; an agreement is for one plan,
 * and a Roof Watch customer was being told about gutters and storms it does not include.
 */
export function footnotesFor(included: readonly string[]): string[] {
  return PLAN_FOOTNOTES.filter((n) =>
    n.startsWith("*")
      ? included.some((l) => l.includes("*"))
      : n.startsWith("†")
        ? included.some((l) => l.includes("†"))
        : included.some((l) => /minor repairs/i.test(l)),
  );
}

/**
 * What the agreement says to a customer who pays by card and has not paid yet (owner, Nov 24:
 * "i got this email prompting me to pay by card even though stripe opened and i paid by card
 * then", and "the office needs to review and then send the payment request after theyre sure of
 * the roof size so even then the pay by card button isnt appropriate").
 *
 * So the agreement holds no payment link and no button. The link goes out only when a person in
 * the office presses Email under Card payment link on the plan (payLinkEmail).
 */
export const AWAITS_CARD_WORDS =
  "You chose to pay by card. If you have not paid yet, we will email you a secure payment link after we review your sign-up. Your plan starts the day we receive your payment.";

const payBlocks = (f: Pick<PlanEmailFacts, "awaits_card">): Block[] =>
  f.awaits_card ? [{ kind: "p", text: AWAITS_CARD_WORDS }] : [];

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

/** The payment request: the link by itself, sent when the office presses Email on the plan. */
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
  return render(
    `Pay for your ${f.company} ${planName(f.plan)} plan${label(f)}`,
    { company: f.company, title: "Pay for your plan.", lead: `${name}${label(f)}` },
    blocks,
  );
}

export interface SizeCorrectedFacts {
  plan: PlanKey;
  plan_number: number | null;
  site: string;
  address: string;
  agreed_by: string;
  from_sqft: number;
  to_sqft: number;
  from_price: number;
  to_price: number;
  /** Dollars now owed for the year. */
  owed: number;
  pay_method: PayMethod | null;
  /** The customer's card payment link, for a card plan when paying online is set up. */
  pay_link: string | null;
  /**
   * A plan year already paid (Nov 24, "then build the rest"): the difference to settle, in
   * dollars. Above 0 it is billed on an invoice of its own, below 0 it is sent back. Absent
   * for a plan that waits for its payment.
   */
  settle?: number;
  /**
   * What the customer's payments cover so far, in dollars (Nov 26). Given only when a
   * correction before this one was not settled yet: `settle` is then worked from this, not
   * from `from_price`, and the email says so. Until now a second correction read "now $1,300.
   * It was $1,200 ... an invoice for the difference of $300.00", which does not add up.
   */
  covered?: number;
  /**
   * The size was corrected before (Nov 26): `from_sqft` is then the size we had, not the size
   * the plan was signed at.
   */
  again?: boolean;
  company: string;
  contact: string;
}

/** Said after the amount when it replaces one the customer was told before. */
export const SIZE_EMAIL_REPLACES =
  "This takes the place of what we wrote to you before about the price.";

/** What is said of the money when the plan year was already paid. */
function settleBlocks(settle: number, covered?: number): Block[] {
  // An earlier correction was not settled yet: the amount is from what the payments cover.
  if (covered != null) {
    const cover = `Your payments so far cover ${money2(covered)}`;
    const text =
      settle > 0
        ? `Your plan year is already paid, and nothing is due today. ${cover}, so we will send you one invoice for the difference of ${money2(settle)}.`
        : settle < 0
          ? `${cover}, so we are sending ${money2(-settle)} back to you.`
          : `${cover}, so nothing more is owed.`;
    return [{ kind: "p", text: `${text} ${SIZE_EMAIL_REPLACES}` }];
  }
  if (settle > 0)
    return [
      {
        kind: "p",
        // "Nothing is due today" (owner, Nov 25: the email "comes across a bit abrupt").
        text: `Your plan year is already paid, and nothing is due today. We will send you an invoice for the difference of ${money2(settle)}.`,
      },
    ];
  if (settle < 0)
    return [
      {
        kind: "p",
        text: `Your plan year is already paid. We are sending ${money2(-settle)} back to you.`,
      },
    ];
  return [{ kind: "p", text: "Your plan year is already paid, and nothing more is owed." }];
}

const money2 = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const sqft = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * "We measured your roof": the new size and the new price of a plan that waits for its payment,
 * and with it the request to pay (owner, Nov 24: "send it but can it be combined with the new
 * price payment?"). One email, sent only when a manager ticks so on saving the corrected size.
 * A card plan gets its Pay by card button here: the size is the office's own by now.
 */
export function sizeCorrectedEmail(f: SizeCorrectedFacts): Email {
  const name = PLAN_NAMES[f.plan];
  const same = Math.round(f.from_price) === Math.round(f.to_price);
  const blocks: Block[] = [
    { kind: "p", text: `Hello ${f.agreed_by.trim() || "there"},` },
    {
      kind: "p",
      text: f.again
        ? `We measured the roof at ${place(f)}. It is ${sqft(f.to_sqft)} sq ft. Until now we had your ${name} plan${label(f)} at ${sqft(f.from_sqft)} sq ft.`
        : `We measured the roof at ${place(f)}. It is ${sqft(f.to_sqft)} sq ft. Your ${name} plan${label(f)} was signed at ${sqft(f.from_sqft)} sq ft.`,
    },
    {
      kind: "p",
      text: same
        ? `The yearly price of your plan stays ${money0(f.to_price)}.`
        : `The yearly price of your plan is now ${money0(f.to_price)}. It was ${money0(f.from_price)}. As your agreement says, the price is an estimate until we measure the roof.`,
    },
    // A plan not yet paid whose price went up (owner, Nov 25, of "you anticipating a certain
    // cost then its quoted much higher"): said before the payment is asked for.
    ...(f.settle == null && Math.round(f.to_price) > Math.round(f.from_price)
      ? [{ kind: "p" as const, text: SIZE_EMAIL_NOT_CHARGED }]
      : []),
    ...(f.settle != null
      ? settleBlocks(f.settle, f.covered)
      : f.pay_link
        ? [
            { kind: "h" as const, text: "Pay by card" },
            {
              kind: "p" as const,
              text: `Use the button below to pay ${money0(f.owed)} for the year on our secure payment page. Your plan starts the day we receive your payment.`,
            },
            { kind: "link" as const, text: "Pay by card", url: f.pay_link },
          ]
        : [
            {
              kind: "p" as const,
              text:
                f.pay_method === "check"
                  ? `We will send you the invoice for ${money0(f.owed)}. Your plan starts the day we receive your payment.`
                  : `${money0(f.owed)} is due for the year. Your plan starts the day we receive your payment.`,
            },
          ]),
    ...signOff(f),
  ];
  return render(
    `${SIZE_EMAIL_SUBJECT} your ${f.company} ${planName(f.plan)} plan${label(f)}`,
    { company: f.company, title: SIZE_EMAIL_TITLE, lead: `${name}${label(f)}` },
    blocks,
  );
}

/**
 * The email's softer words (owner, Nov 25: "i like number 3, 5"). The subject no longer leads
 * with what we did, and nothing in it says anyone was on the roof: the size is as likely read
 * from the state's aerial pictures as measured on site.
 */
export const SIZE_EMAIL_SUBJECT = "Your roof measurement and";
export const SIZE_EMAIL_TITLE = "Your roof measurement.";
export const SIZE_EMAIL_NOT_CHARGED =
  "You have not been charged. If you would rather not go ahead at this price, reply to this email and we will cancel the plan at no cost.";

/**
 * What the plan includes and the terms that were agreed to, word for word: in the agreement,
 * and since Nov 24 in the receipt too (owner, of the receipt: it "didnt show what the roof plan
 * included or the terms. like the other confirmation did"). `terms`: the set the plan agreed
 * to, or undefined when it is not on file here: the terms are then left out.
 */
function planBlocks(f: PlanEmailFacts, terms: readonly string[] | undefined): Block[] {
  const name = PLAN_NAMES[f.plan];
  const included = everythingIncluded(f.plan, f.benefits);
  const notes = footnotesFor(included);
  return [
    { kind: "h", text: `What ${name} includes` },
    { kind: "ul", items: included },
    ...(notes.length ? [{ kind: "p" as const, role: "note" as const, text: notes.join(" ") }] : []),
    ...(terms
      ? [
          { kind: "h" as const, text: "The terms you agreed to" },
          { kind: "ol" as const, items: [...terms] },
          {
            kind: "p" as const,
            text: `Agreed by ${f.agreed_by.trim()} on ${longDay(f.signed_on)}. Terms version ${f.terms_version}.`,
          },
        ]
      : []),
  ];
}

/**
 * The agreement: the plan, the price, what it includes, and the terms that were agreed to, word
 * for word. Null when the plan agreed to a set of terms that is not on file here.
 */
export function agreementEmail(f: PlanEmailFacts): Email | null {
  const terms = TERMS_BY_VERSION[f.terms_version];
  if (!terms) return null;
  const name = PLAN_NAMES[f.plan];
  const first = firstVisitWords(f.first_visit, f.first_days);
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
        first,
        RUNS_TWELVE_MONTHS,
      ],
      card: {
        name,
        pitch: PLAN_PITCH[f.plan],
        big: money0(f.price),
        under: "per year, paid before the plan starts",
        rows: [
          ...(f.plan_number != null
            ? [{ label: "Plan number", value: planNumberLabel(f.plan_number) }]
            : []),
          { label: "Property", value: place(f) },
          ...(f.pay_method ? [{ label: "Paying by", value: PAY_METHOD_WORDS[f.pay_method] }] : []),
          { label: "First inspection", value: first.replace(/^First inspection: /, "") },
          { label: "", value: RUNS_TWELVE_MONTHS },
        ],
      },
    },
    ...payBlocks(f),
    ...planBlocks(f, terms),
    ...signOff(f),
  ];
  return render(
    `Your ${f.company} ${planName(f.plan)} plan agreement${label(f)}`,
    {
      company: f.company,
      title: `Your ${name} plan.`,
      lead: "Your copy of the agreement.",
    },
    blocks,
  );
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
      card: {
        name: "Paid",
        big: money0(f.paid),
        under: `received ${longDay(f.paid_on)}`,
        rows: [
          { label: "Plan", value: `${name}${label(f)}` },
          { label: "Property", value: place(f) },
          ...(f.pay_method ? [{ label: "Paid by", value: PAY_METHOD_WORDS[f.pay_method] }] : []),
          ...(f.invoice_number ? [{ label: "Invoice", value: `#${f.invoice_number}` }] : []),
        ],
      },
    },
    { kind: "h", text: "Your plan year" },
    {
      kind: "p",
      // A renewal paid before the old year was over (Nov 20): the new year is dated from the day
      // after the old year's last day (Nov 23), so no day is lost and none is given twice. It
      // has not "started".
      text:
        f.starts_on > f.paid_on
          ? `Your new plan year starts ${longDay(f.starts_on)}, the day after your current plan year ends, and runs until ${longDay(f.renews_on)}. You are covered without a break. We will be in touch to set the day of each inspection.`
          : `Your plan started ${longDay(f.starts_on)} and runs until ${longDay(f.renews_on)}. We will be in touch to set the day of each inspection.`,
    },
    // Nov 24: the receipt is the email a customer keeps, so it says what the plan includes and
    // the terms too, as the agreement does.
    ...planBlocks(f, TERMS_BY_VERSION[f.terms_version]),
    ...signOff(f),
  ];
  return render(
    `Receipt: your ${f.company} ${planName(f.plan)} plan${label(f)}`,
    { company: f.company, title: "Payment received.", lead: "Thank you. This is your receipt." },
    blocks,
  );
}
