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
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, CloudLightning, Loader2, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { isFieldOnly, managesTickets } from "@/lib/access";
import { useAuth } from "@/lib/auth-store";
import { easternYmd } from "@/lib/field-day";
import { longDay } from "@/lib/followup-rules";
import { NOT_PLACED_LINE, placedRoughly, roughPlaceLine } from "@/lib/roof-care-locate";
import {
  dueWords,
  nextWindow,
  planBadge,
  planDates,
  planName,
  pushPreview,
  roofCarePlansKey,
  runsLate,
  VISIT_LABEL,
  visitsDone,
  visitsDoneWords,
  visitState,
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
  roofCareOffer,
  signUpRoofCare,
  type RoofCareOffer,
} from "@/lib/roof-care-plan.functions";
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

/** The plan in force, else the one that ended last. */
const currentPlan = (plans: readonly RoofCarePlan[]): RoofCarePlan | null =>
  plans.find((p) => p.status === "active") ?? plans[0] ?? null;

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
        className={`gap-1 font-medium ${plan.status === "active" ? "border-emerald-600/50 text-emerald-800 dark:text-emerald-300" : "text-muted-foreground"}`}
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
 * The property's Roof Care plan. `visitId`: on a ticket, the inspection this ticket is, so its
 * line leads; `short`: the ticket's form, with the plan's badge and no list.
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
  const [signUp, setSignUp] = useState(false);
  const [push, setPush] = useState<PlanVisit | null>(null);
  const [ending, setEnding] = useState(false);
  const [asking, setAsking] = useState(false);
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
  const active = plan?.status === "active" ? plan : null;
  const office = !isFieldOnly(profile);
  const manager = managesTickets(profile);
  const mine = active && visitId ? (active.visits.find((v) => v.id === visitId) ?? null) : null;
  return (
    <div className={`space-y-1.5 ${className}`} data-roof-care={active ? active.plan : "none"}>
      {plan && <RoofCareBadge plan={plan} today={today} />}
      {mine && (
        <p className="text-xs font-medium" data-roof-care-this-ticket>
          This ticket is the plan’s {VISIT_LABEL[mine.kind].toLowerCase()}. {dueWords(mine)}.
        </p>
      )}
      {active && (
        <>
          <p className="text-xs text-muted-foreground">
            Signed {longDay(active.signed_on)} by {active.agreed_by}
            {active.sold_by_name ? `, signed up by ${active.sold_by_name}` : ""}. Renews{" "}
            {longDay(active.renews_on)}.{office && ` ${money0(active.price)} a year.`}
            {active.price_estimated && " The price is an estimate until the address is confirmed."}
          </p>
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
      {!active && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setSignUp(true)}
          data-action="roof-care-sign-up"
        >
          <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Sign up for a Roof Care plan
        </Button>
      )}
      {/* Owner, Nov 18: anything else the customer asks for while someone is there. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={() => setAsking(true)}
        data-action="service-request"
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Customer wants another service
      </Button>
      {asking && <ServiceRequestDialog siteId={siteId} onClose={() => setAsking(false)} />}
      {signUp && <SignUpDialog siteId={siteId} today={today} onClose={() => setSignUp(false)} />}
      {push && (
        <PushBackDialog
          siteId={siteId}
          visit={push}
          manager={manager}
          onClose={() => setPush(null)}
        />
      )}
      {ending && active && (
        <EndDialog siteId={siteId} plan={active} onClose={() => setEnding(false)} />
      )}
    </div>
  );
}

// ── Sign up ─────────────────────────────────────────────────────────────────────────────────

const FIRST_WORDS: Record<FirstVisit, string> = {
  now: "Do the first inspection today",
  days: "Push the first inspection back",
  window: "Wait for the next window",
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
  const offerFn = useServerFn(roofCareOffer);
  const signFn = useServerFn(signUpRoofCare);
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
    !!plan && !!first && !!dates && agreedBy.trim().length > 0 && plans.length > 0 && !stale;
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
        },
      }),
    onSuccess: (made) => {
      refresh();
      toast.success(`${planName(made.plan)} plan started`);
      onClose();
    },
    onError: (e) => toast.error(`Could not sign them up: ${errText(e)}`),
  });
  const w = nextWindow(today);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-roof-care-sign-up>
        <DialogHeader>
          <DialogTitle>Sign up for a Roof Care plan</DialogTitle>
          <DialogDescription>
            Two inspections a year with a photo report after each. The price follows the roof’s size
            and the drive from the office.
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
          {price.error && (
            <p className="text-destructive" data-sign-line="error">
              {errText(price.error)}
            </p>
          )}
          {offer && !offer.drive && (
            <p className="text-destructive" data-sign-line="not-placed">
              {NOT_PLACED_LINE}
            </p>
          )}
          {offer?.drive && (
            <p className="text-muted-foreground" data-sign-line="drive">
              Round trip from the office: {offer.drive.hours} h, {offer.drive.miles} miles.
            </p>
          )}
          {offer?.drive && placedRoughly(offer.drive.placed_by) && (
            <p className="text-amber-700 dark:text-amber-400" data-sign-line="rough">
              {roughPlaceLine(offer.drive.place)}
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
                    {money0(o.visit1)} at the first inspection, {money0(o.visit2)} at the second
                  </span>
                  {o.travel > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      {money0(o.list)} plus {money0(o.travel)} for the drive
                    </span>
                  )}
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
                          aria-label="Days to push the first inspection back"
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
                    renews {longDay(dates.renews)}.
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
            Start the plan
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
      toast.success("Plan ended");
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
            No more inspections are made for it. Tickets already made stay as they are.
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
          <DialogTitle>Customer wants another service</DialogTitle>
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
