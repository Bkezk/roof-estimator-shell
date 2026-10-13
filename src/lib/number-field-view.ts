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
