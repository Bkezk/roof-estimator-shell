import { useState } from "react";

import { Input } from "@/components/ui/input";
import { parseRateText } from "@/lib/service-crew";

const show = (v: number | null) => (v == null ? "" : String(v));

/**
 * A $ per hour box (owner, Sep 30): blank means "the default", shown as the placeholder; a
 * number box never starts at 0. `onChange` gets every valid value as it is typed (null =
 * blank); `onCommit` the value when the box is left. Text that is not a rate turns the box red
 * and is not passed on.
 */
export function RateBox(props: {
  value: number | null;
  /** The default, e.g. "85.00" (shown when the box is blank). */
  placeholder?: string | undefined;
  onChange?: ((v: number | null) => void) | undefined;
  onCommit?: ((v: number | null) => void) | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  className?: string | undefined;
  "aria-label"?: string | undefined;
  title?: string | undefined;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? show(props.value);
  const parsed = parseRateText(shown);
  const invalid = parsed === undefined;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        $
      </span>
      <Input
        id={props.id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={props["aria-label"]}
        aria-invalid={invalid || undefined}
        title={props.title}
        disabled={props.disabled}
        placeholder={props.placeholder}
        className={`pl-6 tabular-nums ${invalid ? "border-destructive" : ""} ${props.className ?? ""}`}
        value={shown}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseRateText(e.target.value);
          if (v !== undefined) props.onChange?.(v);
        }}
        onBlur={() => {
          const v = parseRateText(shown);
          setText(null);
          if (v !== undefined && v !== props.value) props.onCommit?.(v);
        }}
      />
    </div>
  );
}
