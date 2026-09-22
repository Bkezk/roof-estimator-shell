import { useState } from "react";

import { Input } from "@/components/ui/input";

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
}) {
  const [text, setText] = useState<string | null>(null);
  const min = props.min ?? 0;
  const blankZero = props.blankZero ?? true;
  const shown = Number.isFinite(props.value) ? props.value : 0;
  const display = text ?? (blankZero && shown === 0 ? "" : String(shown));
  return (
    <Input
      type="number"
      min={min}
      max={props.max}
      step={props.step ?? "1"}
      inputMode={props.inputMode}
      disabled={props.disabled ?? false}
      placeholder={props.placeholder ?? (blankZero ? "0" : undefined)}
      title={props.title}
      className={`${props.invalid ? "border-destructive " : ""}${props.className ?? ""}`}
      value={display}
      onFocus={(e) => {
        setText(shown === 0 && blankZero ? "" : String(shown));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const t = raw.trim();
        if (t === "" || t === "-" || t === "." || t === "-.") {
          props.onChange(Math.max(min, 0));
          return;
        }
        const n = Number(t);
        if (!Number.isFinite(n)) return;
        const clamped = props.max !== undefined ? Math.min(props.max, n) : n;
        props.onChange(Math.max(min, clamped));
      }}
      onBlur={() => {
        setText(null);
        props.onBlur?.();
      }}
    />
  );
}
