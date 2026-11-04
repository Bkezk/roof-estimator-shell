/**
 * Setup › Material pricing (owner, Oct 6: "on the setup page have a tab that says material
 * pricing and seed it with the prices for those materials"): the service material price list a
 * repair ticket bills from — CenterPoint's 133 to start. Cost per unit; "Bills at" is cost ×
 * (1 + the material markup, set here; moved from Service rates on Oct 6 — a draft invoice can
 * change it for itself). Estimate Pricing (the bids') is separate and
 * untouched. Edit, add (at the top), hide (a hidden material is kept for tickets and stock that
 * already name it). Group: where a material with no bid-catalog twin sits on the Inventory page
 * (Underlayment, Sealants, Cleaning Supplies …); a twin sits under the catalog's own group.
 *
 * Nov 4 (review item 2): the rows read as one line of text each under group headings that fold
 * (closed to start; a search opens them all); a row opens its boxes when clicked (one at a time;
 * edits are kept when another is opened); Show stays a live checkbox on the text row. "Priced
 * here only" keeps the rows whose cost is typed on this page. The count follows the search. Add
 * material puts a new, open row at the top with the cursor in its name. A save sends only the
 * rows that changed (lib/material-pricing-view.ts), and the page's leave dialog knows about
 * unsaved edits (lib/setup-forms.ts).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Save,
  Search,
} from "lucide-react";

import { useAuth } from "@/lib/auth-store";
import { listServiceMaterials, saveServiceMaterials } from "@/lib/service-materials.functions";
import { sellPrice, type ServiceMaterial, priceSource } from "@/lib/service-materials";
import {
  changedMaterials,
  filterMaterials,
  groupMaterials,
  groupOpen,
  isFiltering,
  materialCountLine,
  type MaterialView,
} from "@/lib/material-pricing-view";
import { useSetupForm } from "@/lib/setup-forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { plainErrText } from "@/lib/plain-error";

const errText = plainErrText;
const KEY = ["service-materials"] as const;
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const GRID = "md:grid-cols-[minmax(0,1fr)_6rem_6.5rem_6rem_10rem_3.5rem_4rem]";

interface Row extends MaterialView {
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
  screen: string | null;
  /**
   * The Estimate Pricing cell a shared material takes its cost from (owner, Oct 8: "have the
   * service materials pull through the prices from the estimate pricing"); the cost box is
   * read-only for it and the database keeps it in step (20261008170000).
   */
  source: string | null;
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
  screen: m.stock_screen_id,
  source: priceSource(m),
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
  const [pricedHere, setPricedHere] = useState(false);
  /** The row whose boxes are open. */
  const [editing, setEditing] = useState<string | null>(null);
  /** The group headings the user opened (a search opens them all). */
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  /** The markup, percent, as typed. */
  const [markupText, setMarkupText] = useState("");
  useEffect(() => {
    if (q.data && !dirty) {
      setRows(q.data.items.map(toRow));
      setMarkupText(String(Math.round(q.data.markup * 100000) / 1000));
    }
  }, [q.data, dirty]);
  const loaded = useMemo(
    () => new Map<string, MaterialView>((q.data?.items ?? []).map((m) => [m.id, toRow(m)])),
    [q.data],
  );
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
    const key = `new-${Date.now()}-${rows?.length ?? 0}`;
    // New rows go first, so the one just added is in view.
    setRows((rs) => [
      {
        key,
        name: filter.trim(),
        unit: "Each",
        cost: "",
        active: true,
        category: "",
        shared: false,
        screen: null,
        source: null,
      },
      ...(rs ?? []),
    ]);
    setDirty(true);
    setEditing(key);
  };
  const save = useMutation({
    mutationFn: () => {
      // Only the rows that changed go (and only they are checked), so an error names a row the
      // user touched.
      const items = changedMaterials(rows ?? [], loaded).map((r) => {
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
      setEditing(null);
      setRows(saved.map(toRow));
      toast.success("Material pricing saved");
    },
    onError: (e) => toast.error(`Could not save: ${errText(e)}`),
  });
  useSetupForm("materials", dirty, () => save.mutateAsync());

  const filters = useMemo(
    () => ({ search: filter, showHidden, pricedHere }),
    [filter, showHidden, pricedHere],
  );
  const shown = useMemo(() => filterMaterials(rows ?? [], filters), [rows, filters]);
  const grouped = useMemo(() => groupMaterials(shown), [shown]);
  /** The rows with unsaved edits: their groups stay open. */
  const changedKeys = useMemo(
    () => new Set(changedMaterials(rows ?? [], loaded).map((r) => r.key)),
    [rows, loaded],
  );
  const searching = filter.trim() !== "";
  const hiddenCount = (rows ?? []).filter((r) => !r.active && r.id).length;
  const ownCount = (rows ?? []).filter((r) => r.id && !r.shared).length;
  const total = (rows ?? []).filter((r) => r.id && (showHidden || r.active)).length;
  const shownSaved = shown.filter((r) => r.id).length;
  const toggleGroup = (label: string) =>
    setOpened((o) => {
      const next = new Set(o);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

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
          What repair tickets bill for material. A material that is also on Estimate Pricing takes
          its price from there (grey box: change it on Estimate Pricing and it follows). Cost is per
          unit; Bills at is the cost plus the material markup (cost ×{" "}
          {Math.round((1 + markup) * 1000) / 1000}). A draft invoice can use its own markup. Bids
          are priced on Estimate Pricing — nothing here changes them. Click a material to change it.
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
              <span className="text-sm text-muted-foreground" data-line="count">
                {materialCountLine(shownSaved, total, isFiltering(filters))}
              </span>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={pricedHere} onCheckedChange={(v) => setPricedHere(v === true)} />
                Priced here only ({ownCount})
              </label>
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
            <div className="space-y-2">
              {grouped.map((g) => {
                const open = groupOpen(
                  g.label,
                  opened,
                  searching,
                  g.rows.some((r) => changedKeys.has(r.key)),
                );
                return (
                  <section key={g.label} data-group={g.label}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-sm font-medium hover:bg-muted"
                      aria-expanded={open}
                      onClick={() => toggleGroup(g.label)}
                    >
                      {open ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                      )}
                      {g.label}
                      <span className="font-normal text-muted-foreground">({g.rows.length})</span>
                    </button>
                    {open && (
                      <ul className="space-y-1 pl-1 md:pl-5">
                        {g.rows.map((r) => {
                          const cost = costOf(r);
                          const bills = cost === null ? "—" : USD.format(sellPrice(cost, markup));
                          const isEditing = editing === r.key;
                          return (
                            <li
                              key={r.key}
                              data-row={r.key}
                              data-editing={isEditing || undefined}
                              className={`rounded-md border md:border-0 ${r.active ? "" : "opacity-60"} ${r.id ? "" : "bg-primary/5"}`}
                            >
                              {isEditing ? (
                                <div
                                  className={`grid grid-cols-2 items-center gap-2 p-2 md:p-1 ${GRID}`}
                                >
                                  <Input
                                    aria-label="Material name"
                                    className="col-span-2 h-9 md:col-span-1"
                                    maxLength={200}
                                    autoFocus
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
                                    className={`h-9 tabular-nums ${r.source ? "bg-muted text-muted-foreground" : ""}`}
                                    inputMode="decimal"
                                    value={r.cost}
                                    readOnly={!!r.source}
                                    title={
                                      r.source ? `From ${r.source} — change it there` : undefined
                                    }
                                    onChange={(e) => edit(r.key, { cost: e.target.value })}
                                  />
                                  <span className="text-sm tabular-nums text-muted-foreground">
                                    <span className="md:hidden">Bills at </span>
                                    {bills}
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
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-9"
                                    onClick={() => setEditing(null)}
                                  >
                                    <Check className="mr-1 h-4 w-4" aria-hidden /> Done
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 px-2 py-1 md:px-1 md:py-0.5">
                                  <button
                                    type="button"
                                    className="min-w-0 flex-1 rounded-sm text-left hover:bg-muted"
                                    aria-label={`Change ${r.name || "material"}`}
                                    onClick={() => setEditing(r.key)}
                                  >
                                    <span className="block truncate text-sm">{r.name}</span>
                                    <span className="block text-xs text-muted-foreground">
                                      {r.unit} · cost {cost === null ? "—" : USD.format(cost)}
                                      {r.source ? " (from Estimate Pricing)" : ""} · bills at{" "}
                                      {bills}
                                      {!r.shared && r.category.trim()
                                        ? ` · ${r.category.trim()}`
                                        : ""}
                                    </span>
                                  </button>
                                  <label className="flex shrink-0 items-center gap-2 text-sm">
                                    <Checkbox
                                      aria-label={`Show ${r.name || "material"} on tickets`}
                                      checked={r.active}
                                      onCheckedChange={(v) => edit(r.key, { active: v === true })}
                                    />
                                    <span className="text-xs text-muted-foreground">Show</span>
                                  </label>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 shrink-0"
                                    aria-label={`Edit ${r.name || "material"}`}
                                    onClick={() => setEditing(r.key)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
            {!shown.length && (
              <p className="text-sm text-muted-foreground">
                {searching ? `No material matches “${filter}”.` : "No material to show."}
              </p>
            )}
            {dirty && <div className="flex justify-end">{saveButton}</div>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
