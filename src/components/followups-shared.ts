/**
 * Follow-up helpers shared by the Follow-ups page and the opportunity page's follow-up strip:
 * the list's query key, date formats, and the snooze / close mutations (toasts included).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

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

/** Snooze and close, shared by this page and the opportunity page. */
export function useFollowupActions() {
  const qc = useQueryClient();
  const snoozeFn = useServerFn(snoozeFollowup);
  const closeFn = useServerFn(closeFollowup);
  const snooze = useMutation({
    mutationFn: (v: { id: string; days: number }) => snoozeFn({ data: v }),
    onSuccess: (_r, v) => {
      toast.success(`Snoozed: next reminder in ${v.days} day${v.days === 1 ? "" : "s"}`);
      void qc.invalidateQueries({ queryKey: ["followups"] });
    },
    onError: (e) => toast.error(`Could not snooze the follow-up: ${errText(e)}`),
  });
  const close = useMutation({
    mutationFn: (v: { id: string; reason?: string }) => closeFn({ data: v }),
    onSuccess: () => {
      toast.success("Follow-up closed");
      void qc.invalidateQueries({ queryKey: ["followups"] });
    },
    onError: (e) => toast.error(`Could not close the follow-up: ${errText(e)}`),
  });
  return { snooze, close };
}
