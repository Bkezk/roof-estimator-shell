/**
 * Admin › General › Reminders: one card per kind of work, the same lines on each (owner, Nov 18:
 * "its still a bit confusing. can you make a standardized version for each type opp, bid,
 * service ticket etc. where you can select multiple people from a dropdown on who gets alerted
 * and the frequency in days"; of the drawing with one card per type: "i like idea 1, and yes
 * skip working days and make a note that shows that, nobody on it should send alerts too. each
 * step line should be able to be turned on for opps and bids too but defaulted off for now").
 *
 * The rules are lib/alert-rules.ts: Coming up, Past due, Not started, Nobody on it, Done waiting
 * (tickets) and Each step, each "how many working days" and "who". It took the place of a
 * section per rule (Opportunities, Tickets, Bids, Needs assignment, Untouched work), each worded
 * its own way, with one "Also tell" list for everything.
 *
 * Below the cards: the Owner page's Needs attention limits (they send nothing), and the
 * delivery health of the reminder mail / push with "Run reminders now" (the same dispatcher the
 * app calls on load; it skips a pass when the last one ran under ten minutes ago). Admin only:
 * the server refuses everyone else.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, ChevronDown, Loader2, Play, Save, Users } from "lucide-react";

import {
  CRON_STALE_LINE,
  dispatchRemindersIfDue,
  getCrmSettings,
  notificationHealth,
  reminderRunSummary,
  scheduledRunStale,
  setCrmSettings,
  type CrmSettingsInput,
} from "@/lib/followups.functions";
import {
  ALERT_NUMBER_MAX,
  LINE_LABELS,
  TYPE_TITLES,
  WHO_ADMINS,
  WHO_ASSIGNEE,
  WHO_MANAGERS,
  WORKING_DAYS_NOTE,
  alertKey,
  alertNumbers,
  assigneeLabel,
  defaultWho,
  isPersonToken,
  lineHasAssignee,
  parseAlertWho,
  whoSummary,
  type AlertLine,
  type AlertType,
  type AlertWho,
} from "@/lib/alert-rules";
import { BID_DUE_NOTICE_DAYS_MAX, BID_OVERDUE_EVERY_DAYS_MAX } from "@/lib/bid-status";
import { blankOrNumber } from "@/lib/number-field-view";
import { ATTENTION_DEFAULTS } from "@/lib/owner-attention";
import { TICKET_BEFORE_EVERY_DAYS_MAX, TICKET_DUE_NOTICE_DAYS_MAX } from "@/lib/ticket-reminders";
import { listAssigneeOptions } from "@/lib/opportunities.functions";
import { SAVE_BAR_ACTIONS, SaveBar } from "@/components/save-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const whenTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** The settings that are a number of days. */
type NumericKey = {
  [K in keyof CrmSettingsInput]-?: CrmSettingsInput[K] extends number ? K : never;
}[keyof CrmSettingsInput];
/**
 * A number of days OR null = off. Its box starts blank when null; typing a number sets it;
 * clearing the box saves null again. No 0 stands in.
 */
