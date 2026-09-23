/**
 * The Setup step's per-diem chart (owner, 2026-09-23): "Per diem based on N men N days", then a
 * checklist of job-cost headings with a price each. Informational — it is saved with the bid
 * (CustomerInfo.perDiemChart) and printed under the proposal's notes; it does not feed the
 * bid's Per diem figure or any total.
 */
export const PER_DIEM_ITEMS = [
  "Mobilization",
  "Supervision",
  "Boom truck",
  "Fork lift",
  "Equipment",
  "Rental equipment",
  "Fuel",
  "Dumpsters / trash",
  "Security bond",
  "Fringe benefits",
  "Hotel",
  "Food",
  "Porta jon",
  "Mechanical seamer",
  "New cons / multiple trips",
  "Miscellaneous",
] as const;

export interface PerDiemChartItem {
  label: string;
  checked: boolean;
  price: number;
}

export interface PerDiemChart {
  men: number;
  days: number;
  items: PerDiemChartItem[];
}

export const emptyPerDiemChart = (): PerDiemChart => ({
  men: 0,
  days: 0,
  items: PER_DIEM_ITEMS.map((label) => ({ label, checked: false, price: 0 })),
});

/** Older saved charts get any heading added since; unknown headings are kept. */
export function normalizePerDiemChart(raw: unknown): PerDiemChart {
  const c = emptyPerDiemChart();
  if (!raw || typeof raw !== "object") return c;
  const o = raw as Partial<PerDiemChart>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  c.men = num(o.men);
  c.days = num(o.days);
  const saved = Array.isArray(o.items) ? o.items : [];
  const byLabel = new Map<string, PerDiemChartItem>();
  for (const it of saved) {
    if (it && typeof it === "object" && typeof (it as PerDiemChartItem).label === "string") {
      const x = it as PerDiemChartItem;
      byLabel.set(x.label, { label: x.label, checked: !!x.checked, price: num(x.price) });
    }
  }
  c.items = c.items.map((it) => byLabel.get(it.label) ?? it);
  for (const [label, it] of byLabel) if (!c.items.some((x) => x.label === label)) c.items.push(it);
  return c;
}

export const perDiemChartTitle = (c: PerDiemChart): string =>
  `Per diem based on ${c.men} ${c.men === 1 ? "man" : "men"} ${c.days} ${c.days === 1 ? "day" : "days"}`;

export const checkedPerDiemItems = (c: PerDiemChart): PerDiemChartItem[] =>
  c.items.filter((it) => it.checked);

export const perDiemChartTotal = (c: PerDiemChart): number =>
  checkedPerDiemItems(c).reduce((n, it) => n + it.price, 0);
