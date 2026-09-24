import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Legacy frmLaborPopUp (Underlayment / Tear-off / section labor links), read from the program
 * itself (txtChange_TextChanged, txtAdjust_Leave, CalcChangedTotal, get_AdjustLabor):
 *
 *   Calculated Man Hours   the base, read-only
 *   Change Hours           the NEW TOTAL hours (not a delta): base × Adjust / 100, 2 dp
 *   Adjust Labor (%)       100-based: 100 = as calculated, 158 = 58 % more; whole number
 *
 * Typing in either box rewrites the other; what is stored is Round(Adjust) − 100. Each box
 * keeps its own text while it has focus, so a half-typed number is never overwritten (the
 * "editing the hours changes other things" report, Sep 24). "There is no labor or none of it
 * is adjustable." when the selection has no base hours (legacy message).
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
  /** The stored adjustment: ± percent of the base (0 = as calculated). */
  pct: number;
  onPct: (pct: number) => void;
  /** Kept for the call sites; the pop-up always works in whole percents, as legacy does. */
  integerPct?: boolean | undefined;
  onFinish: () => void;
  templateDefault?: { pct: number; onUse: () => void } | undefined;
}) {
  const { baseHours: base, pct } = props;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const total = r2(base * (1 + pct / 100));
  const percent100 = Math.round(100 + pct);
  // Each box owns its text while focused; null = show the value.
  const [hoursText, setHoursText] = useState<string | null>(null);
  const [pctText, setPctText] = useState<string | null>(null);
  useEffect(() => {
    if (!props.open) {
      setHoursText(null);
      setPctText(null);
    }
  }, [props.open]);
  // Stored value from a 100-based percent: whole, never below 0 % of the base.
  const commitPercent = (p: number) => props.onPct(Math.max(-100, Math.round(p) - 100));
  const commitTotal = (h: number) => {
    if (base <= 0) return;
    commitPercent((Math.max(0, h) / base) * 100);
  };
  const parse = (raw: string): number | null => {
    const t = raw.trim();
    if (t === "" || t === "-" || t === "." || t === "-." || /\.$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <p className="text-muted-foreground">
            {props.scope}. Type the new total hours, or the percent of the calculated hours (100 =
            as calculated) — the other follows.
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
              <div className="grid grid-cols-1 gap-3">
                <label className="block">
                  <span className="mb-1 block text-muted-foreground">Calculated Man Hours</span>
                  <Input value={base.toFixed(2)} readOnly disabled />
                </label>
                <label className="block">
                  <span className="mb-1 block text-muted-foreground">
                    Change Hours (the new total)
                  </span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className="h-8"
                    value={hoursText ?? total.toFixed(2)}
                    onFocus={(e) => {
                      setHoursText(total.toFixed(2));
                      e.currentTarget.select();
                    }}
                    onChange={(e) => {
                      setHoursText(e.target.value);
                      const n = parse(e.target.value);
                      if (n !== null) commitTotal(n);
                    }}
                    onBlur={() => setHoursText(null)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-muted-foreground">
                    Adjust Labor (% of calculated; 100 = as calculated)
                  </span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step="1"
                    className="h-8"
                    value={pctText ?? String(percent100)}
                    onFocus={(e) => {
                      setPctText(String(percent100));
                      e.currentTarget.select();
                    }}
                    onChange={(e) => {
                      setPctText(e.target.value);
                      const n = parse(e.target.value);
                      if (n !== null) commitPercent(n);
                    }}
                    onBlur={() => setPctText(null)}
                  />
                </label>
                <p className="text-muted-foreground">
                  {total.toFixed(2)} h = {base.toFixed(2)} h × {percent100}%
                  {pct !== 0 ? ` (${pct > 0 ? "+" : ""}${r2(total - base).toFixed(2)} h)` : ""}
                </p>
              </div>
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          {props.templateDefault && (
            <Button variant="outline" onClick={props.templateDefault.onUse}>
              Use template default ({100 + props.templateDefault.pct}%)
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
