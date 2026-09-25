/**
 * Asks the real length of the two points just clicked with the Scale tool (feet + inches), and
 * whether the same scale goes to every page of the file that has none yet (a plan set's sheets
 * share one size and usually one scale).
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";

export function ScaleDialog(props: {
  open: boolean;
  /** The clicked line's length in page px (shown so a mis-click is obvious). */
  pixels: number;
  /** Pages in the file, and how many other pages have no scale yet. */
  pageCount: number;
  unscaledOtherPages: number;
  onCancel: () => void;
  onSave: (feet: number, applyToAll: boolean) => void;
}) {
  const [ft, setFt] = useState(0);
  const [inch, setInch] = useState(0);
  const multi = props.pageCount > 1;
  const [applyAll, setApplyAll] = useState(multi);
  // Each time the dialog opens: on by default when the file has more than one page.
  useEffect(() => {
    if (props.open) setApplyAll(multi);
  }, [props.open, multi]);
  const total = ft + inch / 12;
  const cancel = () => {
    setFt(0);
    setInch(0);
    props.onCancel();
  };
  const submit = () => {
    if (!(total > 0)) return;
    props.onSave(total, multi && applyAll);
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
          {multi && (
            <label className="col-span-2 flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={applyAll}
                onCheckedChange={(c) => setApplyAll(c === true)}
              />
              <span>
                Apply this scale to every page of this file that has no scale yet
                <span className="block text-xs text-muted-foreground">
                  {props.unscaledOtherPages === 0
                    ? "Every other page already has its own scale; they are left alone."
                    : `${props.unscaledOtherPages} other page${props.unscaledOtherPages === 1 ? "" : "s"} without a scale. Pages that already have one are left alone.`}
                </span>
              </span>
            </label>
          )}
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
