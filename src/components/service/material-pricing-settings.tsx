/**
 * Setup › Material pricing (owner, Oct 6: "on the setup page have a tab that says material
 * pricing and seed it with the prices for those materials"): the service material price list a
 * repair ticket bills from — CenterPoint's 133 to start. Cost per unit; "Bills at" is cost ×
 * (1 + the material markup, set here; moved from Service rates on Oct 6 — a draft invoice can
 * change it for itself). Estimate Pricing (the bids') is separate and
 * untouched. Edit, add (at the top), hide (a hidden material is kept for tickets and stock that
 * already name it). Group: where a material with no bid-catalog twin sits on the Inventory page
 * (Underlayment, Sealants, Cleaning Supplies …); a twin sits under the catalog's own group.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, Save, Search } from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listServiceMaterials, saveServiceMaterials } from "@/lib/service-materials.functions";
import { sellPrice, type ServiceMaterial } from "@/lib/service-materials";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const KEY = ["service-materials"] as const;
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const GRID = "md:grid-cols-[minmax(0,1fr)_6rem_6.5rem_6rem_10rem_3.5rem]";

interface Row {
  key: string;
  id?: string;
  name: string;
  unit: string;
  /** As typed, so "0." survives; parsed on save. */
  cost: string;
  active: boolean;
  category: string;
  /** Counted in the bid catalog's stock (its group is the catalog's): no Group field. */
  shared: boolean;
}
const toRow = (m: ServiceMaterial): Row => ({
  key: m.id,
  id: m.id,
  name: m.name,
  unit: m.unit,
  cost: String(Number(m.cost)),
  active: m.active,
  category: m.category ?? "",
  shared: !!m.stock_screen_id,
});
const costOf = (r: Row) => {
  const n = Number(r.cost.trim().replace(/^\$/, ""));
  return r.cost.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
};

