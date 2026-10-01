/**
 * A month of tasks (owner, Sep 30: "due date on calendar"). Each day shows its tasks (a count
 * on a phone); tap a day for that day's tasks and "New task" on it; tap a task to open it.
 * Days are Eastern (tasks.ts TASK_TZ), so a 9 PM task never slides to the next day.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import {
  addDaysYmd,
  isAllDay,
  localHm,
  localYmd,
  taskDueAt,
  taskDueYmd,
  type TaskInput,
  type TaskRow,
} from "@/lib/tasks";
import { listTasks, userLabel } from "@/lib/tasks.functions";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { TASKS_KEY, taskSubline, useTaskUsers } from "@/components/tasks/task-shared";
import { Button } from "@/components/ui/button";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
};
const dayLabel = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric",
  });
};
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return t.toISOString().slice(0, 7);
};
/** "2:30 PM" for a timed task, "" for an all-day one. */
const timeText = (t: TaskRow) => {
  const at = taskDueAt(t);
  if (!at || isAllDay(t)) return "";
  const [h, mi] = localHm(at).split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function TaskCalendar(props: {
  /** Only tasks I am on (admins and managers otherwise see everyone's). */
  mine?: boolean | undefined;
  /** Prefill for tasks made from here (the day picked is added). */
  defaults?: Partial<TaskInput> | undefined;
}) {
  const today = localYmd(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(today);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [creating, setCreating] = useState(false);

  // Whole weeks covering the month.
  const first = `${month}-01`;
  const gridStart = addDaysYmd(first, -weekday(first));
  const lastOfMonth = addDaysYmd(`${shiftMonth(month, 1)}-01`, -1);
  const gridEnd = addDaysYmd(lastOfMonth, 6 - weekday(lastOfMonth));
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDaysYmd(d, 1)) out.push(d);
    return out;
  }, [gridStart, gridEnd]);

  const listFn = useServerFn(listTasks);
  const q = useQuery({
    queryKey: [...TASKS_KEY, "range", gridStart, gridEnd, { mine: !!props.mine }],
    queryFn: () => listFn({ data: { from: gridStart, to: gridEnd, mine: !!props.mine } }),
  });
  const usersQ = useTaskUsers();
  const nameOf = (id: string | null) =>
    id ? userLabel((usersQ.data ?? []).find((u) => u.id === id)) || null : null;

  const byDay = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const t of q.data ?? []) {
      const d = taskDueYmd(t);
      if (!d) continue;
      m.set(d, [...(m.get(d) ?? []), t]);
    }
    for (const list of m.values())
      list.sort((a, b) => (taskDueAt(a)?.getTime() ?? 0) - (taskDueAt(b)?.getTime() ?? 0));
    return m;
  }, [q.data]);
  const dayTasks = day ? (byDay.get(day) ?? []) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Previous month"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{monthLabel(month)}</span>
          {month !== today.slice(0, 7) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
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
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Next month"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {q.error && (
        <p className="text-sm text-destructive">Could not load tasks: {errText(q.error)}</p>
      )}
      <div className="grid grid-cols-7 overflow-hidden rounded-md border text-xs">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="border-b bg-muted/50 px-1 py-1 text-center font-medium text-muted-foreground"
          >
            {w}
          </div>
        ))}
        {days.map((d, i) => {
          const list = byDay.get(d) ?? [];
          const open = list.filter((t) => t.status !== "done");
          const inMonth = d.startsWith(month);
          const late = d < today && open.length > 0;
          return (
            <button
              key={d}
              type="button"
              aria-label={`${dayLabel(d)}: ${list.length} task${list.length === 1 ? "" : "s"}`}
              aria-pressed={day === d}
              onClick={() => setDay(d)}
              className={`flex min-h-12 flex-col items-stretch gap-0.5 p-1 text-left sm:min-h-20 ${
                i % 7 ? "border-l" : ""
              } ${i >= 7 ? "border-t" : ""} ${inMonth ? "" : "bg-muted/30 text-muted-foreground"} ${
                day === d ? "ring-2 ring-inset ring-primary" : "hover:bg-accent/50"
              }`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center self-start rounded-full ${
                  d === today ? "bg-primary font-semibold text-primary-foreground" : ""
                }`}
              >
                {Number(d.slice(8))}
              </span>
              {/* Phone: a count; wider screens: the first titles. */}
              {list.length > 0 && (
                <span
                  className={`rounded px-1 text-[10px] font-medium sm:hidden ${
                    late ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary"
                  }`}
                >
                  {list.length}
                </span>
              )}
              {list.slice(0, 2).map((t) => (
                <span
                  key={t.id}
                  className={`hidden truncate rounded px-1 sm:block ${
                    t.status === "done"
                      ? "text-muted-foreground line-through"
                      : late
                        ? "bg-destructive/10 text-destructive"
                        : "bg-primary/10"
                  }`}
                >
                  {timeText(t) ? `${timeText(t)} ` : ""}
                  {t.title}
                </span>
              ))}
              {list.length > 2 && (
                <span className="hidden px-1 text-muted-foreground sm:block">
                  +{list.length - 2} more
                </span>
              )}
            </button>
          );
        })}
      </div>

      {day && (
        <div className="space-y-2 rounded-md border p-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{dayLabel(day)}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-4 w-4" /> New task
            </Button>
          </div>
          {dayTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing on this day.</p>
          ) : (
            <ul className="divide-y">
              {dayTasks.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="w-full py-1.5 text-left"
                    onClick={() => setEditing(t)}
                  >
                    <span
                      className={`block text-sm ${
                        t.status === "done" ? "text-muted-foreground line-through" : "font-medium"
                      }`}
                    >
                      {t.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {taskSubline(t, nameOf(t.assignee))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <TaskDialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        task={editing ?? undefined}
      />
      <TaskDialog
        open={creating}
        onOpenChange={setCreating}
        defaults={{ ...(props.defaults ?? {}), date: day }}
      />
    </div>
  );
}
