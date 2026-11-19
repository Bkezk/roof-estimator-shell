/**
 * A property's Roof Care plan (owner, Nov 18; docs/roof-care-plans.md): the badge that says
 * which plan it has and how many of its inspections are done this plan year, the inspections
 * with their tickets, and the buttons: sign up, push back, storm inspection, end.
 *
 * Mounted on the customer's page under each property, on the property's own page, and on a
 * ticket (the short form: the ticket's own inspection, or the sign-up button for whoever is on
 * the roof). The rules are the database's; the forms say what will happen before it is pressed
 * (lib/roof-care-plan.ts).
 */
import { Fragment, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Check, CloudLightning, Loader2, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isFieldOnly, managesTickets, seesInvoices } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { easternYmd } from "@/lib/field-day";
import { longDay } from "@/lib/followup-rules";
import { offeredWords, offersKey } from "@/lib/care-plan-offers";
import { carePlanOffered, markCarePlanOffered } from "@/lib/care-plan-offers.functions";
import { allowanceMoney } from "@/lib/roof-care-allowance";
import {
  AGREE_WORDS,
  benefitsOfPlan,
  benefitsUsed,
  everythingIncluded,
  EMAIL_BAD,
  EMAIL_LABEL,
  EMAIL_NONE_NOTE,
  looksLikeEmail,
  PAY_CARD_NOTE_CUSTOMER,
  PAY_CHECK_NOTE_CUSTOMER,
  PAY_QUESTION,
  PLAN_FOOTNOTES,
  PLAN_PITCH,
  PLAN_RECOMMENDED,
  planIncludes,
  PRICE_AFTER_SIZE,
  PRICE_PAID_FIRST,
  RECOMMENDED_WORDS,
  SIGN_UP_BUTTON,
  SIGN_UP_LEAD,
  SIGN_UP_TITLE,
} from "@/lib/roof-care-benefits";
import { NOT_PLACED_LINE } from "@/lib/roof-care-locate";
import {
  ADDITIONAL_SERVICES_LABEL,
  AWAITING_PAYMENT_NOTE,
  AWAITING_PAYMENT_WORDS,
  CARE_PLAN_LABEL,
  CARRIED_NO_PUSH,
  CLOSE_OUT_LABEL,
  CLOSE_OUT_NOTE,
  closedOutWords,
  CUSTOMER_ASKED_LABEL,
  CUSTOMER_ASKED_NOTE,
  DATES_FROM_PAYMENT,
  dueWords,
  expiredWords,
  firstVisitWords,
  isExpired,
  lostWords,
  MAP_ROOF_MORE,
  MAP_ROOF_USE,
  mapRoofSizeLine,
  nextWindow,
  owedWords,
  PAY_CARD_NOTE,
  PAY_METHOD_WORDS,
  PAY_METHODS,
  payWords,
  planBadge,
  PLAN_MAKE_INVOICE,
  PLAN_NO_INVOICE,
  planDates,
  planEmailLines,
  planName,
  planNumberLabel,
  pushPreview,
  REFUND_BAD_AMOUNT,
  REFUND_MARK_SENT,
  refundLines,
  refundStatusWords,
  RENEW_LABEL,
  RENEWAL_NOTE,
  RENEWAL_WORDS,
  renewalChoiceWords,
  renewalDecisionWords,
  renewalDefaultWords,
  renewalOpen,
  renewalPriceWords,
  renewsWords,
  RENEWAL_CHOICES,
  PRICE_ESTIMATE_JUST_NOW,
  PRICE_ESTIMATE_ROUGH,
  isPriceChanged,
  ROOF_CARE_TERMS,
  roofCarePlansKey,
  runsLate,
  VISIT_LABEL,
  VISIT_UNBILLED_WORDS,
  visitsDone,
  visitsDoneWords,
  visitState,
  visitUnbilled,
  windowWords,
  type FirstVisit,
  type PayMethod,
  type PlanVisit,
  type RenewalChoice,
  type RoofCarePlan,
} from "@/lib/roof-care-plan";
import {
  addRoofCareStorm,
  closeOutRoofCarePlan,
  endRoofCarePlan,
  listRoofCarePlans,
  markRoofCareRefundSent,
  pushBackRoofCareVisit,
  renewRoofCarePlan,
  requestAdditionalService,
  roofCareMapSize,
  roofCareBenefits,
  roofCareOffer,
  roofCareRefund,
  roofCareRenewalOffer,
  setRoofCareEmail,
  signUpRoofCare,
  type RoofCareOffer,
} from "@/lib/roof-care-plan.functions";
import { createRoofCarePlanInvoice } from "@/lib/roof-care-plan-invoice.functions";
import { money0, PLAN_KEYS, PLAN_NAMES, type PlanKey } from "@/lib/roof-care-price";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STALE_MS = 60_000;

/** A whole number out of a box; null for a blank or anything that is not one. */
function wholeNumber(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

function usePlans(siteId: string | null | undefined) {
  const { session } = useAuth();
  const listFn = useServerFn(listRoofCarePlans);
  return useQuery({
    queryKey: roofCarePlansKey(siteId ?? ""),
    queryFn: () => listFn({ data: { site_ids: [siteId!] } }),
    enabled: !!session && !!siteId,
    staleTime: STALE_MS,
  });
}

/** What each plan includes, in numbers. Null while it loads and when it cannot be read. */
function useBenefits() {
  const { session } = useAuth();
  const fn = useServerFn(roofCareBenefits);
  return useQuery({
    queryKey: ["roof-care-benefits"],
    queryFn: () => fn(),
    enabled: !!session,
    staleTime: 10 * 60_000,
  });
}

/**
 * The plan in force, else the one waiting for its payment, else the last one that was in force
 * (a renewal made and cancelled never was), else the one that ended last.
 */
const currentPlan = (plans: readonly RoofCarePlan[]): RoofCarePlan | null =>
  plans.find((p) => p.status === "active") ??
  plans.find((p) => p.status === "awaiting_payment") ??
  plans.find((p) => !p.pay_first || !!p.starts_on) ??
  plans[0] ??
  null;

function useRefresh(siteId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: roofCarePlansKey(siteId) });
    void qc.invalidateQueries({ queryKey: ["service-jobs"] });
    void qc.invalidateQueries({ queryKey: ["service-job"] });
    void qc.invalidateQueries({ queryKey: ["today"] });
  };
}

/** The badge alone: "Roof Guard · 1 of 2 inspections done". Nothing without a plan in force. */
export function RoofCareBadge({ plan, today }: { plan: RoofCarePlan; today: string }) {
  const done = visitsDone(plan, today);
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-roof-care-badge={plan.plan}>
      <Badge
        variant="outline"
        className={`gap-1 font-medium ${plan.status === "active" ? "border-emerald-600/50 text-emerald-800 dark:text-emerald-300" : plan.status === "awaiting_payment" ? "border-amber-600/50 text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`}
      >
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {planBadge(plan)}
      </Badge>
      {plan.status === "active" && (
        <span className="flex items-center gap-1 text-xs" data-roof-care-done={done.visits}>
          {[1, 2].map((n) => (
            <span
              key={n}
              aria-hidden
              className={`h-2.5 w-2.5 rounded-full border ${n <= done.visits ? "border-emerald-600 bg-emerald-600" : "border-muted-foreground/50"}`}
            />
          ))}
          {done.storm > 0 && (
            <CloudLightning
              className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400"
              aria-hidden
            />
          )}
          <span className="text-muted-foreground">{visitsDoneWords(plan, today)}</span>
        </span>
      )}
    </span>
  );
}

const STATE_WORDS = {
  done: "Done",
  late: "Late",
  ticket: "Ticket out",
  waiting: "Not yet due",
  lost: "Lost",
};