type NeverKey = {
  [K in keyof CrmSettingsInput]-?: null extends CrmSettingsInput[K]
    ? number extends CrmSettingsInput[K]
      ? K
      : never
    : never;
}[keyof CrmSettingsInput];
type Field = {
  key: NumericKey | NeverKey;
  /** The box's own name: its hover text, and what a bad number is called. */
  label: string;
  min: number;
  /** Upper bound (365 when unsaid). */
  max?: number;
  /** A blank box means off (stored null); a number must still be within min..max. */
  never?: boolean;
};
const FIELDS: Field[] = [
  // Service tickets
  {
    key: "ticket_first_days",
    label: "Tickets: with no scheduled day, due N days after the technician is assigned",
    min: 0,
  },
  {
    key: "ticket_before_every_days",
    label: "Tickets, Coming up: every N working days before the date (blank = off)",
    min: 1,
    max: TICKET_BEFORE_EVERY_DAYS_MAX,
    never: true,
  },
  {
    key: "ticket_due_notice_days",
    label: "Tickets, Coming up: a notice N working days before the date (blank = off)",
    min: 1,
    max: TICKET_DUE_NOTICE_DAYS_MAX,
    never: true,
  },
  { key: "ticket_every_days", label: "Tickets, Past due: every N working days", min: 1 },
  {
    key: "ticket_untouched_days",
    label: "Tickets, Not started: N working days after its date",
    min: 0,
  },
  {
    key: "unassigned_overdue_days",
    label: "Tickets, Nobody on it: after N working days",
    min: 0,
  },
  {
    key: "ticket_unassigned_every_days",
    label: "Tickets, Nobody on it: then every N working days (blank = once)",
    min: 1,
    max: ALERT_NUMBER_MAX,
    never: true,
  },
  {
    key: "ticket_review_every_days",
    label: "Tickets, Done waiting: every N working days",
    min: 1,
    max: ALERT_NUMBER_MAX,
  },
  // Opportunities
  {
    key: "opportunity_close_days",
    label: "Opportunities: with no expected close, due N calendar days after it is entered",
    min: 1,
  },
  {
    key: "opportunity_before_every_days",
    label: "Opportunities, Coming up: every N working days before the expected close (blank = off)",
    min: 1,
    max: ALERT_NUMBER_MAX,
    never: true,
  },
  {
    key: "opportunity_due_notice_days",
    label:
      "Opportunities, Coming up: a notice N working days before the expected close (blank = off)",
    min: 1,
    max: ALERT_NUMBER_MAX,
    never: true,
  },
  {
    key: "opportunity_every_days",
    label: "Opportunities, Past due: every N working days",
    min: 1,
  },
  {
    key: "opportunity_untouched_days",
    label: "Opportunities, Not started: N working days after it is assigned",
    min: 0,
  },
  {
    key: "opportunity_unassigned_days",
    label: "Opportunities, Nobody on it: after N working days",
    min: 0,
    max: ALERT_NUMBER_MAX,
  },
  {
    key: "opportunity_unassigned_every_days",
    label: "Opportunities, Nobody on it: then every N working days (blank = once)",
    min: 1,
    max: ALERT_NUMBER_MAX,
    never: true,
  },
  // Bids
  {
    key: "bid_due_notice_days",
    label: "Bids, Coming up: a notice N working days before the due date",
    min: 0,
    max: BID_DUE_NOTICE_DAYS_MAX,
  },
  {
    key: "bid_overdue_every_days",
    label: "Bids, Past due: every N working days while a draft is past due (blank = off)",
    min: 1,
    max: BID_OVERDUE_EVERY_DAYS_MAX,
    never: true,
  },
  // Owner, Nov 15: the Owner page's Needs attention list (lib/owner-attention.ts).
  {
    key: "attention_bid_days",
    label: "A submitted bid with no follow-up date needs attention after N days",
    min: 0,
  },
  {
    key: "attention_authorize_days",
    label: "A Done ticket needs attention after N days without being authorized",
    min: 0,
  },
];
const EMPTY: CrmSettingsInput = {
  opportunity_close_days: 0,
  opportunity_every_days: 0,
  opportunity_before_every_days: null,
  opportunity_due_notice_days: null,
  opportunity_untouched_days: 0,
  opportunity_unassigned_days: 0,
  opportunity_unassigned_every_days: null,
  ticket_first_days: 0,
  ticket_every_days: 0,
  ticket_before_every_days: null,
  ticket_due_notice_days: null,
  ticket_untouched_days: 0,
  ticket_review_every_days: 0,
  ticket_unassigned_every_days: null,
  unassigned_overdue_days: 0,
  bid_due_notice_days: 1,
  bid_overdue_every_days: null,
  attention_bid_days: ATTENTION_DEFAULTS.bidDays,
  attention_authorize_days: ATTENTION_DEFAULTS.authorizeDays,
  alert_who: defaultWho(null),
};

