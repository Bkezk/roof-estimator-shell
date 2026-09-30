/**
 * Asks the real length of the two points just clicked with the Scale tool (feet + inches), and
 * whether the same scale goes to every page of the file that has none yet (a plan set's sheets
 * share one size and usually one scale).
 *
 * Scale notes read off the sheet (./sheet-scale) show here too: when this page's scale was read
 * from the sheet the dialog says so (and that drawing a scale replaces it), and the notes found
 * on the sheet are offered as one-click choices — the only way a sheet with several different
 * scales gets one, since those are never set automatically. Opened with no line drawn
 * (`pixels` null) it only offers those choices.
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

import { sheetScaleMessage } from "./sheet-scale";

export function ScaleDialog(props: {
  open: boolean;
  /** The clicked line's length in page px (shown so a mis-click is obvious); null = no line. */
  pixels: number | null;
  /** Pages in the file, and how many other pages have no scale yet. */
  pageCount: number;
  unscaledOtherPages: number;
  onCancel: () => void;
  onSave: (feet: number, applyToAll: boolean) => void;
  /** This page's scale when it was read from the sheet: its note, and a sheet-size warning. */
  sheetScale?: { note: string; warning: string | null } | null;
  /** Scale notes found on this sheet, offered as choices. */
  sheetChoices?: ReadonlyArray<{ text: string }>;
  /** Use the sheet note at this index of `sheetChoices` as the page's scale. */
  onUseSheetNote?: (index: number) => void;
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
  const drawn = props.pixels !== null;
  const choices = props.sheetChoices ?? [];
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
  const sheetNotes = choices.length > 0 && props.onUseSheetNote && (
    <div className="col-span-2 space-y-1.5 rounded-md border p-2">
      <p className="text-xs text-muted-foreground">
        {drawn
          ? "Or use a scale note read from this sheet:"
          : `This sheet has ${choices.length} different scale notes, so none was set on its own. Pick the one for the drawing you are measuring:`}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((c, i) => (
          <Button
            key={`${c.text}-${i}`}
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => props.onUseSheetNote?.(i)}
          >
            {c.text}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        A scale read from the sheet is marked as such — check it against a printed dimension.
      </p>
    </div>
  );
  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (!o) cancel();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{drawn ? "Set the page scale" : "Pick the sheet's scale"}</DialogTitle>
          <DialogDescription>
            {drawn
              ? `How long is the line you just picked (${Math.round(props.pixels ?? 0)} px on screen)? Pick a dimension of 20 ft or more for accuracy.`
              : "Or close this and draw the scale with Scale (S) on a known dimension."}
          </DialogDescription>
        </DialogHeader>
        {props.sheetScale && (
          <div className="rounded-md bg-sky-100 px-2 py-1.5 text-xs text-sky-900 dark:bg-sky-900/60 dark:text-sky-100">
            <p className="font-medium">{sheetScaleMessage(props.sheetScale.note)}.</p>
            {props.sheetScale.warning && <p className="mt-0.5">{props.sheetScale.warning}</p>}
            {drawn && <p className="mt-0.5">Setting a scale here replaces it.</p>}
          </div>
        )}
        {drawn ? (
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
            {sheetNotes}
            <DialogFooter className="col-span-2 mt-2">
              <Button type="button" variant="outline" onClick={cancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={!(total > 0)}>
                Set scale
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {sheetNotes}
            <DialogFooter className="col-span-2 mt-2">
              <Button type="button" variant="outline" onClick={cancel}>
                Cancel
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
