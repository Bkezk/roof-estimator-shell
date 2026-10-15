/**
 * Inventory › Export (owner, Oct 15): the dialog behind the Export button, for admins and managers
 * (the button renders only under the page's canSeeAll). Pick one of three reports — Stock on
 * hand, Movements, Usage by ticket (inventory-export.ts says what each holds) — a From..To for the
 * dated ones (this month to start with), and whether to include the value in dollars (on by
 * default; everyone who can open this may see it). Export downloads the CSV the server builds
 * (inventory-export.functions.ts), the Sage export's way (invoices-page.tsx ExportDialog).
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { downloadBlob, thisMonth } from "@/components/service/invoice-utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  EXPORT_REPORT_INFO,
  EXPORT_REPORTS,
  exportRangeValid,
  type ExportReport,
} from "@/lib/inventory-export";
import { exportInventoryCsv } from "@/lib/inventory-export.functions";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function InventoryExportDialog({ onClose }: { onClose: () => void }) {
  const exportFn = useServerFn(exportInventoryCsv);
  const month = thisMonth();
  const [report, setReport] = useState<ExportReport>("stock");
  const [from, setFrom] = useState(month.from);
  const [to, setTo] = useState(month.to);
  const [withValue, setWithValue] = useState(true);
  const dated = EXPORT_REPORT_INFO[report].dated;
  const valid = exportRangeValid(report, from, to);
  const run = useMutation({
    mutationFn: () =>
      exportFn({
        data: {
          report,
          from: dated ? from : undefined,
          to: dated ? to : undefined,
          with_value: withValue,
        },
      }),
    onSuccess: (r) => {
      if (r.count === 0) {
        toast.info(
          dated
            ? "Nothing in inventory for that date range."
            : "Nothing in inventory yet — no items have been recorded.",
        );
        return;
      }
      downloadBlob(new Blob([r.csv], { type: "text/csv;charset=utf-8" }), r.file_name);
      toast.success(
        `Exported ${r.count} row${r.count === 1 ? "" : "s"} — ${EXPORT_REPORT_INFO[report].title}`,
      );
      onClose();
    },
    onError: (e) => toast.error(`Could not export: ${errText(e)}`),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !run.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export inventory</DialogTitle>
          <DialogDescription>
            A CSV file that opens in Excel or Google Sheets. Pick what to export.
          </DialogDescription>
        </DialogHeader>
        <form
          id="inventory-export"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) {
              toast.error("Pick a from and to date (from on or before to)");
              return;
            }
            run.mutate();
          }}
        >
          <RadioGroup
            value={report}
            onValueChange={(v) => setReport(v as ExportReport)}
            className="gap-3"
          >
            {EXPORT_REPORTS.map((id) => (
              <label key={id} className="flex cursor-pointer items-start gap-3 text-sm">
                <RadioGroupItem value={id} id={`inventory-export-${id}`} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block font-medium">{EXPORT_REPORT_INFO[id].title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {EXPORT_REPORT_INFO[id].blurb}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
          {dated && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="inventory-export-from">From</Label>
                <Input
                  id="inventory-export-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="inventory-export-to">To</Label>
                <Input
                  id="inventory-export-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={withValue} onCheckedChange={(v) => setWithValue(v === true)} />
            Include value in dollars
          </label>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={run.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="inventory-export" disabled={run.isPending || !valid}>
            {run.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-2 h-4 w-4" />
            )}
            Export CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
