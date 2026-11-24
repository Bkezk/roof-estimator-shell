/**
 * "A Roof Care plan is signed and not paid" (owner, Nov 24: "will they get an notification when
 * there is a sign up but no payement? they should and then it should remind after 2 days if no
 * movement").
 *
 * A plan starts when it is paid. Until then it waits (status awaiting_payment): a sign-up on
 * site that pays by check, a card payment not yet made, a plan the office signed from a QR page
 * request, a renewal. The admins and the managers are told once at the sign-up, and again every
 * PLAN_PAY_REMIND_DAYS days while it is still waiting. Sending the payment link again starts
 * the days over. A plan that is paid or ended is never told.
 *
 * A plan paid by card is held back at its sign-up (owner, the same night: "if someone pays by
 * card we just need the notification they paid by card", and "only drop that if they actually
 * pay by card not if they open the menu then leave"). The customer is at the card screen. When
 * the payment comes through the plan starts and "paid by card" is the only notice. When none
 * has come PLAN_CARD_WAIT_MINUTES after the sign-up, the next pass sends the notice of the
 * sign-up, at any hour, and the reminders follow as for any other plan.
 *
 * Pure: the words. The sending is roof-care-notify.server.ts; the database's side is
 * 20261124960000_roof_care_pay_notice.sql.
 */
import { shortDay } from "@/lib/followup-rules";
import { planName } from "@/lib/roof-care-plan";

export const PLAN_NEEDS_PAYMENT_KIND = "plan_needs_payment";
/** A waiting plan is told again after this many days with no movement. */
export const PLAN_PAY_REMIND_DAYS = 2;
/** A card plan's "signed, not paid" waits this long for the card payment to come through. */
export const PLAN_CARD_WAIT_MINUTES = 30;

/** One plan to tell, as roof_care_pay_notice_claim hands it back. */
export interface PlanWaitingForPayment {
  plan_id: string;
  plan: string;
  plan_number: number | null;
  site_id: string;
  site: string | null;
  account: string | null;
  signed_on: string | null;
  pay_method: string | null;
  sold_by_name: string | null;
  /** Next year's plan of a renewal, not a new sign-up. */
  renewal: boolean;
  /** Never told before: the notice of the sign-up itself. Otherwise a reminder. */
  first: boolean;
  /** The stamp it carried before this claim (put back when the send fails). */
  was: string | null;
  /** Calendar days since it was signed. */
  days_waiting: number;
}

const place = (p: Pick<PlanWaitingForPayment, "site" | "account">) => {
  const where = [p.site, p.account].map((x) => (x ?? "").trim()).filter(Boolean);
  return where.length ? `${where[0]}${where[1] ? ` (${where[1]})` : ""}` : "a property";
};

/** The words of the notice: the sign-up's own, or the reminder. */
export function planNeedsPaymentNotice(p: PlanWaitingForPayment) {
  const name = planName(p.plan);
  const url = `/properties/${p.site_id}`;
  const how =
    p.pay_method === "card"
      ? " Paying by card."
      : p.pay_method === "check"
        ? " Paying by check."
        : "";
  if (p.first) {
    const who = (p.sold_by_name ?? "").trim();
    const did = p.renewal ? "Renewed" : "Signed up";
    // A card plan is told only after the card screen was left without a payment.
    const paying =
      p.pay_method === "card" ? " Paying by card, and no card payment has come through." : how;
    return {
      kind: PLAN_NEEDS_PAYMENT_KIND,
      title: `${name} plan ${p.renewal ? "renewed" : "signed"}, not paid: ${place(p)}`,
      body: `${did}${who ? ` by ${who}` : ""}.${paying} The plan starts when it is paid. Open the property to send the payment link or record the payment.`,
      url,
    };
  }
  const days = Math.max(0, Math.round(Number(p.days_waiting) || 0));
  const since = p.signed_on
    ? `Signed ${shortDay(p.signed_on)}${days > 0 ? `, ${days} ${days === 1 ? "day" : "days"} ago` : ""}`
    : "Signed";
  return {
    kind: PLAN_NEEDS_PAYMENT_KIND,
    title: `${name} plan still not paid: ${place(p)}`,
    body: `${since}, and no payment is recorded, so it has not started.${how} Reach out to the customer, record the payment, or end the plan on the property.`,
    url,
  };
}
