/**
 * Work Overview's row actions (owner, Oct 15) — the wiring to the server functions; the rules
 * (who may, what a drop or a pick does) are pure in lib/my-work-actions.ts. One hook gives the
 * page everything a row needs:
 *
 *   - openTask: a task row opens in the TaskDialog (getTask fetches the whole row).
 *   - markDone: the row's Done tick (setTaskStatus), with an Undo on the toast that reopens it.
 *   - move: a ticket or a task dropped on another calendar day (assignServiceJob with its
 *     technician unchanged / moveTaskDate); the toast says when the ticket's hold ended with it.
 *   - assign: the "Assign to…" select on an Unassigned row (assignServiceJob / assignTask /
 *     assignOpportunity); its roster loads the first time a select of that kind opens.
 *   - assignOn / assignDialog (owner, Oct 20): an Unassigned row dropped on a calendar day by
 *     someone who may assign it but not Claim it (lib/my-work-actions.ts dropAssigns) opens a
 *     small dialog — "Assign <title> for <Mon, Oct 22>", the same person select, Assign — and the
 *     pick runs the same assign mutation with that day (assignPlan's day override: the ticket is
 *     scheduled for it, the task is due on it, the opportunity's expected close becomes it where
 *     the viewer may move that date, else the toast says it stayed). Cancel writes nothing.
 *
 * Every change invalidates ["my-work"] and toasts; an error toasts the server's message and
 * invalidates too (Oct 20: a failed move or assignment left the row as the stale list had it;
 * Oct 21: so did a failed open or Done tick — "Task not found" on every click for five minutes).
 * A move also carries the technician the row showed (Oct 21, expect_technician_id): a ticket
 * reassigned or finished since the last refresh is refused with TICKET_CHANGED, not handed back.
 * Oct 21 (the eighth audit): and the day it showed (expect_scheduled_date — a drop from a stale
 * page wrote its day over one somebody had just moved), and a task's content stamp
 * (expect_content_updated_at — a task ticked Done in between was still moved, TASK_CHANGED now).
 * A row whose move is in flight is not draggable and a second drop on it is ignored
 * (lib/my-work-actions.ts canStartMove): one move, one toast.
 */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { listTechnicians, type UserProfile } from "@/lib/auth.functions";
