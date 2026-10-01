/**
 * My Work (owner, Sep 30): the signed-in person's own tickets (as lead technician), open tasks
 * and open follow-ups in one list, grouped Overdue / Today / This week / Later / No date (a Done
 * ticket last, never overdue), or on a month calendar where a click on a day lists that day.
 * Every signed-in user lands here. Admins and managers also get a "Show" picker (Mine /
 * Everyone / one person); the server returns only the caller's own items to anyone else.
 *
 * Each row links to the ticket, the task's building or the follow-up's item. The Follow-ups page
 * is folded in here (owner, Oct 1): a ticket, opportunity or follow-up row shows its follow-up
 * state (Due / Overdue N days / Snoozed until / Reminders every N days). Snooze and Close are
 * for admins and managers only (seesEveryone; the server and the database refuse anyone else);
 * everyone else sees the state with one line saying their manager manages follow-ups. The rules
 * (merge, sort, buckets, calendar grid, scoping) are pure in src/lib/my-work.ts, the follow-up
 * state in src/lib/followup-rules.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  List,
  ListTodo,
  Loader2,
  Plus,
  Users,
  X,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { isAdmin, seesEveryone } from "@/lib/access";
import { followupStateText } from "@/lib/followup-rules";
import { listMyWork } from "@/lib/my-work.functions";
import {
  KIND_LABELS,
  addMonths,
  groupWork,
  itemsByDay,
  localYmd,
  mergeWork,
  monthGrid,
  compareWork,
  presetGroups,
  ymdParts,
  BUCKET_LABELS,
  type BucketPreset,
  type WorkFollowup,
  type WorkItem,
  type WorkKind,
} from "@/lib/my-work";
import { effectiveView, type MyWorkView } from "@/lib/owner-view";
import { CloseFollowupDialog, SnoozeMenu } from "@/components/followup-controls";
import { useFollowupActions } from "@/components/followups-shared";
import { OwnerView } from "@/components/owner-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskDialog } from "@/components/tasks/task-dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const KIND_CLASS: Record<WorkKind, string> = {
  ticket:
    "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
  inspection:
    "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200",
  task: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  followup:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};
const KIND_DOT: Record<WorkKind, string> = {
  ticket: "bg-blue-500",
  inspection: "bg-violet-500",
  task: "bg-amber-500",
  followup: "bg-emerald-500",
};

/** "Wed, Sep 30" for a YYYY-MM-DD day (read as a calendar day, no time zone shift). */
const dayLabel = (ymd: string) => {
  const [y, m, d] = ymdParts(ymd);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};
const monthLabel = (month: string) => {
  const [y, m] = ymdParts(month);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

/** Snooze / Close for one row's follow-up: admins and managers only (null for everyone else). */
type ManageFollowup = (f: WorkFollowup) => React.ReactNode;

/** A row's follow-up state: "Overdue 3 days · Snoozed until Fri, Oct 3 · Reminders every 3 days". */
function FollowupState({ f, today }: { f: WorkFollowup; today: string }) {
  const parts = followupStateText(f, today);
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
      {parts.map((p, i) => (
        <span
          key={p.text}
          className={
            p.tone === "overdue" ? "font-medium text-destructive" : "text-muted-foreground"
          }
        >
          {i > 0 && <span className="mr-2 text-muted-foreground">·</span>}
          {p.text}
        </span>
      ))}
    </div>
  );
}

/**
 * One item: type badge, title, customer / property, date, status (and whose, when not mine), the
 * follow-up state, and — for admins and managers — Snooze / Close under the link.
 */
function WorkRow({
  item,
  showWho,
  today,
  manage,
}: {
  item: WorkItem;
  showWho: boolean;
  today: string;
  manage: ManageFollowup | null;
}) {
  const navigate = useNavigate();
  const f = item.followup && item.followup.status === "open" ? item.followup : null;
  return (
    <div
      className={`rounded-lg border bg-card transition-colors hover:bg-muted/50 ${
        item.done ? "opacity-70" : ""
      }`}
    >
      <a
        href={item.href}
        className="block p-3"
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          void navigate({ href: item.href });
        }}
      >
        <div className="flex items-start gap-2">
          <Badge variant="outline" className={`shrink-0 ${KIND_CLASS[item.kind]}`}>
            {KIND_LABELS[item.kind]}
          </Badge>
          <span className="min-w-0 flex-1 break-words font-medium leading-snug">{item.title}</span>
        </div>
        {item.where && (
          <div className="mt-1 break-words text-sm text-muted-foreground">{item.where}</div>
        )}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{item.date ? dayLabel(item.date) : "No date"}</span>
          <span>{item.status}</span>
          {showWho && <span>{item.assigneeName ?? "(unknown)"}</span>}
        </div>
        {f && <FollowupState f={f} today={today} />}
      </a>
      {f && manage && (
        <div className="flex flex-wrap items-center justify-end gap-1 border-t px-3 py-2">
          {manage(f)}
        </div>
      )}
    </div>
  );
}

