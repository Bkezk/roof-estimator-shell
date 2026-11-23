/**
 * The page a Roof Care customer's card payment link opens (owner, Nov 23: "1. A go"). No
 * sign-in. It shows the one plan the link belongs to, the amount, and one button that opens our
 * card payment page. Paid, it says thank you. A link that is over, or made up, says to call.
 *
 * The same look as the two QR pages (the flyer's), so the customer knows it is ours.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { PublicButton, PublicSampleLine, PublicSheet } from "@/components/public/fields";
import { FLYER_HEAD } from "@/components/roof-care/flyer-look";
import { longDay } from "@/lib/followup-rules";
import { PUBLIC_TRY_AGAIN } from "@/lib/public-forms";
import {
  PAY_BUTTON,
  PAY_CLOSED,
  PAY_JUST_PAID,
  PAY_OFFLINE,
  PAY_PAGE_LEAD,
  PAY_PAGE_TITLE,
  PAY_THANKS_TITLE,
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
          // few times, a few seconds apart, then leave the "being confirmed" words standing.
          if (cameBackPaid() && f.state === "pay" && tries.current < 6) {
            tries.current += 1;
            timer = setTimeout(load, 4000);
          }
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

  const confirming = !!facts && facts.state === "pay" && cameBackPaid();
  return (
    <PublicSheet
      title={PAY_PAGE_TITLE}
      lead={PAY_PAGE_LEAD}
      footTitle="Questions about your plan?"
      data-public-page="pay"
      data-pay-state={facts?.state ?? (problem ? "problem" : "loading")}
    >
      {!facts && !problem && (
        <p className="flex items-center gap-2 text-base text-[var(--flyer-ink)]" role="status">
          <Loader2 className="h-5 w-5 animate-spin" /> One moment…
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
      {facts?.state === "pay" && !confirming && (
        <PublicButton type="button" disabled={opening} onClick={pay} data-action="pay-by-card">
          {opening && <Loader2 className="mr-2 inline h-5 w-5 animate-spin" />}
          {PAY_BUTTON}
        </PublicButton>
      )}
      {confirming && (
        <p
          className="text-base font-semibold text-[var(--flyer-ink)]"
          role="status"
          data-pay="confirming"
        >
          {PAY_JUST_PAID}
        </p>
      )}
      {facts?.state === "paid" && (
        <section className="space-y-2" role="status" data-pay="thanks">
          <h2 className={`${FLYER_HEAD} flyer-h2 text-[var(--jbk-blue)]`}>{PAY_THANKS_TITLE}</h2>
          <p className="text-base text-[var(--flyer-ink)]">
            {payThanksWords(facts.runs_until, longDay)}
          </p>
        </section>
      )}
      {facts?.state === "offline" && (
        <p className="text-base font-semibold text-[var(--flyer-ink)]" data-pay="offline">
          {PAY_OFFLINE}
        </p>
      )}
      {facts?.state === "closed" && (
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
