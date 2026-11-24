/**
 * What a NumberField (components/ui/number-field.tsx) shows while not being edited: its text and
 * its placeholder. With `blankZero` (the default) a 0 shows as an empty box with NO placeholder
 * (owner: number boxes start blank, never a 0 — not even a grey one; Oct 2: an opportunity's
 * Est. value showed a 0). A caller may pass its own placeholder text. Pure, so it is tested
 * without React.
 */
export function numberFieldView(p: {
  value: number;
  blankZero?: boolean | undefined;
  placeholder?: string | undefined;
}): { text: string; placeholder: string | undefined } {
  const blankZero = p.blankZero ?? true;
  const shown = Number.isFinite(p.value) ? p.value : 0;
  return {
    text: blankZero && shown === 0 ? "" : String(shown),
    placeholder: p.placeholder ?? undefined,
  };
}

/**
 * What the text typed into a NumberField means: "blank" for an emptied box (or one holding only
 * a sign or a point), the number clamped between min and max, or null for text that is not a
 * number (ignored). A NumberField sends 0 for "blank" unless its caller asked to be told
 * (`onBlank`; Nov 24: emptying a metals price box goes back to the list price, 0 is a price).
 */
export function numberFieldTyped(raw: string, min: number, max?: number): "blank" | number | null {
  const t = raw.trim();
  if (t === "" || t === "-" || t === "." || t === "-.") return "blank";
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const clamped = max !== undefined ? Math.min(max, n) : n;
  return Math.max(min, clamped);
}

/**
 * A "days, or blank = never" box (Admin › Reminders › Bids, "Then every N days while a draft is
 * past due"; owner, Oct 13): what the typed text means. Blank (or nothing numeric) is null —
 * never; otherwise the whole number typed (rounded). No 0 is made up for an empty box.
 */
export function blankOrNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}