export function RemindersSettings() {
  const qc = useQueryClient();
  const getFn = useServerFn(getCrmSettings);
  const setFn = useServerFn(setCrmSettings);
  const healthFn = useServerFn(notificationHealth);
  const runFn = useServerFn(dispatchRemindersIfDue);
  const usersFn = useServerFn(listAssigneeOptions);

  const settings = useQuery({ queryKey: ["crm-settings"], queryFn: () => getFn() });
  const health = useQuery({ queryKey: ["notification-health"], queryFn: () => healthFn() });
  // The people a line can name: every user (crm_user_options, the same list as the opportunity
  // assignee box).
  const users = useQuery({
    queryKey: ["assignee-options"],
    queryFn: () => usersFn(),
    staleTime: 5 * 60_000,
  });

  const [draft, setDraft] = useState<CrmSettingsInput>(EMPTY);
  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    // The boxes added on Nov 18, read the way the reminder pass reads them (alert-rules.ts): a
    // column that is not there yet takes what the old page did.
    const n = alertNumbers(s);
    setDraft({
      opportunity_close_days: s.opportunity_close_days,
      opportunity_every_days: s.opportunity_every_days,
      opportunity_before_every_days: n.opportunity_before_every_days,
      opportunity_due_notice_days: n.opportunity_due_notice_days,
      opportunity_untouched_days: s.opportunity_untouched_days,
      opportunity_unassigned_days: n.opportunity_unassigned_days,
      opportunity_unassigned_every_days: n.opportunity_unassigned_every_days,
      ticket_first_days: s.ticket_first_days,
      ticket_every_days: s.ticket_every_days,
      // Null is "off" (a blank box). Before 20261113120000 is applied the row has neither:
      // the defaults, 3 and 1.
      ticket_before_every_days:
        s.ticket_before_every_days === undefined ? 3 : s.ticket_before_every_days,
      ticket_due_notice_days: s.ticket_due_notice_days === undefined ? 1 : s.ticket_due_notice_days,
      ticket_untouched_days: s.ticket_untouched_days,
      ticket_review_every_days: n.ticket_review_every_days,
      ticket_unassigned_every_days: n.ticket_unassigned_every_days,
      unassigned_overdue_days: s.unassigned_overdue_days ?? 1,
      // Before 20261013160000 is applied the row has neither: the day before, never past due.
      bid_due_notice_days: s.bid_due_notice_days ?? 1,
      bid_overdue_every_days: s.bid_overdue_every_days ?? null,
      // Before 20261115120000 is applied the row has neither: 7 and 3.
      attention_bid_days: s.attention_bid_days ?? ATTENTION_DEFAULTS.bidDays,
      attention_authorize_days: s.attention_authorize_days ?? ATTENTION_DEFAULTS.authorizeDays,
      // A line never saved shows who it tells today; a line saved empty is off.
      alert_who: parseAlertWho(s.alert_who, s),
    });
  }, [settings.data]);
  const who = draft.alert_who as AlertWho;
  const people = useMemo(
    () => [...(users.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [users.data],
  );
  const invalid = FIELDS.filter((f) => {
    const v = draft[f.key];
    if (v === null) return !f.never; // blank: fine only where blank means off
    return !Number.isInteger(v) || v < f.min || v > (f.max ?? 365);
  });

  const save = useMutation({
    mutationFn: () => setFn({ data: draft }),
    onSuccess: () => {
      toast.success("Reminder settings saved");
      void qc.invalidateQueries({ queryKey: ["crm-settings"] });
    },
    onError: (e) => toast.error(`Could not save the reminder settings: ${errText(e)}`),
  });
  const run = useMutation({
    mutationFn: () => runFn(),
    onSuccess: (r) => {
      // Owner, Oct 12 (item 8): the whole pass — reminders, escalations, task notices, failures.
      // B1: the follow-up pass throwing is its own headline; the notices ran regardless.
      if (!r.ran)
        toast.info("Skipped: the last pass ran under 10 minutes ago. Try again in a few minutes.");
      else if (r.problem)
        toast.error(`Follow-up pass failed: ${r.problem} · ${reminderRunSummary(r)}`);
      else toast.success(`Reminders ran: ${reminderRunSummary(r)}`);
      void qc.invalidateQueries({ queryKey: ["notification-health"] });
      void qc.invalidateQueries({ queryKey: ["followups"] });
    },
    onError: (e) => toast.error(`Could not run the reminders: ${errText(e)}`),
  });

  // A day box, inline in its sentence.
  const field = (key: Field["key"]) => {
    const f = FIELDS.find((x) => x.key === key)!;
    const v = draft[key];
    if (f.never)
      return (
        <DaysOrNever
          key={key}
          field={f}
          value={v}
          invalid={invalid.includes(f)}
          onChange={(n) => setDraft((d) => ({ ...d, [key]: n }))}
        />
      );
    return (
      <Days
        key={key}
        field={f}
        value={v ?? 0}
        invalid={invalid.includes(f)}
        onChange={(n) => setDraft((d) => ({ ...d, [key]: n }))}
      />
    );
  };
  // Who a line tells.
  const picker = (type: AlertType, line: AlertLine) => {
    const key = alertKey(type, line);
    return (
      <WhoPicker
        type={type}
        line={line}
        value={who[key]}
        people={people}
        onChange={(list) =>
          setDraft((d) => ({ ...d, alert_who: { ...(d.alert_who as AlertWho), [key]: list } }))
        }
      />
    );
  };

  const submit = () => {
    if (invalid.length) {
      toast.error(
        `Check the numbers: ${invalid.map((f) => `“${f.label}” must be a whole number from ${f.min} to ${f.max ?? 365}`).join("; ")}`,
      );
      return;
    }
    save.mutate();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Reminders and alerts</CardTitle>
          <CardDescription>
            One card for each kind of work, with the same lines on each. Every line has its number
            of days and who is told. A blank box, or nobody picked, turns that line off. Changes
            take effect from the next reminder.
          </CardDescription>
          <p
            className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm"
            data-note="working-days"
          >
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium">{WORKING_DAYS_NOTE}</span> Reminders go out at 8 AM
              Eastern. “Each step” notices go out at once.
            </span>
          </p>
        </CardHeader>
        <CardContent>
          {settings.error ? (
            <p className="text-sm text-destructive">
              Could not load the reminder settings: {errText(settings.error)}
            </p>
          ) : !settings.data ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : (
            <form
              id="reminder-settings"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {users.error && (
                <p className="text-xs text-destructive">
                  Could not load the people to pick from: {errText(users.error)}
                </p>
              )}

              <TypeCard
                type="ticket"
                help="The date is the scheduled day. Done ends its reminders; so does taking the technician off."
              >
                <Line label="Due date">
                  The scheduled day. With none, {field("ticket_first_days")} days after the
                  technician is assigned.
                </Line>
                <Line label={LINE_LABELS.coming_up} who={picker("ticket", "coming_up")}>
                  Every {field("ticket_before_every_days")} days before the date, and a notice{" "}
                  {field("ticket_due_notice_days")} days before it. Also on the morning of the date.
                </Line>
                <Line label={LINE_LABELS.past_due} who={picker("ticket", "past_due")}>
                  Every {field("ticket_every_days")} days after the date, until it is Done.
                </Line>
                <Line label={LINE_LABELS.not_started} who={picker("ticket", "not_started")}>
                  {field("ticket_untouched_days")} days after its date with nobody started on it,
                  then at the Past due pace.
                </Line>
                <Line label={LINE_LABELS.nobody} who={picker("ticket", "nobody")}>
                  After {field("unassigned_overdue_days")} days with no technician, then every{" "}
                  {field("ticket_unassigned_every_days")} days. It also turns red on Work Overview.
                </Line>
                <Line label={LINE_LABELS.review} who={picker("ticket", "review")}>
                  Every {field("ticket_review_every_days")} days until it is authorized.
                </Line>
                <Line label={LINE_LABELS.steps} who={picker("ticket", "steps")}>
                  Once when it is opened, scheduled, reassigned, moved, authorized, invoiced, closed
                  or deleted.
                </Line>
              </TypeCard>

              <TypeCard
                type="opportunity"
                help="The date is the expected close. Won, Lost or No response ends its reminders; so does taking the assignee off."
              >
                <Line label={LINE_LABELS.opened} who={picker("opportunity", "opened")}>
                  Once, when someone opens a new opportunity. A request from the public pages has
                  its own notice.
                </Line>
                <Line label="Due date">
                  The expected close. With none, {field("opportunity_close_days")} calendar days
                  after it is entered.
                </Line>
                <Line label={LINE_LABELS.coming_up} who={picker("opportunity", "coming_up")}>
                  Every {field("opportunity_before_every_days")} days before the expected close, and
                  a notice {field("opportunity_due_notice_days")} days before it. Also on the
                  morning of the date.
                </Line>
                <Line label={LINE_LABELS.past_due} who={picker("opportunity", "past_due")}>
                  Every {field("opportunity_every_days")} days after it, until it is won, lost or
                  marked No response.
                </Line>
                <Line label={LINE_LABELS.not_started} who={picker("opportunity", "not_started")}>
                  {field("opportunity_untouched_days")} days after it is assigned with no contact
                  logged, then at the Past due pace.
                </Line>
                <Line label={LINE_LABELS.nobody} who={picker("opportunity", "nobody")}>
                  After {field("opportunity_unassigned_days")} days with nobody assigned, then every{" "}
                  {field("opportunity_unassigned_every_days")} days. It also turns red on Work
                  Overview.
                </Line>
                <Line label={LINE_LABELS.steps} who={picker("opportunity", "steps")}>
                  Once when it is assigned, changes status or is deleted. The people here are told
                  of a new one too.
                </Line>
              </TypeCard>

              <TypeCard
                type="bid"
                help="The date is the bid's due date. Only a draft is reminded; a submitted, won or lost bid is not."
              >
                <Line label={LINE_LABELS.coming_up} who={picker("bid", "coming_up")}>
                  A notice {field("bid_due_notice_days")} days before the due date (0 = on the due
                  day).
                </Line>
                <Line label={LINE_LABELS.past_due} who={picker("bid", "past_due")}>
                  Every {field("bid_overdue_every_days")} days while a draft is past due.
                </Line>
                <Line label={LINE_LABELS.steps} who={picker("bid", "steps")}>
                  Once when it is started, changes status or is deleted.
                </Line>
                <Line label="Own reminder">
                  Whoever sets up a bid can also pick a “Remind me on” day on its Setup. That one
                  goes to them alone, on that day, whatever the bid’s status.
                </Line>
              </TypeCard>

              <p className="text-xs text-muted-foreground" data-note="tasks">
                Tasks keep their own notices: when one is given to someone, the morning it is due,
                and when it is overdue. Each person can turn a kind of notice off for themselves on
                My account.
              </p>

              {/* Owner, Nov 15: "keep the owner on top of things" — the list at the top of the
                  Owner page (lib/owner-attention.ts). It sends nothing; these two numbers only
                  decide when a row appears there. */}
              <section className="rounded-lg border p-3" data-card="attention">
                <h3 className="text-sm font-semibold">Owner’s Needs attention list</h3>
                <p className="mb-1 text-xs text-muted-foreground">
                  The list at the top of the Owner page. Nobody is sent anything by it. These two
                  count calendar days. It also lists work with nobody on it and work not started, at
                  the limits above, and draft bids past their due date.
                </p>
                <Line label="Bids sent">
                  A submitted bid with no follow-up date shows after {field("attention_bid_days")}{" "}
                  days. One whose “Remind me on” day has passed shows the next day.
                </Line>
                <Line label="Done tickets">
                  A Done ticket shows after {field("attention_authorize_days")} days without being
                  authorized.
                </Line>
              </section>
              {/* Save stays at the bottom of the window while the page is scrolled (owner,
                  Nov 17: the same bar as a trade bid's, save-bar.tsx). */}
              <SaveBar className="mt-4">
                <div className="min-w-0 flex-1 text-sm text-muted-foreground" data-save-note>
                  <p>The numbers and the people are saved when you press Save.</p>
                </div>
                <div className={SAVE_BAR_ACTIONS}>
                  <Button
                    type="submit"
                    className="h-10 min-w-24"
                    data-save
                    disabled={save.isPending || !settings.data}
                  >
                    {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
                    Save
                  </Button>
                </div>
              </SaveBar>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Delivery health</CardTitle>
            <CardDescription>
              Whether reminders can go out, and the last deliveries that failed.
            </CardDescription>
          </div>
          <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Run reminders now
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {run.data && (
            <p className="text-sm" data-health="last-run-here">
              Last run from here: {run.data.ran ? "ran" : "skipped (ran under 10 minutes ago)"} ·{" "}
              {reminderRunSummary(run.data)}
              {run.data.problem && (
                <span className="text-destructive">
                  {" "}
                  · Follow-up pass failed: {run.data.problem}
                </span>
              )}
            </p>
          )}
          {health.error ? (
            <p className="text-sm text-destructive">
              Could not load the delivery health: {errText(health.error)}
            </p>
          ) : !health.data ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : (
            <>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                {/* Owner, Oct 12 (item 8): the scheduled job's own stamp (the cron route alone
                    writes last_cron_at), apart from any pass — the app's load-time pass used to
                    hide a dead job behind a fresh "Last reminder pass". */}
                <dt className="text-muted-foreground">Last scheduled run</dt>
                <dd className="space-y-1" data-health="last-cron">
                  <span>
                    {health.data.last_cron_at ? whenTime(health.data.last_cron_at) : "Never"}
                  </span>
                  {scheduledRunStale(health.data.last_cron_at, new Date()) && (
                    <p
                      className="text-xs text-amber-700 dark:text-amber-400"
                      data-health="cron-stale"
                    >
                      {CRON_STALE_LINE}
                    </p>
                  )}
                </dd>
                <dt className="text-muted-foreground">Last reminder pass (any)</dt>
                <dd className="space-y-1">
                  <span>
                    {health.data.last_dispatch_at
                      ? whenTime(health.data.last_dispatch_at)
                      : "Never"}
                  </span>
                  {/* Owner, Oct 12 (item 10a): a reminder that failed to send is put back and
                      retried on the next pass; this says how many are waiting for that. */}
                  {health.data.last_dispatch_failed > 0 && (
                    <p
                      className="text-xs text-amber-700 dark:text-amber-400"
                      data-health="failed-sends"
                    >
                      {health.data.last_dispatch_failed} reminder
                      {health.data.last_dispatch_failed === 1 ? "" : "s"} failed to send on the last
                      pass — they retry on the next pass
                    </p>
                  )}
                </dd>
                <dt className="text-muted-foreground">Email configured</dt>
                <dd className="space-y-1">
                  {health.data.email_configured ? (
                    <Badge variant="secondary">Yes</Badge>
                  ) : (
                    <>
                      <Badge variant="destructive">No</Badge>
                      <p className="text-xs text-muted-foreground">
                        Add RESEND_API_KEY (and NOTIFY_FROM_EMAIL, APP_URL) in Lovable Cloud ›
                        Secrets
                      </p>
                    </>
                  )}
                </dd>
                {health.data.email_configured && health.data.email_problem && (
                  <>
                    <dt className="text-muted-foreground">Reminder emails</dt>
                    <dd className="space-y-1" data-health="email-problem">
                      <Badge variant="destructive">Held back</Badge>
                      <p className="text-xs text-destructive">
                        {health.data.email_problem} — set it in Lovable Cloud › Secrets. Until then
                        each reminder records this instead of sending a broken email.
                      </p>
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">From address</dt>
                <dd className="break-all">{health.data.from || "—"}</dd>
                <dt className="text-muted-foreground">App URL (links in reminders)</dt>
                <dd className="break-all">{health.data.app_url || "—"}</dd>
              </dl>

              <div className="space-y-2">
                <p className="text-sm font-semibold">Recent failures</p>
                {health.data.recent_failures.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No failed deliveries.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>When</TableHead>
                          <TableHead>Notification</TableHead>
                          <TableHead>Email error</TableHead>
                          <TableHead>Push error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {health.data.recent_failures.map((f) => (
                          <TableRow key={f.id}>
                            <TableCell className="whitespace-nowrap">
                              {whenTime(f.created_at)}
                            </TableCell>
                            <TableCell>{f.title}</TableCell>
                            <TableCell className="text-destructive">
                              {f.email_error ?? "—"}
                            </TableCell>
                            <TableCell className="text-destructive">
                              {f.push_error ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* Task notices (created / morning / overdue) record their failures on the task
                  (tasks.notify_error); they are listed here too (audit, Oct 2). */}
              <div className="space-y-2" data-health="task-failures">
                <p className="text-sm font-semibold">Task notice failures</p>
                {health.data.task_failures.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No failed task notices.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Updated</TableHead>
                          <TableHead>Task</TableHead>
                          <TableHead>Assignee</TableHead>
                          <TableHead>Problem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {health.data.task_failures.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell className="whitespace-nowrap">
                              {whenTime(t.updated_at)}
                            </TableCell>
                            <TableCell>{t.title}</TableCell>
                            <TableCell>{t.assignee_name ?? "—"}</TableCell>
                            <TableCell className="text-destructive">{t.notify_error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* "Bid due tomorrow" notices record their failures on the bid (bids.notify_error;
                  owner, Oct 12, B4); the stamp is put back, so each retries on the next pass. */}
              <div className="space-y-2" data-health="bid-failures">
                <p className="text-sm font-semibold">Bid notice failures</p>
                {health.data.bid_failures.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No failed bid notices.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Updated</TableHead>
                          <TableHead>Bid</TableHead>
                          <TableHead>Due</TableHead>
                          <TableHead>Problem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {health.data.bid_failures.map((b) => (
                          <TableRow key={b.id}>
                            <TableCell className="whitespace-nowrap">
                              {whenTime(b.updated_at)}
                            </TableCell>
                            <TableCell>{b.name}</TableCell>
                            <TableCell className="whitespace-nowrap">{b.due_date ?? "—"}</TableCell>
                            <TableCell className="text-destructive">{b.notify_error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** One kind of work: its name, what its date is, and its lines. */
function TypeCard(props: { type: AlertType; help: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border p-3" data-card={props.type}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b pb-2">
        <h3 className="text-base font-semibold">{TYPE_TITLES[props.type]}</h3>
        <p className="text-xs text-muted-foreground">{props.help}</p>
      </div>
      <div className="divide-y">{props.children}</div>
    </section>
  );
}

/**
 * One alert line: its name, the sentence with its day boxes, and who is told. On a phone the
 * three stack; on a desk they sit in a row, the same on every card.
 */
function Line(props: { label: string; who?: ReactNode; children: ReactNode }) {
  return (
    <div
      className="grid gap-x-4 gap-y-1.5 py-2.5 text-sm lg:grid-cols-[8.5rem_1fr_17rem]"
      data-line={props.label}
    >
      <span className="font-semibold">{props.label}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">{props.children}</span>
      <span>{props.who}</span>
    </div>
  );
}

/**
 * Who a line tells: a dropdown of tick boxes (owner, Nov 18: "select multiple people from a
 * dropdown on who gets alerted"). The roles first, then everyone by name. Nobody ticked turns
 * the line off, and the button says so.
 */
function WhoPicker(props: {
  type: AlertType;
  line: AlertLine;
  value: string[];
  people: { id: string; name: string }[];
  onChange: (v: string[]) => void;
}) {
  const { type, line, value } = props;
  const names = new Map(props.people.map((u) => [u.id, u.name]));
  const toggle = (token: string) =>
    props.onChange(value.includes(token) ? value.filter((t) => t !== token) : [...value, token]);
  const roles = [
    ...(lineHasAssignee(line) ? [{ token: WHO_ASSIGNEE, label: assigneeLabel(type, line) }] : []),
    { token: WHO_ADMINS, label: "Every admin" },
    { token: WHO_MANAGERS, label: "Every manager" },
  ];
  // Someone picked who has since been removed stays listed, so they can be unticked.
  const gone = value.filter((t) => isPersonToken(t) && !names.has(t));
  const row = (token: string, label: string) => (
    <label
      key={token}
      className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-muted"
    >
      <Checkbox
        checked={value.includes(token)}
        onCheckedChange={() => toggle(token)}
        data-who-option={token}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </label>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-[40px] w-full justify-between gap-2 px-2 font-normal lg:h-9"
          aria-label={`Who is told: ${LINE_LABELS[line]}, ${TYPE_TITLES[type]}`}
          data-who={alertKey(type, line)}
          data-who-count={value.length}
        >
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span
            className={`min-w-0 flex-1 truncate text-left ${value.length ? "" : "text-muted-foreground"}`}
          >
            {whoSummary(value, type, line, names)}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-80 w-72 overflow-y-auto p-1.5">
        <p className="px-2 pb-1 pt-0.5 text-xs text-muted-foreground">
          Tick everyone who should be told. Nobody ticked turns this line off.
        </p>
        {roles.map((r) => row(r.token, r.label))}
        <div className="my-1 border-t" />
        {props.people.map((u) => row(u.id, u.name))}
        {gone.map((t) => row(t, "Someone removed"))}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A number of days OR blank = never (owner, Oct 13: "Then every N days while a draft is past
 * due"). The box shows nothing while the setting is null — no 0 stands in for never — and
 * clearing it saves null again (number-field-view.ts blankOrNumber).
 */
function DaysOrNever(props: {
  field: Field;
  value: number | null;
  invalid: boolean;
  onChange: (v: number | null) => void;
}) {
  return (
    <span className="inline-block w-16">
      <Input
        type="number"
        title={props.field.label}
        data-field={props.field.key}
        value={props.value ?? ""}
        min={props.field.min}
        max={props.field.max ?? 365}
        step="1"
        inputMode="numeric"
        className={`h-8 text-center ${props.invalid ? "border-destructive" : ""}`}
        onChange={(e) => props.onChange(blankOrNumber(e.target.value))}
      />
    </span>
  );
}

/** A number of days, inline in its sentence; the full label is its accessible name. */
function Days(props: {
  field: Field;
  value: number;
  invalid: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <span className="inline-block w-16">
      <NumberField
        title={props.field.label}
        value={props.value}
        min={0}
        max={props.field.max ?? 365}
        inputMode="numeric"
        invalid={props.invalid}
        className="h-8 text-center"
        blankZero={false}
        onChange={(v) => props.onChange(Math.round(v))}
      />
    </span>
  );
}
