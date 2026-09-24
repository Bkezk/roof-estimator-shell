/**
 * "Why was this bid lost?" — asked whenever a bid's status becomes Lost, on the Bids list and
 * inside a bid. Seeded reasons plus free text; "Not known" is an honest answer.
 */
import { useState } from "react";

import { LOST_REASONS } from "@/lib/bid-status";
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

export function LostReasonDialog(props: {
  open: boolean;
  bidName: string;
  initial?: string | null;
  onCancel: () => void;
  /** `reason` is null when not known. */
  onConfirm: (reason: string | null) => void;
}) {
  const seeded = (LOST_REASONS as readonly string[]).find((r) => r === props.initial);
  const [choice, setChoice] = useState<string>(seeded ?? (props.initial ? "Other" : "Price"));
  const [other, setOther] = useState(seeded || !props.initial ? "" : props.initial);
  const reason = choice === "Other" ? other.trim() || null : choice;
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Why was it lost?</DialogTitle>
          <DialogDescription>
            {props.bidName} is being marked Lost. The reason, if known, shows on the bid and helps
            see patterns later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Reason</Label>
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOST_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {choice === "Other" && (
            <div className="space-y-1">
              <Label>What happened</Label>
              <Input
                autoFocus
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder="A few words"
              />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => props.onConfirm(null)}>
            Not known
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={props.onCancel}>
              Cancel
            </Button>
            <Button onClick={() => props.onConfirm(reason)}>Mark lost</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
