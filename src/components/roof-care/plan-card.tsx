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
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Check, CloudLightning, Loader2, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  FLYER_BAND,
  FLYER_BAND_LEAD,
  FLYER_BAND_TITLE,
  FLYER_FOOT,
  FLYER_HEAD,
  FlyerPlan,
  FlyerStepHead,
} from "@/components/roof-care/flyer-look";
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
  CARD_PAID_INVOICE_OPEN,
  cardPaidWords,
  CHECKOUT_BUTTON,
  checkoutReadyKey,
  PAY_CARD_NOTE_ONLINE,
} from "@/lib/roof-care-checkout";
import { carePrefillNote, carePrefillWords, type CareSignUpPrefill } from "@/lib/public-requests";
import { handlePublicRequest, publicCarePrefill } from "@/lib/public-requests.functions";
import { roofCareCheckoutReady, startPlanCheckout } from "@/lib/roof-care-checkout.functions";
import { PAY_HELD_SIZE, SIGNED_PAY_BY_LINK, SIGNED_SIZE_FIRST } from "@/lib/roof-care-pay-link";
import { PlanPayLinkBox } from "@/components/roof-care/pay-link";
import { cleaningAsked, cleaningSummary, roofCareCleaningKey } from "@/lib/roof-care-cleaning";
import { markRoofCareForecast, roofCareCleaning } from "@/lib/roof-care-cleaning.functions";
import {
  AGREE_WORDS,
  benefitsOfPlan,
  benefitsUsed,
  FORECAST_MARK_SENT,
  FORECAST_UNDO,
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
  signUpMissing,
  signUpMissingLine,
  tallyShare,
} from "@/lib/roof-care-benefits";
import { NOT_PLACED_LINE } from "@/lib/roof-care-locate";
import { NO_ACCESS_REMOVE, noAccessLine, noAccessTakeOffWords } from "@/lib/roof-care-no-access";
import { removeRoofCareNoAccess } from "@/lib/roof-care-no-access.functions";
import {
  roofCareStormKey,
  STORM_ADD_BILLED,
  STORM_ADD_INCLUDED,
  STORM_AGAIN_LABEL,
  STORM_REMOVE_LABEL,
  STORM_REMOVE_NOTE,
  stormAgainLine,
  stormCanAdd,
  stormOfferLines,
} from "@/lib/roof-care-storm";
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
  onePressAtATime,
  otherRefundsOwed,
  owedWords,
  PAY_CARD_NOTE,
  PAY_METHOD_WORDS,
  PAY_METHODS,
  payWords,
  planBadge,
  PLAN_MAKE_INVOICE,
  PLAN_BRIEF_HINT,
  PLAN_PAID_TOAST,
  PLAN_WAITING_RELOAD_MS,
  anyPlanWaits,
  plansJustPaid,
  PLAN_NO_INVOICE,
  STEP_PAY,
  STEP_PAY_CARD,
  STEP_PAY_CHECK,
  STEP_SIZE,
  STEP_SIZE_DONE,
  STEP_START,
  STEP_START_CARD,
  STEP_START_CHECK,
  FIRST_DAYS_NOT_PROMISED,
  firstDaysProblem,
  planDates,
  planEmailLines,
  planName,
  planNumberLabel,
  planSizeWords,
  pushPreview,
  REFUND_BAD_AMOUNT,
  REFUND_MARK_SENT,
  REFUND_CHANGE,
  REFUND_CHANGE_HELP,
  REFUND_CHANGE_SAVE,
  refundChangeProblem,
  refundChangeWords,
  refundLines,
  refundPlanWords,
  refundStatusWords,
  CARD_BACK_MARK,
  cardBackWords,
  type PlanCardBack,
  RENEW_LABEL,
  RENEWAL_CHANGE_NEEDS_MANAGER,
  RENEWAL_NOTE,
  RENEWAL_WORDS,
  renewalChoiceWords,
  renewalDecisionWords,
  renewalDefaultWords,
  renewalLapsedWords,
  renewalOpen,
  renewalPriceWords,
  renewsWords,
  RENEWAL_CHOICES,
  PRICE_ESTIMATE_JUST_NOW,
  PRICE_ESTIMATE_ROUGH,
  isPriceChanged,
  ROOF_CARE_TERMS,
  ROOF_CARE_TERMS_VERSION,
  roofCarePlansKey,
  runsLate,
  SIZE_CONFIRM_LABEL,
  SIZE_OK_LABEL,
  SIZE_UNCHECKED_STAFF_NOTE,
  sizeAgainstMap,
  sizeSmallerLine,
  SKIP_LABEL,
  SKIP_NOTE,
  SKIP_REASON_NEEDED,
  skippedWords,
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
  confirmRoofCareSize,
  endRoofCarePlan,
  listRoofCarePlans,
  markRoofCareRefundSent,
  changeRoofCareRefund,
  markRoofCareCardSentBack,
  pushBackRoofCareVisit,
  removeRoofCareStorm,
  renewRoofCarePlan,
  requestAdditionalService,
  roofCareMapSize,
  roofCareBenefits,
  roofCareOffer,
  roofCareRefund,
  roofCareRenewalOffer,
  roofCareStormOffer,
  setRoofCareEmail,
  signUpRoofCare,
  skipRoofCareVisit,
  type RoofCareOffer,
} from "@/lib/roof-care-plan.functions";
import { createRoofCarePlanInvoice } from "@/lib/roof-care-plan-invoice.functions";
import { NoAccessBox } from "./no-access";
import { money0, PLAN_KEYS, PLAN_NAMES, type PlanKey } from "@/lib/roof-care-price";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STALE_MS = 60_000;

/**
 * Opened on a ticket (owner, Nov 24): the technician is on the roof and can measure it, so the
 * card page opens there though the roof size is not confirmed yet. Anywhere else no payment is
 * asked for until a manager or an admin has confirmed the size.
 */
const OnTicket = createContext(false);

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
    // While a plan waits for its payment the page looks for it by itself (Nov 24): the payment
    // comes from the customer's own phone. Not while the tab is in the background.
    refetchInterval: (query) => (anyPlanWaits(query.state.data) ? PLAN_WAITING_RELOAD_MS : false),
  });
}

