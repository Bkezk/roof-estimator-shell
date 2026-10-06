/**
 * The site form (Customers › a customer › Sites › Add site / Edit), shared since Oct 2: the
 * opportunity's site box (SiteSelect `allowAdd`) opens this same form in a dialog for a customer
 * with no site yet (owner, Oct 2: "Don't replicate forms that already exist"). Name, address (by
 * addressPayload's rule: no state-only address), county code, technician instructions and notes;
 * saveSite writes it. `onDone(true, row)` hands back the saved site.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { saveSite, type SiteRow } from "@/lib/crm.functions";
import { CRM_MAX, sitePayload } from "@/lib/crm-account";
import { CountyCodePicker } from "@/components/crm/county-code-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type SiteFields = {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  technician_instructions: string;
  /** The site's notes (crm_sites.notes): the form carries them, so a save keeps them. */
  notes: string;
  /** The JBK county code (county_codes.id), or none. */
  county_code_id: string | null;
};
const siteFields = (s: SiteRow | null): SiteFields => ({
  name: s?.name ?? "",
  address1: s?.address1 ?? "",
  address2: s?.address2 ?? "",
  city: s?.city ?? "",
  state: s ? (s.state ?? "") : "KY",
  zip: s?.zip ?? "",
  technician_instructions: s?.technician_instructions ?? "",
  notes: s?.notes ?? "",
  county_code_id: s?.county_code_id ?? null,
});

export function SiteForm(props: {
  accountId: string;
  site: SiteRow | null;
  /** Closed: `changed` after a save, with the saved row. */
  onDone: (changed: boolean, row?: SiteRow) => void;
}) {
  const saveFn = useServerFn(saveSite);
  const [f, setF] = useState<SiteFields>(() => siteFields(props.site));
  const set = <K extends keyof SiteFields>(k: K, v: SiteFields[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const save = useMutation({
    mutationFn: () => saveFn({ data: sitePayload(props.accountId, props.site?.id ?? null, f) }),
    onSuccess: (row) => {
      toast.success(props.site ? "Property saved" : "Property added");
      props.onDone(true, row);
    },
    onError: (e) => toast.error(`Could not save the property: ${errText(e)}`),
  });
  const idp = props.site?.id ?? "new";
  return (
    <form
      className="space-y-2 rounded-md border border-primary/40 bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        // In a dialog over another form (an opportunity's), React still bubbles the submit to it.
        e.stopPropagation();
        if (!f.name.trim()) {
          toast.error("The property needs a name");
          return;
        }
        save.mutate();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`site-${idp}-name`}>Property name</Label>
        <Input
          id={`site-${idp}-name`}
          maxLength={CRM_MAX.name}
          autoFocus
          value={f.name}
          placeholder="e.g. Yellow Creek Elementary"
          onChange={(e) => set("name", e.target.value)}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          aria-label="Address line 1"
          maxLength={CRM_MAX.address1}
          placeholder="Address line 1"
          value={f.address1}
          onChange={(e) => set("address1", e.target.value)}
        />
        <Input
          aria-label="Address line 2"
          maxLength={CRM_MAX.address2}
          placeholder="Address line 2"
          value={f.address2}
          onChange={(e) => set("address2", e.target.value)}
        />
      </div>
      <div className="grid grid-cols-[1fr_4.5rem_6rem] gap-2">
        <Input
          aria-label="City"
          maxLength={CRM_MAX.city}
          placeholder="City"
          value={f.city}
          onChange={(e) => set("city", e.target.value)}
        />
        <Input
          aria-label="State"
          maxLength={CRM_MAX.state}
          placeholder="State"
          value={f.state}
          onChange={(e) => set("state", e.target.value)}
        />
        <Input
          aria-label="Zip"
          maxLength={CRM_MAX.zip}
          placeholder="Zip"
          inputMode="numeric"
          value={f.zip}
          onChange={(e) => set("zip", e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`site-${idp}-county`}>County code</Label>
        <CountyCodePicker
          id={`site-${idp}-county`}
          value={f.county_code_id}
          onChange={(v) => set("county_code_id", v)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`site-${idp}-tech`}>Technician instructions</Label>
        <Textarea
          id={`site-${idp}-tech`}
          rows={2}
          placeholder="e.g. Check in at the front office; roof hatch in the boiler room"
          maxLength={CRM_MAX.technician_instructions}
          value={f.technician_instructions}
          onChange={(e) => set("technician_instructions", e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`site-${idp}-notes`}>Notes</Label>
        <Textarea
          id={`site-${idp}-notes`}
          rows={2}
          placeholder="e.g. Gate code 1234; roof replaced 2019"
          maxLength={CRM_MAX.notes}
          value={f.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {props.site ? "Save property" : "Add property"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={save.isPending}
          onClick={() => props.onDone(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
