/**
 * The legacy Estimate Review screen (captured 2026-08-31, shots 124824 Cost view / 124849 Labor
 * view): three side-by-side ledgers — Purchases | Labor & Services | Totals — with the bottom
 * Cost/Labor radio flipping the middle column between dollars and man-hours, checkbox "Use"
 * cells for the three discounts, and click-to-edit cells (Shipping (Other), Dollar Markup /
 * Markup percentage, Per-Diem, Sales Commission) instead of a form.
 */

import { useState } from "react";

import type { EstimateResult } from "@/lib/engine/estimate";
import type { MarkupMode } from "@/lib/engine/money";
import type { LedgerRow, ReviewLedger } from "@/lib/engine/review-ledger";

const usd = (v: number) =>
  (v < 0 ? "(" : "") +
  "$" +
  Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
  (v < 0 ? ")" : "");
const hrs = (v: number) => (v === 0 ? "0" : v.toFixed(2).replace(/\.00$/, ""));
const num2 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** A value cell the user clicks to edit in place (the legacy blue-link cells). */
function ClickEdit(props: {
  display: string;
  value: number;
  onCommit: (v: number) => void;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  if (!editing) {
    return (
      <button
        type="button"
        title={props.title ?? "Click to edit"}
        className="w-full text-right text-primary underline decoration-dotted underline-offset-2 tabular-nums"
        onClick={() => {
          setText(String(props.value));
          setEditing(true);
        }}
      >
        {props.display}
      </button>
    );
  }
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n)) props.onCommit(n);
    setEditing(false);
  };
  return (
    <input
      autoFocus
      className="w-full rounded border bg-background px-1 text-right text-xs tabular-nums"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

function GroupHeader({ label }: { label: string }) {
  return (
    <tr className="bg-muted/60">
      <td colSpan={2} className="px-2 py-0.5 font-semibold">
        {label}
      </td>
    </tr>
  );
}

function ItemRows({ rows, labor }: { rows: LedgerRow[]; labor?: boolean }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.label} className="border-t border-border/40">
          <td className="py-0.5 pl-5 pr-2 text-muted-foreground">{r.label}</td>
          <td className="px-2 py-0.5 text-right tabular-nums">
            {labor ? hrs(r.hours ?? 0) : usd(r.cost)}
          </td>
        </tr>
      ))}
    </>
  );
}