/** Is paying by card online set up? False while it loads: Card then reads as the office's. */
function useCheckoutReady(enabled: boolean): boolean {
  const { session } = useAuth();
  const fn = useServerFn(roofCareCheckoutReady);
  const q = useQuery({
    queryKey: checkoutReadyKey,
    queryFn: () => fn(),
    enabled: !!session && enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return q.data === true;
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

/** The fold on a plan that waits for its payment. */
export const WAITING_DETAILS_LABEL = "Plan details: the agreement email";

/** The fold on a plan in force that holds its record. */
export const PLAN_DETAILS_LABEL = "Plan details: signed, paid, roof size, emails";

const STATE_WORDS = {
  done: "Done",
  late: "Late",
  ticket: "Ticket out",
  waiting: "Not yet due",
  lost: "Lost",
  skipped: "Skipped",
};

function VisitRow({
  visit,
  today,
  office,
  showMoney,
  plan,
  onPush,
  onSkip,
  onStormOff,
}: {
  /** The plan, so the office sees what the inspection answered of its cleaning. */
  plan?: PlanKey;
  visit: PlanVisit;
  today: string;
  office: boolean;
  showMoney: boolean;
  onPush: (v: PlanVisit) => void;
  /** A manager's, on a plan in force (Nov 20): skip an inspection, take a storm one off. */
  onSkip?: (v: PlanVisit) => void;
  onStormOff?: (v: PlanVisit) => void;
}) {
  const state = visitState(visit, today);
  // What the plan includes at this inspection, as answered in the workflow (Nov 19, night):
  // shown to the office once it is answered or the inspection is done.
  const cleaning =
    office && plan
      ? cleaningSummary({
          asked: cleaningAsked(plan, visit.kind),
          drains: visit.drains_cleaned ?? null,
          gutters: visit.gutters_cleaned ?? null,
          note: visit.cleaning_note ?? null,
          by_name: visit.cleaning_by_name ?? null,
          at: visit.cleaning_at ?? null,
        })
      : [];
  const showCleaning =
    cleaning.length > 0 &&
    (state === "done" || visit.drains_cleaned != null || visit.gutters_cleaned != null);
  return (
    <li
      className="rounded-md border bg-background px-2.5 py-1.5 text-xs"
      data-roof-care-visit={visit.kind}
      data-visit-state={state}
    >
      {/* Owner, Nov 24: "very visually unappealing and difficult to read". What the inspection
          is and where it stands on the left, what can be done about it on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium">{VISIT_LABEL[visit.kind]}</span>
          <Badge
            variant={state === "late" || state === "lost" ? "destructive" : "secondary"}
            className={state === "done" ? "bg-emerald-600 text-white hover:bg-emerald-600" : ""}
          >
            {STATE_WORDS[state]}
          </Badge>
          <span className="text-muted-foreground" data-visit-skipped={state === "skipped"}>
            {state === "skipped"
              ? skippedWords(visit)
              : visit.lost_on
                ? lostWords(visit.lost_on)
                : visit.kind === "carried"
                  ? `Do it by ${longDay(visit.due_by)}, or it is lost`
                  : dueWords(visit)}
          </span>
          {/* A ticket that is with somebody else is named, not linked: the reader cannot open it. */}
          {visit.ticket &&
            (visit.ticket.mine === false ? (
              <span className="text-muted-foreground" data-visit-ticket="other">
                Ticket #{visit.ticket.number}
              </span>
            ) : (
              <Link
                to="/service"
                search={{ id: visit.ticket.id }}
                className="underline underline-offset-2"
              >
                Ticket #{visit.ticket.number}
              </Link>
            ))}
          {showMoney && visit.amount > 0 && (
            <span className="text-muted-foreground">bills {money0(visit.amount)}</span>
          )}
          {/* Done and signed off, with its share of the plan on no invoice (Nov 19). */}
          {showMoney && visitUnbilled(visit) && (
            <Badge variant="destructive" data-visit-unbilled>
              {VISIT_UNBILLED_WORDS}
            </Badge>
          )}
          {(visit.push_reason ||
            (visit.kind !== "carried" && visit.due_by !== visit.first_due_by)) && (
            <span className="text-muted-foreground" data-visit-pushed={visit.customer_asked}>
              pushed back{visit.push_reason ? `: ${visit.push_reason}` : ""}
            </span>
          )}
          {office && visit.kind === "carried" && state !== "done" && state !== "lost" && (
            <span className="text-muted-foreground">{CARRIED_NO_PUSH}</span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1" data-visit-actions>
          {office && state !== "done" && state !== "skipped" && visit.kind !== "carried" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onPush(visit)}
              data-action="roof-care-push"
            >
              <CalendarClock className="mr-1 h-3.5 w-3.5" /> Push back
            </Button>
          )}
          {/* An inspection we will not do (Nov 20): a manager's, never by deleting its ticket. */}
          {onSkip && visit.kind !== "storm" && !["done", "skipped", "lost"].includes(state) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => onSkip(visit)}
              data-action="roof-care-skip"
            >
              {SKIP_LABEL}
            </Button>
          )}
          {/* A storm inspection added by mistake (Nov 20): a manager's. */}
          {onStormOff && visit.kind === "storm" && state !== "done" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => onStormOff(visit)}
              data-action="roof-care-storm-off"
            >
              {STORM_REMOVE_LABEL}
            </Button>
          )}
        </div>
      </div>
      {showCleaning && (
        <p className="mt-1 text-muted-foreground" data-visit-cleaning>
          {cleaning.join(". ")}.
        </p>
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
  careRequest = null,
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
  /**
   * A Roof Care request from the public page that the office matched to this property (Nov 21):
   * the sign-up opens by itself, with what the customer typed already in it.
   */
  careRequest?: string | null;
}) {
  const { profile, session } = useAuth();
  const q = usePlans(siteId);
  const qc = useQueryClient();
  const [open, setOpen] = useState<"plan" | "service" | null>(null);
  const prefillFn = useServerFn(publicCarePrefill);
  const prefill = useQuery({
    queryKey: ["public-care-prefill", careRequest ?? "", siteId ?? ""],
    queryFn: () => prefillFn({ data: { id: careRequest!, site_id: siteId! } }),
    enabled: !!session && !!careRequest && !!siteId,
    staleTime: 60_000,
    retry: false,
  });
  // Opened once, when both the request and the property's plans are read. A property that
  // already has a plan opens that plan instead, as the button does: never a second sign-up.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!careRequest || !prefill.data || !q.data) return;
    if (openedFor.current === careRequest) return;
    openedFor.current = careRequest;
    setOpen("plan");
  }, [careRequest, prefill.data, q.data]);
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
  // On the ticket of a plan's inspection: what it answered of the plan's cleaning, for the
  // office (Nov 19, night). The workflow is where it is answered.
  const cleaningFn = useServerFn(roofCareCleaning);
  const cleaning = useQuery({
    queryKey: roofCareCleaningKey(visitId ?? ""),
    queryFn: () => cleaningFn({ data: { visit_id: visitId! } }),
    enabled: !!session && showsOffered && !!visitId,
    staleTime: STALE_MS,
  });
  if (!siteId || !profile) return null;
  const today = easternYmd();
  const active = (q.data ?? []).find((p) => p.status === "active") ?? null;
  // Signed and waiting for its payment (Nov 19): Care Plan opens it, never a second sign-up.
  const waiting = (q.data ?? []).find((p) => p.status === "awaiting_payment") ?? null;
  // Its twelve months are over and it is not closed out (owner, Nov 19, night: "go"): Care Plan
  // opens it, for its renewal, never a new sign-up. A new sign-up would drop what the renewal
  // owes the customer for an inspection that was not done.
  const last = currentPlan(q.data ?? []);
  const lapsed = !active && !waiting && last && isExpired(last) && !last.closed_out ? last : null;
  const done = active ? visitsDone(active, today) : null;
  // The workflow's bar: the two side by side on a phone, each tall enough for a thumb, in the
  // logo's blue (owner, Nov 18: "color them blue, the same blue as in the logo").
  const size = big ? BIG_BUTTON : "";
  return (
    <div
      className={`${big ? "grid grid-cols-2 gap-2" : "flex flex-wrap gap-2"} ${className}`}
      data-roof-care-buttons={
        active ? active.plan : waiting ? "awaiting" : lapsed ? "expired" : "none"
      }
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
      {/* On a ticket (Nov 24): the plan and the sign-up know it, for the card page. */}
      <OnTicket.Provider value={!!jobId}>
        {open === "plan" &&
          (active || waiting || lapsed ? (
            <PlanDialog siteId={siteId} visitId={visitId ?? null} onClose={() => setOpen(null)} />
          ) : (
            <SignUpDialog
              siteId={siteId}
              today={today}
              prefill={careRequest ? (prefill.data ?? null) : null}
              onClose={() => setOpen(null)}
            />
          ))}
      </OnTicket.Provider>
      {open === "service" && <ServiceRequestDialog siteId={siteId} onClose={() => setOpen(null)} />}
      {/* Was the plan offered on this ticket? Only where there is one to offer. */}
      {showsOffered && q.data && !active && !waiting && !lapsed && offered.data && (
        <p
          className={`basis-full text-right text-xs ${offered.data.length ? "text-muted-foreground" : "font-medium text-amber-700 dark:text-amber-400"}`}
          data-care-plan-offered={offered.data.length}
        >
          {offeredWords(offered.data)}
        </p>
      )}
      {/* On the ticket of a plan's inspection, for the office: we could not get on the roof
          (Nov 19, late). The workflow has its own, for the technician. */}
      {showsOffered && visitId && jobId && (
        <NoAccessBox jobId={jobId} className="basis-full justify-end text-right" />
      )}
      {showsOffered && cleaning.data && cleaningSummary(cleaning.data).length > 0 && (
        <p
          className="basis-full text-right text-xs text-muted-foreground"
          data-care-cleaning={
            cleaning.data.drains === null && cleaning.data.gutters === null ? "open" : "answered"
          }
        >
          {cleaningSummary(cleaning.data).join(". ")}.
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
  brief = false,
  includesOpen = false,
  className = "",
}: {
  siteId: string | null | undefined;
  visitId?: string | null;
  short?: boolean;
  /**
   * On a property and on the customer page (owner, Nov 24: "does the plan need to show on the
   * property like that if the info is all available by clicking the care plan button?"): the
   * plan, when it renews, and only what waits for somebody. The Care Plan button opens the rest.
   */
  brief?: boolean;
  /** The Care Plan pop-up: what the plan includes is open, not folded. */
  includesOpen?: boolean;
  className?: string;
}) {
  const { profile } = useAuth();
  const q = usePlans(siteId);
  const qc = useQueryClient();
  const [push, setPush] = useState<PlanVisit | null>(null);
  const [ending, setEnding] = useState(false);
  // The renewal (Nov 19): the Renew box, and ending a renewal that is waiting.
  const [renewing, setRenewing] = useState(false);
  const [endingRenewal, setEndingRenewal] = useState(false);
  const [closingOut, setClosingOut] = useState(false);
  const refresh = useRefresh(siteId ?? "");
  const forecastFn = useServerFn(markRoofCareForecast);
  const forecast = useMutation({
    mutationFn: (a: { planId: string; sent: boolean }) =>
      forecastFn({ data: { plan_id: a.planId, sent: a.sent } }),
    onSuccess: (_r, a) => {
      refresh();
      toast.success(a.sent ? "Budget forecast marked sent" : "The mark was taken off");
    },
    onError: (e) => toast.error(`Could not mark the forecast: ${errText(e)}`, { duration: 20_000 }),
  });
  // A technician cannot renew (the office's): the customer's wish goes to the office, with the
  // technician's name on it, as an additional service does.
  const askFn = useServerFn(requestAdditionalService);
  const askRenew = useMutation({
    mutationFn: (p: RoofCarePlan) =>
      askFn({
        data: {
          site_id: p.site_id,
          services: `Renew the ${planName(p.plan)} plan`,
          details: "The customer asked on site to renew their Roof Care plan.",
        },
      }),
    onSuccess: () =>
      toast.success("Sent to the office as a new opportunity, with your name on it", {
        duration: 15_000,
      }),
    onError: (e) => toast.error(`Could not send it: ${errText(e)}`, { duration: 20_000 }),
  });
  // The storm inspection (Nov 19, late): the button opens a box that says, before anything is
  // added, whether this one is included or billed, and what a billed one costs.
  const [storming, setStorming] = useState(false);
  // A manager's (Nov 20): skip an inspection, take off a storm inspection added by mistake.
  const [skipping, setSkipping] = useState<PlanVisit | null>(null);
  const [stormOff, setStormOff] = useState<PlanVisit | null>(null);
  const removeFn = useServerFn(removeRoofCareNoAccess);
  const removeNoAccess = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    // The records left are worked again (Nov 20): the answer says which changed.
    onSuccess: (r) => {
      refresh();
      toast.success(noAccessTakeOffWords(r), { duration: 15_000 });
    },
    onError: (e) => toast.error(`Could not take it off: ${errText(e)}`, { duration: 20_000 }),
  });
  // The moment a plan that was waiting is found in force (Nov 24): said once, and everything
  // else on the page is read again, so the opportunity shows Won and the invoice shows paid
  // with no reload by hand.
  const seen = useRef<RoofCarePlan[] | null>(null);
  useEffect(() => {
    const now = q.data ?? null;
    const paid = plansJustPaid(seen.current, now);
    seen.current = now;
    if (!paid.length) return;
    toast.success(PLAN_PAID_TOAST, { id: `roof-care-paid-${paid[0]}`, duration: 15_000 });
    void qc.invalidateQueries();
  }, [q.data, qc]);
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
  // Owner, Nov 24: "a bit messy once you have a care plan", then "very visually unappealing and
  // difficult to read". The whole plan sits in one box of its own, with what needs doing in
  // sight and the record of it (who signed, how it was paid, the emails) folded under Plan
  // details. In the Care Plan pop-up the pop-up is the box.
  const framed = !short && !includesOpen;
  // Everything: the inspections, the tally, the folds and the buttons. The Care Plan pop-up.
  const full = !short && !brief;
  // The record of the plan in force: one sentence, as before.
  const signedLine = active ? (
    <p className="text-xs text-muted-foreground" data-roof-care-signed>
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
        : ""}
    </p>
  ) : null;
  // What still needs somebody stays in sight; what is settled goes under Plan details.
  const sizeWaits = !!active?.size?.unchecked;
  const cardInvoiceOpen = !!active?.invoice && active.invoice.status !== "paid";
  const emailWaits =
    !!active?.email &&
    (!active.email.to || !active.email.agreement_sent_at || !active.email.receipt_sent_at);
  return (
    <div
      className={`${framed ? "space-y-2.5 rounded-lg border bg-muted/20 p-3" : "space-y-1.5"} ${className}`}
      data-roof-care={active ? active.plan : waiting ? "awaiting" : expired ? "expired" : "none"}
      data-roof-care-framed={framed}
    >
      {/* The top line: the plan and how far along it is, and for a plan in force when it
          renews and what it costs a year. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {plan && <RoofCareBadge plan={plan} today={today} />}
        {active && (
          <p className="text-xs text-muted-foreground" data-roof-care-renews>
            Renews <span className="font-medium text-foreground">{longDay(active.renews_on)}</span>
            {office && (
              <>
                {" · "}
                <span className="font-medium text-foreground">{money0(active.price)}</span> a year
              </>
            )}
          </p>
        )}
      </div>
      {plan.status === "ended" &&
        plan.refund &&
        (plan.refund.due > 0 || (plan.refund.changes?.length ?? 0) > 0) && (
          <RefundOwed siteId={siteId} plan={plan} manager={manager} />
        )}
      {/* A refund still owed on an older plan of this property (Nov 23): each has its own line,
          named, with the same two buttons. Before, only the current plan's could be reached. */}
      {otherRefundsOwed(q.data, plan.id).map((p) => (
        <RefundOwed
          key={p.id}
          siteId={siteId}
          plan={p}
          manager={manager}
          label={refundPlanWords(p)}
        />
      ))}
      {/* Card money that has to go back, of any plan of this property (Nov 20). */}
      {q.data
        .flatMap((p) => p.card_back ?? [])
        .map((c) => (
          <CardBackLine key={c.id} siteId={siteId} back={c} manager={manager} today={today} />
        ))}
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
          {/* Renewing is the office's. On the roof, the customer's wish is sent to it. */}
          {!short && !office && !expired.closed_out && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 text-xs"
              disabled={askRenew.isPending || askRenew.isSuccess}
              onClick={() => askRenew.mutate(expired)}
              data-action="roof-care-ask-renew"
            >
              {askRenew.isSuccess ? "Sent to the office" : "The customer wants to renew"}
            </Button>
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
          brief={brief}
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
          {/* On a ticket the one sentence stays in sight; on the property it is folded. */}
          {short && signedLine}
          {active.price_estimated && (
            <p className="text-xs text-amber-800 dark:text-amber-300" data-roof-care-estimate>
              The price is an estimate until the address is confirmed.
            </p>
          )}
          {!short && office && sizeWaits && (
            <PlanSizeLine siteId={siteId} plan={active} manager={manager} />
          )}
          {/* A card payment taken online whose invoice is still open: said in sight. */}
          {!short && office && active.card_paid && cardInvoiceOpen && (
            <p className="text-xs" data-roof-care-card-paid>
              {cardPaidWords(active.card_paid)} {CARD_PAID_INVOICE_OPEN}
            </p>
          )}
          {!short && office && active.pay_first && active.email && emailWaits && (
            <PlanEmailLine siteId={siteId} plan={active} paid />
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
              brief={brief}
              renewalOf={active}
              onEnd={() => setEndingRenewal(true)}
            />
          )}
          {(full || mine) && (
            <ul className="space-y-1.5">
              {(!full && mine ? [mine] : active.visits).map((v) => (
                <VisitRow
                  key={v.id}
                  visit={v}
                  today={today}
                  office={office}
                  showMoney={office}
                  plan={active.plan}
                  onPush={setPush}
                  {...(manager && full ? { onSkip: setSkipping, onStormOff: setStormOff } : {})}
                />
              ))}
            </ul>
          )}
          {/* The times we could not get on the roof this plan year (Nov 19, late): which were
              charged, and whether each charge is on an invoice. The office's. */}
          {full && office && (active.no_access ?? []).length > 0 && (
            <ul className="space-y-1 text-xs" data-roof-care-no-access>
              {(active.no_access ?? []).map((n) => (
                <li
                  key={n.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                  data-no-access-charged={n.charged}
                  data-no-access-billed={n.billed === null ? "unknown" : String(n.billed)}
                >
                  <span
                    className={
                      n.charged && n.billed === false
                        ? "text-amber-800 dark:text-amber-300"
                        : "text-muted-foreground"
                    }
                  >
                    {noAccessLine(n, office)}
                  </span>
                  {n.invoice && (
                    <Link
                      to="/service/invoices"
                      search={{ id: n.invoice.id }}
                      className="underline underline-offset-2"
                    >
                      Open invoice
                    </Link>
                  )}
                  {manager && !n.invoice && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-muted-foreground"
                      disabled={removeNoAccess.isPending}
                      onClick={() => removeNoAccess.mutate(n.id)}
                      data-action="roof-care-no-access-remove"
                    >
                      {NO_ACCESS_REMOVE}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* What the plan includes and what it has given so far (owner, Nov 19). */}
          {full && <PlanBenefits plan={active} today={today} open={includesOpen} />}
          {/* The record of the plan (Nov 24): who signed, how it was paid, the roof size, where
              the emails went and which invoices used the minor repairs. Folded: it is read
              now and then, and nothing in it waits for anybody. */}
          {full && (
            <details
              className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs"
              data-roof-care-details
            >
              <summary className="cursor-pointer font-medium">{PLAN_DETAILS_LABEL}</summary>
              <div className="mt-1.5 space-y-1.5">
                {signedLine}
                {office && !sizeWaits && (
                  <PlanSizeLine siteId={siteId} plan={active} manager={manager} />
                )}
                {/* A card payment taken online (Nov 19, night). */}
                {office && active.card_paid && !cardInvoiceOpen && (
                  <p className="text-xs" data-roof-care-card-paid>
                    {cardPaidWords(active.card_paid)}
                  </p>
                )}
                {office && active.pay_first && active.email && !emailWaits && (
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
                      A repair invoice at this property uses the plan by itself while any is left.
                      Untick it on the invoice when the repair is not a minor one.
                    </p>
                  </div>
                )}
              </div>
            </details>
          )}
          {full && office && (
            <div
              className={`flex flex-wrap items-center gap-1.5 ${framed ? "border-t pt-2" : ""}`}
              data-roof-care-actions
            >
              {/* Roof Guard's yearly budget forecast (Nov 19, night): marked when it is sent. */}
              {active.plan === "guard" && (
                <Button
                  type="button"
                  variant={active.forecast_sent_on ? "ghost" : "outline"}
                  size="sm"
                  className={`h-7 text-xs ${active.forecast_sent_on ? "text-muted-foreground" : ""}`}
                  disabled={forecast.isPending}
                  onClick={() =>
                    forecast.mutate({ planId: active.id, sent: !active.forecast_sent_on })
                  }
                  data-action="roof-care-forecast"
                  data-forecast-sent={!!active.forecast_sent_on}
                >
                  {active.forecast_sent_on ? FORECAST_UNDO : FORECAST_MARK_SENT}
                </Button>
              )}
              {active.plan === "guard" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setStorming(true)}
                  data-action="roof-care-storm"
                >
                  <CloudLightning className="mr-1 h-3.5 w-3.5" />
                  Storm inspection
                </Button>
              )}
              {manager && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 text-xs text-muted-foreground"
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
      {brief && (active || waiting) && (
        <p className="text-xs text-muted-foreground" data-roof-care-brief>
          {PLAN_BRIEF_HINT}
        </p>
      )}
      {storming && active && (
        <StormDialog siteId={siteId} plan={active} onClose={() => setStorming(false)} />
      )}
      {skipping && (
        <SkipDialog siteId={siteId} visit={skipping} onClose={() => setSkipping(null)} />
      )}
      {stormOff && (
        <StormOffDialog siteId={siteId} visit={stormOff} onClose={() => setStormOff(null)} />
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

/**
 * Before a storm inspection is added (owner, Nov 19, late): is it one the plan includes, or a
 * further one that is billed, and what the billed one costs after what is left of the minor
 * repairs. Nothing is added until the button under it is pressed.
 */
function StormDialog({
  siteId,
  plan,
  onClose,
}: {
  siteId: string;
  plan: RoofCarePlan;
  onClose: () => void;
}) {
  const refresh = useRefresh(siteId);
  const offerFn = useServerFn(roofCareStormOffer);
  const offer = useQuery({
    queryKey: roofCareStormKey(plan.id),
    queryFn: () => offerFn({ data: { plan_id: plan.id } }),
    // Read fresh each time the box opens: the answer changes with every inspection added.
    staleTime: 0,
    gcTime: 0,
  });
  const addFn = useServerFn(addRoofCareStorm);
  // One was already added today (Nov 20): a second one has to be ticked here.
  const [again, setAgain] = useState(false);
  const add = useMutation({
    mutationFn: (billed: boolean) =>
      addFn({ data: { plan_id: plan.id, billed_ok: billed, again_ok: again } }),
    onSuccess: (_r, billed) => {
      refresh();
      toast.success(
        billed
          ? "Storm inspection ticket made. It is billed when the inspection is authorized."
          : "Storm inspection ticket made",
        { duration: 10_000 },
      );
      onClose();
    },
    onError: (e) =>
      toast.error(`Could not add the storm inspection: ${errText(e)}`, { duration: 20_000 }),
  });
  const o = offer.data;
  return (
    <Dialog open onOpenChange={(open) => !open && !add.isPending && onClose()}>
      <DialogContent
        className="max-w-md"
        data-storm-dialog={o ? (o.billed ? "billed" : "included") : "loading"}
      >
        <DialogHeader>
          <DialogTitle>Storm inspection</DialogTitle>
          <DialogDescription>
            {planName(plan.plan)} plan. A ticket is made for the inspection, due in two weeks.
          </DialogDescription>
        </DialogHeader>
        {offer.isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking the plan…
          </p>
        )}
        {offer.error && (
          <p className="text-sm font-medium text-destructive" role="alert">
            Could not check the plan: {errText(offer.error)}
          </p>
        )}
        {o && (
          <div
            className={`space-y-1 rounded-md border px-3 py-2 text-sm ${o.billed ? "border-amber-500/60 bg-amber-500/10" : "bg-muted/40"}`}
            data-storm-offer
          >
            {stormOfferLines(o).map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        )}
        {o?.added_today && (
          <div
            className="space-y-2 rounded-md border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-sm"
            data-storm-again
          >
            <p>{stormAgainLine(o.added_today)}</p>
            <label className="flex cursor-pointer items-start gap-2 font-medium">
              <Checkbox
                checked={again}
                onCheckedChange={(v) => setAgain(v === true)}
                className="mt-0.5"
                data-storm-again-ok
              />
              <span>{STORM_AGAIN_LABEL}</span>
            </label>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={add.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!o || !stormCanAdd(o, again) || add.isPending}
            onClick={() => o && add.mutate(o.billed)}
            data-action="roof-care-storm-confirm"
          >
            {add.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {o?.billed ? STORM_ADD_BILLED : STORM_ADD_INCLUDED}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Skip an inspection (owner, Nov 20): a manager's, with a reason. */
function SkipDialog({
  siteId,
  visit,
  onClose,
}: {
  siteId: string;
  visit: PlanVisit;
  onClose: () => void;
}) {
  const refresh = useRefresh(siteId);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const fn = useServerFn(skipRoofCareVisit);
  const skip = useMutation({
    mutationFn: () => fn({ data: { visit_id: visit.id, reason: reason.trim() } }),
    onSuccess: (r) => {
      refresh();
      toast.success(
        r.ticket
          ? `Inspection skipped. Ticket #${r.ticket} is off the board. It still counts as owed.`
          : "Inspection skipped. It still counts as owed.",
        { duration: 12_000 },
      );
      onClose();
    },
    onError: (e) => setProblem(errText(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !skip.isPending && onClose()}>
      <DialogContent className="max-w-md" data-roof-care-skip-dialog>
        <DialogHeader>
          <DialogTitle>{SKIP_LABEL}</DialogTitle>
          <DialogDescription>
            {VISIT_LABEL[visit.kind]}. {SKIP_NOTE}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rc-skip-reason">Why it is skipped</Label>
          <Textarea
            id="rc-skip-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setProblem(null);
            }}
          />
        </div>
        {problem && (
          <p className="text-sm font-medium text-destructive" role="alert" data-skip-problem>
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={skip.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={skip.isPending}
            onClick={() => {
              if (!reason.trim()) return setProblem(SKIP_REASON_NEEDED);
              skip.mutate();
            }}
            data-action="roof-care-skip-confirm"
          >
            {skip.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Skip it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Take off a storm inspection added by mistake (owner, Nov 20): a manager's. */
function StormOffDialog({
  siteId,
  visit,
  onClose,
}: {
  siteId: string;
  visit: PlanVisit;
  onClose: () => void;
}) {
  const refresh = useRefresh(siteId);
  const [problem, setProblem] = useState<string | null>(null);
  const fn = useServerFn(removeRoofCareStorm);
  const off = useMutation({
    mutationFn: () => fn({ data: { visit_id: visit.id } }),
    onSuccess: (r) => {
      refresh();
      toast.success(
        r.made_included
          ? `Storm inspection taken off. The billed one${r.number ? ` (ticket #${r.number})` : ""} is now the one the plan includes, so it is not billed.`
          : "Storm inspection taken off.",
        { duration: 12_000 },
      );
      onClose();
    },
    onError: (e) => setProblem(errText(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !off.isPending && onClose()}>
      <DialogContent className="max-w-md" data-storm-off-dialog>
        <DialogHeader>
          <DialogTitle>Take the storm inspection off</DialogTitle>
          <DialogDescription>
            {STORM_REMOVE_NOTE}
            {visit.ticket ? ` Ticket #${visit.ticket.number} comes off the board.` : ""}
          </DialogDescription>
        </DialogHeader>
        {problem && (
          <p className="text-sm font-medium text-destructive" role="alert" data-storm-off-problem>
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={off.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={off.isPending}
            onClick={() => off.mutate()}
            data-action="roof-care-storm-off-confirm"
          >
            {off.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Take it off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The roof size against the map (owner, Nov 20), for the office: a size typed where the map
 * had none waits for a manager to confirm it, and one a manager said was right names them.
 */
function PlanSizeLine({
  siteId,
  plan,
  manager,
}: {
  siteId: string;
  plan: RoofCarePlan;
  manager: boolean;
}) {
  const refresh = useRefresh(siteId);
  const fn = useServerFn(confirmRoofCareSize);
  const confirm = useMutation({
    mutationFn: () => fn({ data: { plan_id: plan.id } }),
    onSuccess: () => {
      refresh();
      toast.success("Roof size confirmed");
    },
    onError: (e) => toast.error(`Could not confirm it: ${errText(e)}`, { duration: 20_000 }),
  });
  const words = planSizeWords(plan);
  if (!words) return null;
  const unchecked = !!plan.size?.unchecked;
  return (
    <p
      className={`flex flex-wrap items-center gap-2 text-xs ${unchecked ? "font-medium text-amber-800 dark:text-amber-300" : "text-muted-foreground"}`}
      data-roof-care-size={unchecked ? "unchecked" : "confirmed"}
    >
      <span>{words}</span>
      {manager && unchecked && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={confirm.isPending}
          onClick={() => confirm.mutate()}
          data-action="roof-care-size-confirm"
        >
          {SIZE_CONFIRM_LABEL}
        </Button>
      )}
    </p>
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
    <div className="space-y-2" data-roof-care-benefits>
      {/* Owner, Nov 24: one small tile for each thing the plan gives, with a bar for how much
          of it is used, in place of a list of lines. */}
      <div className="text-xs">
        <p className="font-medium">Used this plan year</p>
        <dl className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          {rows.map((r) => {
            const share = tallyShare(r.used, r.of);
            return (
              <div key={r.key} className="rounded-md border bg-background px-2.5 py-1.5">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className="font-medium" data-benefit={r.key}>
                  {r.words}
                </dd>
                {share !== null && (
                  <div
                    className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                    aria-hidden
                    data-benefit-bar={share}
                  >
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </dl>
      </div>
      <PlanIncludes plan={plan} open={open} />
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
function RefundOwed({
  siteId,
  plan,
  manager,
  label,
}: {
  siteId: string;
  plan: RoofCarePlan;
  manager: boolean;
  /** Which plan it is for, when it is not the property's current one. */
  label?: string;
}) {
  const refresh = useRefresh(siteId);
  const [ref, setRef] = useState("");
  // A manager changes what is owed (Nov 20): the customer's own check bounced, say.
  const [changing, setChanging] = useState(false);
  const [amount, setAmount] = useState("");
  const [why, setWhy] = useState("");
  const changeFn = useServerFn(changeRoofCareRefund);
  const change = useMutation({
    mutationFn: () =>
      changeFn({
        data: {
          plan_id: plan.id,
          amount: Number(amount.trim().replace(/[$,\s]/g, "")),
          reason: why.trim(),
        },
      }),
    onSuccess: () => {
      refresh();
      setChanging(false);
      setAmount("");
      setWhy("");
      toast.success("Refund changed");
    },
    onError: (e) => toast.error(`Could not change the refund: ${errText(e)}`, { duration: 20_000 }),
  });
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
    <div
      className="space-y-1 text-xs"
      data-roof-care-refund={r.sent_on ? "sent" : "owed"}
      data-refund-plan={plan.id}
    >
      {label && (
        <p className="font-medium" data-refund-for>
          {label}
        </p>
      )}
      <p
        className={
          r.sent_on ? "text-muted-foreground" : "font-medium text-amber-800 dark:text-amber-300"
        }
      >
        {refundStatusWords(r)}
      </p>
      {(r.changes ?? []).map((c, i) => (
        <p key={i} className="text-muted-foreground" data-refund-change>
          {refundChangeWords(c)}
        </p>
      ))}
      {!r.sent_on && r.due > 0 && (
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
      {manager && !r.sent_on && !changing && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setChanging(true)}
          data-action="roof-care-refund-change"
        >
          {REFUND_CHANGE}
        </Button>
      )}
      {manager && !r.sent_on && changing && (
        <div className="space-y-1 rounded-md border p-2" data-refund-change-form>
          <p className="text-muted-foreground">{REFUND_CHANGE_HELP}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="The refund owed now, in dollars"
              inputMode="decimal"
              placeholder="New refund"
              className="h-7 w-28 text-xs"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              aria-label="Why the refund is changed"
              placeholder="Why (for example: check bounced)"
              className="h-7 w-64 text-xs"
              value={why}
              onChange={(e) => setWhy(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={!!refundChangeProblem(amount, why, r.due) || change.isPending}
              onClick={() => change.mutate()}
              data-action="roof-care-refund-change-save"
            >
              {change.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {REFUND_CHANGE_SAVE}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setChanging(false)}
            >
              Cancel
            </Button>
          </div>
          {amount.trim() !== "" && refundChangeProblem(amount, why, r.due) && (
            <p className="text-destructive" data-refund-change-problem>
              {refundChangeProblem(amount, why, r.due)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Card money to send back (owner, Nov 20) ─────────────────────────────────────────────────

/** One amount of card money that has to go back, with a manager's "Mark sent back". */
function CardBackLine({
  siteId,
  back,
  manager,
  today,
}: {
  siteId: string;
  back: PlanCardBack;
  manager: boolean;
  today: string;
}) {
  const refresh = useRefresh(siteId);
  const [on, setOn] = useState(today);
  const [ref, setRef] = useState("");
  const sentFn = useServerFn(markRoofCareCardSentBack);
  const sent = useMutation({
    mutationFn: () => sentFn({ data: { payment_id: back.id, on, ref: ref.trim() } }),
    onSuccess: () => {
      refresh();
      toast.success("Marked sent back");
    },
    onError: (e) => toast.error(`Could not mark it sent back: ${errText(e)}`, { duration: 20_000 }),
  });
  return (
    <div className="space-y-1 text-xs" data-roof-care-card-back={back.sent_back ? "sent" : "owed"}>
      <p className={back.sent_back ? "text-muted-foreground" : "font-medium text-destructive"}>
        {cardBackWords(back)}
      </p>
      {!back.sent_back && manager && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="The day the money was sent back"
            className="h-7 w-36 text-xs"
            max={today}
            value={on}
            onChange={(e) => setOn(e.target.value)}
          />
          <Input
            aria-label="Reference of the money sent back"
            placeholder="Reference or note"
            className="h-7 w-44 text-xs"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!on || on > today || sent.isPending}
            onClick={() => sent.mutate()}
            data-action="roof-care-card-sent-back"
          >
            {sent.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {CARD_BACK_MARK}
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
  brief = false,
  includesOpen = false,
  renewalOf,
  onEnd,
}: {
  siteId: string;
  plan: RoofCarePlan;
  office: boolean;
  manager: boolean;
  short: boolean;
  /** On a property: the steps, and nothing folded under them. */
  brief?: boolean;
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
  // Paying by card online, when it is set up: the page to hand or send to the customer.
  const cardOnline = useCheckoutReady(plan.pay_method === "card");
  const checkoutFn = useServerFn(startPlanCheckout);
  // On a ticket the technician can measure the roof, so the card page opens there though the
  // size is not confirmed. Anywhere else no payment is asked for until it is (owner, Nov 24).
  const onSite = useContext(OnTicket);
  const checkout = useMutation({
    mutationFn: () =>
      checkoutFn({ data: { plan_id: plan.id, ...(onSite ? { on_site: true } : {}) } }),
    onSuccess: (r) => {
      if (r.url) window.location.assign(r.url);
      else toast.error(r.reason ?? "The card payment page could not be made", { duration: 20_000 });
    },
    onError: (e) =>
      toast.error(`Could not open the card payment page: ${errText(e)}`, { duration: 20_000 }),
  });
  const full = !short && !brief;
  const sizeWaits = !!plan.size?.unchecked;
  const held = sizeWaits && !onSite;
  const card = plan.pay_method === "card";
  // The agreement that has not gone, or has nowhere to go, stays in sight.
  const emailWaits = !!plan.email && (!plan.email.to || !plan.email.agreement_sent_at);
  // What is left to do, in order. Each is one step; a step that is done is ticked.
  const steps: { key: string; title: string; done?: boolean; body: ReactNode }[] = [];
  if (office && !short)
    steps.push({
      key: "size",
      title: sizeWaits ? STEP_SIZE : STEP_SIZE_DONE,
      done: !sizeWaits,
      body: planSizeWords(plan) ? (
        <PlanSizeLine siteId={siteId} plan={plan} manager={manager} />
      ) : (
        <p className="text-muted-foreground" data-roof-care-size="checked">
          Roof size {Math.round(plan.roof_sqft).toLocaleString("en-US")} sq ft.
        </p>
      ),
    });
  steps.push({
    key: "pay",
    title: card ? STEP_PAY_CARD : plan.pay_method === "check" ? STEP_PAY_CHECK : STEP_PAY,
    body: (
      <>
        {plan.pay_method && (
          <p data-awaiting-pay={plan.pay_method}>
            {payWords(plan.pay_method, plan.pay_note)}
            {card && !cardOnline ? ` ${PAY_CARD_NOTE}` : ""}
          </p>
        )}
        {/* No payment is asked for until the roof size is confirmed (owner, Nov 24). */}
        {card && held && (
          <p className="font-medium text-amber-800 dark:text-amber-300" data-awaiting-held>
            {PAY_HELD_SIZE}
          </p>
        )}
        {card && !held && (
          <div className="flex flex-wrap items-start gap-1.5">
            {cardOnline && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={checkout.isPending}
                onClick={() => checkout.mutate()}
                data-action="roof-care-checkout"
              >
                {checkout.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                {CHECKOUT_BUTTON}
              </Button>
            )}
            {/* Nov 23: the customer's own link, for one who is not at this screen (signed up
                through the QR page, or wants to pay later from their own phone). Shown whenever
                the plan pays by card: before card payment is set up the box says so. */}
            <PlanPayLinkBox planId={plan.id} />
          </div>
        )}
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
      </>
    ),
  });
  steps.push({
    key: "start",
    title: STEP_START,
    body: (
      <>
        {money && plan.pay_method && (
          <p data-awaiting-record={plan.pay_method}>{card ? STEP_START_CARD : STEP_START_CHECK}</p>
        )}
        {!short && !renewalOf && (
          <p className="text-muted-foreground" data-awaiting-first>
            {firstVisitWords(plan.first_visit, plan.first_days)}
          </p>
        )}
      </>
    ),
  });
  return (
    <div
      className={`space-y-2 text-xs ${renewalOf ? "rounded-md border p-2" : ""}`}
      data-roof-care-awaiting={renewalOf ? "renewal" : "new"}
      data-awaiting-size-held={held}
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
      <ol className="space-y-1.5" data-awaiting-steps={steps.length}>
        {steps.map((st, i) => (
          <li
            key={st.key}
            className="flex gap-2 rounded-md border bg-background px-2.5 py-1.5"
            data-awaiting-step={st.key}
            data-step-done={!!st.done}
          >
            <span
              aria-hidden
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${st.done ? "bg-emerald-600 text-white" : "border border-amber-600/60 text-amber-800 dark:text-amber-300"}`}
            >
              {st.done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium">{st.title}</p>
              {st.body}
            </div>
          </li>
        ))}
      </ol>
      {!short && office && plan.email && emailWaits && (
        <PlanEmailLine siteId={siteId} plan={plan} paid={false} />
      )}
      {full && !renewalOf && <PlanIncludes plan={plan} open={includesOpen} />}
      {full && office && plan.email && !emailWaits && (
        <details
          className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs"
          data-roof-care-details
        >
          <summary className="cursor-pointer font-medium">{WAITING_DETAILS_LABEL}</summary>
          <div className="mt-1.5">
            <PlanEmailLine siteId={siteId} plan={plan} paid={false} />
          </div>
        </details>
      )}
      {full && manager && (
        <div className="flex border-t pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs text-muted-foreground"
            onClick={onEnd}
            data-action={renewalOf ? "roof-care-end-renewal" : "roof-care-end"}
          >
            {renewalOf ? "Cancel the renewal" : "End plan"}
          </Button>
        </div>
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
  // The rule's own answer stands for anyone who may not pick the other one (Nov 20).
  const choice =
    o && o.owed.length ? (o.can_change ? (picked ?? o.default_choice) : o.default_choice) : null;
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
            {o.lapsed && (
              <p className="text-amber-800 dark:text-amber-300" data-renew-line="lapsed">
                {renewalLapsedWords(o)}
              </p>
            )}
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
                      disabled={!o.can_change && c !== o.default_choice}
                      onChange={() => setPicked(c)}
                      data-renew-choice={c}
                    />
                    <span>{renewalChoiceWords(c, o)}</span>
                  </label>
                ))}
                <p className="text-xs text-muted-foreground" data-renew-line="default">
                  {renewalDefaultWords(o)}
                </p>
                {!o.can_change && (
                  <p className="text-xs font-medium" data-renew-line="needs-manager">
                    {RENEWAL_CHANGE_NEEDS_MANAGER}
                  </p>
                )}
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
  window: "In the inspection window",
};

/** A numbered part of the sign-up, headed as the flyer heads things (Nov 21: the look only). */
function SignStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3" data-sign-step={n}>
      <FlyerStepHead n={n} title={title} />
      {children}
    </section>
  );
}

function SignUpDialog({
  siteId,
  today,
  onClose,
  prefill = null,
}: {
  siteId: string;
  today: string;
  onClose: () => void;
  /**
   * What a customer typed on the public Roof Care page (Nov 21). It only fills the boxes: the
   * price is still read fresh, every rule of the sign-up still runs, and the first inspection
   * is still the office's to choose.
   */
  prefill?: CareSignUpPrefill | null;
}) {
  const { profile } = useAuth();
  const refresh = useRefresh(siteId);
  const onSite = useContext(OnTicket);
  const [sqft, setSqft] = useState(() =>
    prefill?.sqft != null && prefill.sqft > 0 ? String(Math.round(prefill.sqft)) : "",
  );
  const [offer, setOffer] = useState<RoofCareOffer | null>(null);
  const [pricedFor, setPricedFor] = useState<number | null>(null);
  const [plan, setPlan] = useState<PlanKey | null>(prefill?.plan ?? null);
  const [first, setFirst] = useState<FirstVisit | null>(null);
  const [days, setDays] = useState("");
  const [agreedBy, setAgreedBy] = useState(prefill?.agreed_by ?? "");
  const [notes, setNotes] = useState(() => (prefill ? carePrefillNote(prefill) : ""));
  // The customer's own tick on the public page stands only for the terms now in use.
  const [agreed, setAgreed] = useState(
    !!prefill && prefill.terms_version === ROOF_CARE_TERMS_VERSION,
  );
  // Where the agreement and the receipt are emailed (owner, Nov 19).
  const [email, setEmail] = useState(prefill?.customer_email ?? "");
  const handleFn = useServerFn(handlePublicRequest);
  const benefits = useBenefits().data ?? null;
  // How they pay for the year (owner, Nov 19: "by check or card either one during sign up").
  const [payMethod, setPayMethod] = useState<PayMethod | null>(prefill?.pay_method ?? null);
  const [payNote, setPayNote] = useState("");
  const offerFn = useServerFn(roofCareOffer);
  const signFn = useServerFn(signUpRoofCare);
  // Card (owner, Nov 19): once online payment is set up, signing goes on to the card payment
  // page. Until then the office takes the card.
  const checkoutFn = useServerFn(startPlanCheckout);
  const cardOnline = useCheckoutReady(payMethod === "card");
  // What the map shows at the address, offered beside the box. The box itself stays blank.
  const mapFn = useServerFn(roofCareMapSize);
  const mapSize = useQuery({
    queryKey: ["roof-care-map-size", siteId],
    queryFn: () => mapFn({ data: { site_id: siteId } }),
    staleTime: 60 * 60_000,
    retry: false,
  });
  const size = wholeNumber(sqft);
  // The typed size against the map's (Nov 20): one more than 20% smaller is not signed, unless
  // a manager or an admin ticks that it is right.
  const [sizeOk, setSizeOk] = useState(false);
  const manager = managesTickets(profile);
  // Two presses in the same instant are one sign-up (Nov 20).
  const press = useRef(onePressAtATime()).current;
  const price = useMutation({
    mutationFn: (n: number) => offerFn({ data: { site_id: siteId, sqft: n } }),
    onSuccess: (o, n) => {
      setOffer(o);
      setPricedFor(n);
      setSizeOk(false);
    },
  });
  const dayCount = wholeNumber(days);
  const dates = first ? planDates(today, first, first === "days" ? dayCount : null) : null;
  // Pushed so far that the second inspection would fall after the plan ends (Nov 20).
  const daysTooFar = firstDaysProblem(today, first, dayCount);
  const answer = offer?.price ?? null;
  const plans = answer?.ready && !answer.custom_quote ? answer.plans : [];
  const stale = pricedFor !== size;
  const emailBad = email.trim() !== "" && !looksLikeEmail(email.trim());
  const mapSqft = offer?.map_sqft ?? null;
  const sizeCheck =
    offer && !stale && size != null && plans.length > 0 ? sizeAgainstMap(size, mapSqft) : "ok";
  const sizeState: "ok" | "tick" | "blocked" =
    sizeCheck !== "smaller" ? "ok" : !manager ? "blocked" : sizeOk ? "ok" : "tick";
  const missing = signUpMissing({
    priced: plans.length > 0,
    stale,
    plan: !!plan && plans.some((o) => o.plan === plan),
    first: !!first,
    daysBad: first === "days" && (!dates || !!daysTooFar),
    pay: !!payMethod,
    name: agreedBy.trim().length > 0,
    emailBad,
    agreed,
    size: sizeState,
  });
  const ready =
    !!plan &&
    !!first &&
    !!dates &&
    !!payMethod &&
    agreedBy.trim().length > 0 &&
    agreed &&
    !emailBad &&
    plans.length > 0 &&
    !stale &&
    missing.length === 0;
  const sign = useMutation({
    mutationFn: async () => {
      const made = await signFn({
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
          ...(sizeCheck === "smaller" && manager && sizeOk ? { size_ok: true } : {}),
        },
      });
      // Opened from a public request: the request points at the plan it became, so its
      // opportunity turns Won by itself the day the plan is paid (Nov 23). The plan is signed
      // either way; when the pointing fails the office is told what to do by hand.
      if (prefill) {
        try {
          await handleFn({
            data: { id: prefill.request_id, status: "matched", site_id: siteId, plan_id: made.id },
          });
        } catch {
          toast.warning(
            `The plan is signed, but request ${prefill.reference} could not be tied to it. When the plan is paid, open that request's opportunity and set it to Won.`,
            { duration: 30_000 },
          );
        }
      }
      // The card payment page, when there is one. The plan is signed either way. Not for a
      // plan signed from a public request (Nov 23): that customer is not at this screen, so
      // they pay from their own link, and the office is told where it is.
      // Nov 24 (owner): "ideally we arent requesting payment or taking payment until the roof
      // size is confirmed. the only reason we take card payment when care plan is selceted on a
      // ticket workflow is the tech can measure the roof there." So the card page opens on a
      // ticket, or when the map checked the size; else the plan waits for a manager.
      let pay: string | null = null;
      const sizeFirst = payMethod === "card" && !prefill && !onSite && !!made.size?.unchecked;
      if (payMethod === "card" && !prefill && !sizeFirst) {
        try {
          pay = (
            await checkoutFn({ data: { plan_id: made.id, ...(onSite ? { on_site: true } : {}) } })
          ).url;
        } catch {
          pay = null;
        }
      }
      return { made, pay, sizeFirst };
    },
    onSuccess: ({ made, pay, sizeFirst }) => {
      refresh();
      if (sizeFirst) {
        toast.success(`${planName(made.plan)} plan signed. ${SIGNED_SIZE_FIRST}`, {
          duration: 30_000,
        });
        onClose();
        return;
      }
      if (pay) {
        toast.success(`${planName(made.plan)} plan signed. Opening the card payment page.`, {
          duration: 20_000,
        });
        window.location.assign(pay);
        return;
      }
      if (prefill && payMethod === "card") {
        toast.success(`${planName(made.plan)} plan signed. ${SIGNED_PAY_BY_LINK}`, {
          duration: 30_000,
        });
        onClose();
        return;
      }
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
      {/* The look of the Roof Care flyer (owner, Nov 20: "a bit more color similar to the one
          sheeter"): the green band with the heavy headline, the plans as the sheet's columns, the
          blue band at the foot. Only the look: every step, box, rule and word is as it was. The
          close cross sits on the green, so it takes the green's dark print. */}
      <DialogContent
        className="max-h-[92vh] max-w-5xl gap-0 overflow-y-auto p-0 [&>button:last-child]:text-[var(--jbk-green-ink)]"
        data-roof-care-sign-up
      >
        <DialogHeader className={`${FLYER_BAND} space-y-0 pr-12`} data-flyer="band">
          <DialogTitle className={FLYER_BAND_TITLE}>{SIGN_UP_TITLE}.</DialogTitle>
          <DialogDescription className={FLYER_BAND_LEAD}>{SIGN_UP_LEAD}</DialogDescription>
        </DialogHeader>
        <div className="space-y-7 px-4 py-5 text-sm sm:px-7">
          {prefill && (
            <p
              className="rounded-lg border-2 border-[var(--jbk-blue)]/40 bg-[var(--jbk-blue)]/5 p-3 text-sm"
              data-care-prefill={prefill.reference}
            >
              {carePrefillWords(prefill, ROOF_CARE_TERMS_VERSION)}
            </p>
          )}
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
            {/* The typed size is far under what the map shows (Nov 20). */}
            {sizeCheck === "smaller" && mapSqft != null && size != null && (
              <div className="space-y-2" data-sign-line="size-smaller">
                <p className="font-medium text-destructive">
                  {sizeSmallerLine(mapSqft, size, manager)}
                </p>
                {manager && (
                  <label className="flex cursor-pointer items-start gap-2 font-medium">
                    <Checkbox
                      checked={sizeOk}
                      onCheckedChange={(v) => setSizeOk(v === true)}
                      className="mt-0.5"
                      data-size-ok
                    />
                    <span>{SIZE_OK_LABEL}</span>
                  </label>
                )}
              </div>
            )}
          </SignStep>

          <SignStep n={2} title="Pick your plan">
            {/* The three plans are explained before there is a price; one is picked once
                there is. */}
            <div
              className={`grid gap-y-5 sm:grid-cols-3 ${stale && plans.length > 0 ? "opacity-60" : ""}`}
              data-plan-cards
            >
              {PLAN_KEYS.map((k) => {
                const o = offerOf(k);
                const picked = plan === k && !!o;
                return (
                  <FlyerPlan
                    key={k}
                    planKey={k}
                    disabled={!o || stale}
                    onClick={() => setPlan(k)}
                    data-plan-offer={o ? k : undefined}
                    name={PLAN_NAMES[k]}
                    promise={PLAN_PITCH[k]}
                    price={o ? money0(o.price) : null}
                    waiting={PRICE_AFTER_SIZE}
                    lines={planIncludes(k, benefits?.[k] ?? null)}
                    recommended={k === PLAN_RECOMMENDED ? RECOMMENDED_WORDS : null}
                    picked={picked}
                    action={o ? (picked ? "Selected" : `Choose ${PLAN_NAMES[k]}`) : null}
                  />
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
                    <div key={c} className="space-y-0.5">
                      <label className="flex flex-wrap items-center gap-2">
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
                      {/* Always under the choice (owner, Nov 23: "i dont see the note here"): the
                          customer reads it before picking, not only after. */}
                      {c === "days" && (
                        <p
                          className={`pl-6 text-sm ${first === "days" ? "font-medium" : "text-muted-foreground"}`}
                          data-sign-line="days-not-promised"
                        >
                          {FIRST_DAYS_NOT_PROMISED}
                        </p>
                      )}
                    </div>
                  ))}
                  {first === "days" && !dates && (
                    <p className="text-xs text-destructive">Type the days, 1 to 365.</p>
                  )}
                  {daysTooFar && (
                    <p className="text-xs text-destructive" data-sign-line="days-too-far">
                      {daysTooFar}
                    </p>
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
                      {cardOnline ? PAY_CARD_NOTE_ONLINE : PAY_CARD_NOTE_CUSTOMER}
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
                {sizeCheck === "unchecked" && (
                  <p className="text-xs text-muted-foreground" data-sign-line="size-unchecked">
                    {SIZE_UNCHECKED_STAFF_NOTE}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
        {/* The blue band at the foot of the sheet: the plan picked and its yearly price, already
            shown above, said once more beside the button that signs. */}
        <div className={`${FLYER_FOOT} space-y-3`} data-flyer="foot">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <p className="min-w-0" data-sign-line="picked">
              {plan && offerOf(plan) && !stale ? (
                <>
                  <span className={`${FLYER_HEAD} flyer-h2 block text-white`}>
                    {PLAN_NAMES[plan]}
                  </span>
                  <span className="block text-base font-semibold text-white">
                    {money0(offerOf(plan)!.price)} per year
                  </span>
                </>
              ) : (
                <span className={`${FLYER_HEAD} flyer-h2 block text-white`}>Pick your plan</span>
              )}
            </p>
            <DialogFooter className="w-full gap-2 sm:w-auto sm:items-center sm:space-x-0">
              <Button
                type="button"
                variant="ghost"
                className="min-h-[44px] text-white hover:bg-white/15 hover:text-white"
                onClick={onClose}
              >
                Not now
              </Button>
              <Button
                type="button"
                size="lg"
                className="min-h-[48px] rounded-none bg-[var(--jbk-green)] px-6 text-base font-bold text-[var(--jbk-green-ink)] hover:bg-[#8fc238] disabled:bg-white/25 disabled:text-white disabled:opacity-100"
                disabled={!ready || sign.isPending}
                // The second of two presses in the same instant is dropped: one sign-up, one answer.
                onClick={() => press(() => sign.mutateAsync())}
                data-action="roof-care-confirm"
              >
                {sign.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {SIGN_UP_BUTTON}
              </Button>
            </DialogFooter>
          </div>
          {/* Why the button cannot be pressed yet (Nov 20). */}
          {!ready && !sign.isPending && missing.length > 0 && (
            <p className="text-right text-xs text-white/90" data-sign-line="missing">
              {signUpMissingLine(missing)}
            </p>
          )}
        </div>
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
