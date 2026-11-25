/**
 * The page a Roof Care customer's card payment link opens (owner, Nov 23: "1. A go"). No
 * sign-in. It shows the one plan the link belongs to, the amount, and one button that opens our
 * card payment page. Paid, it says thank you. A link that is over, or made up, says to call.
 *
 * The same look as the two QR pages (the flyer's), so the customer knows it is ours.
 *
 * Nov 26 (the audit of Nov 25, numbers 3, 18 and 28):
 *   - Back from the card page, the thanks are said only while the page is still looking for
 *     the payment. When its looks are done and the plan is still not paid, it says so and
 *     shows the button again. It used to say "your receipt is on its way" for good.
 *   - A payment from the customer's bank account that is on its way, and a roof size that is
 *     not confirmed yet, are each a sentence and no button.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { PublicButton, PublicSampleLine, PublicSheet } from "@/components/public/fields";
import { FLYER_HEAD } from "@/components/roof-care/flyer-look";
import { longDay } from "@/lib/followup-rules";
import { PUBLIC_TRY_AGAIN } from "@/lib/public-forms";
import {
  PAID_LATE_LOOKS_MS,
  PAID_LOOKS_MS,
  PAY_BANK_ON_ITS_WAY,
  PAY_BUTTON,
  PAY_CLOSED,
  PAY_JUST_PAID,
  PAY_NOT_CONFIRMED,
  PAY_OFFLINE,
  PAY_PAGE_LEAD,
  PAY_PAGE_TITLE,
  PAY_SIZE_NOT_READY,
  PAY_THANKS_TITLE,
  payPageOffersPay,
  payPageView,
  payThanksWords,
  type PublicPayFacts,
} from "@/lib/roof-care-pay-link";
import { publicPayPage, publicPayStart } from "@/lib/roof-care-pay-link.functions";
import { money0 } from "@/lib/roof-care-price";

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : PUBLIC_TRY_AGAIN);

/** True when the customer has just come back from the card page. */
const cameBackPaid = () =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("paid") === "1";

