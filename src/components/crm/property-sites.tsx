/**
 * Customers › a property › Sites (owner, Oct 6: "properties also should have a sites form that
 * can be added"): the named sites inside a property — a branch, a building — that a ticket can
 * pick under its property. The names show as chips; Edit sites opens the list: rename, add,
 * remove (a removed site stays on the tickets that name it). Server: property-sites.functions.ts.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Loader2, Plus, Save, Trash2 } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import {
  listPropertySites,
  savePropertySites,
  type PropertySiteRow,
} from "@/lib/property-sites.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Row {
  key: string;
  id?: string;
  name: string;
  notes: string;
}
const toRow = (s: PropertySiteRow): Row => ({
  key: s.id,
  id: s.id,
  name: s.name,
  notes: s.notes ?? "",
});

export function PropertySites({
  propertyId,
  readOnly,
}: {
  propertyId: string;
  readOnly?: boolean | undefined;
}) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listPropertySites);
  const saveFn = useServerFn(savePropertySites);
  const key = ["property-sites", propertyId] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { property_id: propertyId } }),
    enabled: !!session,
  });
  const [rows, setRows] = useState<Row[] | null>(null);
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          property_id: propertyId,
          items: (rows ?? [])
            .filter((r) => r.name.trim() || r.id)
            .map((r) => ({
              ...(r.id ? { id: r.id } : {}),
              name: r.name.trim(),
              notes: r.notes.trim() || null,
            })),
        },
      }),
    onSuccess: (saved) => {
      qc.setQueryData(key, saved);
      setRows(null);
      toast.success("Sites saved");
    },
    onError: (e) => toast.error(`Could not save the sites: ${errText(e)}`),
  });
  const sites = q.data ?? [];
  const edit = (k: string, patch: Partial<Row>) =>
    setRows((rs) => (rs ?? []).map((r) => (r.key === k ? { ...r, ...patch } : r)));

  if (q.error)
    return (
      <p className="mt-1 text-xs text-destructive">Could not load the sites: {errText(q.error)}</p>
    );

  if (!rows)
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Sites">
        <span className="inline-flex items-center gap-1 font-medium">
          <Building2 className="h-3.5 w-3.5" /> Sites:
        </span>
        {sites.length ? (
          sites.map((s) => (
            <span
              key={s.id}
              className="rounded-full border bg-background px-2 py-0.5"
              title={s.notes ?? undefined}
            >
              {s.name}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">none</span>
        )}
        {!readOnly && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => setRows(sites.length ? sites.map(toRow) : [newRow(0)])}
          >
            {sites.length ? "Edit sites" : "Add sites"}
          </Button>
        )}
      </div>
    );

  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-2" aria-label="Edit sites">
      <p className="text-xs text-muted-foreground">
        Named places at this property (a branch, a building). A ticket picks one under its property.
      </p>
      {rows.map((r, i) => (
        <div key={r.key} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={`Site ${i + 1} name`}
            className="h-8 w-56"
            placeholder="e.g. CVNB Somerset"
            maxLength={120}
            value={r.name}
            onChange={(e) => edit(r.key, { name: e.target.value })}
          />
          <Input
            aria-label={`Site ${i + 1} notes`}
            className="h-8 min-w-0 flex-1"
            placeholder="Notes (optional)"
            maxLength={2000}
            value={r.notes}
            onChange={(e) => edit(r.key, { notes: e.target.value })}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive hover:text-destructive"
            aria-label={`Remove ${r.name || "site"}`}
            onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setRows([...rows, newRow(rows.length)])}
        >
          <Plus className="mr-1 h-4 w-4" /> Add site
        </Button>
        <Button type="button" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1 h-4 w-4" />
          )}
          Save sites
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={save.isPending}
          onClick={() => setRows(null)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

const newRow = (n: number): Row => ({ key: `new-${Date.now()}-${n}`, name: "", notes: "" });
