import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";

/**
 * Legacy frmLaborPopUp (Underlayment / Tear-off / section labor links): Calculated Man Hours,
 * Change Hours (±, editable → % = change ÷ base × 100), Adjust Labor % (editable → change =
 * Round(base × %/100, 2)) and the adjusted total. "There is no labor or none of it is
 * adjustable." when the selection has no base hours (legacy message).
 */
export function LaborAdjustDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What the base hours cover, e.g. "3 selected section(s)". */
  scope: string;
  /** Extra sentence after the scope line. */
  note?: string | undefined;
  baseHours: number;
  /** The selected items already carry different adjustments (legacy warns and refuses). */
  differing: boolean;
  pct: number;
  onPct: (pct: number) => void;
  /** Whole-percent adjust (legacy Convert.ToInt32, e.g. TO_Additional). */
  integerPct?: boolean | undefined;
  onFinish: () => void;
  templateDefault?: { pct: number; onUse: () => void } | undefined;
}) {
  const { baseHours: base, pct } = props;
  const setPct = (p: number) => props.onPct(props.integerPct ? Math.round(p) : p);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <p className="text-muted-foreground">
            {props.scope}. Change the hours or the percent — the other follows.
            {props.note ? ` ${props.note}` : ""}
          </p>
          {base <= 0 ? (
            <p className="text-destructive">There is no labor or none of it is adjustable.</p>
          ) : (
            <>
              {props.differing && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 dark:bg-amber-950/30">
                  Labor adjustments have been made to some of these sections. Finishing here sets
                  every selected section to the same adjustment.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-muted-foreground">Calculated Man Hours</span>
                  <Input value={base.toFixed(2)} readOnly disabled />
                </label>
                <label className="block">
                  <span className="mb-1 block text-muted-foreground">Change Hours (±)</span>
                  <NumberField
                    className="h-8"
                    step="0.01"
                    value={Math.round(base * pct) / 100}
                    onChange={(v) => setPct(Math.round((v / base) * 100 * 100) / 100)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-muted-foreground">Adjust Labor (%)</span>
                  <NumberField
                    className="h-8"
                    min={-100}
                    step="1"
                    value={pct}
                    onChange={(v) => setPct(v)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-muted-foreground">Adjusted Man Hours</span>
                  <Input value={(base * (1 + pct / 100)).toFixed(2)} readOnly disabled />
                </label>
              </div>
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          {props.templateDefault && (
            <Button variant="outline" onClick={props.templateDefault.onUse}>
              Use template default ({props.templateDefault.pct}%)
            </Button>
          )}
          <Button disabled={base <= 0} onClick={props.onFinish}>
            Finished
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
