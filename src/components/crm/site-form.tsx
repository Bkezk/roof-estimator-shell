/**
 * The property form (Customers › a customer › Properties › Add property / the pencil), shared
 * since Oct 2: the opportunity's property box (SiteSelect `allowAdd`) opens this same form in a
 * dialog for a customer with none yet (owner, Oct 2: "Don't replicate forms that already exist").
 * Name, address (by addressPayload's rule: no state-only address), county code, technician
 * instructions and notes — and, since Oct 6, the property's Sites and roof Warranties (owner: "if
 * you add a warranty or site on a property it should be when you create the property or when you
 * click the little pencil to edit it"). One Save writes them all: saveSite, then the sites
 * (savePropertySites) and the warranties that changed. `onDone(true, row)` hands back the
 * saved property.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { saveSite, type SiteRow } from "@/lib/crm.functions";
import { CRM_MAX, sitePayload } from "@/lib/crm-account";
import { listPropertySites, savePropertySites } from "@/lib/property-sites.functions";
import {
  deleteSiteWarranty,
  listSiteWarranties,
  saveSiteWarranty,
} from "@/lib/warranties.functions";
import { WARRANTY_MAX, warrantyProblem, type Warranty } from "@/lib/warranty";
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

/** A site inside the property, as edited here. */
interface SiteDraft {
  key: string;
  id?: string;
  name: string;
  notes: string;
}
/** A roof warranty, as edited here (dates as typed, "" = none). */
interface WarrantyDraft {
  key: string;
  id?: string;
  manufacturer: string;
  kind: string;
  number: string;
  start_date: string;
  end_date: string;
  notes: string;
}
const warrantyDraft = (w: Warranty): WarrantyDraft => ({
  key: w.id,
  id: w.id,
  manufacturer: w.manufacturer,
  kind: w.kind ?? "",
  number: w.number ?? "",
  start_date: w.start_date ?? "",
  end_date: w.end_date ?? "",
  notes: w.notes ?? "",
});
let seq = 0;
const newKey = () => `new-${Date.now()}-${seq++}`;
const blankWarranty = (w: WarrantyDraft) =>
  !w.id &&
  ![w.manufacturer, w.kind, w.number, w.start_date, w.end_date, w.notes].some((x) => x.trim());
const sameWarranty = (a: WarrantyDraft, b: WarrantyDraft) =>
  JSON.stringify({ ...a, key: "" }) === JSON.stringify({ ...b, key: "" });