export function PublicPayPage({ token }: { token: string }) {
  const read = useServerFn(publicPayPage);
  const start = useServerFn(publicPayStart);
  const [facts, setFacts] = useState<PublicPayFacts | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const tries = useRef(0);
  // Back from the card page (owner, Nov 24: it "does stay on this page for longer than id like
  // after payment"): the thanks are said at once, before anything is read, and the first looks
  // for the payment come sooner. Set after the first paint, so the server's page and the
  // browser's agree.
  const [back, setBack] = useState(false);
  useEffect(() => setBack(cameBackPaid()), []);
  // Nov 26: true once the quick looks are done and the plan is still not paid. The thanks are
  // taken down then, and the button comes back.
  const [looksDone, setLooksDone] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      read({ data: { token } })
        .then((f) => {
          if (!live) return;
          setFacts(f);
          setProblem(null);
          // Back from the card page: the payment company tells us a moment later. Look again a
          // few times, soon at first. Nov 26: then say the payment is not confirmed, and keep
          // looking a few more times, slowly, so the page says thank you by itself if it lands.
          if (!cameBackPaid() || f.state !== "pay") return;
          const n = tries.current;
          tries.current += 1;
          if (n < PAID_LOOKS_MS.length) {
            timer = setTimeout(load, PAID_LOOKS_MS[n]);
            return;
          }
          setLooksDone(true);
          const late = n - PAID_LOOKS_MS.length;
          if (late < PAID_LATE_LOOKS_MS.length) timer = setTimeout(load, PAID_LATE_LOOKS_MS[late]);
        })
        .catch((e) => {
          if (live) setProblem(errText(e));
        });
    };
    load();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [read, token]);

  const pay = () => {
    if (opening) return;
    setOpening(true);
    setProblem(null);
    start({ data: { token } })
      .then((r) => window.location.assign(r.url))
      .catch((e) => {
        setProblem(errText(e));
        setOpening(false);
      });
  };

  // What the page says (payPageView): the server's answer, and for a customer who has just
  // come back, whether the page is still looking for the payment.
  const view = facts ? payPageView(facts.state, cameBackPaid(), looksDone) : null;
  return (
    <PublicSheet
      title={PAY_PAGE_TITLE}
      lead={PAY_PAGE_LEAD}
      footTitle="Questions about your plan?"
      data-public-page="pay"
      data-pay-state={facts?.state ?? (problem ? "problem" : "loading")}
      data-pay-view={view ?? ""}
    >
      {!facts && !problem && !back && (
        <p className="flex items-center gap-2 text-base text-[var(--flyer-ink)]" role="status">
          <Loader2 className="h-5 w-5 animate-spin" /> One moment…
        </p>
      )}
      {!facts && !problem && back && (
        <p
          className="flex items-center gap-2 text-base font-semibold text-[var(--flyer-ink)]"
          role="status"
          data-pay="confirming-first"
        >
          <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> {PAY_JUST_PAID}
        </p>
      )}
      {facts?.sample && <PublicSampleLine />}
      {facts && facts.state !== "closed" && (
        <section className="space-y-2" data-pay="plan">
          <h2 className={`${FLYER_HEAD} flyer-h2 text-[var(--jbk-blue)]`}>
            {facts.plan_name} plan
          </h2>
          <p className="text-base text-[var(--flyer-ink)]">
            {[facts.plan_label, facts.site].filter(Boolean).join(" · ")}
          </p>
          {facts.amount != null && facts.state !== "paid" && (
            <p className="text-base text-[var(--flyer-ink)]" data-pay="amount">
              <b className="text-2xl">{money0(facts.amount)}</b> for the year
            </p>
          )}
        </section>
      )}
      {view === "unconfirmed" && (
        <p
          className="text-base font-semibold text-[var(--flyer-ink)]"
          role="status"
          data-pay="unconfirmed"
        >
          {PAY_NOT_CONFIRMED}
        </p>
      )}
      {view && payPageOffersPay(view) && (
        <PublicButton type="button" disabled={opening} onClick={pay} data-action="pay-by-card">
          {opening && <Loader2 className="mr-2 inline h-5 w-5 animate-spin" />}
          {PAY_BUTTON}
        </PublicButton>
      )}
      {view === "confirming" && (
        <p
          className="text-base font-semibold text-[var(--flyer-ink)]"
          role="status"
          data-pay="confirming"
        >
          {PAY_JUST_PAID}
        </p>
      )}
      {view === "bank" && (
        <p
          className="text-base font-semibold text-[var(--flyer-ink)]"
          role="status"
          data-pay="bank"
        >
          {PAY_BANK_ON_ITS_WAY}
        </p>
      )}
      {view === "held" && (
        <p
          className="text-base font-semibold text-[var(--flyer-ink)]"
          role="status"
          data-pay="held"
        >
          {PAY_SIZE_NOT_READY}
        </p>
      )}
      {view === "paid" && (
        <section className="space-y-2" role="status" data-pay="thanks">
          <h2 className={`${FLYER_HEAD} flyer-h2 text-[var(--jbk-blue)]`}>{PAY_THANKS_TITLE}</h2>
          <p className="text-base text-[var(--flyer-ink)]">
            {payThanksWords(facts?.runs_until ?? null, longDay)}
          </p>
        </section>
      )}
      {view === "offline" && (
        <p className="text-base font-semibold text-[var(--flyer-ink)]" data-pay="offline">
          {PAY_OFFLINE}
        </p>
      )}
      {view === "closed" && (
        <p className="text-base font-semibold text-[var(--flyer-ink)]" data-pay="closed">
          {PAY_CLOSED}
        </p>
      )}
      {problem && (
        <p
          className="rounded-md border-2 border-[var(--pub-bad)] p-3 text-base font-semibold text-[var(--pub-bad)]"
          role="alert"
          data-pay="problem"
        >
          {problem}
        </p>
      )}
    </PublicSheet>
  );
}
