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
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, CloudLightning, Loader2, Plus, ShieldCheck } from "lucide-react";
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
import {
  ALLOWANCE_INCLUDED_WORDS,
  allowanceMoney,
  allowanceStatusWords,
} from "@/lib/roof-care-allowance";
import { NOT_PLACED_LINE } from "@/lib/roof-care-locate";
import {
  ADDITIONAL_SERVICES_LABEL,
  AWAITING_PAYMENT_NOTE,
  AWAITING_PAYMENT_WORDS,
  CARE_PLAN_LABEL,
  DATES_FROM_PAYMENT,
  dueWords,
  firstVisitWords,
  MAP_ROOF_MORE,
  MAP_ROOF_USE,
  mapRoofSizeLine,
  nextWindow,
  planBadge,
  PLAN_MAKE_INVOICE,
  PLAN_NO_INVOICE,
  planDates,
  planName,
  planNumberLabel,
  pushPreview,
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
  type PlanVisit,
  type RoofCarePlan,
} from "@/lib/roof-care-plan";
import {
  addRoofCareStorm,
  endRoofCarePlan,
  listRoofCarePlans,
  pushBackRoofCareVisit,
  requestAdditionalService,
  roofCareMapSize,
  roofCareOffer,
  signUpRoofCare,
  type RoofCareOffer,
} from "@/lib/roof-care-plan.functions";
import { createRoofCarePlanInvoice } from "@/lib/roof-care-plan-invoice.functions";
import { money0, type PlanKey } from "@/lib/roof-care-price";

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

/** The plan in force, else the one waiting for its payment, else the one that ended last. */
const currentPlan = (plans: readonly RoofCarePlan[]): RoofCarePlan | null =>
  plans.find((p) => p.status === "active") ??
  plans.find((p) => p.status === "awaiting_payment") ??
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