function VisitRow({
  visit,
  today,
  office,
  showMoney,
  onPush,
}: {
  visit: PlanVisit;
  today: string;
  office: boolean;
  showMoney: boolean;
  onPush: (v: PlanVisit) => void;
}) {
  const state = visitState(visit, today);
  return (
    <li
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
      data-roof-care-visit={visit.kind}
      data-visit-state={state}
    >
      <span className="font-medium">{VISIT_LABEL[visit.kind]}</span>
      <span className="text-muted-foreground">
        {visit.lost_on
          ? lostWords(visit.lost_on)
          : visit.kind === "carried"
            ? `Do it by ${longDay(visit.due_by)}, or it is lost`
            : dueWords(visit)}
      </span>
      <Badge
        variant={state === "late" || state === "lost" ? "destructive" : "secondary"}
        className={state === "done" ? "bg-emerald-600 text-white hover:bg-emerald-600" : ""}
      >
        {STATE_WORDS[state]}
      </Badge>
      {visit.ticket && (
        <Link
          to="/service"
          search={{ id: visit.ticket.id }}
          className="underline underline-offset-2"
        >
          Ticket #{visit.ticket.number}
        </Link>
      )}
      {showMoney && visit.amount > 0 && (
        <span className="text-muted-foreground">bills {money0(visit.amount)}</span>
      )}
      {/* Done and signed off, with its share of the plan on no invoice (Nov 19). */}
      {showMoney && visitUnbilled(visit) && (
        <Badge variant="destructive" data-visit-unbilled>
          {VISIT_UNBILLED_WORDS}
        </Badge>
      )}
      {(visit.push_reason || (visit.kind !== "carried" && visit.due_by !== visit.first_due_by)) && (
        <span className="text-muted-foreground" data-visit-pushed={visit.customer_asked}>
          pushed back{visit.push_reason ? `: ${visit.push_reason}` : ""}
        </span>
      )}
      {office && visit.kind === "carried" && state !== "done" && state !== "lost" && (
        <span className="text-muted-foreground">{CARRIED_NO_PUSH}</span>
      )}
      {office && state !== "done" && visit.kind !== "carried" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => onPush(visit)}
          data-action="roof-care-push"
        >
          <CalendarClock className="mr-1 h-3.5 w-3.5" /> Push back
        </Button>
      )}
    </li>
  );
}

/**
 * The two buttons (owner, Nov 18: "lets have the two buttons 'Care Plan' and 'Additional
 * Services'"): pinned at the bottom of the ticket workflow, under Open ticket and the stage on a
 * ticket, and under New ticket on a property. Care Plan opens the property's plan when it has
 * one (its inspections, push back, storm inspection) and the sign-up when it has none; the
 * button carries the plan's name and how many inspections are done. Additional Services takes
 * down what else the customer wants. `big`: the workflow's bar, for a thumb.
 */
export function RoofCareButtons({
  siteId,
  visitId,
  jobId,
  big = false,
  className = "",
}: {
  siteId: string | null | undefined;
  visitId?: string | null;
  /**
   * On a ticket: the ticket. Pressing Care Plan there is kept, so the owner can see the plan is
   * being offered (Nov 19: "track the care plan button click on the ticket").
   */
  jobId?: string | null;
  big?: boolean;
  className?: string;
}) {
  const { profile, session } = useAuth();
  const q = usePlans(siteId);
  const qc = useQueryClient();
  const [open, setOpen] = useState<"plan" | "service" | null>(null);
  const markFn = useServerFn(markCarePlanOffered);
  const mark = useMutation({
    mutationFn: (id: string) => markFn({ data: { job_id: id } }),
    // The press is a record, not the person's task: a failure is tried again, never shown.
    retry: 2,
    onSuccess: (_r, id) => void qc.invalidateQueries({ queryKey: offersKey(id) }),
  });
  // Who has pressed it on this ticket: the office's line under the buttons.
  const offeredFn = useServerFn(carePlanOffered);
  const showsOffered = !!jobId && !big && !!profile && !isFieldOnly(profile);
  const offered = useQuery({
    queryKey: offersKey(jobId ?? ""),
    queryFn: () => offeredFn({ data: { job_id: jobId! } }),
    enabled: !!session && showsOffered,
    staleTime: STALE_MS,
  });
  if (!siteId || !profile) return null;
  const today = easternYmd();
  const active = (q.data ?? []).find((p) => p.status === "active") ?? null;
  // Signed and waiting for its payment (Nov 19): Care Plan opens it, never a second sign-up.
  const waiting = (q.data ?? []).find((p) => p.status === "awaiting_payment") ?? null;
  const done = active ? visitsDone(active, today) : null;
  // The workflow's bar: the two side by side on a phone, each tall enough for a thumb, in the
  // logo's blue (owner, Nov 18: "color them blue, the same blue as in the logo").
  const size = big ? BIG_BUTTON : "";
  return (
    <div
      className={`${big ? "grid grid-cols-2 gap-2" : "flex flex-wrap gap-2"} ${className}`}
      data-roof-care-buttons={active ? active.plan : waiting ? "awaiting" : "none"}
    >
      <Button
        type="button"
        variant="outline"
        size={big ? "lg" : "sm"}
        className={size}
        // Until the plans are read the button cannot know which of the two it opens.
        disabled={!q.data && !q.error}
        title={q.error ? `Could not load the Roof Care plan: ${errText(q.error)}` : undefined}
        onClick={() => {
          setOpen("plan");
          if (jobId) mark.mutate(jobId);
        }}
        data-action="care-plan"
      >
        <span className={big ? "flex min-w-0 flex-col items-center leading-tight" : "contents"}>
          <span className="flex items-center">
            <ShieldCheck className={`mr-1 ${big ? "h-5 w-5" : "h-4 w-4"}`} /> {CARE_PLAN_LABEL}
          </span>
          {active && done && (
            <span
              className={`rounded px-1.5 font-medium ${big ? "bg-white/20 text-[10px] text-white" : "ml-1.5 bg-emerald-600/15 py-0.5 text-[11px] text-emerald-800 dark:text-emerald-300"}`}
              data-care-plan-chip
            >
              {planName(active.plan)} · {done.visits}/2
            </span>
          )}
          {!active && waiting && (
            <span
              className={`rounded px-1.5 font-medium ${big ? "bg-white/20 text-[10px] text-white" : "ml-1.5 bg-amber-500/15 py-0.5 text-[11px] text-amber-800 dark:text-amber-300"}`}
              data-care-plan-chip="awaiting"
            >
              {AWAITING_PAYMENT_WORDS}
            </span>
          )}
        </span>
      </Button>
      <Button
        type="button"
        variant="outline"
        size={big ? "lg" : "sm"}
        className={size}
        onClick={() => setOpen("service")}
        data-action="additional-services"
      >
        <Plus className={`mr-1 ${big ? "h-5 w-5" : "h-4 w-4"}`} /> {ADDITIONAL_SERVICES_LABEL}
      </Button>
      {open === "plan" &&
        (active || waiting ? (
          <PlanDialog siteId={siteId} visitId={visitId ?? null} onClose={() => setOpen(null)} />
        ) : (
          <SignUpDialog siteId={siteId} today={today} onClose={() => setOpen(null)} />
        ))}
      {open === "service" && <ServiceRequestDialog siteId={siteId} onClose={() => setOpen(null)} />}
      {/* Was the plan offered on this ticket? Only where there is one to offer. */}
      {showsOffered && q.data && !active && !waiting && offered.data && (
        <p
          className={`basis-full text-right text-xs ${offered.data.length ? "text-muted-foreground" : "font-medium text-amber-700 dark:text-amber-400"}`}
          data-care-plan-offered={offered.data.length}
        >
          {offeredWords(offered.data)}
        </p>
      )}
    </div>
  );
}

/** A button of the workflow's bar: blue, white words, a thumb tall. */
const BIG_BUTTON =
  "h-11 min-w-0 rounded-lg border-transparent bg-[var(--jbk-blue)] px-2 text-sm font-semibold text-white shadow-none hover:bg-[var(--jbk-blue-hover)] hover:text-white active:bg-[var(--jbk-blue-hover)] disabled:opacity-70";

