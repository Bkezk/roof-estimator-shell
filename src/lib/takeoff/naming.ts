/**
 * The name a new takeoff starts with, from the customer picked in the New takeoff dialog.
 * Owner (Sep 30): the pre-filled name "needs to be somewhat intuitive — if the customer has 3
 * takeoffs that are all the same name that's going to be hard to differentiate". So the
 * suggestion is the customer (and site) plus the date, "Acme Foods — Plant 2 · Sep 30, 2026",
 * and a second takeoff for the same customer on the same day gets " (2)", " (3)"…, checked
 * against every name the person can already see in the list. The user can type over it.
 */
export function suggestTakeoffName(
  customerLabel: string,
  existingNames: readonly string[],
  now = new Date(),
): string {
  const base = customerLabel.trim();
  if (!base) return "";
  const day = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const first = `${base} · ${day}`;
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  if (!taken.has(first.toLowerCase())) return first;
  for (let n = 2; ; n++) {
    const candidate = `${first} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
