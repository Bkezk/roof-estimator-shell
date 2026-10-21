/**
 * The Margin report's charts (owner, Oct 21: "add some charts to track over time with the ability
 * to compare months/years"; "keep it before tax"), under the report's controls and above its
 * table. Everything is drawn from the same server answer the table shows — the per-invoice rows,
 * aggregated by month in lib/margin-report.ts monthSeries and aligned with the comparison period
 * in lib/margin-compare.ts — so there is no extra read.
 *
 *  By month   grouped bars of revenue, cost and margin per month of the range (zero where nothing
 *             was invoiced), with the comparison period's revenue and margin as faded grey bars
 *             beside them when Compare is on. Margin % is a 2px line in its own small chart right
 *             under the bars, sharing the month ticks — never a second y-axis on the bars (two
 *             scales on one plot invent a relationship the data does not have).
 *  By group   when grouped by customer or technician the first chart becomes horizontal bars of
 *             margin per group, the top 10 by margin with the rest folded into Others; the
 *             comparison period's margin sits beside each in grey.
 *  Cost mix   stacked bars per month — material, labor & travel, purchase orders, other — for the
 *             whole range whatever the grouping.
 *
 * Colour follows the figure, never its rank: revenue is always slot 1, cost slot 2, margin (and
 * margin %) slot 3; material / labor / purchase orders take the same three slots in the cost mix,
 * and Other and the earlier period are the theme's muted grey. The slots are the dataviz
 * palette's first three, each a light and a dark step declared through the shadcn chart
 * wrapper's ChartConfig `theme` (the dark step is chosen for the dark surface, not a flipped
 * light one), validated for colour-blind separation in both modes against this theme's
 * surfaces. Every value is also in the table under the charts, so a tooltip never gates a figure.
 * Thin rounded bars (24px at most), a 2px surface gap between stacked segments, hairline grid,
 * a legend on every chart with two or more series, "Oct 26" ticks, compact money on the axis.
 * The charts stack full width on a phone (the wrapper is responsive) at a fixed height each, and
 * render nothing when there are no invoices — the report shows its own empty line then.
 */
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import { money } from "@/components/service/invoice-utils";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { comparedGroupBars, comparedMonthSeries } from "@/lib/margin-compare";
import {
  MARGIN_GROUP_LABELS,
  monthSeries,
  shortMonthLabel,
  type MarginReportResult,
} from "@/lib/margin-report";

const SURFACE = "var(--background)";