/** The property's plan in a pop-up: what Care Plan opens when there is one. */
function PlanDialog({
  siteId,
  visitId,
  onClose,
}: {
  siteId: string;
  visitId: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" data-care-plan-dialog>
        <DialogHeader>
          <DialogTitle>{CARE_PLAN_LABEL}</DialogTitle>
          <DialogDescription>
            The plan this property is on, what it includes, and what has been used this plan year.
          </DialogDescription>
        </DialogHeader>
        <RoofCareCard siteId={siteId} visitId={visitId} includesOpen />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The property's Roof Care plan, when it has one: the badge, who signed, and each inspection.
 * `visitId`: on a ticket, the inspection this ticket is, so its line leads; `short`: the badge
 * and that one line, no list. Nothing for a property that never had a plan.
 */
export function RoofCareCard({
  siteId,
  visitId,
  short = false,
  includesOpen = false,
  className = "",
}: {
  siteId: string | null | undefined;
  visitId?: string | null;
  short?: boolean;
  /** The Care Plan pop-up: what the plan includes is open, not folded. */
  includesOpen?: boolean;
  className?: string;
}) {
  const { profile } = useAuth();
  const q = usePlans(siteId);
  const [push, setPush] = useState<PlanVisit | null>(null);
  const [ending, setEnding] = useState(false);
  // The renewal (Nov 19): the Renew box, and ending a renewal that is waiting.
  const [renewing, setRenewing] = useState(false);
  const [endingRenewal, setEndingRenewal] = useState(false);
  const [closingOut, setClosingOut] = useState(false);
  const refresh = useRefresh(siteId ?? "");
  const stormFn = useServerFn(addRoofCareStorm);
  const storm = useMutation({
    mutationFn: (planId: string) => stormFn({ data: { plan_id: planId } }),
    onSuccess: () => {
      refresh();
      toast.success("Storm inspection ticket made");
    },
    onError: (e) => toast.error(`Could not add the storm inspection: ${errText(e)}`),
  });
  if (!siteId || !profile) return null;
  if (q.error)
    return (
      <p className={`text-xs text-destructive ${className}`}>
        Could not load the Roof Care plan: {errText(q.error)}
      </p>
    );
  if (!q.data) return null;
  const today = easternYmd();
  const plan = currentPlan(q.data);
  // A property that never had a plan shows nothing here: the Care Plan button is where one
  // starts (RoofCareButtons).
  if (!plan) return null;
  const active = plan?.status === "active" ? plan : null;
  const waiting = plan?.status === "awaiting_payment" ? plan : null;
  // Its twelve months are over (Nov 19): what it included has stopped, and it can be renewed.
  const expired = isExpired(plan) ? plan : null;
  // A plan that is waiting may be the renewal of one that has since expired.
  const waitingRenews = waiting?.renewed_from
    ? q.data.find((p) => p.id === waiting.renewed_from)
    : undefined;
  // Next year's plan, made and waiting for its payment, while this year's is still in force.
  const renewal = active
    ? (q.data.find((p) => p.status === "awaiting_payment" && p.renewed_from === active.id) ?? null)
    : null;
  const office = !isFieldOnly(profile);
  const manager = managesTickets(profile);
  const mine = active && visitId ? (active.visits.find((v) => v.id === visitId) ?? null) : null;
  return (
    <div
      className={`space-y-1.5 ${className}`}
      data-roof-care={active ? active.plan : waiting ? "awaiting" : expired ? "expired" : "none"}
    >
      {plan && <RoofCareBadge plan={plan} today={today} />}
      {plan.status === "ended" && plan.refund && plan.refund.due > 0 && (
        <RefundOwed siteId={siteId} plan={plan} />
      )}
      {expired && (
        <div className="space-y-1 text-xs" data-roof-care-expired>
          <p className="font-medium text-amber-800 dark:text-amber-300">{expiredWords(expired)}</p>
          {expired.closed_out && (
            <p className="text-muted-foreground" data-roof-care-closed-out>
              {closedOutWords(expired.closed_out)}
            </p>
          )}
          {/* What was not done is still owed. */}
          {!short &&
            expired.visits.some(
              (v) => v.kind !== "storm" && !["done", "lost"].includes(visitState(v, today)),
            ) && (
              <ul className="space-y-1" data-expired-owed>
                {expired.visits
                  .filter(
                    (v) => v.kind !== "storm" && !["done", "lost"].includes(visitState(v, today)),
                  )
                  .map((v) => (
                    <VisitRow
                      key={v.id}
                      visit={v}
                      today={today}
                      office={false}
                      showMoney={false}
                      onPush={setPush}
                    />
                  ))}
              </ul>
            )}
          {!short && office && (
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setRenewing(true)}
                data-action="roof-care-renew"
              >
                {RENEW_LABEL}
              </Button>
              {/* It will not be renewed (owner, Nov 19): a manager takes it off the lists. */}
              {manager && !expired.closed_out && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => setClosingOut(true)}
                  data-action="roof-care-close-out"
                >
                  {CLOSE_OUT_LABEL}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {waiting && (
        <AwaitingPayment
          siteId={siteId}
          plan={waiting}
          office={office}
          manager={manager}
          short={short}
          includesOpen={includesOpen}
          {...(waitingRenews ? { renewalOf: waitingRenews } : {})}
          onEnd={() => setEnding(true)}
        />
      )}
      {mine && (
        <p className="text-xs font-medium" data-roof-care-this-ticket>
          This ticket is the plan’s {VISIT_LABEL[mine.kind].toLowerCase()}. {dueWords(mine)}.
        </p>
      )}
      {active && (
        <>
          <p className="text-xs text-muted-foreground">
            {/* A renewed year says so; who first agreed and who signed them up stay with it. */}
            {active.renewed_from
              ? `Renewed ${longDay(active.signed_on)}. First agreed by ${active.agreed_by}`
              : `Signed ${longDay(active.signed_on)} by ${active.agreed_by}`}
            {active.sold_by_name ? `, signed up by ${active.sold_by_name}` : ""}.
            {/* A renewal paid ahead has not started yet: its year begins when the old one ends. */}
            {active.pay_first && active.starts_on
              ? active.starts_on > today
                ? ` Paid. The plan year starts ${longDay(active.starts_on)}.`
                : ` Paid, and started ${longDay(active.starts_on)}.`
              : ""}{" "}
            Renews {longDay(active.renews_on)}.{office && ` ${money0(active.price)} a year.`}
            {active.price_estimated && " The price is an estimate until the address is confirmed."}
          </p>
          {/* What the plan includes and what it has given so far (owner, Nov 19). */}
          {!short && <PlanBenefits plan={active} today={today} open={includesOpen} />}
          {!short && office && active.pay_first && active.email && (
            <PlanEmailLine siteId={siteId} plan={active} paid />
          )}
          {/* Which invoices used the minor repairs, for those who see invoices. The tally
              above says how much is used and left. */}
          {!short && active.repair_allowance > 0 && active.allowance_used !== null && (
            <div className="space-y-0.5 text-xs" data-roof-care-allowance>
              {active.allowance_uses.length > 0 && (
                <p className="text-muted-foreground" data-allowance-uses>
                  Minor repairs used on{" "}
                  {active.allowance_uses.map((u, n) => (
                    <span key={u.invoice_id}>
                      {n > 0 && ", "}
                      <Link
                        to="/service/invoices"
                        search={{ id: u.invoice_id }}
                        className="underline underline-offset-2"
                      >
                        invoice #{u.number}
                      </Link>{" "}
                      ({allowanceMoney(u.amount)})
                    </span>
                  ))}
                  .
                </p>
              )}
              <p className="text-muted-foreground">
                A repair invoice at this property uses the plan by itself while any is left. Untick
                it on the invoice when the repair is not a minor one.
              </p>
            </div>
          )}
          {runsLate(active) && (
            <p className="text-xs text-amber-700 dark:text-amber-400" data-roof-care-late>
              Running late: an inspection was pushed past the plan year, so the renewal moved.
            </p>
          )}
          {/* The last 60 days of the plan year (owner, Nov 19): the renewal, or the button
              that makes it. */}
          {!short && office && !renewal && renewalOpen(active, today) && (
            <div
              className="flex flex-wrap items-center gap-2 text-xs"
              data-roof-care-renew={active.renews_on < today ? "past" : "due"}
            >
              <span
                className={
                  active.renews_on < today
                    ? "font-medium text-destructive"
                    : "font-medium text-amber-800 dark:text-amber-300"
                }
              >
                {renewsWords(active, today)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setRenewing(true)}
                data-action="roof-care-renew"
              >
                {RENEW_LABEL}
              </Button>
            </div>
          )}
          {renewal && (
            <AwaitingPayment
              siteId={siteId}
              plan={renewal}
              office={office}
              manager={manager}
              short={short}
              renewalOf={active}
              onEnd={() => setEndingRenewal(true)}
            />
          )}
          {(!short || mine) && (
            <ul className="space-y-1">
              {(short && mine ? [mine] : active.visits).map((v) => (
                <VisitRow
                  key={v.id}
                  visit={v}
                  today={today}
                  office={office}
                  showMoney={office}
                  onPush={setPush}
                />
              ))}
            </ul>
          )}
          {!short && office && (
            <div className="flex flex-wrap gap-1.5">
              {active.plan === "guard" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={storm.isPending}
                  onClick={() => storm.mutate(active.id)}
                  data-action="roof-care-storm"
                >
                  {storm.isPending ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CloudLightning className="mr-1 h-3.5 w-3.5" />
                  )}
                  Storm inspection
                </Button>
              )}
              {manager && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => setEnding(true)}
                  data-action="roof-care-end"
                >
                  End plan
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {push && (
        <PushBackDialog
          siteId={siteId}
          visit={push}
          manager={manager}
          onClose={() => setPush(null)}
        />
      )}
      {ending && (active ?? waiting) && (
        <EndDialog
          siteId={siteId}
          plan={(active ?? waiting)!}
          renewal={!active && !!waitingRenews}
          onClose={() => setEnding(false)}
        />
      )}
      {renewing && (active ?? expired) && (
        <RenewDialog
          siteId={siteId}
          plan={(active ?? expired)!}
          onClose={() => setRenewing(false)}
        />
      )}
      {closingOut && expired && (
        <CloseOutDialog siteId={siteId} plan={expired} onClose={() => setClosingOut(false)} />
      )}
      {endingRenewal && renewal && (
        <EndDialog siteId={siteId} plan={renewal} renewal onClose={() => setEndingRenewal(false)} />
      )}
    </div>
  );
}

// ── What the plan includes, and what it has given (owner, Nov 19) ───────────────────────────

/** Every line the plan includes, with the plan's own numbers. Folded unless `open`. */
function PlanIncludes({ plan, open }: { plan: RoofCarePlan; open: boolean }) {
  const lines = everythingIncluded(plan.plan, benefitsOfPlan(plan, plan.storm_included ?? 0));
  return (
    <details
      className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs"
      open={open}
      data-roof-care-includes={plan.plan}
    >
      <summary className="cursor-pointer font-medium">What {planName(plan.plan)} includes</summary>
      <ul className="mt-1.5 space-y-1">
        {lines.map((line) => (
          <li key={line} className="flex gap-1.5">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The plan in force: what it includes, and the plan year's tally (the inspections, the minor
 * repairs, the leak calls with no trip charge, the storm inspection).
 */
function PlanBenefits({ plan, today, open }: { plan: RoofCarePlan; today: string; open: boolean }) {
  const rows = benefitsUsed(plan, today, plan.storm_included ?? 0);
  return (
    <div className="space-y-1.5" data-roof-care-benefits>
      <PlanIncludes plan={plan} open={open} />
      <div className="rounded-md border px-2.5 py-1.5 text-xs">
        <p className="font-medium">Used this plan year</p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {rows.map((r) => (
            <Fragment key={r.key}>
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="font-medium" data-benefit={r.key}>
                {r.words}
              </dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** Where the agreement and the receipt went, and the box that gives or corrects the address. */
function PlanEmailLine({
  siteId,
  plan,
  paid,
}: {
  siteId: string;
  plan: RoofCarePlan;
  paid: boolean;
}) {
  const refresh = useRefresh(siteId);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(plan.email?.to ?? "");
  const fn = useServerFn(setRoofCareEmail);
  const save = useMutation({
    mutationFn: () => fn({ data: { plan_id: plan.id, email: value.trim() } }),
    onSuccess: () => {
      refresh();
      setEditing(false);
      toast.success("Email saved");
    },
    onError: (e) => toast.error(`Could not save the email: ${errText(e)}`, { duration: 20_000 }),
  });
  const e = plan.email;
  if (!e) return null;
  const bad = value.trim() !== "" && !looksLikeEmail(value.trim());
  return (
    <div className="space-y-1 text-xs" data-roof-care-email={e.to ? "has" : "none"}>
      {planEmailLines(e, { paid, day: longDay }).map((l) => (
        <p key={l} className="text-muted-foreground">
          {l}
        </p>
      ))}
      {editing ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            type="email"
            aria-label="The customer’s email"
            className="h-8 w-64"
            value={value}
            onChange={(ev) => setValue(ev.target.value)}
          />
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            disabled={bad || save.isPending}
            onClick={() => save.mutate()}
            data-action="roof-care-email-save"
          >
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          {bad && <span className="text-destructive">{EMAIL_BAD}</span>}
        </div>
      ) : (
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-xs"
          onClick={() => setEditing(true)}
          data-action="roof-care-email-edit"
        >
          {e.to ? "Change the email" : "Add an email"}
        </Button>
      )}
    </div>
  );
}

// ── The refund of a plan ended early (owner, Nov 19) ────────────────────────────────────────

/** The refund a manager confirmed, until it is marked sent. Only for those who see invoices. */
function RefundOwed({ siteId, plan }: { siteId: string; plan: RoofCarePlan }) {
  const refresh = useRefresh(siteId);
  const [ref, setRef] = useState("");
  const sentFn = useServerFn(markRoofCareRefundSent);
  const sent = useMutation({
    mutationFn: () => sentFn({ data: { plan_id: plan.id, on: easternYmd(), ref: ref.trim() } }),
    onSuccess: () => {
      refresh();
      toast.success("Refund marked sent");
    },
    onError: (e) => toast.error(`Could not mark the refund sent: ${errText(e)}`),
  });
  const r = plan.refund!;
  return (
    <div className="space-y-1 text-xs" data-roof-care-refund={r.sent_on ? "sent" : "owed"}>
      <p
        className={
          r.sent_on ? "text-muted-foreground" : "font-medium text-amber-800 dark:text-amber-300"
        }
      >
        {refundStatusWords(r)}
      </p>
      {!r.sent_on && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Check number or note for the refund"
            placeholder="Check number or note"
            className="h-7 w-48 text-xs"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={sent.isPending}
            onClick={() => sent.mutate()}
            data-action="roof-care-refund-sent"
          >
            {sent.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {REFUND_MARK_SENT}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Signed, waiting for its payment (owner, Nov 19) ─────────────────────────────────────────

/**
 * A plan that is signed and not yet paid: who signed, what was chosen for the first inspection,
 * and for those who see invoices the plan's invoice, or the button that makes it. The plan
 * starts by itself the day that invoice is marked paid in full.
 */
function AwaitingPayment({
  siteId,
  plan,
  office,
  manager,
  short,
  includesOpen = false,
  renewalOf,
  onEnd,
}: {
  siteId: string;
  plan: RoofCarePlan;
  office: boolean;
  manager: boolean;
  short: boolean;
  /** The Care Plan pop-up: what the plan includes is open. */
  includesOpen?: boolean;
  /** The plan year this one renews, when it is a renewal shown under it. */
  renewalOf?: RoofCarePlan;
  onEnd: () => void;
}) {
  const { profile } = useAuth();
  const refresh = useRefresh(siteId);
  const navigate = useNavigate();
  const makeFn = useServerFn(createRoofCarePlanInvoice);
  const make = useMutation({
    mutationFn: () => makeFn({ data: { plan_id: plan.id } }),
    onSuccess: (r) => {
      refresh();
      void navigate({ to: "/service/invoices", search: { id: r.id } });
    },
    onError: (e) => toast.error(`Could not make the invoice: ${errText(e)}`, { duration: 20_000 }),
  });
  const money = seesInvoices(profile);
  const inv = plan.invoice;
  const decided = renewalDecisionWords(plan);
  return (
    <div
      className={`space-y-1 text-xs ${renewalOf ? "rounded-md border p-2" : ""}`}
      data-roof-care-awaiting={renewalOf ? "renewal" : "new"}
    >
      <p className="font-medium text-amber-800 dark:text-amber-300">
        {renewalOf
          ? `${RENEWAL_WORDS}: ${AWAITING_PAYMENT_WORDS.toLowerCase()}`
          : AWAITING_PAYMENT_WORDS}
        {plan.plan_number != null ? ` · ${planNumberLabel(plan.plan_number)}` : ""}
        {office && ` · ${money0(Math.max(0, plan.price - plan.renewal_credit))} for the year`}
      </p>
      {renewalOf ? (
        <p className="text-muted-foreground">
          Made {longDay(plan.signed_on)}. {RENEWAL_NOTE}
        </p>
      ) : (
        <p className="text-muted-foreground">
          Signed {longDay(plan.signed_on)} by {plan.agreed_by}
          {plan.sold_by_name ? `, signed up by ${plan.sold_by_name}` : ""}. {AWAITING_PAYMENT_NOTE}
        </p>
      )}
      {office && decided && (
        <p className="font-medium" data-renewal-decision={plan.renewal_choice}>
          {decided}
        </p>
      )}
      {plan.pay_method && (
        <p className="font-medium" data-awaiting-pay={plan.pay_method}>
          {payWords(plan.pay_method, plan.pay_note)}
          {plan.pay_method === "card" ? ` ${PAY_CARD_NOTE}` : ""}
        </p>
      )}
      {!short && !renewalOf && (
        <p className="text-muted-foreground" data-awaiting-first>
          {firstVisitWords(plan.first_visit, plan.first_days)}
        </p>
      )}
      {!short && !renewalOf && <PlanIncludes plan={plan} open={includesOpen} />}
      {!short && office && plan.email && <PlanEmailLine siteId={siteId} plan={plan} paid={false} />}
      {money &&
        (inv ? (
          <p data-awaiting-invoice={inv.status}>
            <Link
              to="/service/invoices"
              search={{ id: inv.id }}
              className="font-medium underline underline-offset-2"
            >
              Invoice #{inv.number}
            </Link>{" "}
            {inv.status === "draft"
              ? "is a draft. Finalise it and send it to the customer."
              : inv.paid_amount > 0
                ? `has ${money0(inv.paid_amount)} paid of ${money0(inv.total)}. ${renewalOf ? "The new plan year" : "The plan"} starts when it is paid in full.`
                : "is waiting to be paid. Mark it paid when the payment arrives."}
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-2" data-awaiting-invoice="none">
            <span>{PLAN_NO_INVOICE}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={make.isPending}
              onClick={() => make.mutate()}
              data-action="roof-care-make-invoice"
            >
              {make.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {PLAN_MAKE_INVOICE}
            </Button>
          </p>
        ))}
      {!short && manager && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={onEnd}
          data-action={renewalOf ? "roof-care-end-renewal" : "roof-care-end"}
        >
          {renewalOf ? "Cancel the renewal" : "End plan"}
        </Button>
      )}
    </div>
  );
}

// ── Renew (owner, Nov 19) ───────────────────────────────────────────────────────────────────

/**
 * The Renew box: the price today, how they pay, and, with an inspection still owed, the office's
 * call between the two answers with the push-back reasons in front of it. The database decides
 * everything; this says it first.
 */
function RenewDialog({
  siteId,
  plan,
  onClose,
}: {
  siteId: string;
  plan: RoofCarePlan;
  onClose: () => void;
}) {
  const refresh = useRefresh(siteId);
  const navigate = useNavigate();
  const offerFn = useServerFn(roofCareRenewalOffer);
  const offer = useQuery({
    queryKey: ["roof-care-renewal-offer", plan.id],
    queryFn: () => offerFn({ data: { plan_id: plan.id } }),
    retry: false,
    staleTime: 0,
  });
  // Null until the person picks: the rule's own answer and last year's way of paying stand.
  const [picked, setPicked] = useState<RenewalChoice | null>(null);
  const [pay, setPay] = useState<PayMethod | null>(null);
  const [payNote, setPayNote] = useState("");
  const o = offer.data;
  const choice = o && o.owed.length ? (picked ?? o.default_choice) : null;
  const payMethod = pay ?? o?.pay_method ?? null;
  const renewFn = useServerFn(renewRoofCarePlan);
  const renew = useMutation({
    mutationFn: () =>
      renewFn({
        data: {
          plan_id: plan.id,
          choice,
          pay_method: payMethod!,
          pay_note: payMethod === "check" ? payNote.trim() : "",
          shown_price: o!.price,
        },
      }),
    onSuccess: (r) => {
      refresh();
      if (r.started) toast.success("Renewed at no charge. The new plan year has started.");
      else if (r.invoice_id) {
        toast.success("Renewal made. Its invoice is a draft: finalise it and send it.");
        void navigate({ to: "/service/invoices", search: { id: r.invoice_id } });
      } else toast.success("Renewal made. It waits for the office to make its invoice.");
      onClose();
    },
    onError: (e) => {
      // A changed price is read again, so the box shows the one that will be saved.
      if (isPriceChanged(errText(e))) void offer.refetch();
      toast.error(`Could not renew the plan: ${errText(e)}`, { duration: 20_000 });
    },
  });
  const ready = !!o && o.open && !o.has_renewal && !!payMethod && (!o.owed.length || !!choice);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-roof-care-renew-dialog>
        <DialogHeader>
          <DialogTitle>Renew the {planName(plan.plan)} plan</DialogTitle>
          <DialogDescription>
            Another plan year, paid before it starts. {RENEWAL_NOTE}
          </DialogDescription>
        </DialogHeader>
        {offer.isPending && <p className="text-sm text-muted-foreground">Working it out…</p>}
        {offer.error && (
          <p className="text-sm text-destructive">Could not work it out: {errText(offer.error)}</p>
        )}
        {o && (
          <div className="space-y-3 text-sm">
            <p className="font-medium" data-renew-line="price">
              {renewalPriceWords(o)}
            </p>
            {o.owed.length > 0 && (
              <fieldset className="space-y-1.5 rounded-md border p-3" data-renew-owed>
                <legend className="px-1 font-medium">{owedWords(o.owed.length)}</legend>
                <ul className="text-xs text-muted-foreground">
                  {o.owed.map((v) => (
                    <li key={v.kind} data-owed={v.kind} data-customer-asked={v.customer_asked}>
                      {VISIT_LABEL[v.kind]}, due by {longDay(v.due_by)}
                      {v.late ? ", late" : ", not late yet"}.{" "}
                      {v.push_reason ? `Pushed back: ${v.push_reason}` : "Never pushed back."}
                    </li>
                  ))}
                </ul>
                {RENEWAL_CHOICES.map((c) => (
                  <label key={c} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="rc-renew-choice"
                      className="mt-1"
                      checked={choice === c}
                      onChange={() => setPicked(c)}
                      data-renew-choice={c}
                    />
                    <span>{renewalChoiceWords(c, o)}</span>
                  </label>
                ))}
                <p className="text-xs text-muted-foreground" data-renew-line="default">
                  {renewalDefaultWords(o)}
                </p>
              </fieldset>
            )}
            <fieldset className="space-y-1.5" data-renew-pay>
              <legend className="font-medium">How they are paying for the year</legend>
              {PAY_METHODS.map((m) => (
                <label key={m} className="flex flex-wrap items-center gap-2">
                  <input
                    type="radio"
                    name="rc-renew-pay"
                    checked={payMethod === m}
                    onChange={() => setPay(m)}
                    data-pay={m}
                  />
                  <span>{PAY_METHOD_WORDS[m]}</span>
                  {m === "check" && payMethod === "check" && (
                    <Input
                      aria-label="Check number, if known"
                      placeholder="Check number, if known"
                      className="h-8 w-56"
                      value={payNote}
                      onChange={(e) => setPayNote(e.target.value)}
                    />
                  )}
                </label>
              ))}
              {payMethod === "card" && (
                <p className="text-xs text-muted-foreground">{PAY_CARD_NOTE}</p>
              )}
            </fieldset>
            {o.has_renewal && <p className="text-destructive">This plan already has a renewal.</p>}
            {!o.open && (
              <p className="text-destructive">
                A plan is renewed in the last 60 days of its year. This one can be renewed from{" "}
                {longDay(o.opens_on)}.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!ready || renew.isPending}
            onClick={() => renew.mutate()}
            data-action="roof-care-renew-confirm"
          >
            {renew.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Renew
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sign up ─────────────────────────────────────────────────────────────────────────────────

// Counted from the day the payment is received (Nov 19): no inspection before the plan is paid.
// In the customer's words (Nov 19): they read this screen.
const FIRST_WORDS: Record<FirstVisit, string> = {
  now: "As soon as your payment is received",
  days: "A set number of days after your payment",
  window: "In the next inspection window",
};

/** A numbered part of the sign-up. */
function SignStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5" data-sign-step={n}>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--jbk-blue)] text-xs font-bold text-white">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function SignUpDialog({
  siteId,
  today,
  onClose,
}: {
  siteId: string;
  today: string;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const refresh = useRefresh(siteId);
  const [sqft, setSqft] = useState("");
  const [offer, setOffer] = useState<RoofCareOffer | null>(null);
  const [pricedFor, setPricedFor] = useState<number | null>(null);
  const [plan, setPlan] = useState<PlanKey | null>(null);
  const [first, setFirst] = useState<FirstVisit | null>(null);
  const [days, setDays] = useState("");
  const [agreedBy, setAgreedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [agreed, setAgreed] = useState(false);
  // Where the agreement and the receipt are emailed (owner, Nov 19).
  const [email, setEmail] = useState("");
  const benefits = useBenefits().data ?? null;
  // How they pay for the year (owner, Nov 19: "by check or card either one during sign up").
  const [payMethod, setPayMethod] = useState<PayMethod | null>(null);
  const [payNote, setPayNote] = useState("");
  const offerFn = useServerFn(roofCareOffer);
  const signFn = useServerFn(signUpRoofCare);
  // What the map shows at the address, offered beside the box. The box itself stays blank.
  const mapFn = useServerFn(roofCareMapSize);
  const mapSize = useQuery({
    queryKey: ["roof-care-map-size", siteId],
    queryFn: () => mapFn({ data: { site_id: siteId } }),
    staleTime: 60 * 60_000,
    retry: false,
  });
  const size = wholeNumber(sqft);
  const price = useMutation({
    mutationFn: (n: number) => offerFn({ data: { site_id: siteId, sqft: n } }),
    onSuccess: (o, n) => {
      setOffer(o);
      setPricedFor(n);
    },
  });
  const dayCount = wholeNumber(days);
  const dates = first ? planDates(today, first, first === "days" ? dayCount : null) : null;
  const answer = offer?.price ?? null;
  const plans = answer?.ready && !answer.custom_quote ? answer.plans : [];
  const stale = pricedFor !== size;
  const emailBad = email.trim() !== "" && !looksLikeEmail(email.trim());
  const ready =
    !!plan &&
    !!first &&
    !!dates &&
    !!payMethod &&
    agreedBy.trim().length > 0 &&
    agreed &&
    !emailBad &&
    plans.length > 0 &&
    !stale;
  const sign = useMutation({
    mutationFn: () =>
      signFn({
        data: {
          site_id: siteId,
          plan: plan!,
          sqft: size!,
          first: first!,
          days: first === "days" ? dayCount : null,
          pay_method: payMethod!,
          pay_note: payMethod === "check" ? payNote.trim() : "",
          agreed_by: agreedBy.trim(),
          notes: notes.trim(),
          email: email.trim(),
          terms_agreed: true as const,
          // The price on the screen: the plan is saved at it or not at all (Nov 19).
          shown_price: plans.find((o) => o.plan === plan)!.price,
        },
      }),
    onSuccess: (made) => {
      refresh();
      toast.success(
        made.invoice
          ? `${planName(made.plan)} plan signed. Invoice #${made.invoice.number} is a draft: finalise it and send it. The plan starts when it is paid.`
          : `${planName(made.plan)} plan signed. The office sends the invoice. The plan starts when it is paid.`,
        { duration: 20_000 },
      );
      onClose();
    },
    onError: (e) => {
      const message = errText(e);
      toast.error(`Could not sign them up: ${message}`, { duration: 20_000 });
      // The price moved since it was shown: read the prices again, so the form shows the new
      // one and the tick has to be given again for it.
      if (isPriceChanged(message) && size) {
        setAgreed(false);
        price.mutate(size);
      }
    },
  });
  const w = nextWindow(today);
  const offerOf = (k: PlanKey) => plans.find((o) => o.plan === k) ?? null;
  // The screen is read by the customer (owner, Nov 19): what each plan is, in their words, and
  // the price for their roof. The steps run top to bottom; nothing here names a cost of ours.
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto" data-roof-care-sign-up>
        <DialogHeader className="mt-4 rounded-xl bg-[var(--jbk-blue)] px-4 py-4 text-left text-white sm:px-6">
          <DialogTitle className="text-2xl font-bold tracking-tight">{SIGN_UP_TITLE}</DialogTitle>
          <DialogDescription className="text-sm text-white/90">{SIGN_UP_LEAD}</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 text-sm">
          <SignStep n={1} title="Your roof">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="rc-sqft">Roof size (sq ft)</Label>
                <Input
                  id="rc-sqft"
                  inputMode="numeric"
                  className="h-10 w-40"
                  value={sqft}
                  onChange={(e) => setSqft(e.target.value)}
                />
              </div>
              <Button
                type="button"
                className="h-10 bg-[var(--jbk-blue)] text-white hover:bg-[var(--jbk-blue-hover)]"
                disabled={size == null || size <= 0 || price.isPending}
                onClick={() => size != null && price.mutate(size)}
                data-action="roof-care-price"
              >
                {price.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Show my price
              </Button>
            </div>
            {mapSize.data && (
              <p className="text-muted-foreground" data-sign-line="map-size">
                {mapRoofSizeLine(mapSize.data)} {MAP_ROOF_MORE}{" "}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 align-baseline"
                  onClick={() => setSqft(String(mapSize.data!.sqft))}
                  data-action="use-map-size"
                >
                  {MAP_ROOF_USE}
                </Button>
              </p>
            )}
            {price.error && (
              <p className="text-destructive" data-sign-line="error">
                {errText(price.error)}
              </p>
            )}
            {offer && !offer.placed && (
              <p className="text-destructive" data-sign-line="not-placed">
                {NOT_PLACED_LINE}
              </p>
            )}
            {/* The price is one number here (owner, Nov 19): nothing of the drive or what it adds. */}
            {offer?.estimate === "just-now" && (
              <p className="text-amber-700 dark:text-amber-400" data-sign-line="estimate-just-now">
                {PRICE_ESTIMATE_JUST_NOW}
              </p>
            )}
            {offer?.estimate === "rough" && (
              <p className="text-amber-700 dark:text-amber-400" data-sign-line="rough">
                {PRICE_ESTIMATE_ROUGH}
              </p>
            )}
            {answer && !answer.ready && (
              <p className="text-destructive" data-sign-line="not-ready">
                The Roof Care plan prices are not set up yet. Ask an admin.
              </p>
            )}
            {answer?.ready && answer.custom_quote && (
              <p className="text-destructive" data-sign-line="custom">
                A roof over {answer.over_sqft.toLocaleString("en-US")} sq ft gets a custom quote.
                Call the office.
              </p>
            )}
          </SignStep>

          <SignStep n={2} title="Pick your plan">
            {/* The three plans are explained before there is a price; one is picked once
                there is. */}
            <div
              className={`grid gap-4 pt-2 sm:grid-cols-3 ${stale && plans.length > 0 ? "opacity-60" : ""}`}
              data-plan-cards
            >
              {PLAN_KEYS.map((k) => {
                const o = offerOf(k);
                const picked = plan === k && !!o;
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={!o || stale}
                    onClick={() => setPlan(k)}
                    aria-pressed={picked}
                    data-plan-offer={o ? k : undefined}
                    data-plan-card={k}
                    className={`relative flex h-full flex-col rounded-xl border-2 p-4 text-left transition ${picked ? "border-[var(--jbk-blue)] bg-[var(--jbk-blue)]/5 shadow-md" : "border-border bg-card enabled:hover:border-[var(--jbk-blue)]/50"}`}
                  >
                    {k === PLAN_RECOMMENDED && (
                      <span
                        className="absolute -top-3 left-4 whitespace-nowrap rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                        data-plan-recommended
                      >
                        {RECOMMENDED_WORDS}
                      </span>
                    )}
                    <span className="text-lg font-bold">{PLAN_NAMES[k]}</span>
                    <span className="mt-0.5 text-sm text-muted-foreground">{PLAN_PITCH[k]}</span>
                    {o ? (
                      <span className="mt-3 block" data-plan-price>
                        <span className="text-3xl font-bold tracking-tight">{money0(o.price)}</span>
                        <span className="text-sm text-muted-foreground"> a year</span>
                      </span>
                    ) : (
                      <span className="mt-3 block text-sm italic text-muted-foreground">
                        {PRICE_AFTER_SIZE}
                      </span>
                    )}
                    <ul className="mt-3 flex-1 space-y-1.5 text-sm" data-plan-includes={k}>
                      {planIncludes(k, benefits?.[k] ?? null).map((line) => (
                        <li key={line} className="flex gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                    {o && (
                      <span
                        className={`mt-4 rounded-lg px-3 py-2 text-center text-sm font-semibold ${picked ? "bg-[var(--jbk-blue)] text-white" : "border border-[var(--jbk-blue)] text-[var(--jbk-blue)] dark:border-white/60 dark:text-white"}`}
                      >
                        {picked ? "Selected" : `Choose ${PLAN_NAMES[k]}`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="space-y-0.5 text-xs text-muted-foreground" data-plan-footnotes>
              <p>{PRICE_PAID_FIRST}.</p>
              {PLAN_FOOTNOTES.map((f) => (
                <p key={f}>{f}</p>
              ))}
            </div>
            {stale && plans.length > 0 && (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                The roof size changed. Press Show my price again.
              </p>
            )}
          </SignStep>

          {plans.length > 0 && (
            <>
              <SignStep n={3} title="Your first inspection">
                <fieldset className="space-y-2">
                  <legend className="sr-only">Your first inspection</legend>
                  {(["now", "days", "window"] as const).map((c) => (
                    <label key={c} className="flex flex-wrap items-center gap-2">
                      <input
                        type="radio"
                        name="rc-first"
                        checked={first === c}
                        onChange={() => setFirst(c)}
                        data-first={c}
                      />
                      <span>{FIRST_WORDS[c]}</span>
                      {c === "days" && (
                        <>
                          <Input
                            aria-label="Days after your payment for the first inspection"
                            inputMode="numeric"
                            className="h-8 w-20"
                            value={days}
                            onChange={(e) => {
                              setDays(e.target.value);
                              setFirst("days");
                            }}
                          />
                          <span>days</span>
                        </>
                      )}
                      {c === "window" && (
                        <span className="text-muted-foreground">({windowWords(w)})</span>
                      )}
                    </label>
                  ))}
                  {first === "days" && !dates && (
                    <p className="text-xs text-destructive">Type the days, 1 to 365.</p>
                  )}
                  {dates && (
                    <p className="text-xs text-muted-foreground" data-sign-line="dates">
                      Inspection 1:{" "}
                      {dueWords({ due_from: dates.first.from, due_by: dates.first.to })}. Inspection
                      2: {dueWords({ due_from: dates.second.from, due_by: dates.second.to })}. The
                      plan renews {longDay(dates.renews)}. {DATES_FROM_PAYMENT}
                    </p>
                  )}
                </fieldset>
              </SignStep>

              <SignStep n={4} title={PAY_QUESTION}>
                <fieldset className="space-y-2" data-sign-pay>
                  <legend className="sr-only">{PAY_QUESTION}</legend>
                  {PAY_METHODS.map((m) => (
                    <label key={m} className="flex flex-wrap items-center gap-2">
                      <input
                        type="radio"
                        name="rc-pay"
                        checked={payMethod === m}
                        onChange={() => setPayMethod(m)}
                        data-pay={m}
                      />
                      <span>{PAY_METHOD_WORDS[m]}</span>
                      {m === "check" && payMethod === "check" && (
                        <Input
                          aria-label="Check number, if you have it now"
                          placeholder="Check number, if you have it now"
                          className="h-8 w-60"
                          value={payNote}
                          onChange={(e) => setPayNote(e.target.value)}
                        />
                      )}
                    </label>
                  ))}
                  {/* Card (owner, Nov 19): once Stripe is set up, signing sends the customer to
                      its checkout. Until then the office takes the card. */}
                  {payMethod === "card" && (
                    <p className="text-xs text-muted-foreground" data-sign-line="card-note">
                      {PAY_CARD_NOTE_CUSTOMER}
                    </p>
                  )}
                  {payMethod === "check" && (
                    <p className="text-xs text-muted-foreground" data-sign-line="check-note">
                      {PAY_CHECK_NOTE_CUSTOMER}
                    </p>
                  )}
                </fieldset>
              </SignStep>

              <SignStep n={5} title="Your agreement">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="rc-agreed">Your name</Label>
                    <Input
                      id="rc-agreed"
                      className="h-10"
                      autoComplete="off"
                      value={agreedBy}
                      onChange={(e) => setAgreedBy(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="rc-email">{EMAIL_LABEL}</Label>
                    <Input
                      id="rc-email"
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      className="h-10"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      data-sign-email
                    />
                    {emailBad ? (
                      <p className="text-xs text-destructive">{EMAIL_BAD}</p>
                    ) : (
                      email.trim() === "" && (
                        <p className="text-xs text-muted-foreground">{EMAIL_NONE_NOTE}</p>
                      )
                    )}
                  </div>
                </div>
                <div className="space-y-2" data-roof-care-terms>
                  <p className="font-medium">The terms of your plan</p>
                  <ol className="max-h-56 list-decimal space-y-1.5 overflow-y-auto rounded-lg border bg-muted/30 py-2.5 pl-8 pr-3 text-xs">
                    {ROOF_CARE_TERMS.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ol>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border-2 border-[var(--jbk-blue)]/40 p-3 font-medium">
                    <Checkbox
                      checked={agreed}
                      onCheckedChange={(v) => setAgreed(v === true)}
                      className="mt-0.5"
                      data-terms-agreed
                    />
                    <span>{AGREE_WORDS}</span>
                  </label>
                </div>
              </SignStep>

              {/* The office's own part: not for the customer. */}
              <div className="space-y-1.5 rounded-lg border border-dashed p-3" data-sign-staff>
                <Label htmlFor="rc-notes" className="text-xs text-muted-foreground">
                  JBK notes (optional)
                </Label>
                <Textarea
                  id="rc-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <p className="text-xs text-muted-foreground" data-sign-line="credit">
                  Signed up with {(profile?.full_name ?? "").trim() || profile?.email}. Their name
                  goes on the plan.
                </p>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button
            type="button"
            size="lg"
            className="bg-[var(--jbk-blue)] text-white hover:bg-[var(--jbk-blue-hover)]"
            disabled={!ready || sign.isPending}
            onClick={() => sign.mutate()}
            data-action="roof-care-confirm"
          >
            {sign.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {SIGN_UP_BUTTON}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Push back ───────────────────────────────────────────────────────────────────────────────

function PushBackDialog({
  siteId,
  visit,
  manager,
  onClose,
}: {
  siteId: string;
  visit: PlanVisit;
  manager: boolean;
  onClose: () => void;
}) {
  const refresh = useRefresh(siteId);
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  // The customer asked for it (Nov 19): kept on the inspection, for the renewal.
  const [customer, setCustomer] = useState(false);
  const pushFn = useServerFn(pushBackRoofCareVisit);
  const n = wholeNumber(days);
  // "The customer asked" is a reason by itself, as the database takes it.
  const preview = pushPreview(visit, n, {
    manager,
    reason: reason.trim() || (customer ? CUSTOMER_ASKED_LABEL : ""),
  });
  const push = useMutation({
    mutationFn: () =>
      pushFn({ data: { visit_id: visit.id, days: n!, reason: reason.trim(), customer } }),
    onSuccess: (r) => {
      refresh();
      toast.success(
        `Pushed back. Now due by ${longDay(r.due_by)}${r.ticket_moved_to ? `, and the ticket moved to ${longDay(r.ticket_moved_to)}` : ""}`,
      );
      onClose();
    },
    onError: (e) => {
      refresh();
      toast.error(`Could not push it back: ${errText(e)}`);
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-roof-care-push-dialog>
        <DialogHeader>
          <DialogTitle>Push back {VISIT_LABEL[visit.kind].toLowerCase()}</DialogTitle>
          <DialogDescription>
            {dueWords(visit)}. The plan’s later inspection moves back by the same days.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="rc-push-days">Days</Label>
              <Input
                id="rc-push-days"
                inputMode="numeric"
                className="h-9 w-24"
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
            {preview && (
              <p className="pb-2 text-muted-foreground" data-push-line="new">
                New last day: {longDay(preview.due_by)}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="rc-push-reason">Reason</Label>
            <Textarea
              id="rc-push-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="space-y-0.5">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={customer}
                onCheckedChange={(c) => setCustomer(c === true)}
                data-push-customer
              />
              <span>{CUSTOMER_ASKED_LABEL}</span>
            </label>
            <p className="pl-6 text-xs text-muted-foreground">{CUSTOMER_ASKED_NOTE}</p>
          </div>
          {preview?.problem && (
            <p className="text-destructive" data-push-line="problem">
              {preview.problem}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!preview || !!preview.problem || push.isPending}
            onClick={() => push.mutate()}
            data-action="roof-care-push-confirm"
          >
            {push.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Push back
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── End ─────────────────────────────────────────────────────────────────────────────────────

function EndDialog({
  siteId,
  plan,
  renewal = false,
  onClose,
}: {
  siteId: string;
  plan: RoofCarePlan;
  /** A renewal that is waiting for its payment: this year's plan stays as it is. */
  renewal?: boolean;
  onClose: () => void;
}) {
  const refresh = useRefresh(siteId);
  const [reason, setReason] = useState("");
  // The refund (owner, Nov 19): the share for inspections not done, less the minor repairs the
  // plan already covered. The database works it; the manager confirms it, or types another.
  const [refundText, setRefundText] = useState("");
  const refundFn = useServerFn(roofCareRefund);
  const worked = useQuery({
    queryKey: ["roof-care-refund", plan.id],
    queryFn: () => refundFn({ data: { plan_id: plan.id } }),
    enabled: plan.pay_first,
    retry: false,
    staleTime: 0,
  });
  const typed = refundText.trim() === "" ? null : Number(refundText.replace(/[$,\s]/g, ""));
  const badRefund =
    typed !== null &&
    !(Number.isFinite(typed) && typed >= 0 && (!worked.data || typed <= worked.data.paid));
  const endFn = useServerFn(endRoofCarePlan);
  const end = useMutation({
    mutationFn: () => endFn({ data: { plan_id: plan.id, reason: reason.trim(), refund: typed } }),
    onSuccess: (r) => {
      refresh();
      // Its inspection tickets nobody had started are taken off the board (Nov 19).
      toast.success(
        renewal
          ? "Renewal cancelled. Its unpaid invoice was removed. This year's plan is as it was."
          : plan.status === "awaiting_payment"
            ? "Plan ended. Its unpaid invoice was removed."
            : r.refund > 0
              ? `Plan ended. A refund of ${money0(r.refund)} is owed: send it, then mark it sent on the property.`
              : "Plan ended. Its inspection tickets not yet started were taken off the board.",
        { duration: 20_000 },
      );
      onClose();
    },
    onError: (e) => toast.error(`Could not end the plan: ${errText(e)}`),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-roof-care-end-dialog>
        <DialogHeader>
          <DialogTitle>
            {renewal ? "Cancel the renewal" : `End the ${planName(plan.plan)} plan`}
          </DialogTitle>
          <DialogDescription>
            {renewal
              ? "The renewal was not paid, so next year never started. Its unpaid invoice is removed with it. This year's plan stays as it is, and can be renewed again."
              : plan.status === "awaiting_payment"
                ? "The plan was never paid, so it never started. Its unpaid invoice is removed with it."
                : "No more inspections are made for it. Tickets already made stay as they are."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 text-sm">
          <Label htmlFor="rc-end-reason">
            {renewal ? "Why it is cancelled" : "Why it is ending"}
          </Label>
          <Textarea
            id="rc-end-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {plan.pay_first && (
          <div className="space-y-1 rounded-md border p-3 text-sm" data-roof-care-end-refund>
            <p className="font-medium">The refund</p>
            {worked.isPending && <p className="text-muted-foreground">Working out the refund…</p>}
            {worked.error && (
              <p className="text-destructive">
                Could not work out the refund: {errText(worked.error)}
              </p>
            )}
            {worked.data && (
              <>
                <ul className="text-muted-foreground" data-refund-lines>
                  {refundLines(worked.data).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                {worked.data.paid > 0 && (
                  <div className="space-y-1 pt-1">
                    <Label htmlFor="rc-end-refund">
                      Refund to confirm (leave blank for the amount above)
                    </Label>
                    <Input
                      id="rc-end-refund"
                      inputMode="decimal"
                      className="h-9 w-40"
                      value={refundText}
                      onChange={(e) => setRefundText(e.target.value)}
                    />
                    {badRefund && <p className="text-xs text-destructive">{REFUND_BAD_AMOUNT}</p>}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!reason.trim() || badRefund || end.isPending}
            onClick={() => end.mutate()}
            data-action="roof-care-end-confirm"
          >
            {end.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {renewal ? "Cancel the renewal" : "End plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Close out an expired plan (owner, Nov 19) ───────────────────────────────────────────────

function CloseOutDialog({
  siteId,
  plan,
  onClose,
}: {
  siteId: string;
  plan: RoofCarePlan;
  onClose: () => void;
}) {
  const refresh = useRefresh(siteId);
  const [reason, setReason] = useState("");
  const closeFn = useServerFn(closeOutRoofCarePlan);
  const close = useMutation({
    mutationFn: () => closeFn({ data: { plan_id: plan.id, reason: reason.trim() } }),
    onSuccess: (r) => {
      refresh();
      toast.success(
        r.dropped > 0
          ? `Closed out. ${r.dropped === 1 ? "1 inspection that was still owed was" : `${r.dropped} inspections that were still owed were`} dropped.`
          : "Closed out.",
        { duration: 15_000 },
      );
      onClose();
    },
    onError: (e) => toast.error(`Could not close it out: ${errText(e)}`),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-roof-care-close-out-dialog>
        <DialogHeader>
          <DialogTitle>Close out the {planName(plan.plan)} plan</DialogTitle>
          <DialogDescription>{CLOSE_OUT_NOTE}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1 text-sm">
          <Label htmlFor="rc-close-reason">Why it is closed out</Label>
          <Textarea
            id="rc-close-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!reason.trim() || close.isPending}
            onClick={() => close.mutate()}
            data-action="roof-care-close-out-confirm"
          >
            {close.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {CLOSE_OUT_LABEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Another service ─────────────────────────────────────────────────────────────────────────

function ServiceRequestDialog({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [services, setServices] = useState("");
  const [details, setDetails] = useState("");
  const askFn = useServerFn(requestAdditionalService);
  const ask = useMutation({
    mutationFn: () =>
      askFn({ data: { site_id: siteId, services: services.trim(), details: details.trim() } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["opportunities"] });
      void qc.invalidateQueries({ queryKey: ["crm"] });
      toast.success("Sent to the office as a new opportunity, with your name on it");
      onClose();
    },
    onError: (e) => toast.error(`Could not send it: ${errText(e)}`),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-service-request-dialog>
        <DialogHeader>
          <DialogTitle>{ADDITIONAL_SERVICES_LABEL}</DialogTitle>
          <DialogDescription>
            It goes to the office as a new opportunity for this property.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <Label htmlFor="sr-services">What they are asking for</Label>
            <Input
              id="sr-services"
              className="h-9"
              maxLength={180}
              value={services}
              onChange={(e) => setServices(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sr-details">Details (optional)</Label>
            <Textarea
              id="sr-details"
              rows={3}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground" data-request-credit>
            Taken down by {(profile?.full_name ?? "").trim() || profile?.email}. Your name goes on
            the opportunity.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!services.trim() || ask.isPending}
            onClick={() => ask.mutate()}
            data-action="service-request-confirm"
          >
            {ask.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Send to the office
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
