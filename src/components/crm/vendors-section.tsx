/**
 * The Vendors tab on the Customers page (`/customers?tab=vendors`; owner, Oct 1: "We need
 * somewhere to add vendor info like name, address etc, then we can select them as a recipient";
 * no new sidebar entry — the owner wants fewer nav items). A vendor is a supplier: a PO's Vendor
 * and, when Billable, an invoice's Bill To (lib/vendors.ts).
 *
 * A searchable list (name, city / state, phone, email, terms, billable, archived); archived
 * vendors are hidden unless "Show archived" is on. A row opens the vendor's dialog with every
 * field: admins and managers edit, archive and restore (`canEditVendors`; RLS says the same);
 * everyone else reads. The History fold (who changed what) is there for admins and managers.
 * Errors are toasts with the server's message.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Loader2, Plus, Save, Truck } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  VENDOR_NAME_MAX,
  canEditVendors,
  searchVendors,
  vendorAddressLine,
  vendorCityState,
  vendorDraftOf,
  vendorFormProblem,
  type VendorDraft,
} from "@/lib/vendors";
import { archiveVendor, restoreVendor, saveVendor, type VendorRow } from "@/lib/vendors.functions";
import { VENDORS_KEY, useVendors } from "@/components/crm/use-vendors";
import { AuditHistory } from "@/components/audit-history";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const loudError = (what: string, e: unknown) =>
  toast.error(`${what}: ${errText(e)}`, { duration: 12_000 });

export function VendorsSection() {
  const { profile } = useAuth();
  const canEdit = canEditVendors(profile);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  // null = closed; "new" = adding; a row = that vendor.
  const [open, setOpen] = useState<VendorRow | "new" | null>(null);
  const list = useVendors(showArchived);
  const all = list.data ?? [];
  const rows = searchVendors(all, search);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="search"
          placeholder="Search name, city, phone, email, terms…"
          value={search}
          className="min-w-0 flex-1 sm:max-w-sm"
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
          Show archived
        </label>
        {canEdit && (
          <Button className="sm:ml-auto" onClick={() => setOpen("new")}>
            <Plus className="mr-1 h-4 w-4" /> New vendor
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Suppliers the crews buy from (a PO&apos;s Vendor). A billable vendor can be an
        invoice&apos;s Bill To.
        {canEdit ? "" : " Managers and admins add and change vendors."}
      </p>

      {list.error ? (
        <p className="text-sm text-destructive">
          Could not load the vendors ({errText(list.error)}). Try refreshing, or sign in again.
        </p>
      ) : list.isLoading || !list.data ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading vendors…
        </p>
      ) : all.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {showArchived ? "No vendors yet." : "No vendors yet (archived ones are hidden)."}
          {canEdit ? " Add one with New vendor." : ""}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No vendor matches “{search.trim()}”.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">City / State</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Terms</th>
                <th className="px-3 py-2 font-medium">Billable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr
                  key={v.id}
                  className={`cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40 ${v.archived_at ? "text-muted-foreground" : ""}`}
                  onClick={() => setOpen(v)}
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-left font-medium underline-offset-2 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(v);
                      }}
                    >
                      {v.name}
                    </button>
                    {v.archived_at && (
                      <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[11px] font-normal">
                        Archived
                      </Badge>
                    )}
                    {v.contact_name && (
                      <span className="block text-xs text-muted-foreground">{v.contact_name}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{vendorCityState(v) || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{v.phone || "—"}</td>
                  <td className="px-3 py-2">{v.email || "—"}</td>
                  <td className="px-3 py-2">{v.terms || "—"}</td>
                  <td className="px-3 py-2">{v.billable ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && list.data.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {rows.length} of {all.length} vendor{all.length === 1 ? "" : "s"}
        </p>
      )}

      {open && (
        <VendorDialog
          key={open === "new" ? "new" : open.id}
          vendor={open === "new" ? null : open}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onSaved={(v) => setOpen(v)}
        />
      )}
    </div>
  );
}

const FIELDS: {
  key: Exclude<keyof VendorDraft, "billable" | "notes">;
  label: string;
  max: number;
  wide?: boolean;
  type?: string;
}[] = [
  { key: "name", label: "Name *", max: VENDOR_NAME_MAX, wide: true },
  { key: "address1", label: "Address", max: 200, wide: true },
  { key: "address2", label: "Address 2", max: 200, wide: true },
  { key: "city", label: "City", max: 100 },
  { key: "state", label: "State", max: 2 },
  { key: "zip", label: "Zip", max: 20 },
  { key: "contact_name", label: "Contact", max: 120 },
  { key: "phone", label: "Phone", max: 40, type: "tel" },
  { key: "email", label: "Email", max: 200, type: "email" },
  { key: "terms", label: "Terms (e.g. Net 30)", max: 120 },
  { key: "account_number", label: "Our account #", max: 60 },
];

/** Every field of a vendor: editable for admins and managers, read-only for everyone else. */
function VendorDialog({
  vendor,
  canEdit,
  onClose,
  onSaved,
}: {
  vendor: VendorRow | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (v: VendorRow) => void;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveVendor);
  const archiveFn = useServerFn(archiveVendor);
  const restoreFn = useServerFn(restoreVendor);
  const [draft, setDraft] = useState<VendorDraft>(() => vendorDraftOf(vendor));
  const set = <K extends keyof VendorDraft>(k: K, v: VendorDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: VENDORS_KEY });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };
  const readOnly = !canEdit;

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ...(vendor ? { id: vendor.id } : {}),
          ...draft,
          state: draft.state.trim().toUpperCase() || null,
        },
      }),
    onSuccess: (v) => {
      refresh();
      toast.success(vendor ? `Vendor ${v.name} saved` : `Vendor ${v.name} added`);
      if (vendor) onClose();
      else onSaved(v);
    },
    onError: (e) => loudError(vendor ? "Could not save the vendor" : "Could not add the vendor", e),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      archived ? archiveFn({ data: { id: vendor!.id } }) : restoreFn({ data: { id: vendor!.id } }),
    onSuccess: (v) => {
      refresh();
      toast.success(
        v.archived_at
          ? `${v.name} archived; it is off the pickers`
          : `${v.name} restored to the pickers`,
      );
      onClose();
    },
    onError: (e) => loudError("Could not change the vendor", e),
  });
  const busy = save.isPending || archive.isPending;
  const submit = () => {
    const problem = vendorFormProblem(draft);
    if (problem) {
      loudError("The vendor is not saved", new Error(problem));
      return;
    }
    save.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            {vendor ? vendor.name : "New vendor"}
            {vendor?.archived_at && (
              <Badge variant="outline" className="font-normal">
                Archived
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {vendor
              ? vendorAddressLine(vendor) || "No address yet."
              : "A supplier: a PO's Vendor and, when billable, an invoice's Bill To."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          aria-label={vendor ? `Vendor ${vendor.name}` : "New vendor"}
          onSubmit={(e) => {
            e.preventDefault();
            if (!readOnly) submit();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {FIELDS.map((f) => (
              <div key={f.key} className={`space-y-1 ${f.wide ? "sm:col-span-3" : ""}`}>
                <Label htmlFor={`vendor-${f.key}`}>{f.label}</Label>
                <Input
                  id={`vendor-${f.key}`}
                  type={f.type ?? "text"}
                  maxLength={f.max}
                  autoComplete="off"
                  readOnly={readOnly}
                  disabled={busy}
                  value={draft[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="vendor-notes">Notes</Label>
            <Textarea
              id="vendor-notes"
              rows={3}
              readOnly={readOnly}
              disabled={busy}
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
            <span>
              <span className="font-medium">Billable</span>
              <span className="block text-xs text-muted-foreground">
                May be chosen as an invoice&apos;s Bill To.
              </span>
            </span>
            <Switch
              checked={draft.billable}
              disabled={readOnly || busy}
              aria-label="Billable"
              onCheckedChange={(v) => set("billable", v)}
            />
          </label>
          <DialogFooter className="flex-wrap gap-2 sm:justify-between sm:gap-2">
            {canEdit && vendor ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => archive.mutate(!vendor.archived_at)}
              >
                {archive.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : vendor.archived_at ? (
                  <ArchiveRestore className="mr-1 h-4 w-4" />
                ) : (
                  <Archive className="mr-1 h-4 w-4" />
                )}
                {vendor.archived_at ? "Restore" : "Archive"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                {readOnly ? "Close" : "Cancel"}
              </Button>
              {!readOnly && (
                <Button type="submit" disabled={busy}>
                  {save.isPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-4 w-4" />
                  )}
                  {vendor ? "Save" : "Add vendor"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
        {/* Admins and managers: who changed the vendor (audit_log, entity 'vendor'). */}
        {vendor && <AuditHistory entity="vendor" entityId={vendor.id} />}
      </DialogContent>
    </Dialog>
  );
}
