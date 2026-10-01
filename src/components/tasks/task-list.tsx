/**
 * Upcoming open tasks grouped Overdue / Today / This week / Later (bucketTasks in tasks.ts).
 * Tick a task done in place; tap it to open the dialog.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import {
  bucketTasks,
  TASK_BUCKET_LABELS,
  type TaskBucket,
  type TaskInput,
  type TaskRow,
} from "@/lib/tasks";
import { listTasks, setTaskStatus, userLabel } from "@/lib/tasks.functions";
import { TaskDialog } from "@/components/tasks/task-dialog";
import {
  TASKS_KEY,
  taskSubline,
  useInvalidateTasks,
  useTaskUsers,
} from "@/components/tasks/task-shared";
import { Checkbox } from "@/components/ui/checkbox";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ORDER: TaskBucket[] = ["overdue", "today", "week", "later"];

export function TaskList(props: {
  /** Only tasks I am on (admins and managers otherwise see everyone's). */
  mine?: boolean | undefined;
  /** Prefill for tasks made from here. */
  defaults?: Partial<TaskInput> | undefined;
  emptyText?: string | undefined;
}) {
  const listFn = useServerFn(listTasks);
  const q = useQuery({
    queryKey: [...TASKS_KEY, "open", { mine: !!props.mine }],
    queryFn: () => listFn({ data: { openOnly: true, mine: !!props.mine } }),
  });
  const usersQ = useTaskUsers();
  const nameOf = (id: string | null) =>
    id ? userLabel((usersQ.data ?? []).find((u) => u.id === id)) || null : null;
  const invalidate = useInvalidateTasks();
  const statusFn = useServerFn(setTaskStatus);
  const toggle = useMutation({
    mutationFn: (v: { id: string; status: "open" | "done" }) => statusFn({ data: v }),
    onSuccess: (row) => {
      if (row.status === "done") toast.success(`Done: ${row.title}`);
      invalidate();
    },
    onError: (e) => toast.error(errText(e)),
  });
  const [editing, setEditing] = useState<TaskRow | null>(null);

  if (q.error)
    return <p className="text-sm text-destructive">Could not load tasks: {errText(q.error)}</p>;
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading tasks…</p>;
  const groups = bucketTasks(q.data ?? [], new Date());
  const total = ORDER.reduce((n, b) => n + groups[b].length, 0);

  return (
    <div className="space-y-3">
      {total === 0 && (
        <p className="text-sm text-muted-foreground">{props.emptyText ?? "No open tasks."}</p>
      )}
      {ORDER.filter((b) => groups[b].length).map((b) => (
        <section key={b}>
          <h4
            className={`mb-1 text-xs font-semibold uppercase tracking-wide ${
              b === "overdue" ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {TASK_BUCKET_LABELS[b]} ({groups[b].length})
          </h4>
          <ul className="divide-y rounded-md border">
            {groups[b].map((t) => (
              <li key={t.id} className="flex items-start gap-2 px-2 py-2">
                <Checkbox
                  className="mt-0.5"
                  aria-label={`Mark “${t.title}” done`}
                  checked={t.status === "done"}
                  disabled={toggle.isPending}
                  onCheckedChange={(v) =>
                    toggle.mutate({ id: t.id, status: v === true ? "done" : "open" })
                  }
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setEditing(t)}
                >
                  <span className="block text-sm font-medium">{t.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {taskSubline(t, nameOf(t.assignee))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <TaskDialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        task={editing ?? undefined}
        defaults={props.defaults}
      />
    </div>
  );
}
