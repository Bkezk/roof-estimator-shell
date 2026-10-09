/**
 * The follow-up controls (moved here from the old Follow-ups page, owner, Oct 1): the Snooze
 * popover and the Close dialog (optional reason). Work Overview and the opportunity page's
 * follow-up strip render them only for admins and managers (seesEveryone); the mutations and the
 * other helpers live in followups-shared.ts.
 *
 * Snooze (owner, Oct 9) is a hold with a date and a reason, not "N days": presets 1 week / 2
 * weeks / 1 month, or "Until a date" (tomorrow through 180 days out), and a required reason
 * (1..200 characters, e.g. "Customer asked to call back after the 15th"). The reminders pause
 * until 08:00 Eastern that day; the row moves to Waiting and says why (lib/followup-holds.ts).
 */
import { useState } from "react";
import { AlarmClockOff, Loader2 } from "lucide-react";

import {
  HOLD_PRESETS,
  HOLD_REASON_MAX,
  holdDateBounds,
  holdDateProblem,
  holdReasonProblem,
} from "@/lib/followup-holds";
import { shortDay } from "@/lib/followup-rules";
import { addDays, localYmd } from "@/lib/my-work";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

/** What a snooze sends: the hold's last quiet day (YYYY-MM-DD) and why. */
export interface SnoozeHold {
  until: string;
  reason: string;
}

export function SnoozeMenu(props: {
  disabled?: boolean;
  onSnooze: (hold: SnoozeHold) => void;
  size?: "sm" | "default";
  /** The viewer's day (YYYY-MM-DD); today by default. */
  today?: string;
}) {
  const today = props.today ?? localYmd(new Date());
  const { min, max } = holdDateBounds(today);
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const dateProblem = until ? holdDateProblem(until, today) : null;
  const ready = !!until && !dateProblem && !holdReasonProblem(reason);
  const reset = () => {
    setUntil("");
    setReason("");
  };
  const submit = () => {
    if (!ready) return;
    props.onSnooze({ until, reason: reason.trim() });
    setOpen(false);
    reset();
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size={props.size ?? "sm"} disabled={props.disabled}>
          <AlarmClockOff className="mr-1 h-4 w-4" /> Snooze
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3" aria-label="Snooze until">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            submit();
          }}
        >
          <div className="space-y-1">
            <p className="text-sm font-medium">Put this follow-up on hold</p>
            <p className="text-xs text-muted-foreground">
              Reminders pause until the morning of that day; the item waits under “Waiting”.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Presets">
            {HOLD_PRESETS.map((p) => {
              const day = addDays(today, p.days);
              const on = until === day;
              return (
                <Button
                  key={p.label}
                  type="button"
                  size="sm"
                  variant={on ? "default" : "outline"}
                  className="h-8"
                  aria-pressed={on}
                  title={`Until ${shortDay(day)}`}
                  onClick={() => setUntil(day)}
                >
                  {p.label}
                </Button>
              );
            })}
          </div>
          <div className="space-y-1">
            <Label htmlFor="followup-hold-until">Until a date</Label>
            <Input
              id="followup-hold-until"
              type="date"
              value={until}
              min={min}
              max={max}
              onChange={(e) => setUntil(e.target.value)}
            />
            {dateProblem ? (
              <p className="text-xs text-destructive">{dateProblem}</p>
            ) : until ? (
              <p className="text-xs text-muted-foreground">Back on {shortDay(until)}.</p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="followup-hold-reason">Reason</Label>
            <Textarea
              id="followup-hold-reason"
              rows={2}
              value={reason}
              maxLength={HOLD_REASON_MAX}
              required
              placeholder="e.g. Customer asked to call back after the 15th"
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Required. It shows on the row and on the item’s timeline.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!ready}>
              Put on hold
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Close a follow-up by hand with an optional reason. `target` null = closed dialog. */
export function CloseFollowupDialog(props: {
  target: { id: string; title: string } | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={!!props.target}
      onOpenChange={(o) => {
        if (!o && !props.pending) {
          setReason("");
          props.onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Close this follow-up?</DialogTitle>
          <DialogDescription>
            Reminders for “{props.target?.title}” stop. The item itself keeps its status.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onConfirm(reason.trim());
            setReason("");
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="followup-close-reason">Reason (optional)</Label>
            <Input
              id="followup-close-reason"
              value={reason}
              maxLength={200}
              autoFocus
              placeholder="e.g. Spoke with the customer, no longer needed"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={props.pending}
              onClick={() => {
                setReason("");
                props.onCancel();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={props.pending}>
              {props.pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Close follow-up
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