import { shortDay } from "@/lib/followup-rules";
import type { WorkItem } from "@/lib/my-work";
import {
  assignKind,
  assignPlan,
  assignedToast,
  assignedToastExtra,
  canEditWorkTask,
  canMoveWork,
  canStartMove,
  dropAssigns,
  dropPlan,
  monthDay,
  movedToast,
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  /** Is THIS row's Done tick in flight (the tick shows ticked meanwhile; Oct 20: not for any other change)? */
  markingDone: (item: WorkItem) => boolean;
  /** The "Assign to…" select for an Unassigned row; null when the viewer may not assign it. */
  assign: (item: WorkItem) => ReactNode;
  /**
   * Does a drop of this Unassigned row on a calendar day open the assign dialog (Oct 20: the
   * viewer may assign it but not Claim it — dropAssigns)? The pane drags the row when so.
   */
  dropAssigns: (item: WorkItem) => boolean;
  /** The drop itself: open the dialog for that day (nothing when the viewer may not assign it). */
  assignOn: (item: WorkItem, day: string) => void;
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
  /** The assign-for-a-day dialog (Oct 20), for the page to render once. */
  assignDialog: ReactNode;
} {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["my-work"] });

  // Open in place: the row carries only what the list shows; the dialog needs the whole task.
  const getTaskFn = useServerFn(getTask);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const open = useMutation({
    mutationFn: (id: string) => getTaskFn({ data: { id } }),
    onSuccess: (row) => setEditTask(row),
    // Oct 21: a task deleted or reassigned elsewhere kept answering "Task not found" on every
    // click until the five-minute refresh — the row is stale, so the list is refetched too.
    onError: (e) => {
      toast.error(errText(e) || "Could not open the task");
      invalidate();
    },
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
    // The same (Oct 21): a failed tick means the row is not what the list showed.
    onError: (e) => {
      toast.error(errText(e) || "Could not change the task");
      invalidate();
    },
  });

  // A drop on another calendar day: a ticket keeps its technician (a date-only move stays
  // Scheduled and is logged on the ticket), a task keeps its time of day.
  const assignTicketFn = useServerFn(assignServiceJob);
  const moveTaskFn = useServerFn(moveTaskDate);
  const move = useMutation({
    /** Resolves to whether the ticket's follow-up hold ended with the move (a task: never). */
    mutationFn: async (plan: DropPlan): Promise<boolean> => {
      if (plan.kind === "ticket") {
        // expect_technician_id (Oct 21): the technician the row showed, whom the server must
        // still find on the ticket — a row gone stale (reassigned or finished since the last
        // refresh) is refused with TICKET_CHANGED instead of handing the ticket back. And the
        // day it showed (expect_scheduled_date, the eighth audit): the same refusal for a ticket
        // somebody moved in between, instead of moving it back.
        const r = await assignTicketFn({
          data: {
            id: plan.id,
            technician_id: plan.technicianId,
            scheduled_date: plan.date,
            expect_technician_id: plan.expectTechnicianId,
            expect_scheduled_date: plan.expectDate,
          },
        });
        return !!r.snooze_cleared;
      }
      // The task's content stamp as listed (Oct 21): a task changed or ticked Done in between is
      // refused with TASK_CHANGED (toasted below) instead of moved.
      await moveTaskFn({
        data: { id: plan.id, date: plan.date, expect_content_updated_at: plan.expectStamp },
      });
      return false;
    },
    onSuccess: (snoozeCleared, plan) => {
      toast.success(movedToast(plan.date, snoozeCleared));
      invalidate();
    },
    // The row is stale either way (Oct 20; Oct 21: TICKET_CHANGED says so): the list is refetched.
    onError: (e) => {
      toast.error(errText(e) || "Could not move it");
      invalidate();
    },
  });

  // "Assign to…" on an Unassigned row, or the dialog's Assign (Oct 20: with the dropped day).
  const assignTaskFn = useServerFn(assignTask);
  const assignOppFn = useServerFn(assignOpportunity);
  const assign = useMutation({
    /** Resolves to the expected close an opportunity KEPT when the viewer may not move it. */
    mutationFn: async (
      v: AssignPlan & { name: string; day: string | null },
    ): Promise<string | null> => {
      // expect_unassigned (Oct 15): the ticket must still be nobody's at the write, or the
      // server answers "Someone already has it" — two dispatchers cannot both hand it out.
      if (v.kind === "ticket") {
        await assignTicketFn({
          data: {
            id: v.id,
            technician_id: v.technicianId,
            scheduled_date: v.date,
            expect_unassigned: true,
          },
        });
        return null;
      }
      if (v.kind === "task") {
        await assignTaskFn({ data: { id: v.id, assignee: v.assignee, date: v.date ?? null } });
        return null;
      }
      const r = await assignOppFn({
        data: { id: v.id, assignee_id: v.assignee, date: v.date ?? null },
      });
      return r.dateKept || v.dateKept ? (r.expected_close ?? null) : null;
    },
    onSuccess: (kept, v) => {
      // Oct 20: a dispatcher without the tick loses sight of the ticket (Work Overview lists only
      // their own) — the toast says it is on the Service board, with an Open action to it.
      const extra = assignedToastExtra(profile, v);
      toast.success(
        assignedToast(v.name, v.day, kept),
        extra
          ? {
              description: extra.description,
              action: {
                label: extra.action.label,
                onClick: () => void navigate({ href: extra.action.href }),
              },
            }
          : undefined,
      );
      invalidate();
    },
    // "Someone already has it" or any other refusal: the row is stale, so the list is refetched
    // (Oct 20; the claim's onError on the page has done the same since Oct 15).
    onError: (e) => {
      toast.error(errText(e) || "Could not assign it");
      invalidate();
    },
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

  // The assign-for-a-day dialog (Oct 20): the row dropped on a day, and the person picked so far.
  const [drop, setDrop] = useState<{ item: WorkItem; day: string } | null>(null);
  const [picked, setPicked] = useState("");
  const dropKind = drop ? assignKind(drop.item, profile) : null;
  const dropPlanned = drop && dropKind ? assignPlan(drop.item, picked, profile, drop.day) : null;
  const closeDrop = () => {
    setDrop(null);
    setPicked("");
  };
  const assignDialog = (
    <Dialog
      open={!!drop && !!dropKind}
      onOpenChange={(o) => {
        if (!o) closeDrop();
      }}
    >
      {drop && dropKind && (
        <DialogContent className="sm:max-w-md" data-dialog="assign-day">
          <DialogHeader>
            <DialogTitle>
              Assign {drop.item.title} for {shortDay(drop.day)}
            </DialogTitle>
            <DialogDescription>
              {dropKind === "ticket"
                ? "They get the ticket, scheduled for that day."
                : dropKind === "task"
                  ? "They get the task, due that day."
                  : dropPlanned?.kind === "opportunity" && dropPlanned.dateKept && drop.item.date
                    ? `They get the opportunity; its expected close stays ${monthDay(drop.item.date)} — only a manager moves it.`
                    : "They get the opportunity, with that day as its expected close."}
            </DialogDescription>
          </DialogHeader>
          <AssignSelect
            label={`Assign ${drop.item.title} to`}
            roster={rosters[dropKind].data ?? []}
            loading={rosters[dropKind].isLoading}
            error={rosters[dropKind].error ? errText(rosters[dropKind].error) : null}
            disabled={assign.isPending}
            value={picked}
            onOpen={() => want(dropKind)}
            onPick={setPicked}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDrop}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!dropPlanned || assign.isPending}
              onClick={() => {
                if (!dropPlanned) return;
                const name =
                  (rosters[dropKind].data ?? []).find((o) => o.id === picked)?.name ?? "them";
                assign.mutate({ ...dropPlanned, name, day: drop.day });
                closeDrop();
              }}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );

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
    markingDone: (item) =>
      status.isPending &&
      status.variables?.status === "done" &&
      status.variables.id === workId(item),
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
            assign.mutate({ ...plan, name, day: null });
          }}
        />
      );
    },
    dropAssigns: (item) => dropAssigns(item, profile),
    assignOn: (item, day) => {
      if (!assignKind(item, profile)) return;
      setPicked("");
      setDrop({ item, day });
    },
    // Not while a change to the row is in flight (Oct 21, canStartMove): the cell is not
    // draggable, and a drop that slipped through before the re-render sends nothing.
    movable: (item) => canMoveWork(item, profile) && canStartMove(pendingIds, workId(item)),
    move: (item, day) => {
      if (!canStartMove(pendingIds, workId(item))) return;
      const plan = dropPlan(item, day, profile);
      if (plan) move.mutate(plan);
    },
    busy: (item) => pendingIds.has(workId(item)),
  };

  return { actions, editTask, closeTask: () => setEditTask(null), assignDialog };
}
