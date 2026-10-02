/**
 * How each step of the stage stepper (components/stage-strip.tsx) is drawn. Pure, so it is
 * unit tested without React.
 *
 * Audit, Oct 2: the stepper marked every dated step as reached, so a ticket that went Done and
 * then back to Scheduled (ticket #6003) showed Done filled as if it were still reached. Now the
 * position decides: steps before the current one are filled when they were entered (dated); the
 * current one is the ringed primary dot; steps after it are hollow and muted even when they carry
 * a date — the date is still shown, muted, so the history stays visible. With no current step
 * (an unknown stage) every dated step reads as reached, as before.
 */
import type { StripCell } from "@/lib/stage-dates";

export type StepState = "reached" | "current" | "ahead";

export interface StepLook {
  state: StepState;
  /** The dot. */
  dot: string;
  /** The connector after the step (to the next one). */
  line: string;
  /** The label beneath. */
  label: string;
  /** The date beneath (muted always; lighter for a step ahead). */
  date: string;
}

export const DOT_CURRENT = "bg-primary ring-2 ring-primary ring-offset-2 ring-offset-background";
export const DOT_REACHED = "bg-foreground/60";
export const DOT_AHEAD = "border border-muted-foreground/40 bg-background";
export const LINE_REACHED = "bg-foreground/40";
export const LINE_AHEAD = "bg-border";
export const LABEL_CURRENT = "font-semibold";
export const LABEL_REACHED = "font-medium";
export const LABEL_AHEAD = "text-muted-foreground";
export const DATE_SHOWN = "text-muted-foreground";
export const DATE_AHEAD = "text-muted-foreground/60";

/** Each cell's state and classes, in order. */
export function stepLooks(cells: readonly StripCell[]): StepLook[] {
  const cur = cells.findIndex((c) => c.current);
  return cells.map((c, i) => {
    const state: StepState =
      i === cur
        ? "current"
        : cur === -1
          ? c.at
            ? "reached"
            : "ahead"
          : i < cur
            ? "reached"
            : "ahead";
    // Before the current step but never entered (skipped): hollow, though the line runs on.
    const filled = state === "reached" && !!c.at;
    const lineOn = cur === -1 ? filled : i < cur;
    return {
      state,
      dot: state === "current" ? DOT_CURRENT : filled ? DOT_REACHED : DOT_AHEAD,
      line: lineOn ? LINE_REACHED : LINE_AHEAD,
      label: state === "current" ? LABEL_CURRENT : filled ? LABEL_REACHED : LABEL_AHEAD,
      date: state === "ahead" ? DATE_AHEAD : DATE_SHOWN,
    };
  });
}
