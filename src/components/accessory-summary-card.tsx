import { ChevronDown, ChevronRight, ChevronUp, Table2 } from "lucide-react";
import { useState } from "react";

import type { AccessoriesResult, AccessoryReviewLine } from "@/lib/engine/accessories";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const qtyText = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const hrs = (n: number) => `${n.toFixed(2)} h`;

interface ScreenGroup {
  screen: string;
  rows: AccessoryReviewLine[];
  material: number;
  hours: number;
}

function groupByScreen(lines: AccessoryReviewLine[]): ScreenGroup[] {
  const groups: ScreenGroup[] = [];
  for (const ln of lines) {
    const g = groups[groups.length - 1];
    if (g && g.screen === ln.screen) {
      g.rows.push(ln);
      g.material += ln.totalCost;
      g.hours += ln.hours;
    } else {
      groups.push({ screen: ln.screen, rows: [ln], material: ln.totalCost, hours: ln.hours });
    }
  }
  return groups;
}

/**
 * The legacy "Accessories Summary" (frmAccReview: Qty / Name / Unit Cost / Total Cost / Labor)
 * under the Bid total. The sidebar column is 220–320 px wide, so the card shows one line per
 * accessory screen (material · hours) that expands to its items stacked two lines each; the
 * full five-column table opens in a dialog.
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tableOpen, setTableOpen] = useState(false);
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
  const groups = groupByScreen(lines);
  const material = result?.totalCost ?? 0;
  const hours = result?.manHours ?? 0;
  return (
    <Card className="mt-3">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 py-3">
        <div className="min-w-0">
          <CardTitle className="text-base">Accessories</CardTitle>
          <p className="text-xs text-muted-foreground tabular-nums">
            {money(material)} · {hrs(hours)} · {money(hours * laborRate)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 px-2"
          onClick={toggle}
          aria-expanded={open}
          aria-controls="acc-summary-body"
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <span className="sr-only">{open ? "Minimize" : "Show"} accessories summary</span>
        </Button>
      </CardHeader>
      <CardContent id="acc-summary-body" className={open ? "space-y-2 pt-0" : "hidden"}>
        {lines.length === 0 ? (
          <p className="text-xs text-muted-foreground">No accessories on this bid yet.</p>
        ) : (
          <>
            <ul className="divide-y text-sm">
              {groups.map((g) => {
                const isOpen = expanded[g.screen] ?? false;
                return (
                  <li key={g.screen}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1 py-1.5 text-left"
                      onClick={() => setExpanded((p) => ({ ...p, [g.screen]: !isOpen }))}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">{g.screen}</span>
                      <span className="shrink-0 text-right tabular-nums">
                        {g.material > 0 ? money(g.material) : ""}
                        {g.hours > 0 && (
                          <span className="block text-[11px] text-muted-foreground">
                            {hrs(g.hours)}
                          </span>
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <ul className="mb-1.5 ml-4 space-y-1.5 border-l pl-2">
                        {g.rows.map((ln, i) => (
                          <li key={i} className="text-xs">
                            <div className="leading-snug">{ln.name}</div>
                            <div className="flex justify-between gap-2 text-muted-foreground tabular-nums">
                              <span>
                                {qtyText(ln.qty)}
                                {ln.unitCost > 0 ? ` × ${money(ln.unitCost)}` : ""}
                              </span>
                              <span>
                                {ln.totalCost > 0 ? money(ln.totalCost) : ""}
                                {ln.totalCost > 0 && ln.hours > 0 ? " · " : ""}
                                {ln.hours > 0 ? hrs(ln.hours) : ""}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between border-t pt-2 text-sm font-medium tabular-nums">
              <span>Total</span>
              <span className="text-right">
                {money(material)}
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {hrs(hours)} · {money(hours * laborRate)} labor
                </span>
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setTableOpen(true)}
            >
              <Table2 className="mr-1 h-4 w-4" /> Full summary table
            </Button>
            <Dialog open={tableOpen} onOpenChange={setTableOpen}>
              <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Accessories Summary</DialogTitle>
                  <DialogDescription>
                    Every priced or laboured accessory item on this bid (legacy Accessories Summary:
                    Qty / Name / Unit Cost / Total Cost / Labor).
                  </DialogDescription>
                </DialogHeader>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1 pr-2 text-right font-medium">Qty</th>
                      <th className="py-1 pr-2 text-left font-medium">Name</th>
                      <th className="py-1 pr-2 text-right font-medium">Unit Cost</th>
                      <th className="py-1 pr-2 text-right font-medium">Total Cost</th>
                      <th className="py-1 text-right font-medium">Labor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <GroupRows key={g.screen} group={g} />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-medium tabular-nums">
                      <td />
                      <td className="py-1.5 pr-2">Totals</td>
                      <td />
                      <td className="py-1.5 pr-2 text-right">{money(material)}</td>
                      <td className="py-1.5 text-right">{hrs(hours)}</td>
                    </tr>
                    <tr className="text-muted-foreground tabular-nums">
                      <td />
                      <td className="pb-1 pr-2">Labor cost at {money(laborRate)}/h</td>
                      <td />
                      <td className="pb-1 pr-2 text-right">{money(hours * laborRate)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </DialogContent>
            </Dialog>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GroupRows({ group }: { group: ScreenGroup }) {
  return (
    <>
      <tr>
        <td
          colSpan={5}
          className="pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {group.screen}
        </td>
      </tr>
      {group.rows.map((ln, i) => (
        <tr key={i} className="border-b border-muted/60 tabular-nums">
          <td className="py-1 pr-2 text-right align-top">{qtyText(ln.qty)}</td>
          <td className="py-1 pr-2 align-top">{ln.name}</td>
          <td className="py-1 pr-2 text-right align-top">
            {ln.unitCost > 0 ? money(ln.unitCost) : ""}
          </td>
          <td className="py-1 pr-2 text-right align-top">
            {ln.totalCost > 0 ? money(ln.totalCost) : ""}
          </td>
          <td className="py-1 text-right align-top">{ln.hours > 0 ? hrs(ln.hours) : ""}</td>
        </tr>
      ))}
    </>
  );
}
