/** Asks the real length of the two points just clicked with the Scale tool (feet + inches). */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";

export function ScaleDialog(props: {
  open: boolean;
  /** The clicked line's length in page px (shown so a mis-click is obvious). */
  pixels: number;
  onCancel: () => void;
  onSave: (feet: number) => void;
}) {
  const [ft, setFt] = useState(0);
  const [inch, setInch] = useState(0);
  const total = ft + inch / 12;
  const cancel = () => {
    setFt(0);
    setInch(0);
    props.onCancel();
  };
  const submit = () => {
    if (!(total > 0)) return;
    props.onSave(total);
    setFt(0);
    setInch(0);
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (!o) cancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Set the page scale</DialogTitle>
          <DialogDescription>
            How long is the line you just picked ({Math.round(props.pixels)} px on screen)? Pick a
            dimension of 20 ft or more for accuracy.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Feet</Label>
            <NumberField value={ft} onChange={setFt} step="any" inputMode="decimal" autoFocus />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Inches</Label>
            <NumberField
              value={inch}
              onChange={setInch}
              step="any"
              max={11.99}
              inputMode="decimal"
            />
          </div>
          <DialogFooter className="col-span-2 mt-2">
            <Button type="button" variant="outline" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!(total > 0)}>
              Set scale
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
