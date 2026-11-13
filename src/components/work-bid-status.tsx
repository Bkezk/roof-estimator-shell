/**
 * A bid row's status on Work Overview (owner, Nov 13: "have the bid status be able to be updated
 * on the work overview page like how you can assign unassigned jobs on tickets"): the Bids
 * page's select, compact like the "Assign to…" beside it, and the Bids page's "When was it won?"
 * question (routes/bids.tsx; the Lost one is components/lost-reason-dialog.tsx). The rules are
 * pure in lib/my-work-actions.ts; components/my-work-actions.tsx owns the server call.
 */
import type { BidStatus } from "@/lib/bid-status";
import { BID_STATUS_CHOICES } from "@/lib/my-work-actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The row's select: it shows the bid's status and a pick is handed on at once. */
export function BidStatusSelect({
  label,
  value,
  disabled,
  onPick,
}: {
  label: string;
  value: BidStatus;
  disabled: boolean;
  onPick: (status: BidStatus) => void;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        if (v && v !== value) onPick(v as BidStatus);
      }}
    >
      <SelectTrigger className="h-8 w-32 text-xs" aria-label={label} data-select="bid-status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {BID_STATUS_CHOICES.map((c) => (
          <SelectItem key={c.value} value={c.value}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "When was it won?" — the Bids page's question, word for word. */
export function BidWonDialog({
  bidName,
  day,
  busy,
  onDay,
  onCancel,
  onConfirm,
}: {
  bidName: string;
  day: string;
  busy: boolean;
  onDay: (day: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-sm" data-dialog="bid-won">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm();
          }}
        >
          <DialogHeader>
            <DialogTitle>When was it won?</DialogTitle>
            <DialogDescription>
              {bidName} is being marked Won. The Margin report counts it on this day; it can be
              changed later in the report or in the estimator.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 py-3">
            <Label htmlFor="bid-won-on-work">Won on</Label>
            <Input
              id="bid-won-on-work"
              type="date"
              autoFocus
              value={day}
              onChange={(e) => onDay(e.target.value)}
              className="w-[11rem]"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Mark won
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
