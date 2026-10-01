/**
 * The follow-up controls (moved here from the old Follow-ups page, owner, Oct 1): the Snooze menu
 * (next reminder in 1 / 3 / 7 days) and the Close dialog (optional reason). My Work and the
 * opportunity page's follow-up strip render them only for admins and managers (seesEveryone);
 * the mutations and the other helpers live in followups-shared.ts.
 */
import { useState } from "react";
import { AlarmClockOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SnoozeMenu(props: {
  disabled?: boolean;
  onSnooze: (days: number) => void;
  size?: "sm" | "default";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={props.size ?? "sm"} disabled={props.disabled}>
          <AlarmClockOff className="mr-1 h-4 w-4" /> Snooze
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Next reminder in
        </DropdownMenuLabel>
        {[1, 3, 7].map((d) => (
          <DropdownMenuItem key={d} onSelect={() => props.onSnooze(d)}>
            {d} day{d === 1 ? "" : "s"}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
