/**
 * What the task components share: the query key, the user roster, the refresh after a change,
 * and the one-line summary under a task's title.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { taskWhenText, type TaskRow } from "@/lib/tasks";
import { listAssignableUsers } from "@/lib/tasks.functions";

/** Every task query starts with this key; a save invalidates them all. */
export const TASKS_KEY = ["tasks"] as const;

/** The user roster for the assignee and attendee pickers and for names in lists. */
export function useTaskUsers() {
  const fn = useServerFn(listAssignableUsers);
  return useQuery({ queryKey: ["task-users"], queryFn: () => fn(), staleTime: 5 * 60_000 });
}

/** Refresh every list a task shows up in (the calendar, the list, a building's tasks). */
export function useInvalidateTasks() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: TASKS_KEY });
    void qc.invalidateQueries({ queryKey: ["open-tasks"] });
    void qc.invalidateQueries({ queryKey: ["building"] });
  };
}

/** One line under a task's title: when, company / property, who it is assigned to. */
export function taskSubline(t: TaskRow, assigneeName?: string | null): string {
  return [
    t.due_at || t.due_date ? taskWhenText(t) : null,
    t.account_name,
    t.site_name,
    assigneeName ? `→ ${assigneeName}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
