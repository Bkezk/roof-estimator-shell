import { useState } from "react";

import { Input } from "@/components/ui/input";
import { numberFieldTyped, numberFieldView } from "@/lib/number-field-view";

/**
 * Numeric input backed by a number value. While the field is focused it keeps its own text so
 * the user can clear it, type a leading "-" or a partial decimal; the parent only ever sees a
 * finite, min-clamped number. On focus the current value is selected, so typing replaces a 0
 * instead of appending to it (the "0 will not go away" report).
 */
export function NumberField(props: {
  value: number;
  onChange: (v: number) => void;
  /** Lower clamp (default 0 — quantities and footages are never negative). */
  min?: number | undefined;
  max?: number | undefined;
  step?: string | undefined;
  className?: string | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  title?: string | undefined;
  /**
   * Show an empty box (with the placeholder) instead of "0" while not editing. On by default
   * (owner: number boxes start empty, not 0); pass false where a visible 0 matters.
   */
  blankZero?: boolean | undefined;
  inputMode?: "numeric" | "decimal" | undefined;
  onBlur?: (() => void) | undefined;
  /** Focus (and select) on mount — a freshly added row's first box. */
  autoFocus?: boolean | undefined;
  /**
   * An emptied box means "no value of my own", not 0 (Nov 24, a metals price typed on a bid:
   * emptying the box goes back to the list price, typing 0 is a price of $0). When given, an
   * emptied box calls this instead of onChange(0).
   */
  onBlank?: (() => void) | undefined;
  /** What the box is, for a screen reader, where no label sits beside it. */
  label?: string | undefined;
}) {
  const [text, setText] = useState<string | null>(null);
  const min = props.min ?? 0;
  const blankZero = props.blankZero ?? true;
  const shown = Number.isFinite(props.value) ? props.value : 0;
  const view = numberFieldView(props);
  const display = text ?? view.text;
  return (
    <Input
      type="number"
      autoFocus={props.autoFocus}
      min={min}
      max={props.max}
      step={props.step ?? "1"}
      inputMode={props.inputMode}
      disabled={props.disabled ?? false}
      placeholder={view.placeholder}
      title={props.title}
      aria-label={props.label}
      className={`${props.invalid ? "border-destructive " : ""}${props.className ?? ""}`}
      value={display}
      onFocus={(e) => {
        setText(shown === 0 && blankZero ? "" : String(shown));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const typed = numberFieldTyped(raw, min, props.max);
        if (typed === null) return;
        if (typed === "blank") {
          if (props.onBlank) props.onBlank();
          else props.onChange(Math.max(min, 0));
          return;
        }
        props.onChange(typed);
      }}
      onBlur={() => {
        setText(null);
        props.onBlur?.();
      }}
    />
  );
}
