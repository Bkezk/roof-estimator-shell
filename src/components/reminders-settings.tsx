/**
 * Admin › General › Reminders (docs/service-module-design.md §11): the follow-up timer lengths
 * (crm_settings) and the delivery health of the reminder mail / push, with a "Run reminders
 * now" button (the same lazy dispatcher the app calls on load; it skips a pass when the last one
 * ran under ten minutes ago). Admin only — the server refuses everyone else.
 *
 * The sentences state the rules as followups.server.ts runs them (owner, Oct 9: "its unclear
 * what the remind the assignee after x days means … for tickets who is it reminding if
 * unassigned? if assigned is it 1 day after due date then every 3 days?"). Quoted from that
 * module's header and syncFollowup:
 *   "One open row per assigned item; assigning starts it, a closing status ends it, and the
 *    dispatcher (notify.server.ts) reminds the assignee until then."
 *   "ticket = due on its scheduled day (or first_days from now when unscheduled), reminders
 *    every ticket_every_days, closed at Done / Invoiced / Closed or when unassigned.
 *    Opportunity = due at its expected close (default close_days from creation), first reminder
 *    after opportunity_first_days, then every opportunity_every_days, closed at Won / Lost /
 *    No response."
 *   "Ticket: remind on the due day (the scheduled day) unless it is already past, then now.
 *    Opportunity: first reminder after first_days, never later than the due date."
 * An item with no assignee has no follow-up row (syncFollowup closes it "unassigned"), so
 * nobody is reminded; Work Overview lists it under Unassigned and flags it overdue after
 * crm_settings.unassigned_overdue_days (my-work.ts unassignedOverdue). Untouched work
 * (notify.server.ts escalateUntouched): assigned, no contact logged, not started; past
 * ticket_untouched_days / opportunity_untouched_days the escalation people hear, "then again
 * every ticket_every_days / opportunity_every_days", while the assignee's own reminders go on.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Play, Save } from "lucide-react";

import {
  dispatchRemindersIfDue,
  getCrmSettings,
  notificationHealth,
  setCrmSettings,
  type CrmSettingsInput,
} from "@/lib/followups.functions";
import { listAssigneeOptions } from "@/lib/opportunities.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberField } from "@/components/ui/number-field";
import { Switch } from "@/components/ui/switch";
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

/** The settings that are a number of days (the escalation ones are not). */
type NumericKey = {
  [K in keyof CrmSettingsInput]-?: CrmSettingsInput[K] extends number ? K : never;
}[keyof CrmSettingsInput];
type Field = {
  key: NumericKey;
  label: string;
  min: number;
  group: "opportunity" | "ticket" | "untouched" | "unassigned";
};
const FIELDS: Field[] = [
  {
    key: "opportunity_close_days",
    label: "Opportunities should close within N days",
    min: 1,
    group: "opportunity",
  },
  {
    key: "opportunity_first_days",
    label: "First opportunity reminder N days after assignment",
    min: 0,
    group: "opportunity",
  },
  { key: "opportunity_every_days", label: "Then every N days", min: 1, group: "opportunity" },
  {
    key: "ticket_first_days",
    label: "Unscheduled ticket due N days after the technician is assigned",
    min: 0,
    group: "ticket",
  },
  { key: "ticket_every_days", label: "Then every N days", min: 1, group: "ticket" },
  {
    key: "ticket_untouched_days",
    label: "Ticket counts as untouched after N days with no contact",
    min: 0,
    group: "untouched",
  },
  {
    key: "opportunity_untouched_days",
    label: "Opportunity counts as untouched after N days",
    min: 0,
    group: "untouched",
  },
  {
    key: "unassigned_overdue_days",
    label: "Unassigned work is flagged overdue after N days without a person",
    min: 0,
    group: "unassigned",
  },
];
const EMPTY: CrmSettingsInput = {
  opportunity_close_days: 0,
  opportunity_first_days: 0,
  opportunity_every_days: 0,
  ticket_first_days: 0,
  ticket_every_days: 0,
  ticket_untouched_days: 0,
  opportunity_untouched_days: 0,
  unassigned_overdue_days: 0,
  escalate_to_admins: false,
  escalate_user_ids: [],
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
  // The people untouched items can escalate to: every user (crm_user_options, the same list as
  // the opportunity assignee box; it was technician_options, the Service roster only).
  const users = useQuery({
    queryKey: ["assignee-options"],
    queryFn: () => usersFn(),
    staleTime: 5 * 60_000,
  });

  const [draft, setDraft] = useState<CrmSettingsInput>(EMPTY);
  useEffect(() => {
    const s = settings.data;
    if (s)
      setDraft({
        opportunity_close_days: s.opportunity_close_days,
        opportunity_first_days: s.opportunity_first_days,
        opportunity_every_days: s.opportunity_every_days,
        ticket_first_days: s.ticket_first_days,
        ticket_every_days: s.ticket_every_days,
        ticket_untouched_days: s.ticket_untouched_days,
        opportunity_untouched_days: s.opportunity_untouched_days,
        unassigned_overdue_days: s.unassigned_overdue_days ?? 1,
        escalate_to_admins: s.escalate_to_admins,
        escalate_user_ids: s.escalate_user_ids ?? [],
      });
  }, [settings.data]);
  const toggleEscalate = (id: string) =>
    setDraft((d) => ({
      ...d,
      escalate_user_ids: d.escalate_user_ids.includes(id)
        ? d.escalate_user_ids.filter((x) => x !== id)
        : [...d.escalate_user_ids, id],
    }));
  const userOptions = useMemo(() => {
    const all = [...(users.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    // Keep someone already picked listed (and removable) even if they left the roster.
    for (const id of draft.escalate_user_ids)
      if (!all.some((u) => u.id === id)) all.push({ id, name: "Former user" });
    return all;
  }, [users.data, draft.escalate_user_ids]);
  const invalid = FIELDS.filter((f) => !Number.isInteger(draft[f.key]) || draft[f.key] < f.min);

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
      if (r.ran) toast.success(`Reminders ran: ${r.reminded} sent`);
      else
        toast.info("Skipped: the last pass ran under 10 minutes ago. Try again in a few minutes.");
      void qc.invalidateQueries({ queryKey: ["notification-health"] });
      void qc.invalidateQueries({ queryKey: ["followups"] });
    },
    onError: (e) => toast.error(`Could not run the reminders: ${errText(e)}`),
  });

  // Owner, Oct 9 ("optimize and clarify this page a bit, its layout is unusual and spaced out"):
  // the numbers sit inside short sentences, one compact card, four sections side by side with
  // their help instead of a two-column grid of boxed sub-cards.
  const field = (key: NumericKey) => {
    const f = FIELDS.find((x) => x.key === key)!;
    return (
      <Days
        key={key}
        field={f}
        value={draft[key]}
        invalid={invalid.includes(f)}
        onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
      />
    );
  };
  const daysFields = (group: Field["group"]) =>
    FIELDS.filter((f) => f.group === group).map((f) => field(f.key));

  const submit = () => {
    if (invalid.length) {
      toast.error(
        `Check the numbers: ${invalid.map((f) => `“${f.label}” must be at least ${f.min}`).join("; ")}`,
      );
      return;
    }
    save.mutate();
  };

  const saveButton = (
    <Button type="submit" form="reminder-settings" disabled={save.isPending || !settings.data}>
      {save.isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Save className="mr-2 h-4 w-4" />
      )}
      Save
    </Button>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Follow-up reminders</CardTitle>
            <CardDescription>
              A timer starts when a ticket gets a technician or an opportunity gets an assignee;
              that person is reminded at these lengths until it is closed. Nothing is timed, and
              nobody is reminded, while an item has no person on it. Changes apply to timers started
              from now on.
            </CardDescription>
          </div>
          {saveButton}
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
              className="divide-y"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Section
                title="Opportunities"
                help="Won, Lost or No response ends the timer; taking the assignee off stops the reminders."
              >
                <Row>
                  Timer starts when someone is assigned. Due at the expected close,{" "}
                  {field("opportunity_close_days")} days after it is entered unless a date is set.
                </Row>
                <Row>
                  Remind the assignee {field("opportunity_first_days")} days after assignment (never
                  later than the due date), then every {field("opportunity_every_days")} days until
                  it is won, lost or closed.
                </Row>
              </Section>

              <Section
                title="Tickets"
                help="Done, Invoiced or Closed ends the timer; taking the technician off stops the reminders."
              >
                <Row>
                  Timer starts when a technician is assigned. A scheduled ticket is due on its day:
                  remind the technician that day, then every {field("ticket_every_days")} days until
                  it is Done.
                </Row>
                <Row>
                  An unscheduled ticket is due {field("ticket_first_days")} days after assignment:
                  remind the technician then, and again every {draft.ticket_every_days} days until
                  it is Done.
                </Row>
              </Section>

              <Section
                title="Needs assignment"
                help="Nobody is reminded while a ticket or opportunity has no person on it — there is no timer until someone is assigned."
              >
                <Row>
                  It sits under Unassigned on Work Overview and is flagged overdue there after{" "}
                  {daysFields("unassigned")} days (0 = the day it is entered).
                </Row>
              </Section>

              <Section
                title="Untouched work"
                help="Assigned, but no contact logged and not started. Past the limit it turns red in the lists; the assignee is reminded as above, and the people below are told as well — right away, then again at the ticket's or opportunity's “every N days” above — until a contact is logged or it is started."
              >
                <Row>
                  A ticket counts as untouched after {field("ticket_untouched_days")} days with no
                  contact; an opportunity after {field("opportunity_untouched_days")} days.
                </Row>
                <Row>
                  <Switch
                    checked={draft.escalate_to_admins}
                    onCheckedChange={(v) => setDraft((d) => ({ ...d, escalate_to_admins: v }))}
                    aria-label="Escalate untouched items to every admin and manager"
                  />
                  <span>Escalate untouched items to every admin and manager</span>
                </Row>
                <Row>
                  <span className="text-muted-foreground">Also escalate to</span>
                  {users.error ? (
                    <span className="text-xs text-destructive">
                      Could not load the users: {errText(users.error)}
                    </span>
                  ) : !users.data ? (
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the users…
                    </span>
                  ) : userOptions.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No users to pick.</span>
                  ) : (
                    userOptions.map((u) => {
                      const on = draft.escalate_user_ids.includes(u.id);
                      return (
                        <Button
                          key={u.id}
                          type="button"
                          size="sm"
                          variant={on ? "default" : "outline"}
                          className="h-7 rounded-full px-3 text-xs"
                          aria-pressed={on}
                          onClick={() => toggleEscalate(u.id)}
                        >
                          {u.name}
                        </Button>
                      );
                    })
                  )}
                </Row>
              </Section>
              <div className="flex justify-end pt-4">{saveButton}</div>
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
            <p className="text-sm">
              Last run from here: {run.data.ran ? "ran" : "skipped (ran under 10 minutes ago)"} ·{" "}
              {run.data.reminded} reminded
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
                <dt className="text-muted-foreground">Last reminder pass</dt>
                <dd>
                  {health.data.last_dispatch_at ? whenTime(health.data.last_dispatch_at) : "Never"}
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** One setting group: its name and help on the left, its sentences on the right. */
function Section(props: { title: string; help?: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-2 py-4 first:pt-0 sm:grid-cols-[11rem_1fr] lg:grid-cols-[15rem_1fr]">
      <div className="space-y-1">
        <p className="text-sm font-semibold">{props.title}</p>
        {props.help && <p className="text-xs text-muted-foreground">{props.help}</p>}
      </div>
      <div className="space-y-2">{props.children}</div>
    </div>
  );
}

/** A sentence with number boxes in it. */
function Row(props: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">{props.children}</div>
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
        max={365}
        inputMode="numeric"
        invalid={props.invalid}
        className="h-8 text-center"
        blankZero={false}
        onChange={(v) => props.onChange(Math.round(v))}
      />
    </span>
  );
}
