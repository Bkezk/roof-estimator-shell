/**
 * Whom an invoice is billed to (owner, Oct 1: "Sometimes invoices go to vendors … then we can
 * select them as a recipient"; "Sometimes it's both a customer and a vendor, so we could make two
 * invoices for that if needed"): the ticket's customer account (the default, as always) or a
 * billable vendor picked by name (VendorPicker). Used by the draft invoice's Bill To
 * (invoice-editor.tsx) and by "Another invoice" on the ticket's invoice card (invoice-block.tsx),
 * which asks up front. The badge "Billed to vendor: <name>" marks such an invoice on the
 * invoice page, the ticket's card and the Invoices list.
 */
import { useState } from "react";
import { Building2, Contact, Loader2, Plus, Truck } from "lucide-react";

import { vendorBilledLabel } from "@/lib/vendors";
import { VendorPicker } from "@/components/crm/vendor-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/** "Billed to vendor: ABC Supply". */
export function VendorBilledBadge({ name }: { name: string | null | undefined }) {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-300 font-normal text-amber-800 dark:border-amber-800 dark:text-amber-200"
    >
      <Truck className="h-3 w-3" aria-hidden />
      {vendorBilledLabel(name)}
    </Badge>
  );
}

/**
 * Customer account | Vendor, and the vendor box when Vendor is chosen. `vendorId` null = the
 * customer account.
 */
export function BillToChoice(props: {
  vendorId: string | null;
  onChange: (vendorId: string | null) => void;
  /** The ticket's customer, shown on the Customer button. */
  customerName: string | null | undefined;
  /** The picked vendor's name when it is no longer billable or is archived. */
  fallbackName?: string | null | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  /** Told when Vendor is chosen or left (a vendor may not be picked yet). */
  onVendorMode?: (vendor: boolean) => void;
}) {
  // Vendor chosen but none picked yet.
  const [wantVendor, setWantVendorState] = useState(false);
  const setWantVendor = (v: boolean) => {
    setWantVendorState(v);
    props.onVendorMode?.(v || !!props.vendorId);
  };
  const vendor = !!props.vendorId || wantVendor;
  const id = props.id ?? "bill-to";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Bill to">
        <Button
          type="button"
          size="sm"
          variant={vendor ? "outline" : "secondary"}
          aria-pressed={!vendor}
          disabled={props.disabled}
          className="h-8 max-w-full gap-1.5"
          onClick={() => {
            setWantVendorState(false);
            props.onVendorMode?.(false);
            if (props.vendorId) props.onChange(null);
          }}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            Customer{props.customerName ? `: ${props.customerName}` : ""}
          </span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant={vendor ? "secondary" : "outline"}
          aria-pressed={vendor}
          disabled={props.disabled}
          className="h-8 gap-1.5"
          onClick={() => setWantVendor(true)}
        >
          <Truck className="h-3.5 w-3.5" /> Vendor
        </Button>
      </div>
      {vendor && (
        <div className="space-y-1">
          <Label htmlFor={`${id}-vendor`} className="text-xs">
            Vendor (billable)
          </Label>
          <VendorPicker
            id={`${id}-vendor`}
            value={props.vendorId}
            billableOnly
            fallbackName={props.fallbackName ?? null}
            disabled={props.disabled}
            placeholder="Type the vendor's name…"
            onChange={(v) => {
              setWantVendorState(!v);
              props.onVendorMode?.(true);
              props.onChange(v?.id ?? null);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * "Another invoice" on the ticket: billed to the customer account or to a vendor, picked before
 * the draft is made (a ticket can carry one invoice to the customer and a second to the vendor).
 */
export function AnotherInvoiceDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobNumber: number | string;
  customerName: string | null | undefined;
  busy: boolean;
  onMake: (vendorId: string | null) => void;
}) {
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorMode, setVendorMode] = useState(false);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(o) => {
        if (!o && props.busy) return;
        if (!o) {
          setVendorId(null);
          setVendorMode(false);
        }
        props.onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Another invoice for ticket #{props.jobNumber}</DialogTitle>
          <DialogDescription>
            Drafted from the ticket&apos;s time and materials, numbered {props.jobNumber}.2,{" "}
            {props.jobNumber}.3, … Bill it to the customer, or to a vendor.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Contact className="h-3.5 w-3.5" /> Bill to
          </p>
          <BillToChoice
            id="another-bill-to"
            vendorId={vendorId}
            customerName={props.customerName}
            disabled={props.busy}
            onChange={setVendorId}
            onVendorMode={setVendorMode}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="ghost"
            disabled={props.busy}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={props.busy || (vendorMode && !vendorId)}
            onClick={() => props.onMake(vendorId)}
          >
            {props.busy ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            {vendorId ? "Make the vendor's invoice" : "Make the invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
