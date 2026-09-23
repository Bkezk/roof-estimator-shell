import { describe, it, expect } from "vitest";

import {
  PER_DIEM_ITEMS,
  emptyPerDiemChart,
  normalizePerDiemChart,
  perDiemChartTitle,
  perDiemChartTotal,
  checkedPerDiemItems,
} from "./per-diem-chart";

describe("per diem chart", () => {
  it("starts with every heading unticked at $0", () => {
    const c = emptyPerDiemChart();
    expect(c.items.map((i) => i.label)).toEqual([...PER_DIEM_ITEMS]);
    expect(c.items.every((i) => !i.checked && i.price === 0)).toBe(true);
    expect(perDiemChartTitle(c)).toBe("Per diem based on 0 men 0 days");
  });
  it("totals only ticked items and words the title by count", () => {
    const c = emptyPerDiemChart();
    c.men = 1;
    c.days = 3;
    c.items[0]!.checked = true;
    c.items[0]!.price = 500;
    c.items[1]!.price = 99; // unticked: not counted
    expect(perDiemChartTitle(c)).toBe("Per diem based on 1 man 3 days");
    expect(checkedPerDiemItems(c).map((i) => i.label)).toEqual(["Mobilization"]);
    expect(perDiemChartTotal(c)).toBe(500);
  });
  it("normalizes an older saved chart: keeps its values, adds new headings, drops junk", () => {
    const c = normalizePerDiemChart({
      men: 4,
      days: -2,
      items: [
        { label: "Hotel", checked: true, price: 1200 },
        { label: "Crane", checked: true, price: 800 },
        "junk",
      ],
    });
    expect(c.men).toBe(4);
    expect(c.days).toBe(0);
    expect(c.items.find((i) => i.label === "Hotel")).toEqual({
      label: "Hotel",
      checked: true,
      price: 1200,
    });
    expect(c.items.find((i) => i.label === "Crane")).toEqual({
      label: "Crane",
      checked: true,
      price: 800,
    });
    expect(c.items.length).toBe(PER_DIEM_ITEMS.length + 1);
    expect(normalizePerDiemChart(null).items.length).toBe(PER_DIEM_ITEMS.length);
  });
});