export function SiteForm(props: {
  accountId: string;
  site: SiteRow | null;
  /** Closed: `changed` after a save, with the saved row. */
  onDone: (changed: boolean, row?: SiteRow) => void;
}) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const saveFn = useServerFn(saveSite);
  const listSitesFn = useServerFn(listPropertySites);
  const saveSitesFn = useServerFn(savePropertySites);
  const listWFn = useServerFn(listSiteWarranties);
  const saveWFn = useServerFn(saveSiteWarranty);
  const delWFn = useServerFn(deleteSiteWarranty);
  const [f, setF] = useState<SiteFields>(() => siteFields(props.site));
  const set = <K extends keyof SiteFields>(k: K, v: SiteFields[K]) =>
    setF((p) => ({ ...p, [k]: v }));

  // An existing property's sites and warranties, loaded into the form once.
  const propertyId = props.site?.id ?? null;
  const sitesQ = useQuery({
    queryKey: ["property-sites", propertyId],
    queryFn: () => listSitesFn({ data: { property_id: propertyId! } }),
    enabled: !!session && !!propertyId,
  });
  const warrantiesQ = useQuery({
    queryKey: ["site-warranties", propertyId],
    queryFn: () => listWFn({ data: { site_id: propertyId! } }),
    enabled: !!session && !!propertyId,
  });
  const [sites, setSites] = useState<SiteDraft[] | null>(propertyId ? null : []);
  const [warranties, setWarranties] = useState<WarrantyDraft[] | null>(propertyId ? null : []);
  useEffect(() => {
    if (sites === null && sitesQ.data)
      setSites(
        sitesQ.data.map((s) => ({ key: s.id, id: s.id, name: s.name, notes: s.notes ?? "" })),
      );
  }, [sites, sitesQ.data]);
  useEffect(() => {
    if (warranties === null && warrantiesQ.data) setWarranties(warrantiesQ.data.map(warrantyDraft));
  }, [warranties, warrantiesQ.data]);

  const save = useMutation({
    mutationFn: async () => {
      const row = await saveFn({ data: sitePayload(props.accountId, props.site?.id ?? null, f) });
      // The sites: the whole list (kept, added, removed), when it changed.
      const keptSites = (sites ?? []).filter((s) => s.name.trim() || s.id);
      const before = sitesQ.data ?? [];
      const sitesChanged =
        keptSites.length !== before.length ||
        keptSites.some((s, i) => {
          const b = before[i];
          return (
            !b || b.id !== s.id || b.name !== s.name.trim() || (b.notes ?? "") !== s.notes.trim()
          );
        });
      if (sites && sitesChanged)
        await saveSitesFn({
          data: {
            property_id: row.id,
            items: keptSites.map((s) => ({
              ...(s.id ? { id: s.id } : {}),
              name: s.name.trim(),
              notes: s.notes.trim() || null,
            })),
          },
        });
      // The warranties: removed ones deleted, new or changed ones saved.
      if (warranties) {
        const was = new Map((warrantiesQ.data ?? []).map((w) => [w.id, warrantyDraft(w)]));
        const keep = new Set(warranties.filter((w) => w.id).map((w) => w.id!));
        for (const id of was.keys()) if (!keep.has(id)) await delWFn({ data: { id } });
        for (const w of warranties) {
          if (blankWarranty(w)) continue;
          const old = w.id ? was.get(w.id) : undefined;
          if (old && sameWarranty(old, w)) continue;
          await saveWFn({
            data: {
              ...(w.id ? { id: w.id } : {}),
              site_id: row.id,
              manufacturer: w.manufacturer,
              kind: w.kind,
              number: w.number,
              start_date: w.start_date || null,
              end_date: w.end_date || null,
              notes: w.notes,
            },
          });
        }
      }
      return row;
    },
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ["property-sites", row.id] });
      void qc.invalidateQueries({ queryKey: ["site-warranties", row.id] });
      toast.success(props.site ? "Property saved" : "Property added");
      props.onDone(true, row);
    },
    onError: (e) => toast.error(`Could not save the property: ${errText(e)}`),
  });
  const idp = props.site?.id ?? "new";

  const problemOf = (): string | null => {
    if (!f.name.trim()) return "The property needs a name";
    const names = new Set<string>();
    for (const s of sites ?? []) {
      const n = s.name.trim().toLowerCase();
      if (!n) {
        if (s.id || s.notes.trim()) return "Every site needs a name";
        continue;
      }
      if (names.has(n)) return `Two sites are called "${s.name.trim()}" — rename one`;
      names.add(n);
    }
    for (const w of warranties ?? []) {
      if (blankWarranty(w)) continue;
      const p = warrantyProblem({
        manufacturer: w.manufacturer,
        start_date: w.start_date || null,
        end_date: w.end_date || null,
      });
      if (p) return `Warranty: ${p}`;
    }
    return null;
  };

  return (
    <form
      className="space-y-2 rounded-md border border-primary/40 bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        // In a dialog over another form (an opportunity's), React still bubbles the submit to it.
        e.stopPropagation();
        const problem = problemOf();
        if (problem) {
          toast.error(problem);
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

      {/* Sites inside the property (owner, Oct 6): a ticket picks one under its property. */}
      <fieldset className="space-y-2 rounded-md border bg-background p-2" aria-label="Sites">
        <legend className="flex items-center gap-1 px-1 text-sm font-medium">
          <Building2 className="h-4 w-4" /> Sites
        </legend>
        <p className="text-xs text-muted-foreground">
          Named places at this property (a branch, a building). A ticket picks one under its
          property.
        </p>
        {sites === null ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the sites…
          </p>
        ) : (
          sites.map((s, i) => (
            <div key={s.key} className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Site ${i + 1} name`}
                className="h-8 w-56"
                placeholder="e.g. CVNB Somerset"
                maxLength={120}
                value={s.name}
                onChange={(e) =>
                  setSites((ls) =>
                    (ls ?? []).map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)),
                  )
                }
              />
              <Input
                aria-label={`Site ${i + 1} notes`}
                className="h-8 min-w-0 flex-1"
                placeholder="Notes (optional)"
                maxLength={2000}
                value={s.notes}
                onChange={(e) =>
                  setSites((ls) =>
                    (ls ?? []).map((x) => (x.key === s.key ? { ...x, notes: e.target.value } : x)),
                  )
                }
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive hover:text-destructive"
                aria-label={`Remove ${s.name || "site"}`}
                onClick={() => setSites((ls) => (ls ?? []).filter((x) => x.key !== s.key))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
        {sites !== null && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() =>
              setSites((ls) => [...(ls ?? []), { key: newKey(), name: "", notes: "" }])
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add site
          </Button>
        )}
      </fieldset>

      {/* Roof warranties (service study M5): their badge shows on the tickets while in force. */}
      <fieldset className="space-y-2 rounded-md border bg-background p-2" aria-label="Warranties">
        <legend className="flex items-center gap-1 px-1 text-sm font-medium">
          <ShieldCheck className="h-4 w-4" /> Warranties
        </legend>
        {warranties === null ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the warranties…
          </p>
        ) : (
          warranties.map((w, i) => {
            const setW = (patch: Partial<WarrantyDraft>) =>
              setWarranties((ls) =>
                (ls ?? []).map((x) => (x.key === w.key ? { ...x, ...patch } : x)),
              );
            const n = i + 1;
            return (
              <div key={w.key} className="grid gap-2 rounded-md border p-2 sm:grid-cols-2">
                <Input
                  aria-label={`Warranty ${n} manufacturer`}
                  className="h-8"
                  placeholder="Manufacturer, e.g. Duro-Last"
                  maxLength={WARRANTY_MAX.manufacturer}
                  value={w.manufacturer}
                  onChange={(e) => setW({ manufacturer: e.target.value })}
                />
                <Input
                  aria-label={`Warranty ${n} type`}
                  className="h-8"
                  placeholder="Type, e.g. 15 NDL"
                  maxLength={WARRANTY_MAX.kind}
                  value={w.kind}
                  onChange={(e) => setW({ kind: e.target.value })}
                />
                <Input
                  aria-label={`Warranty ${n} number`}
                  className="h-8"
                  placeholder="Warranty #"
                  maxLength={WARRANTY_MAX.number}
                  value={w.number}
                  onChange={(e) => setW({ number: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label={`Warranty ${n} start`}
                    title="Start"
                    className="h-8"
                    type="date"
                    maxLength={10}
                    value={w.start_date}
                    onChange={(e) => setW({ start_date: e.target.value })}
                  />
                  <Input
                    aria-label={`Warranty ${n} end`}
                    title="End"
                    className="h-8"
                    type="date"
                    maxLength={10}
                    value={w.end_date}
                    onChange={(e) => setW({ end_date: e.target.value })}
                  />
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <Input
                    aria-label={`Warranty ${n} notes`}
                    className="h-8 min-w-0 flex-1"
                    placeholder="Notes (optional)"
                    maxLength={WARRANTY_MAX.notes}
                    value={w.notes}
                    onChange={(e) => setW({ notes: e.target.value })}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    aria-label={`Remove warranty ${n}`}
                    onClick={() => setWarranties((ls) => (ls ?? []).filter((x) => x.key !== w.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
        {warranties !== null && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() =>
              setWarranties((ls) => [
                ...(ls ?? []),
                {
                  key: newKey(),
                  manufacturer: "",
                  kind: "",
                  number: "",
                  start_date: "",
                  end_date: "",
                  notes: "",
                },
              ])
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add warranty
          </Button>
        )}
      </fieldset>

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