const STATE_WORDS = { done: "Done", late: "Late", ticket: "Ticket out", waiting: "Not yet due" };

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
      <span className="text-muted-foreground">{dueWords(visit)}</span>
      <Badge
        variant={state === "late" ? "destructive" : "secondary"}
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
      {visit.due_by !== visit.first_due_by && (
        <span className="text-muted-foreground">
          pushed back{visit.push_reason ? `: ${visit.push_reason}` : ""}
        </span>
      )}
      {office && state !== "done" && (
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
  big = false,
  className = "",
}: {
  siteId: string | null | undefined;
  visitId?: string | null;
  big?: boolean;
  className?: string;
}) {
  const { profile } = useAuth();
  const q = usePlans(siteId);
  const [open, setOpen] = useState<"plan" | "service" | null>(null);
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
        onClick={() => setOpen("plan")}
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
          <DialogDescription>This property’s Roof Care plan and its inspections.</DialogDescription>
        </DialogHeader>
        <RoofCareCard siteId={siteId} visitId={visitId} />
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
  className = "",
}: {
  siteId: string | null | undefined;
  visitId?: string | null;
  short?: boolean;
  className?: string;
}) {
  const { profile } = useAuth();
  const q = usePlans(siteId);
  const [push, setPush] = useState<PlanVisit | null>(null);
  const [ending, setEnding] = useState(false);
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
  const office = !isFieldOnly(profile);
  const manager = managesTickets(profile);
  const mine = active && visitId ? (active.visits.find((v) => v.id === visitId) ?? null) : null;
  return (
    <div
      className={`space-y-1.5 ${className}`}
      data-roof-care={active ? active.plan : waiting ? "awaiting" : "none"}
    >
      {plan && <RoofCareBadge plan={plan} today={today} />}
      {waiting && (
        <AwaitingPayment
          siteId={siteId}
          plan={waiting}
          office={office}
          manager={manager}
          short={short}
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
            Signed {longDay(active.signed_on)} by {active.agreed_by}
            {active.sold_by_name ? `, signed up by ${active.sold_by_name}` : ""}.
            {active.pay_first && active.starts_on
              ? ` Paid, and started ${longDay(active.starts_on)}.`
              : ""}{" "}
            Renews {longDay(active.renews_on)}.{office && ` ${money0(active.price)} a year.`}
            {active.price_estimated && " The price is an estimate until the address is confirmed."}
          </p>
          {/* The minor repairs the plan includes each year (owner, Nov 19: "have that under
              the plan status"): what is used and what is left, for those who see invoices. */}
          {!short && active.repair_allowance > 0 && (
            <div className="space-y-0.5 text-xs" data-roof-care-allowance>
              {active.allowance_used === null ? (
                <p className="text-muted-foreground">{ALLOWANCE_INCLUDED_WORDS}</p>
              ) : (
                <>
                  <p className="font-medium" data-allowance-status>
                    {allowanceStatusWords({
                      repair_allowance: active.repair_allowance,
                      allowance_used: active.allowance_used,
                    })}
                  </p>
                  {active.allowance_uses.length > 0 && (
                    <p className="text-muted-foreground" data-allowance-uses>
                      Used on{" "}
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
                </>
              )}
            </div>
          )}
          {runsLate(active) && (
            <p className="text-xs text-amber-700 dark:text-amber-400" data-roof-care-late>
              Running late: an inspection was pushed past the plan year, so the renewal moved.
            </p>
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
        <EndDialog siteId={siteId} plan={(active ?? waiting)!} onClose={() => setEnding(false)} />
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
  onEnd,
}: {
  siteId: string;
  plan: RoofCarePlan;
  office: boolean;
  manager: boolean;
  short: boolean;
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
  return (
    <div className="space-y-1 text-xs" data-roof-care-awaiting>
      <p className="font-medium text-amber-800 dark:text-amber-300">
        {AWAITING_PAYMENT_WORDS}
        {plan.plan_number != null ? ` · ${planNumberLabel(plan.plan_number)}` : ""}
        {office && ` · ${money0(plan.price)} for the year`}
      </p>
      <p className="text-muted-foreground">
        Signed {longDay(plan.signed_on)} by {plan.agreed_by}
        {plan.sold_by_name ? `, signed up by ${plan.sold_by_name}` : ""}. {AWAITING_PAYMENT_NOTE}
      </p>
      {!short && (
        <p className="text-muted-foreground" data-awaiting-first>
          {firstVisitWords(plan.first_visit, plan.first_days)}
        </p>
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
                ? `has ${money0(inv.paid_amount)} paid of ${money0(inv.total)}. The plan starts when it is paid in full.`
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
          data-action="roof-care-end"
        >
          End plan
        </Button>
      )}
    </div>
  );
}

// ── Sign up ─────────────────────────────────────────────────────────────────────────────────

// Counted from the day the payment is received (Nov 19): no inspection before the plan is paid.
const FIRST_WORDS: Record<FirstVisit, string> = {
  now: "As soon as the payment is received",
  days: "This many days after the payment",
  window: "In the next window after the payment",
};

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
  const ready =
    !!plan &&
    !!first &&
    !!dates &&
    agreedBy.trim().length > 0 &&
    agreed &&
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
          agreed_by: agreedBy.trim(),
          notes: notes.trim(),
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
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-roof-care-sign-up>
        <DialogHeader>
          <DialogTitle>Sign up for a Roof Care plan</DialogTitle>
          <DialogDescription>
            Two inspections a year with a photo report after each. The price is for this property.
            The plan is paid for the year first, and starts the day the payment is received.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="rc-sqft">Roof size (sq ft)</Label>
              <Input
                id="rc-sqft"
                inputMode="numeric"
                className="h-9 w-40"
                value={sqft}
                onChange={(e) => setSqft(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={size == null || size <= 0 || price.isPending}
              onClick={() => size != null && price.mutate(size)}
              data-action="roof-care-price"
            >
              {price.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Get the price
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
              A roof over {answer.over_sqft.toLocaleString("en-US")} sq ft gets a custom quote. Call
              the office.
            </p>
          )}
          {plans.length > 0 && (
            <div className={`grid gap-2 sm:grid-cols-3 ${stale ? "opacity-50" : ""}`}>
              {plans.map((o) => (
                <button
                  key={o.plan}
                  type="button"
                  disabled={stale}
                  onClick={() => setPlan(o.plan)}
                  aria-pressed={plan === o.plan}
                  data-plan-offer={o.plan}
                  className={`rounded-lg border p-3 text-left ${plan === o.plan ? "border-primary ring-2 ring-primary/40" : "hover:bg-muted/50"}`}
                >
                  <span className="block font-semibold">{o.name}</span>
                  <span className="block text-lg font-semibold" data-plan-price>
                    {money0(o.price)}
                    <span className="text-xs font-normal text-muted-foreground"> a year</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Paid in full before the plan starts
                  </span>
                </button>
              ))}
            </div>
          )}
          {stale && plans.length > 0 && (
            <p className="text-xs text-muted-foreground">
              The roof size changed. Press Get the price again.
            </p>
          )}
          {plans.length > 0 && (
            <>
              <fieldset className="space-y-1.5">
                <legend className="font-medium">The first inspection</legend>
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
                          aria-label="Days after the payment for the first inspection"
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
                    Inspection 1: {dueWords({ due_from: dates.first.from, due_by: dates.first.to })}
                    . Inspection 2:{" "}
                    {dueWords({ due_from: dates.second.from, due_by: dates.second.to })}. The plan
                    renews {longDay(dates.renews)}. {DATES_FROM_PAYMENT}
                  </p>
                )}
              </fieldset>
              <div className="space-y-1">
                <Label htmlFor="rc-agreed">Who agreed to the plan (the customer’s name)</Label>
                <Input
                  id="rc-agreed"
                  className="h-9"
                  value={agreedBy}
                  onChange={(e) => setAgreedBy(e.target.value)}
                />
              </div>
              <div className="space-y-1.5" data-roof-care-terms>
                <p className="font-medium">What the customer agrees to</p>
                <ol className="max-h-48 list-decimal space-y-1 overflow-y-auto rounded-md border bg-muted/30 py-2 pl-8 pr-3 text-xs">
                  {ROOF_CARE_TERMS.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ol>
                <label className="flex cursor-pointer items-start gap-2">
                  <Checkbox
                    checked={agreed}
                    onCheckedChange={(v) => setAgreed(v === true)}
                    className="mt-0.5"
                    data-terms-agreed
                  />
                  <span>The customer has read these terms and agrees to them.</span>
                </label>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rc-notes">Notes (optional)</Label>
                <Textarea
                  id="rc-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground" data-sign-line="credit">
                Signed up by {(profile?.full_name ?? "").trim() || profile?.email}. Your name goes
                on the plan.
              </p>
            </>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!ready || sign.isPending}
            onClick={() => sign.mutate()}
            data-action="roof-care-confirm"
          >
            {sign.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Sign the plan
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
  const pushFn = useServerFn(pushBackRoofCareVisit);
  const n = wholeNumber(days);
  const preview = pushPreview(visit, n, { manager, reason });
  const push = useMutation({
    mutationFn: () => pushFn({ data: { visit_id: visit.id, days: n!, reason: reason.trim() } }),
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
  onClose,
}: {
  siteId: string;
  plan: RoofCarePlan;
  onClose: () => void;
}) {
  const refresh = useRefresh(siteId);
  const [reason, setReason] = useState("");
  const endFn = useServerFn(endRoofCarePlan);
  const end = useMutation({
    mutationFn: () => endFn({ data: { plan_id: plan.id, reason: reason.trim() } }),
    onSuccess: () => {
      refresh();
      // Its inspection tickets nobody had started are taken off the board (Nov 19).
      toast.success(
        plan.status === "awaiting_payment"
          ? "Plan ended. Its unpaid invoice was removed."
          : "Plan ended. Its inspection tickets not yet started were taken off the board.",
      );
      onClose();
    },
    onError: (e) => toast.error(`Could not end the plan: ${errText(e)}`),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-roof-care-end-dialog>
        <DialogHeader>
          <DialogTitle>End the {planName(plan.plan)} plan</DialogTitle>
          <DialogDescription>
            {plan.status === "awaiting_payment"
              ? "The plan was never paid, so it never started. Its unpaid invoice is removed with it."
              : "No more inspections are made for it. Tickets already made stay as they are."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 text-sm">
          <Label htmlFor="rc-end-reason">Why it is ending</Label>
          <Textarea
            id="rc-end-reason"
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
            variant="destructive"
            disabled={!reason.trim() || end.isPending}
            onClick={() => end.mutate()}
            data-action="roof-care-end-confirm"
          >
            {end.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            End plan
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
