import { Trash2 } from "lucide-react";

import {
  checkedPerDiemItems,
  perDiemChartTitle,
  perDiemChartTotal,
  type PerDiemChart,
} from "@/lib/per-diem-chart";
import { Button } from "@/components/ui/button";
import { NumberField } from "@/components/ui/number-field";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** The Setup step's per-diem chart editor: men × days line, checklist on the left, prices right. */
export function PerDiemChartEditor(props: {
  chart: PerDiemChart;
  onChange: (c: PerDiemChart) => void;
  onRemove: () => void;
  disabled?: boolean | undefined;
}) {
  const { chart, onChange } = props;
  const setItem = (i: number, patch: Partial<PerDiemChart["items"][number]>) =>
    onChange({ ...chart, items: chart.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Per diem based on</span>
        <NumberField
          value={chart.men}
          onChange={(n) => onChange({ ...chart, men: n })}
          className="h-7 w-16 text-right"
          inputMode="numeric"
          disabled={props.disabled}
          title="Men"
        />
        <span>{chart.men === 1 ? "man" : "men"}</span>
        <NumberField
          value={chart.days}
          onChange={(n) => onChange({ ...chart, days: n })}
          className="h-7 w-16 text-right"
          inputMode="decimal"
          step="0.5"
          disabled={props.disabled}
          title="Days"
        />
        <span>{chart.days === 1 ? "day" : "days"}</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 text-xs text-destructive"
          onClick={props.onRemove}
          disabled={props.disabled}
          title="Remove the chart from this bid"
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove chart
        </Button>
      </div>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {chart.items.map((it, i) => (
          <div key={it.label} className="flex items-center justify-between gap-2">
            <label className="flex min-w-0 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={it.checked}
                disabled={props.disabled}
                onChange={(e) => setItem(i, { checked: e.target.checked })}
              />
              <span className={it.checked ? "" : "text-muted-foreground"}>{it.label}</span>
            </label>
            <NumberField
              value={it.price}
              onChange={(n) => setItem(i, { price: n, ...(n > 0 ? { checked: true } : {}) })}
              className={`h-7 w-28 text-right ${it.checked ? "" : "opacity-60"}`}
              inputMode="decimal"
              step="0.01"
              placeholder="$"
              disabled={props.disabled}
              title={`${it.label} price`}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end border-t pt-2 text-sm">
        <span className="text-muted-foreground">
          {checkedPerDiemItems(chart).length} item
          {checkedPerDiemItems(chart).length === 1 ? "" : "s"}
          &nbsp;·&nbsp;
        </span>
        <span className="font-semibold tabular-nums">{usd(perDiemChartTotal(chart))}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Printed under the proposal notes. Informational only — it does not change the bid&apos;s per
        diem or total.
      </p>
    </div>
  );
}

/** Read-only rendering (proposal): title line, the ticked items with prices, and the total. */
export function PerDiemChartView(props: { chart: PerDiemChart; className?: string | undefined }) {
  const items = checkedPerDiemItems(props.chart);
  if (items.length === 0 && props.chart.men === 0 && props.chart.days === 0) return null;
  return (
    <div className={props.className}>
      <p className="font-medium">{perDiemChartTitle(props.chart)}</p>
      {items.length > 0 && (
        <table className="mt-1 text-sm">
          <tbody>
            {items.map((it) => (
              <tr key={it.label}>
                <td className="pr-6">{it.label}</td>
                <td className="text-right tabular-nums">{usd(it.price)}</td>
              </tr>
            ))}
            <tr className="border-t font-semibold">
              <td className="pr-6 pt-1">Total</td>
              <td className="pt-1 text-right tabular-nums">
                {usd(perDiemChartTotal(props.chart))}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
