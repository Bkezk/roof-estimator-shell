/**
 * The Tech Board's week label beside Prev / Next (owner, Oct 5: it read "Oct 5 – 2026 (day: 11)").
 * Formatting a date with `day` and `year` but no `month` makes Chrome print "2026 (day: 11)", so
 * the label is assembled by hand: "Oct 5 – 11, 2026" within a month, "Sep 28 – Oct 4, 2026"
 * across one, "Dec 29, 2025 – Jan 4, 2026" across a year. Pure: no I/O.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "YYYY-MM-DD" → [year, month (1–12), day], no time zone involved. */
const parts = (ymd: string): [number, number, number] => {
  const [y, m, d] = ymd.split("-").map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
};

export function weekLabel(firstYmd: string, lastYmd: string): string {
  const [y1, m1, d1] = parts(firstYmd);
  const [y2, m2, d2] = parts(lastYmd);
  const left = `${MONTHS[m1 - 1]} ${d1}`;
  if (y1 !== y2) return `${left}, ${y1} – ${MONTHS[m2 - 1]} ${d2}, ${y2}`;
  if (m1 !== m2) return `${left} – ${MONTHS[m2 - 1]} ${d2}, ${y2}`;
  return `${left} – ${d2}, ${y2}`;
}
