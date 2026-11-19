/**
 * "Were the drains and scuppers cleaned?" on a Roof Care plan's inspection (owner, Nov 19; the
 * rules are cleaning-gate.ts and lib/roof-care-cleaning.ts). Each question is Yes or No with a
 * thumb-sized button; a tap saves at once; a No asks why in the one box under them and saves
 * with the reason. The office sees who answered and when.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { loudError, whenShort } from "@/components/service/field-utils";
import {
  CLEANING_KEYS,
  CLEANING_QUESTION,
  CLEANING_WHY_LABEL,
  roofCareCleaningKey,
  type CleaningKey,
  type VisitCleaning,
} from "@/lib/roof-care-cleaning";
import { setRoofCareCleaning } from "@/lib/roof-care-cleaning.functions";
import { planName } from "@/lib/roof-care-plan";
import {
  CLEANING_LOADING,
  CLEANING_NOT_SAVED,
  CLEANING_PENDING_NOTE,
  CLEANING_UNREAD,
  cleaningNos,
  cleaningReason,
  cleaningShown,
  cleaningTap,
  type CleaningGate,
  type CleaningSend,
} from "./cleaning-gate";

export function CleaningQuestions({
  gate,
  locked,
  office,
  onRetryRead,
}: {
  gate: CleaningGate;
  /** The ticket is past where this person may change it: the answers show, the buttons do not act. */
  locked: boolean;
  /** Who answered and when is the office's line. */
  office: boolean;
  onRetryRead: () => void;
}) {
  if (gate.kind === "none") return null;
  if (gate.kind === "loading")
    return (
      <p
        className="flex items-center gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground"
        data-cleaning="loading"
      >
        <Loader2 className="h-4 w-4 animate-spin" /> {CLEANING_LOADING}…
      </p>
    );
  if (gate.kind === "unread")
    return (
      <div
        className="space-y-2 rounded-xl border-2 border-destructive/50 p-3"
        data-cleaning="unread"
      >
        <p className="text-sm font-medium text-destructive">
          {CLEANING_UNREAD}: {gate.message}
        </p>
        <Button type="button" variant="outline" className="h-11" onClick={onRetryRead}>
          <RefreshCw className="mr-2 h-4 w-4" /> Try again
        </Button>
      </div>
    );
  return <Asked cleaning={gate.cleaning} open={gate.open.length} locked={locked} office={office} />;
}

function Asked({
  cleaning: c,
  open,
  locked,
  office,
}: {
  cleaning: VisitCleaning;
  open: number;
  locked: boolean;
  office: boolean;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(setRoofCareCleaning);
  // A No that was tapped and waits for its reason: on this screen only, saved with the reason.
  const [pendingNo, setPendingNo] = useState<CleaningKey[]>([]);
  const [typed, setTyped] = useState(c.note ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  // What the last failed save was sending, for the Try again under the questions.
  const [failed, setFailed] = useState<CleaningSend | null>(null);
  // The reason as the server holds it, when it changes under us (another device answered).
  useEffect(() => {
    setTyped(c.note ?? "");
  }, [c.note]);
  const save = useMutation({
    mutationFn: (send: CleaningSend) => saveFn({ data: { visit_id: c.visit_id, ...send } }),
    onSuccess: (now) => {
      setFailed(null);
      qc.setQueryData(roofCareCleaningKey(c.visit_id), now);
      // The plan's own tally of what was cleaned reads the same inspections.
      void qc.invalidateQueries({ queryKey: ["roof-care-plans"] });
    },
    onError: (e, send) => {
      setFailed(send);
      loudError(CLEANING_NOT_SAVED, e, () => save.mutate(send));
    },
  });
  const tap = (key: CleaningKey, yes: boolean) => {
    const r = cleaningTap(c, pendingNo, key, yes, typed);
    setPendingNo(r.pendingNo);
    setProblem(null);
    if (r.send) save.mutate(r.send);
  };
  const saveReason = () => {
    const r = cleaningReason(c, pendingNo, typed);
    setProblem(r.problem);
    if (!r.send) return;
    setPendingNo([]);
    save.mutate(r.send);
  };
  const nos = cleaningNos(c, pendingNo);
  const busy = save.isPending;
  return (
    <div
      className="space-y-3 rounded-xl border-2 border-[var(--jbk-blue)]/50 p-3"
      data-cleaning="asked"
      data-cleaning-open={open}
    >
      <p className="font-semibold">Included in the {planName(c.plan)} plan at this inspection</p>
      {CLEANING_KEYS.filter((k) => c.asked[k]).map((k) => {
        const shown = cleaningShown(c, pendingNo, k);
        return (
          <div key={k} className="space-y-1.5" data-cleaning-q={k} data-cleaning-answer={shown}>
            <p className="text-base">{CLEANING_QUESTION[k]}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={shown === "yes" ? "default" : "outline"}
                className="h-14 text-base font-semibold"
                aria-pressed={shown === "yes"}
                disabled={locked || busy}
                onClick={() => tap(k, true)}
                data-cleaning-yes
              >
                Yes
              </Button>
              <Button
                type="button"
                variant={shown === "no" || shown === "pending" ? "default" : "outline"}
                className="h-14 text-base font-semibold"
                aria-pressed={shown === "no" || shown === "pending"}
                disabled={locked || busy}
                onClick={() => tap(k, false)}
                data-cleaning-no
              >
                No
              </Button>
            </div>
            {shown === "pending" && (
              <p className="text-sm text-amber-700 dark:text-amber-400">{CLEANING_PENDING_NOTE}</p>
            )}
          </div>
        );
      })}
      {nos.length > 0 && (
        <div className="space-y-1.5" data-cleaning-why>
          <Label htmlFor={`cleaning-why-${c.visit_id}`}>{CLEANING_WHY_LABEL}</Label>
          <Textarea
            id={`cleaning-why-${c.visit_id}`}
            rows={2}
            maxLength={300}
            className="text-base"
            value={typed}
            disabled={locked}
            onChange={(e) => {
              setTyped(e.target.value);
              setProblem(null);
            }}
            onBlur={saveReason}
          />
          {(pendingNo.length > 0 || typed.trim() !== (c.note ?? "").trim()) && (
            <Button
              type="button"
              className="h-11"
              disabled={locked || busy}
              onClick={saveReason}
              data-action="cleaning-save-why"
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save the reason
            </Button>
          )}
          {problem && <p className="text-sm font-medium text-destructive">{problem}</p>}
        </div>
      )}
      {failed && !busy && (
        <div className="flex flex-wrap items-center gap-2" data-cleaning-failed>
          <p className="text-sm font-medium text-destructive">{CLEANING_NOT_SAVED}.</p>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => save.mutate(failed)}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Try again
          </Button>
        </div>
      )}
      {office && c.at && (
        <p className="text-xs text-muted-foreground" data-cleaning-by>
          Answered by {(c.by_name ?? "").trim() || "someone"}, {whenShort(c.at)}
        </p>
      )}
    </div>
  );
}