function ListView({
  items,
  today,
  showWho,
  manage,
  preset,
  onClearPreset,
}: {
  items: WorkItem[];
  today: string;
  showWho: boolean;
  manage: ManageFollowup | null;
  /** ?bucket=today|overdue: only that group (the Owner view's links). */
  preset: BucketPreset | null;
  onClearPreset: () => void;
}) {
  const groups = useMemo(
    () => presetGroups(groupWork(items, today), preset),
    [items, today, preset],
  );
  return (
    <div className="space-y-6">
      {preset && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            Showing {BUCKET_LABELS[preset]} only
            {groups.length === 0
              ? ` — nothing ${preset === "today" ? "due today" : "overdue"}.`
              : "."}
          </span>
          <Button size="sm" variant="outline" onClick={onClearPreset}>
            <X className="h-4 w-4" /> Show all
          </Button>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.bucket} className="space-y-2">
          <h2
            className={`text-sm font-semibold ${g.bucket === "overdue" ? "text-destructive" : ""}`}
          >
            {g.label} <span className="font-normal text-muted-foreground">({g.items.length})</span>
          </h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {g.items.map((it) => (
              <WorkRow key={it.key} item={it} showWho={showWho} today={today} manage={manage} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CalendarView({
  items,
  today,
  showWho,
  manage,
}: {
  items: WorkItem[];
  today: string;
  showWho: boolean;
  manage: ManageFollowup | null;
}) {
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [day, setDay] = useState(today);
  const byDay = useMemo(() => itemsByDay(items), [items]);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const dayItems = useMemo(() => [...(byDay.get(day) ?? [])].sort(compareWork), [byDay, day]);
  const undated = items.filter((i) => !i.date).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous month"
          onClick={() => setMonth((m) => addMonths(m, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <span className="font-semibold">{monthLabel(month)}</span>
          {(month !== today.slice(0, 7) || day !== today) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMonth(today.slice(0, 7));
                setDay(today);
              }}
            >
              Today
            </Button>
          )}
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next month"
          onClick={() => setMonth((m) => addMonths(m, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="py-1.5">
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b last:border-b-0">
            {week.map((d) => {
              const list = byDay.get(d) ?? [];
              const inMonth = d.slice(0, 7) === month;
              const overdue = d < today && list.some((i) => !i.done);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDay(d)}
                  aria-pressed={d === day}
                  aria-label={`${dayLabel(d)}: ${list.length} item${list.length === 1 ? "" : "s"}`}
                  className={`flex min-h-14 flex-col items-stretch gap-1 border-r p-1 text-left last:border-r-0 sm:min-h-24 ${
                    inMonth ? "" : "bg-muted/30 text-muted-foreground"
                  } ${d === day ? "bg-primary/10 ring-2 ring-inset ring-primary" : "hover:bg-muted/50"}`}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-xs ${
                      d === today ? "bg-primary font-semibold text-primary-foreground" : ""
                    } ${overdue && d !== today ? "text-destructive" : ""}`}
                  >
                    {Number(d.slice(8))}
                  </span>
                  {/* Phone: coloured dots; wider screens: the first titles. */}
                  {list.length > 0 && (
                    <>
                      <span className="flex flex-wrap gap-0.5 sm:hidden">
                        {list.slice(0, 4).map((i) => (
                          <span
                            key={i.key}
                            className={`h-1.5 w-1.5 rounded-full ${KIND_DOT[i.kind]}`}
                          />
                        ))}
                        {list.length > 4 && (
                          <span className="text-[10px] leading-none">+{list.length - 4}</span>
                        )}
                      </span>
                      <span className="hidden flex-col gap-0.5 sm:flex">
                        {list.slice(0, 2).map((i) => (
                          <span
                            key={i.key}
                            className={`truncate rounded px-1 text-[11px] leading-4 ${KIND_CLASS[i.kind]} ${
                              i.done ? "opacity-60" : ""
                            }`}
                          >
                            {i.title}
                          </span>
                        ))}
                        {list.length > 2 && (
                          <span className="text-[11px] text-muted-foreground">
                            +{list.length - 2} more
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          {dayLabel(day)}{" "}
          <span className="font-normal text-muted-foreground">({dayItems.length})</span>
        </h2>
        {dayItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing on this day.</p>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {dayItems.map((it) => (
              <WorkRow key={it.key} item={it} showWho={showWho} today={today} manage={manage} />
            ))}
          </div>
        )}
        {undated > 0 && (
          <p className="text-xs text-muted-foreground">
            {undated} item{undated === 1 ? " has" : "s have"} no date — see the List.
          </p>
        )}
      </section>
    </div>
  );
}

export function MyWorkPage(props: {
  view: MyWorkView;
  who: string;
  bucket: BucketPreset | null;
  onView: (v: MyWorkView) => void;
  onWho: (who: string) => void;
  onBucket: (b: BucketPreset | null) => void;
}) {
  const { session, profile } = useAuth();
  const qc = useQueryClient();
  const [newTask, setNewTask] = useState(false);
  // ?view=owner is honoured for admins only; anyone else gets the list.
  const view = effectiveView(props.view, profile);
  // The Owner toggle: admins only (the server's listOwnerView refuses anyone else too).
  const ownerToggle = isAdmin(profile);
  const listFn = useServerFn(listMyWork);
  const q = useQuery({
    queryKey: ["my-work", props.who],
    queryFn: () => listFn({ data: { who: props.who } }),
    enabled: !!session && view !== "owner",
  });

  // Errors toast the server's message (and stay on the page until the next try).
  const errMsg = q.error ? errText(q.error) : null;
  useEffect(() => {
    if (errMsg) toast.error(`Could not load your work: ${errMsg}`);
  }, [errMsg]);

  const items = useMemo(() => (q.data ? mergeWork(q.data) : []), [q.data]);
  const today = localYmd(new Date());

  // Follow-ups are management's (owner, Oct 1): Snooze / Close only under seesEveryone (admin or
  // manager); the server (canManageFollowup) and the database trigger refuse anyone else.
  const canManage = seesEveryone(profile);
  const { snooze, close } = useFollowupActions();
  const [closing, setClosing] = useState<WorkFollowup | null>(null);
  const manage: ManageFollowup | null = canManage
    ? (f) => {
        const busy =
          (snooze.isPending && snooze.variables?.id === f.id) ||
          (close.isPending && close.variables?.id === f.id);
        return (
          <>
            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <SnoozeMenu disabled={busy} onSnooze={(days) => snooze.mutate({ id: f.id, days })} />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setClosing(f)}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> Close
            </Button>
          </>
        );
      }
    : null;
  const hasFollowups = items.some((i) => i.followup?.status === "open");
  const canPick = !!q.data?.canPick;
  const scope = q.data?.scope;
  const mineOnly = scope !== "all" && scope?.length === 1 && scope[0] === profile?.id;
  const showWho = !!scope && !mineOnly;
  const people = q.data?.people ?? [];
  const whoName =
    props.who === "all"
      ? "Everyone"
      : props.who === "mine"
        ? null
        : (people.find((p) => p.id === props.who)?.name ?? null);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ListTodo className="h-6 w-6" /> My Work
        </h1>
        <p className="text-sm text-muted-foreground">
          {view === "owner"
            ? "Everyone: what is due today, what is overdue, what got done this week."
            : mineOnly || !scope
              ? "Your tickets, tasks and follow-ups, by date."
              : `${whoName ?? "Someone else"}: tickets, tasks and follow-ups, by date.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setNewTask(true)}>
          <Plus className="h-4 w-4" /> New task
        </Button>
        <TaskDialog
          open={newTask}
          onOpenChange={setNewTask}
          onSaved={() => void qc.invalidateQueries({ queryKey: ["my-work"] })}
        />
        <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="View">
          <Button
            size="sm"
            variant={view === "list" ? "default" : "ghost"}
            aria-pressed={view === "list"}
            onClick={() => props.onView("list")}
          >
            <List className="h-4 w-4" /> List
          </Button>
          <Button
            size="sm"
            variant={view === "calendar" ? "default" : "ghost"}
            aria-pressed={view === "calendar"}
            onClick={() => props.onView("calendar")}
          >
            <CalendarDays className="h-4 w-4" /> Calendar
          </Button>
          {ownerToggle && (
            <Button
              size="sm"
              variant={view === "owner" ? "default" : "ghost"}
              aria-pressed={view === "owner"}
              onClick={() => props.onView("owner")}
            >
              <Users className="h-4 w-4" /> Owner
            </Button>
          )}
        </div>
        {canPick && view !== "owner" && (
          <Select value={props.who} onValueChange={props.onWho}>
            <SelectTrigger className="h-9 w-[220px]" aria-label="Show">
              <span className="mr-1 text-muted-foreground">Show:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">Mine</SelectItem>
              <SelectItem value="all">Everyone</SelectItem>
              {people.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>One person</SelectLabel>
                    {people
                      .filter((p) => p.id !== profile?.id)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          {p.technician ? " (tech)" : ""}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>
        )}
        {q.isFetching && view !== "owner" && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {!canManage && hasFollowups && !errMsg && view !== "owner" && (
        <p className="text-xs text-muted-foreground">Follow-ups are managed by your manager.</p>
      )}

      {view === "owner" && ownerToggle ? (
        <OwnerView />
      ) : q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : errMsg ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">Could not load your work: {errMsg}</p>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </div>
      ) : view === "calendar" ? (
        <CalendarView items={items} today={today} showWho={showWho} manage={manage} />
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing assigned{mineOnly ? " to you" : ""} right now.
        </p>
      ) : (
        <ListView
          items={items}
          today={today}
          showWho={showWho}
          manage={manage}
          preset={props.bucket}
          onClearPreset={() => props.onBucket(null)}
        />
      )}

      {canManage && (
        <CloseFollowupDialog
          target={closing}
          pending={close.isPending}
          onCancel={() => setClosing(null)}
          onConfirm={(reason) => {
            if (!closing) return;
            close.mutate(
              { id: closing.id, ...(reason ? { reason } : {}) },
              { onSuccess: () => setClosing(null) },
            );
          }}
        />
      )}
    </div>
  );
}