/** The "By month" bars: the three figures, and the earlier period's revenue and margin in grey. */
const BY_MONTH = {
  revenue: { label: "Revenue", theme: { light: "#2a78d6", dark: "#3987e5" } },
  cost: { label: "Cost", theme: { light: "#eb6834", dark: "#d95926" } },
  margin: { label: "Margin", theme: { light: "#1baf7a", dark: "#199e70" } },
  earlierRevenue: { label: "Revenue, earlier", color: "var(--muted-foreground)" },
  earlierMargin: { label: "Margin, earlier", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

/** The small margin % line under the bars (the same slot as margin). */
const PCT = {
  marginPct: { label: "Margin %", theme: { light: "#1baf7a", dark: "#199e70" } },
  earlierMarginPct: { label: "Margin %, earlier", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

/** Margin per customer / technician (the same slot as margin). */
const BY_GROUP = {
  margin: { label: "Margin", theme: { light: "#1baf7a", dark: "#199e70" } },
  earlierMargin: { label: "Margin, earlier", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

/** The cost mix: the three slots again, Other in grey. */
const COST_MIX = {
  material: { label: "Material", theme: { light: "#2a78d6", dark: "#3987e5" } },
  labor: { label: "Labor & travel", theme: { light: "#eb6834", dark: "#d95926" } },
  purchaseOrders: { label: "Purchase orders", theme: { light: "#1baf7a", dark: "#199e70" } },
  other: { label: "Other", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

const COMPACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
/** "$12.5K" on an axis. */
const compactMoney = (n: number) => COMPACT.format(n);
const pct = (n: number) => `${n.toFixed(1)}%`;
const isPctKey = (name: unknown) => String(name).toLowerCase().endsWith("pct");

type TooltipFormatter = NonNullable<Parameters<typeof ChartTooltipContent>[0]["formatter"]>;

/**
 * One tooltip row: a short key in the series colour, the series name, the value as money or a
 * percent (the wrapper's own row would print a bare number).
 */
const formatRow = (config: ChartConfig): TooltipFormatter =>
  function row(value, name, item) {
    const n = typeof value === "number" ? value : Number(value);
    const label = config[String(name)]?.label ?? String(name);
    return (
      <div className="flex w-full items-center gap-2">
        <span
          className="h-2.5 w-1 shrink-0 rounded-[2px]"
          style={{ backgroundColor: item.color }}
          aria-hidden
        />
        <span className="flex-1 text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums text-foreground">
          {Number.isFinite(n) ? (isPctKey(name) ? pct(n) : money(n)) : "—"}
        </span>
      </div>
    );
  };

/** The month tick, with the earlier month beside it when there is one ("Oct 26 · vs Oct 25"). */
const monthTooltipLabel = (
  label: unknown,
  payload: readonly { payload?: unknown }[] | undefined,
) => {
  const earlier = (payload?.[0]?.payload as { earlierKey?: string | null } | undefined)?.earlierKey;
  return earlier ? `${String(label)} · vs ${shortMonthLabel(earlier)}` : String(label);
};

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string | undefined;
  children: ReactNode;
}) {
  return (
    <figure className="min-w-0 rounded-md border p-3">
      <figcaption className="mb-2 text-sm font-medium">
        {title}
        {note && <span className="ml-2 font-normal text-muted-foreground">{note}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

export function MarginCharts({ d }: { d: MarginReportResult }) {
  const { invoices } = d;
  if (invoices.length === 0) return null;
  const compare = !!d.comparison;
  const months = comparedMonthSeries(d);
  const mix = monthSeries(invoices, d.from, d.to);
  const byGroup = d.groupBy === "month" ? null : comparedGroupBars(d);
  const earlierNote =
    compare && d.comparison ? `earlier: ${d.comparison.from} to ${d.comparison.to}` : undefined;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {byGroup === null ? (
        <Panel title="By month" note={earlierNote}>
          <ChartContainer config={BY_MONTH} className="aspect-auto h-56 w-full">
            <BarChart data={months} accessibilityLayer margin={{ left: 4, right: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} />
              <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={compactMoney} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={formatRow(BY_MONTH)}
                    labelFormatter={monthTooltipLabel}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey="revenue"
                fill="var(--color-revenue)"
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
              />
              {compare && (
                <Bar
                  dataKey="earlierRevenue"
                  fill="var(--color-earlierRevenue)"
                  fillOpacity={0.45}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                />
              )}
              <Bar dataKey="cost" fill="var(--color-cost)" radius={[4, 4, 0, 0]} maxBarSize={24} />
              <Bar
                dataKey="margin"
                fill="var(--color-margin)"
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
              />
              {compare && (
                <Bar
                  dataKey="earlierMargin"
                  fill="var(--color-earlierMargin)"
                  fillOpacity={0.45}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                />
              )}
            </BarChart>
          </ChartContainer>
          <ChartContainer config={PCT} className="mt-2 aspect-auto h-28 w-full">
            {/*
             * A composed chart carrying one hidden bar: recharts then lays the months out as the
             * same bands as the chart above, so each point and tick sits under its month's bars
             * (a plain line chart spaces its points edge to edge, a few pixels off).
             */}
            <ComposedChart data={months} accessibilityLayer margin={{ left: 4, right: 4 }}>
              <CartesianGrid vertical={false} />
              <Bar dataKey="marginPct" hide legendType="none" tooltipType="none" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(v: number) => `${v}%`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={formatRow(PCT)}
                    labelFormatter={monthTooltipLabel}
                  />
                }
              />
              {compare && <ChartLegend content={<ChartLegendContent />} />}
              {compare && (
                <Line
                  type="monotone"
                  dataKey="earlierMarginPct"
                  stroke="var(--color-earlierMarginPct)"
                  strokeOpacity={0.6}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              )}
              <Line
                type="monotone"
                dataKey="marginPct"
                stroke="var(--color-marginPct)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: SURFACE }}
                connectNulls
              />
            </ComposedChart>
          </ChartContainer>
        </Panel>
      ) : (
        <Panel
          title={`Margin by ${MARGIN_GROUP_LABELS[d.groupBy].toLowerCase()}`}
          note={
            byGroup.some((r) => r.key === "others") ? "top 10, the rest as Others" : earlierNote
          }
        >
          <ChartContainer config={BY_GROUP} className="aspect-auto h-80 w-full">
            <BarChart
              data={byGroup}
              layout="vertical"
              accessibilityLayer
              margin={{ left: 4, right: 12 }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={compactMoney} />
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={false}
                width={112}
                interval={0}
              />
              <ChartTooltip content={<ChartTooltipContent formatter={formatRow(BY_GROUP)} />} />
              {compare && <ChartLegend content={<ChartLegendContent />} />}
              <Bar
                dataKey="margin"
                fill="var(--color-margin)"
                radius={[0, 4, 4, 0]}
                maxBarSize={24}
              />
              {compare && (
                <Bar
                  dataKey="earlierMargin"
                  fill="var(--color-earlierMargin)"
                  fillOpacity={0.45}
                  radius={[0, 4, 4, 0]}
                  maxBarSize={24}
                />
              )}
            </BarChart>
          </ChartContainer>
        </Panel>
      )}

      <Panel title="Cost mix" note="by month">
        <ChartContainer config={COST_MIX} className="aspect-auto h-80 w-full">
          <BarChart data={mix} accessibilityLayer margin={{ left: 4, right: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} />
            <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={compactMoney} />
            <ChartTooltip content={<ChartTooltipContent formatter={formatRow(COST_MIX)} />} />
            <ChartLegend content={<ChartLegendContent />} />
            {/* A 2px stroke in the surface colour is the gap between stacked segments. */}
            <Bar
              dataKey="material"
              stackId="cost"
              fill="var(--color-material)"
              stroke={SURFACE}
              strokeWidth={2}
              maxBarSize={24}
            />
            <Bar
              dataKey="labor"
              stackId="cost"
              fill="var(--color-labor)"
              stroke={SURFACE}
              strokeWidth={2}
              maxBarSize={24}
            />
            <Bar
              dataKey="purchaseOrders"
              stackId="cost"
              fill="var(--color-purchaseOrders)"
              stroke={SURFACE}
              strokeWidth={2}
              maxBarSize={24}
            />
            <Bar
              dataKey="other"
              stackId="cost"
              fill="var(--color-other)"
              stroke={SURFACE}
              strokeWidth={2}
              radius={[4, 4, 0, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ChartContainer>
      </Panel>
    </div>
  );
}
