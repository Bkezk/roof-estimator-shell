/**
 * The app menu on a narrow screen (an iPad; owner, Nov 3): it starts folded so the page has the
 * width, and its button opens it for the visit. The fold runs ONCE per arrival (owner, Nov 6:
 * "on half screen i cant open the nav bar, it stays collapsed" — the sidebar's setOpen is
 * remade on every open or close, and an effect keyed on it folded the menu again at each
 * attempt to open it between 768 and 1099 px). Pure, so the test can call it the way the
 * effect does: again and again, with the same `done` box.
 */
import { isNarrow } from "@/components/takeoff/touch";

export function foldMenuOnArrival(
  done: { current: boolean },
  width: number,
  setOpen: (open: boolean) => void,
): void {
  if (done.current) return;
  done.current = true;
  if (isNarrow(width)) setOpen(false);
}
