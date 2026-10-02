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
