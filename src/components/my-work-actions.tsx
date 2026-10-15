/**
 * Work Overview's row actions (owner, Oct 15) — the wiring to the server functions; the rules
 * (who may, what a drop or a pick does) are pure in lib/my-work-actions.ts. One hook gives the
 * page everything a row needs:
 *
 *   - openTask: a task row opens in the TaskDialog (getTask fetches the whole row).
 *   - markDone: the row's Done tick (setTaskStatus), with an Undo on the toast that reopens it.
 *   - move: a ticket or a task dropped on another calendar day (assignServiceJob with its
 *     technician unchanged / moveTaskDate).
 *   - assign: the "Assign to…" select on an Unassigned row (assignServiceJob / assignTask /
 *     assignOpportunity); its roster loads the first time a select of that kind opens.
 *
 * Every change invalidates ["my-work"] and toasts; an error toasts the server's message.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { listTechnicians, type UserProfile } from "@/lib/auth.functions";
import type { WorkItem } from "@/lib/my-work";
import {
  assignKind,
  assignPlan,
  canEditWorkTask,
  canMoveWork,
  dropPlan,
  monthDay,
  taskOpensInPlace,
  workId,
  type AssignKind,
  type AssignPlan,
  type DropPlan,
} from "@/lib/my-work-actions";
import { assignOpportunity, listAssigneeOptions } from "@/lib/opportunities.functions";
import { assignServiceJob } from "@/lib/service.functions";
import type { TaskRow } from "@/lib/tasks";
import {
  assignTask,
  getTask,
  listAssignableUsers,
  moveTaskDate,
  setTaskStatus,
  userLabel,
} from "@/lib/tasks.functions";
import { AssignSelect, type AssignOption as Option } from "@/components/work-assign-select";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What a row (and the calendar) can do; every callback already knows the viewer. */
export interface WorkActions {
  /** Does this row open in place (taskOpensInPlace)? A task — unless nobody's and not the viewer's to take or assign. */
  opensInPlace: (item: WorkItem) => boolean;
  /** Open a task row in place (the TaskDialog). */
  openTask: (item: WorkItem) => void;
  /** May the viewer tick this task Done (canEditWorkTask)? */
  canEditTask: (item: WorkItem) => boolean;
  /** The Done tick: mark the task done; the toast's Undo reopens it. */
  markDone: (item: WorkItem) => void;
  /** The "Assign to…" select for an Unassigned row; null when the viewer may not assign it. */
  assign: (item: WorkItem) => ReactNode;
  /** May the viewer drag this row onto another calendar day? */
  movable: (item: WorkItem) => boolean;
  /** A drop on another day: reschedule (nothing on the same day or without permission). */
  move: (item: WorkItem, day: string) => void;
  /** Is a change to this row in flight? */
  busy: (item: WorkItem) => boolean;
}

