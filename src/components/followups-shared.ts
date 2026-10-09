/**
 * Follow-up helpers shared by Work Overview and the opportunity page's follow-up strip: the list's
 * query key, date formats, and the snooze / close mutations (toasts included). The Snooze menu
 * and the Close dialog are components, in followup-controls.tsx. Snooze and Close are an admin's
 * or a manager's (owner, Oct 1: canManageFollowup in lib/followup-rules.ts; the server refuses
 * anyone else) — callers render them only under `seesEveryone(profile)`.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { shortDay } from "@/lib/followup-rules";
import { closeFollowup, snoozeFollowup } from "@/lib/followups.functions";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The follow-up list's query key; `include_closed` is part of it. */
export const followupsKey = (includeClosed: boolean) => ["followups", includeClosed] as const;

export const whenDay = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
export const whenTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

/** Snooze and close (managers only; errors toast the server's message). */
export function useFollowupActions() {
  const qc = useQueryClient();
  const snoozeFn = useServerFn(snoozeFollowup);
  const closeFn = useServerFn(closeFollowup);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["followups"] });
    void qc.invalidateQueries({ queryKey: ["my-work"] });
  };
  // A snooze is a hold with a date and a reason (owner, Oct 9; followup-controls.tsx SnoozeMenu).
  const snooze = useMutation({
    mutationFn: (v: { id: string; until: string; reason: string }) => snoozeFn({ data: v }),
    onSuccess: (r) => {
      toast.success(`On hold until ${shortDay(r.until)}`);
      refresh();
    },
    onError: (e) => toast.error(`Could not snooze the follow-up: ${errText(e)}`),
  });
  const close = useMutation({
    mutationFn: (v: { id: string; reason?: string }) => closeFn({ data: v }),
    onSuccess: () => {
      toast.success("Follow-up closed");
      refresh();
    },
    onError: (e) => toast.error(`Could not close the follow-up: ${errText(e)}`),
  });
  return { snooze, close };
}
