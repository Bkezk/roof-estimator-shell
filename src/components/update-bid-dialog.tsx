import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** The legacy frmUpdateBidOptions checkboxes (frmHome.btnUpdate_Click). */
export interface UpdateBidOptions {
  /** cbMaterialPricing: replace the bid's frozen management data with the current admin data. */
  materialPricing: boolean;
  /** cbUnderQuoteReset: drop the bid's custom underlayment $/sq ft quotes (else they survive). */
  resetUnderlaymentQuotes: boolean;
  /** cbNDLUnitLabor / cbNDLLaborRate / cbNDLUnitPrice: Non-DL rows back to management defaults. */
  ndlUnitLabor: boolean;
  ndlLaborRate: boolean;
  ndlUnitPrice: boolean;
  /** cbLaborTemplate: re-apply the management template modifiers (overrides manual labor %). */
  laborTemplate: boolean;
  /** cbLatestFormulas: stamp the bid with the current formulas version. */
  latestFormulas: boolean;
}

export function UpdateBidDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the current admin data differs from the bid's frozen copy. */
  pricingStale: boolean;
  frozenAsOf: string | null;
  underlaymentQuoteCount: number;
  ndlOverrides: { unitPrice: number; unitLabor: number; laborRate: number };
  laborTemplateName: string;
  formulasVersion: string;
  latestFormulasVersion: string;
  onApply: (opts: UpdateBidOptions) => Promise<void>;
}) {
  const [o, setO] = useState<UpdateBidOptions>({
    materialPricing: false,
    resetUnderlaymentQuotes: false,
    ndlUnitLabor: false,
    ndlLaborRate: false,
    ndlUnitPrice: false,
    laborTemplate: false,
    latestFormulas: false,
  });
  const [busy, setBusy] = useState(false);
  // Legacy opens with nothing ticked; pre-tick the pricing box when it is actually stale.
  useEffect(() => {
    if (props.open)
      setO({
        materialPricing: props.pricingStale,
        resetUnderlaymentQuotes: false,
        ndlUnitLabor: false,
        ndlLaborRate: false,
        ndlUnitPrice: false,
        laborTemplate: false,
        latestFormulas: false,
      });
  }, [props.open, props.pricingStale]);
  const isLatest = props.formulasVersion === props.latestFormulasVersion;
  const anything = o.materialPricing || o.laborTemplate || (o.latestFormulas && !isLatest);
  const sub = (
    key: "resetUnderlaymentQuotes" | "ndlUnitLabor" | "ndlLaborRate" | "ndlUnitPrice",
    label: string,
    count: number,
  ) => (
    <label
      className={`flex items-start gap-2 text-sm ${o.materialPricing ? "" : "text-muted-foreground"}`}
    >
      <input
        type="checkbox"
        className="mt-0.5"
        disabled={!o.materialPricing}
        checked={o[key]}
        onChange={(e) => setO({ ...o, [key]: e.target.checked })}
      />
      <span>
        {label}
        {count > 0 ? (
          <span className="ml-1 text-xs text-muted-foreground">({count} on this bid)</span>
        ) : (
          <span className="ml-1 text-xs text-muted-foreground">(none on this bid)</span>
        )}
      </span>
    </label>
  );
  return (
    <Dialog open={props.open} onOpenChange={(v) => !busy && props.onOpenChange(v)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Update Bid Options</DialogTitle>
          <DialogDescription>
            Please select the options with which you wish to update your bid. Nothing is saved until
            you save the bid.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="space-y-2">
            <label className="flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={o.materialPricing}
                onChange={(e) => setO({ ...o, materialPricing: e.target.checked })}
              />
              <span>
                Update Material Pricing &amp; Unit Labor
                <div className="text-xs font-normal text-muted-foreground">
                  Replaces every price, labor table and warranty rate this bid froze
                  {props.frozenAsOf
                    ? ` on ${new Date(props.frozenAsOf).toLocaleDateString()}`
                    : ""}{" "}
                  with the current management data.{" "}
                  {props.pricingStale
                    ? "Management data has changed since."
                    : "Management data is unchanged — this only matters with a sub-option."}
                </div>
              </span>
            </label>
            <div className="ml-6 space-y-1.5 rounded-md border p-2">
              <p className="text-xs font-medium text-destructive">
                These sub-options may reset quoted and/or custom values
              </p>
              <p className="text-xs text-muted-foreground">
                Non-DL rows keep the price, labor per unit and labor rate this bid already carries
                unless the matching box is ticked, which copies the current management value onto
                every row.
              </p>
              {sub(
                "resetUnderlaymentQuotes",
                "Reset Underlayment Price Quotes",
                props.underlaymentQuoteCount,
              )}
              {sub(
                "ndlUnitLabor",
                "Update Non-DL Labor/Unit to Management Defaults",
                props.ndlOverrides.unitLabor,
              )}
              {sub(
                "ndlLaborRate",
                "Update Non-DL Labor Rate to Management Defaults",
                props.ndlOverrides.laborRate,
              )}
              {sub(
                "ndlUnitPrice",
                "Update Non-DL Price/Unit to Management Defaults",
                props.ndlOverrides.unitPrice,
              )}
            </div>
          </div>
          <label className="flex items-start gap-2 font-medium">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={o.laborTemplate}
              onChange={(e) => setO({ ...o, laborTemplate: e.target.checked })}
            />
            <span>
              Update Labor Template
              <div className="text-xs font-normal text-muted-foreground">
                Applies the current management modifiers of the template &quot;
                {props.laborTemplateName || "None"}&quot;. This will override all manually entered
                labor settings (the % adjustments on sections, parapets, curbs, accessories, setup
                and inspection).
              </div>
            </span>
          </label>
          <label
            className={`flex items-start gap-2 font-medium ${isLatest ? "text-muted-foreground" : ""}`}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              disabled={isLatest}
              checked={o.latestFormulas && !isLatest}
              onChange={(e) => setO({ ...o, latestFormulas: e.target.checked })}
            />
            <span>
              Upgrade to Latest Formulas
              <div className="text-xs font-normal">
                {isLatest
                  ? `This bid already uses the latest formulas (${props.latestFormulasVersion}).`
                  : `This bid computes with the formulas it was created under (${props.formulasVersion}); tick to move it to ${props.latestFormulasVersion}.`}
              </div>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={busy || !anything}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onApply(o);
                props.onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Updating…" : "OK"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
