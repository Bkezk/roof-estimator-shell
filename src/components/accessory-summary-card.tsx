import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import type { AccessoriesResult } from "@/lib/engine/accessories";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const qtyText = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * The legacy "Accessories Summary" (frmAccReview: Qty / Name / Unit Cost / Total Cost / Labor),
 * as a collapsible card under the Bid total. Grouped by the screen each row came from.
 */
export function AccessorySummaryCard({
  result,
  laborRate,
}: {
  result: AccessoriesResult | undefined;
  laborRate: number;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("accSummaryOpen") === "1";
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem("accSummaryOpen", o ? "0" : "1");
      } catch {
        /* per-browser convenience only */
      }
      return !o;
    });
  const lines = result?.lines ?? [];
  const groups: Array<{ screen: string; rows: typeof lines }> = [];
  for (const ln of lines) {
    const g = groups[groups.length - 1];
    if (g && g.screen === ln.screen) g.rows.push(ln);
    else groups.push({ screen: ln.screen, rows: [ln] });
  }
  const material = result?.totalCost ?? 0;
  const hours = result?.manHours ?? 0;
  return (
    <Card className="mt-3">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 py-3">
        <div className="min-w-0">
          <CardTitle className="text-base">Accessories summary</CardTitle>
          {!open && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {money(material)} · {hours.toFixed(2)} h · {money(hours * laborRate)}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 px-2"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="acc-summary-body"
        >
          {open ? (
            <>
              <ChevronUp className="mr-1 h-4 w-4" /> Minimize
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-4 w-4" /> Show
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent id="acc-summary-body" className={open ? "space-y-2" : "hidden"}>
        {lines.length === 0 ? (
          <p className="text-xs text-muted-foreground">No accessories on this bid yet.</p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="text-muted-foreground">
                  <th className="py-1 text-right font-medium">Qty</th>
                  <th className="py-1 pl-2 text-left font-medium">Name</th>
                  <th className="py-1 pl-2 text-right font-medium">Unit</th>
                  <th className="py-1 pl-2 text-right font-medium">Total</th>
                  <th className="py-1 pl-2 text-right font-medium">Labor h</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g.screen} screen={g.screen} rows={g.rows} />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t font-medium tabular-nums">
                  <td />
                  <td className="py-1 pl-2">Totals</td>
                  <td />
                  <td className="py-1 pl-2 text-right">{money(material)}</td>
                  <td className="py-1 pl-2 text-right">{hours.toFixed(2)}</td>
                </tr>
                <tr className="text-muted-foreground tabular-nums">
                  <td />
                  <td className="pb-1 pl-2">Labor cost at {money(laborRate)}/h</td>
                  <td />
                  <td className="pb-1 pl-2 text-right">{money(hours * laborRate)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GroupRows({ screen, rows }: { screen: string; rows: AccessoriesResult["lines"] }) {
  return (
    <>
      <tr>
        <td
          colSpan={5}
          className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {screen}
        </td>
      </tr>
      {rows.map((ln, i) => (
        <tr key={i} className="tabular-nums">
          <td className="py-0.5 text-right">{qtyText(ln.qty)}</td>
          <td className="py-0.5 pl-2">{ln.name}</td>
          <td className="py-0.5 pl-2 text-right">{ln.unitCost > 0 ? money(ln.unitCost) : ""}</td>
          <td className="py-0.5 pl-2 text-right">{ln.totalCost > 0 ? money(ln.totalCost) : ""}</td>
          <td className="py-0.5 pl-2 text-right">{ln.hours > 0 ? ln.hours.toFixed(2) : ""}</td>
        </tr>
      ))}
    </>
  );
}