export function MaterialPricingSettings() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listServiceMaterials);
  const saveFn = useServerFn(saveServiceMaterials);
  const q = useQuery({ queryKey: KEY, queryFn: () => listFn(), enabled: !!session });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  /** The markup, percent, as typed. */
  const [markupText, setMarkupText] = useState("");
  useEffect(() => {
    if (q.data && !dirty) {
      setRows(q.data.items.map(toRow));
      setMarkupText(String(Math.round(q.data.markup * 100000) / 1000));
    }
  }, [q.data, dirty]);
  const markupPct = Number(markupText);
  const markupOk =
    markupText.trim() !== "" && Number.isFinite(markupPct) && markupPct >= 0 && markupPct <= 1000;
  const markup = markupOk ? markupPct / 100 : (q.data?.markup ?? 0.75);
  const groups = useMemo(
    () =>
      [...new Set((rows ?? []).map((r) => r.category.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [rows],
  );

  const edit = (key: string, patch: Partial<Row>) => {
    setRows((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const addRow = () => {
    // New rows go first, so the one just added is in view.
    setRows((rs) => [
      {
        key: `new-${Date.now()}-${rs?.length ?? 0}`,
        name: filter.trim(),
        unit: "Each",
        cost: "",
        active: true,
        category: "",
        shared: false,
      },
      ...(rs ?? []),
    ]);
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: () => {
      const items = (rows ?? []).map((r) => {
        const cost = costOf(r);
        if (!r.name.trim()) throw new Error("Every material needs a name");
        if (!r.unit.trim()) throw new Error(`"${r.name}" needs a unit`);
        if (cost === null) throw new Error(`"${r.name}": type the cost as a number`);
        return {
          ...(r.id ? { id: r.id } : {}),
          name: r.name.trim(),
          unit: r.unit.trim(),
          cost,
          active: r.active,
          category: r.category.trim() || null,
        };
      });
      if (!markupOk) throw new Error("Type the material markup as a percent (0 to 1000)");
      return saveFn({ data: { items, markup: markupPct / 100 } });
    },
    onSuccess: (saved) => {
      qc.setQueryData(KEY, { items: saved, markup });
      setDirty(false);
      setRows(saved.map(toRow));
      toast.success("Material pricing saved");
    },
    onError: (e) => toast.error(`Could not save: ${errText(e)}`),
  });

  const shown = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return (rows ?? []).filter(
      (r) =>
        !r.id ||
        ((showHidden || r.active) &&
          words.every((w) => `${r.name} ${r.unit} ${r.category}`.toLowerCase().includes(w))),
    );
  }, [rows, filter, showHidden]);
  const hiddenCount = (rows ?? []).filter((r) => !r.active && r.id).length;

  const saveButton = (
    <Button
      type="button"
      size="sm"
      disabled={!dirty || save.isPending}
      onClick={() => save.mutate()}
    >
      {save.isPending ? (
        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
      ) : (
        <Save className="mr-1 h-4 w-4" />
      )}
      Save material pricing
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Material pricing</CardTitle>
        <CardDescription>
          What repair tickets bill for material. Cost is per unit; Bills at is the cost plus the
          material markup (cost × {Math.round((1 + markup) * 1000) / 1000}). A draft invoice can use
          its own markup. Bids are priced on Estimate Pricing — nothing here changes them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.error ? (
          <p className="text-sm text-destructive">
            Could not load material pricing: {errText(q.error)}
          </p>
        ) : !rows ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className="block text-sm font-medium">Material markup %</span>
                <Input
                  aria-label="Material markup %"
                  className="h-9 w-28 tabular-nums"
                  inputMode="decimal"
                  aria-invalid={!markupOk || undefined}
                  value={markupText}
                  onChange={(e) => {
                    setMarkupText(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <p className="pb-2 text-xs text-muted-foreground">
                75 % bills a $10 part at $17.50. New invoices start with it.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="mr-1 h-4 w-4" /> Add material
              </Button>
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label="Search materials"
                  placeholder="Search materials"
                  className="h-9 pl-8"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <span className="text-sm text-muted-foreground">
                {rows.filter((r) => r.active).length} materials
              </span>
              {hiddenCount > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={showHidden}
                    onCheckedChange={(v) => setShowHidden(v === true)}
                  />
                  Show {hiddenCount} hidden
                </label>
              )}
              {dirty && (
                <div className="flex items-center gap-2">
                  {saveButton}
                  <span className="text-xs text-muted-foreground">Unsaved changes</span>
                </div>
              )}
            </div>
            <datalist id="material-groups">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <div
              className={`hidden gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid ${GRID}`}
            >
              <span>Material</span>
              <span>Unit</span>
              <span>Cost</span>
              <span>Bills at</span>
              <span>Group</span>
              <span>Show</span>
            </div>
            <ul className="space-y-2 md:space-y-1">
              {shown.map((r) => {
                const cost = costOf(r);
                return (
                  <li
                    key={r.key}
                    className={`grid grid-cols-2 items-center gap-2 rounded-md border p-2 md:border-0 md:p-1 ${GRID} ${r.active ? "" : "opacity-60"} ${r.id ? "" : "bg-primary/5"}`}
                  >
                    <Input
                      aria-label="Material name"
                      className="col-span-2 h-9 md:col-span-1"
                      maxLength={200}
                      value={r.name}
                      onChange={(e) => edit(r.key, { name: e.target.value })}
                    />
                    <Input
                      aria-label={`Unit of ${r.name || "material"}`}
                      className="h-9"
                      maxLength={30}
                      value={r.unit}
                      onChange={(e) => edit(r.key, { unit: e.target.value })}
                    />
                    <Input
                      aria-label={`Cost of ${r.name || "material"}`}
                      className="h-9 tabular-nums"
                      inputMode="decimal"
                      value={r.cost}
                      onChange={(e) => edit(r.key, { cost: e.target.value })}
                    />
                    <span className="text-sm tabular-nums text-muted-foreground">
                      <span className="md:hidden">Bills at </span>
                      {cost === null ? "—" : USD.format(sellPrice(cost, markup))}
                    </span>
                    {r.shared ? (
                      <span className="hidden md:block" />
                    ) : (
                      <Input
                        aria-label={`Group of ${r.name || "material"}`}
                        className="h-9"
                        list="material-groups"
                        maxLength={80}
                        placeholder="Group"
                        value={r.category}
                        onChange={(e) => edit(r.key, { category: e.target.value })}
                      />
                    )}
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        aria-label={`Show ${r.name || "material"} on tickets`}
                        checked={r.active}
                        onCheckedChange={(v) => edit(r.key, { active: v === true })}
                      />
                      <span className="md:hidden">Show on tickets</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {!shown.length && (
              <p className="text-sm text-muted-foreground">No material matches “{filter}”.</p>
            )}
            {dirty && <div className="flex justify-end">{saveButton}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