export function useWorkActions(profile: UserProfile | null): {
  actions: WorkActions;
  /** The task open in place, for the page's edit TaskDialog. */
  editTask: TaskRow | null;
  closeTask: () => void;
} {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["my-work"] });

  // Open in place: the row carries only what the list shows; the dialog needs the whole task.
  const getTaskFn = useServerFn(getTask);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const open = useMutation({
    mutationFn: (id: string) => getTaskFn({ data: { id } }),
    onSuccess: (row) => setEditTask(row),
    onError: (e) => toast.error(errText(e) || "Could not open the task"),
  });

  // The Done tick (owner, Oct 15: no confirm; the toast's Undo sets it back to open).
  const statusFn = useServerFn(setTaskStatus);
  const status = useMutation({
    mutationFn: (v: { id: string; status: "open" | "done" }) => statusFn({ data: v }),
    onSuccess: (_r, v) => {
      if (v.status === "done")
        toast.success("Task done", {
          action: { label: "Undo", onClick: () => status.mutate({ id: v.id, status: "open" }) },
        });
      else toast.success("Task reopened");
      invalidate();
    },
    onError: (e) => toast.error(errText(e) || "Could not change the task"),
  });

  // A drop on another calendar day: a ticket keeps its technician (a date-only move stays
  // Scheduled and is logged on the ticket), a task keeps its time of day.
  const assignTicketFn = useServerFn(assignServiceJob);
  const moveTaskFn = useServerFn(moveTaskDate);
  const move = useMutation({
    mutationFn: async (plan: DropPlan) => {
      if (plan.kind === "ticket")
        await assignTicketFn({
          data: { id: plan.id, technician_id: plan.technicianId, scheduled_date: plan.date },
        });
      else await moveTaskFn({ data: { id: plan.id, date: plan.date } });
    },
    onSuccess: (_r, plan) => {
      toast.success(`Moved to ${monthDay(plan.date)}`);
      invalidate();
    },
    onError: (e) => toast.error(errText(e) || "Could not move it"),
  });

  // "Assign to…" on an Unassigned row.
  const assignTaskFn = useServerFn(assignTask);
  const assignOppFn = useServerFn(assignOpportunity);
  const assign = useMutation({
    mutationFn: async (v: AssignPlan & { name: string }) => {
      // expect_unassigned (Oct 15): the ticket must still be nobody's at the write, or the
      // server answers "Someone already has it" — two dispatchers cannot both hand it out.
      if (v.kind === "ticket")
        await assignTicketFn({
          data: {
            id: v.id,
            technician_id: v.technicianId,
            scheduled_date: v.date,
            expect_unassigned: true,
          },
        });
      else if (v.kind === "task") await assignTaskFn({ data: { id: v.id, assignee: v.assignee } });
      else await assignOppFn({ data: { id: v.id, assignee_id: v.assignee } });
    },
    onSuccess: (_r, v) => {
      toast.success(`Assigned to ${v.name}`);
      invalidate();
    },
    onError: (e) => toast.error(errText(e) || "Could not assign it"),
  });

  // The rosters, loaded the first time a select of that kind opens (not for a page that never
  // shows one): technicians for tickets, assignable users for tasks, the CRM's users for
  // opportunities (each the roster its own page uses).
  const [wanted, setWanted] = useState<AssignKind[]>([]);
  const want = (k: AssignKind) => setWanted((w) => (w.includes(k) ? w : [...w, k]));
  const techFn = useServerFn(listTechnicians);
  const usersFn = useServerFn(listAssignableUsers);
  const oppUsersFn = useServerFn(listAssigneeOptions);
  const techs = useQuery({
    queryKey: ["work-roster", "technicians"],
    queryFn: () => techFn(),
    enabled: wanted.includes("ticket"),
    staleTime: 5 * 60_000,
    select: (rows): Option[] => rows.map((r) => ({ id: r.id, name: r.name })),
  });
  const users = useQuery({
    // The TaskDialog's roster key (task-shared.ts useTaskUsers): one load serves both.
    queryKey: ["task-users"],
    queryFn: () => usersFn(),
    enabled: wanted.includes("task"),
    staleTime: 5 * 60_000,
    select: (rows): Option[] => rows.map((u) => ({ id: u.id, name: userLabel(u) || u.id })),
  });
  const oppUsers = useQuery({
    queryKey: ["work-roster", "opportunity"],
    queryFn: () => oppUsersFn(),
    enabled: wanted.includes("opportunity"),
    staleTime: 5 * 60_000,
    select: (rows): Option[] => rows,
  });
  const rosters = { ticket: techs, task: users, opportunity: oppUsers } as const;

  const pendingIds = new Set<string>(
    [
      open.isPending ? open.variables : null,
      status.isPending ? status.variables?.id : null,
      move.isPending ? move.variables?.id : null,
      assign.isPending ? assign.variables?.id : null,
    ].filter((x): x is string => !!x),
  );

  const actions: WorkActions = {
    opensInPlace: (item) => taskOpensInPlace(item, profile),
    openTask: (item) => open.mutate(workId(item)),
    canEditTask: (item) => canEditWorkTask(item, profile),
    markDone: (item) => status.mutate({ id: workId(item), status: "done" }),
    assign: (item) => {
      const kind = assignKind(item, profile);
      if (!kind) return null;
      const q = rosters[kind];
      return (
        <AssignSelect
          label={`Assign ${item.title} to`}
          roster={q.data ?? []}
          loading={q.isLoading}
          error={q.error ? errText(q.error) : null}
          disabled={pendingIds.has(workId(item))}
          onOpen={() => want(kind)}
          onPick={(id) => {
            const plan = assignPlan(item, id, profile);
            if (!plan) return;
            const name = (q.data ?? []).find((o) => o.id === id)?.name ?? "them";
            assign.mutate({ ...plan, name });
          }}
        />
      );
    },
    movable: (item) => canMoveWork(item, profile),
    move: (item, day) => {
      const plan = dropPlan(item, day, profile);
      if (plan) move.mutate(plan);
    },
    busy: (item) => pendingIds.has(workId(item)),
  };

  return { actions, editTask, closeTask: () => setEditTask(null) };
}
