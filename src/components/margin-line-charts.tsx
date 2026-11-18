/**
 * The Owner page's three lines of business side by side (owner, Nov 18: "the ability to compare
 * trade bids, roof care, to just our regular buisness"; lib/margin-lines.ts).
 *
 * Always all three lines of the period, whatever the Business select shows below, so one line
 * can be read alone and still be compared.
 *
 *   - "By line of business": revenue, cost and margin of each line, one axis. The table under it
 *     carries the same figures with the margin % and the count, so nothing is read off a colour.
 *   - "Revenue by month, by line": one stacked bar a month. Each line keeps its colour whichever
 *     lines have figures: regular blue, trade orange, Roof Care green (checked for colour-blind
 *     separation, light and dark).
 */
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { money } from "@/components/service/invoice-utils";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { MARGIN_LINE_LABELS, type MarginLineTotals } from "@/lib/margin-lines";
import type { MarginReportResult } from "@/lib/margin-report";
import { money0 } from "@/lib/roof-care-price";

const SURFACE = "var(--background)";

/** The three figures of a line: the same colours as the "By month" chart. */
const FIGURES = {
  revenue: { label: "Revenue", theme: { light: "#2a78d6", dark: "#3987e5" } },
  cost: { label: "Cost", theme: { light: "#eb6834", dark: "#d95926" } },
  margin: { label: "Margin", theme: { light: "#1baf7a", dark: "#199e70" } },
  earlierMargin: { label: "Margin, earlier", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

/** The three lines, in their fixed order and colours. */
const LINES = {
  regular: { label: MARGIN_LINE_LABELS.regular, theme: { light: "#2a78d6", dark: "#3987e5" } },
  trade: { label: MARGIN_LINE_LABELS.trade, theme: { light: "#eb6834", dark: "#d95926" } },
  roofcare: { label: MARGIN_LINE_LABELS.roofcare, theme: { light: "#1baf7a", dark: "#199e70" } },
} satisfies ChartConfig;

const COMPACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const compactMoney = (n: number) => COMPACT.format(n);
const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

type TooltipFormatter = NonNullable<Parameters<typeof ChartTooltipContent>[0]["formatter"]>;
const moneyRow = (config: ChartConfig): TooltipFormatter =>
  function row(value, name, item) {
    const n = typeof value === "number" ? value : Number(value);
    return (
      <div className="flex w-full items-center gap-2">
        <span
          className="h-2.5 w-1 shrink-0 rounded-[2px]"
          style={{ backgroundColor: item.color }}
          aria-hidden
        />
        <span className="flex-1 text-muted-foreground">
          {config[String(name)]?.label ?? String(name)}
        </span>
        <span className="font-medium tabular-nums text-foreground">
          {Number.isFinite(n) ? money(n) : "—"}
        </span>
      </div>
    );
  };

export function MarginLineCharts({ d }: { d: MarginReportResult }) {
  const lines = d.byLine;
  if (!lines || !lines.some((l) => l.items > 0)) return null;
  const earlier = new Map<string, MarginLineTotals>(
    (d.earlierByLine ?? []).map((l) => [l.line, l]),
  );
  const compare = !!d.earlierByLine;
  const bars = lines.map((l) => ({
    ...l,
    ...(compare ? { earlierMargin: earlier.get(l.line)?.margin ?? 0 } : {}),
  }));
  const months = d.lineMonths ?? [];
  return (
    <section className="space-y-3" aria-label="By line of business" data-margin-lines>
      <div className="grid gap-3 lg:grid-cols-2">
        <figure className="min-w-0 rounded-md border p-3">
          <figcaption className="mb-2 text-sm font-medium">
            By line of business
            <span className="ml-2 font-normal text-muted-foreground">
              all three, whatever is picked under Business
            </span>
          </figcaption>
          <ChartContainer config={FIGURES} className="aspect-auto h-56 w-full">
            <BarChart data={bars} accessibilityLayer margin={{ left: 4, right: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} />
              <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={compactMoney} />
              <ChartTooltip content={<ChartTooltipContent formatter={moneyRow(FIGURES)} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="revenue"
                fill="var(--color-revenue)"
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
              <Bar dataKey="cost" fill="var(--color-cost)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar
                dataKey="margin"
                fill="var(--color-margin)"
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
              {compare && (
                <Bar
                  dataKey="earlierMargin"
                  fill="var(--color-earlierMargin)"
                  fillOpacity={0.45}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              )}
            </BarChart>
          </ChartContainer>
        </figure>
        <figure className="min-w-0 rounded-md border p-3">
          <figcaption className="mb-2 text-sm font-medium">Revenue by month, by line</figcaption>
          <ChartContainer config={LINES} className="aspect-auto h-56 w-full">
            <BarChart data={months} accessibilityLayer margin={{ left: 4, right: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} />
              <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={compactMoney} />
              <ChartTooltip content={<ChartTooltipContent formatter={moneyRow(LINES)} />} />
              <ChartLegend content={<ChartLegendContent />} />
              {(["regular", "trade", "roofcare"] as const).map((k) => (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId="line"
                  fill={`var(--color-${k})`}
                  stroke={SURFACE}
                  strokeWidth={2}
                  maxBarSize={32}
                />
              ))}
            </BarChart>
          </ChartContainer>
        </figure>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[34rem] text-sm" data-margin-lines-table>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Line of business</th>
              <th className="px-3 py-2 text-right font-medium">Invoices + bids</th>
              <th className="px-3 py-2 text-right font-medium">Revenue</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
              <th className="px-3 py-2 text-right font-medium">Margin</th>
              <th className="px-3 py-2 text-right font-medium">Margin %</th>
              {compare && <th className="px-3 py-2 text-right font-medium">Margin, earlier</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.line} className="border-b last:border-0" data-line={l.line}>
                <td className="px-3 py-2 font-medium">{l.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.items}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.revenue)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.cost)}</td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${l.margin < 0 ? "text-destructive" : ""}`}
                >
                  {money(l.margin)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(l.marginPct)}</td>
                {compare && (
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {money(earlier.get(l.line)?.margin ?? 0)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.roofCare && (
        <p className="text-xs text-muted-foreground" data-roof-care-in-force>
          Roof Care plans in force today: {d.roofCare.plans}
          {d.roofCare.plans > 0 && `, worth ${money0(d.roofCare.yearly)} a year`}. A plan’s revenue
          counts here when an inspection’s invoice is final.
        </p>
      )}
    </section>
  );
}