export function EstimateReviewLedger(props: {
  ledger: ReviewLedger;
  est: EstimateResult;
  stats: {
    roofSqFt: number;
    membraneSqFt: number;
    parapetVertSqFt: number;
    parapetWallSqFt: number;
  };
  discounts: {
    prepay: boolean;
    std: boolean;
    volume: boolean;
    onPrepay: (v: boolean) => void;
    onStd: (v: boolean) => void;
    onVolume: (v: boolean) => void;
  };
  markup: { mode: MarkupMode; value: number; onChange: (mode: MarkupMode, value: number) => void };
  perDiem: { rate: number; onChange: (v: number) => void };
  commission: { pct: number; onChange: (v: number) => void };
  extraShipping: { value: number; onChange: (v: number) => void };
  /** Opens the settings panel (warranty, labor rate, templates…) — the non-grid knobs. */
  onOpenSettings: () => void;
}) {
  const { ledger, est } = props;
  const [laborView, setLaborView] = useState(false);
  const d = est.money.dTotals;
  const v = (i: number) => d[i] ?? 0;
  const g = est.money.grandTotal;

  const discountRow = (label: string, idx: number, used: boolean, onUse: (b: boolean) => void) => (
    <tr className="border-t">
      <td className="px-2 py-0.5">{label}</td>
      <td className="w-8 text-center">
        <input type="checkbox" checked={used} onChange={(e) => onUse(e.target.checked)} />
      </td>
      <td className="px-2 py-0.5 text-right tabular-nums">{usd(v(idx))}</td>
    </tr>
  );

  return (
    <div className="space-y-2">
      <div className="grid gap-3 xl:grid-cols-[1fr_1fr_1.25fr]">
        {/* ── Purchases ─────────────────────────────────────────────────── */}
        <table className="h-fit w-full border text-xs">
          <thead>
            <tr className="border-b bg-muted">
              <th className="px-2 py-1 text-left">Purchases</th>
              <th className="px-2 py-1 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            <GroupHeader label="Duro-Last" />
            <ItemRows rows={ledger.purchases.duroLast} />
            <GroupHeader label="Insulation" />
            <ItemRows rows={ledger.purchases.insulation} />
            <GroupHeader label="Non-DuroLast" />
            <ItemRows rows={ledger.purchases.nonDuroLast} />
            <GroupHeader label="Totals" />
            <tr className="border-t">
              <td className="py-0.5 pl-5 pr-2 text-muted-foreground">Materials</td>
              <td className="px-2 py-0.5 text-right tabular-nums">
                {usd(ledger.purchases.materials)}
              </td>
            </tr>
            <tr className="border-t">
              <td className="py-0.5 pl-5 pr-2 text-muted-foreground">Tax</td>
              <td className="px-2 py-0.5 text-right tabular-nums">{usd(est.money.taxCharged)}</td>
            </tr>
            <tr className="border-t">
              <td className="py-0.5 pl-5 pr-2 text-muted-foreground">Shipping (DL)</td>
              <td className="px-2 py-0.5 text-right tabular-nums">
                {usd(ledger.purchases.shippingDl)}
              </td>
            </tr>
            <tr className="border-t bg-green-100 dark:bg-green-950/40">
              <td className="py-0.5 pl-5 pr-2">Shipping (Other)</td>
              <td className="px-2 py-0.5 text-right">
                <ClickEdit
                  display={usd(props.extraShipping.value)}
                  value={props.extraShipping.value}
                  onCommit={props.extraShipping.onChange}
                  title="Extra shipping $ — click to edit"
                />
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── Labor & Services (Cost ⇄ Man Hours) ───────────────────────── */}
        <table className="h-fit w-full border text-xs">
          <thead>
            <tr className="border-b bg-muted">
              <th className="px-2 py-1 text-left">Labor &amp; Services</th>
              <th className="px-2 py-1 text-right">{laborView ? "Man Hours" : "Cost"}</th>
            </tr>
          </thead>
          <tbody>
            <GroupHeader label="Duro-Last" />
            <ItemRows rows={ledger.labor.duroLast} labor={laborView} />
            <GroupHeader label="Insulation" />
            <ItemRows rows={ledger.labor.insulation} labor={laborView} />
            <GroupHeader label="Non-DuroLast" />
            <ItemRows rows={ledger.labor.nonDuroLast} labor={laborView} />
            <ItemRows
              rows={[ledger.labor.setup, ledger.labor.inspection, ledger.labor.tearOff]}
              labor={laborView}
            />
            <tr className="border-t font-semibold">
              <td className="px-2 py-0.5">Total Labor</td>
              <td className="px-2 py-0.5 text-right tabular-nums">
                {laborView
                  ? hrs(ledger.labor.totalLabor.hours ?? 0)
                  : usd(ledger.labor.totalLabor.cost)}
              </td>
            </tr>
            <GroupHeader label="Subcontractors" />
            <ItemRows rows={ledger.labor.subcontractors} labor={laborView} />
            <GroupHeader label="Services" />
            <ItemRows rows={ledger.labor.services} labor={laborView} />
            <tr className="border-t font-semibold">
              <td className="px-2 py-0.5">Total Subs. &amp; Svc</td>
              <td className="px-2 py-0.5 text-right tabular-nums">
                {laborView ? "0" : usd(ledger.labor.totalSubsSvc)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── Totals ────────────────────────────────────────────────────── */}
        <table className="h-fit w-full border text-xs">
          <thead>
            <tr className="border-b bg-muted">
              <th className="px-2 py-1 text-left">Totals</th>
              <th className="w-8 px-1 py-1 text-center">Use</th>
              <th className="px-2 py-1 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            <TotalRowU label="Total DuroLast" value={usd(v(0))} />
            {discountRow("Prepay Discount", 1, props.discounts.prepay, props.discounts.onPrepay)}
            {discountRow(
              "Standard Sheet Size Discount",
              2,
              props.discounts.std,
              props.discounts.onStd,
            )}
            {discountRow(
              "100,000 sf Discount",
              3,
              props.discounts.volume,
              props.discounts.onVolume,
            )}
            <TotalRowU label="After Selected Discounts" value={usd(v(4))} bold />
            <tr className="border-t">
              <td className="px-2 py-0.5">
                <button
                  type="button"
                  className="text-primary underline decoration-dotted underline-offset-2"
                  onClick={props.onOpenSettings}
                  title="Pick the warranty in the settings panel"
                >
                  Warranty Cost
                </button>
              </td>
              <td />
              <td className="px-2 py-0.5 text-right tabular-nums">{usd(v(5))}</td>
            </tr>
            <TotalRowU label="Insulation & Underlayment" value={usd(v(6))} />
            <TotalRowU label="Other Purchases" value={usd(v(7))} />
            <TotalRowU label="Sales Tax" value={usd(est.money.taxCharged)} />
            <TotalRowU label="Total Purchases" value={usd(v(8))} />
            <TotalRowU label="Total Shipping" value={usd(v(9))} />
            <TotalRowU label="Total Labor" value={usd(v(10))} />
            <TotalRowU label="Total Services" value={usd(v(11))} />
            <TotalRowU label="Subtotal 1" value={usd(est.money.subtotal1)} bold />
            <tr className="border-t">
              <td className="px-2 py-0.5">Dollar Markup</td>
              <td className="text-center">
                <input
                  type="radio"
                  title="$ per man-day markup"
                  checked={props.markup.mode === 1}
                  onChange={() => props.markup.onChange(1, props.markup.value)}
                />
              </td>
              <td className="px-2 py-0.5 text-right">
                {props.markup.mode === 1 ? (
                  <ClickEdit
                    display={`${usd(est.money.markupValue)} (@ ${usd(props.markup.value)}/day)`}
                    value={props.markup.value}
                    onCommit={(n) => props.markup.onChange(1, n)}
                    title="$ per man-day — click to edit"
                  />
                ) : (
                  <span className="tabular-nums">{usd(est.money.markupValue)}</span>
                )}
              </td>
            </tr>
            <tr className="border-t">
              <td className="px-2 py-0.5">Markup percentage</td>
              <td className="text-center">
                <input
                  type="radio"
                  title="Percentage markup (gross profit)"
                  checked={props.markup.mode !== 1}
                  onChange={() => props.markup.onChange(2, props.markup.value)}
                />
              </td>
              <td className="px-2 py-0.5 text-right">
                {props.markup.mode !== 1 ? (
                  <ClickEdit
                    display={`${num2(props.markup.value)}%`}
                    value={props.markup.value}
                    onCommit={(n) => props.markup.onChange(props.markup.mode, n)}
                    title="Markup % — click to edit"
                  />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
            <TotalRowU label="Subtotal 2" value={usd(est.money.subtotal2)} bold />
            <tr className="border-t">
              <td className="px-2 py-0.5">Per-Diem Charge</td>
              <td />
              <td className="px-2 py-0.5 text-right">
                <ClickEdit
                  display={usd(est.money.perDiemValue)}
                  value={props.perDiem.rate}
                  onCommit={props.perDiem.onChange}
                  title="Per-diem $/man-day — click to edit the rate"
                />
              </td>
            </tr>
            <tr className="border-t">
              <td className="px-2 py-0.5">Sales Commission</td>
              <td />
              <td className="px-2 py-0.5 text-right">
                <ClickEdit
                  display={usd(est.money.commissionValue)}
                  value={props.commission.pct}
                  onCommit={props.commission.onChange}
                  title="Commission % — click to edit"
                />
              </td>
            </tr>
            <TotalRowU label="Bid Total" value={usd(g)} bold />
            <tr>
              <td colSpan={3} className="py-1" />
            </tr>
            <TotalRowU label="Total Man Days" value={num2(est.money.totalManDays)} />
            <TotalRowU
              label="Price per roof sqft"
              value={props.stats.roofSqFt > 0 ? num2(g / props.stats.roofSqFt) : "0"}
            />
            <TotalRowU
              label="Price per membrane sqft"
              value={props.stats.membraneSqFt > 0 ? num2(g / props.stats.membraneSqFt) : "0"}
            />
            <TotalRowU
              label="Labor per roof sqft"
              value={
                props.stats.roofSqFt > 0 ? num2(est.laborSubtotal1 / props.stats.roofSqFt) : "0"
              }
            />
            <TotalRowU
              label="Labor per membrane sqft"
              value={
                props.stats.membraneSqFt > 0
                  ? num2(est.laborSubtotal1 / props.stats.membraneSqFt)
                  : "0"
              }
            />
            <TotalRowU label="Roof area sqft" value={num2(props.stats.roofSqFt)} />
            <TotalRowU
              label="Parapet vertical wall sqft"
              value={num2(props.stats.parapetVertSqFt)}
            />
            <TotalRowU label="Parapet total wall sqft" value={num2(props.stats.parapetWallSqFt)} />
            <TotalRowU label="Total Membrane sqft" value={num2(props.stats.membraneSqFt)} />
          </tbody>
        </table>
      </div>

      {/* The legacy bottom radio: flips the Labor & Services column between $ and man-hours. */}
      <div className="flex justify-center gap-6 border-t pt-2 text-xs">
        <label className="flex items-center gap-1">
          <input type="radio" checked={!laborView} onChange={() => setLaborView(false)} />
          Cost
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={laborView} onChange={() => setLaborView(true)} />
          Labor
        </label>
      </div>
    </div>
  );

  function TotalRowU({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
    return (
      <tr className={`border-t ${bold ? "font-semibold" : ""}`}>
        <td className="px-2 py-0.5">{label}</td>
        <td />
        <td className="px-2 py-0.5 text-right tabular-nums">{value}</td>
      </tr>
    );
  }
}
