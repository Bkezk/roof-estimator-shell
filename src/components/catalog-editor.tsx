import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, Save, Lock } from "lucide-react";

import { listItemNumbers } from "@/lib/admin-item-numbers.functions";
import {
  getPricingCatalog,
  savePricingScreen,
  type CatalogScreenData,
} from "@/lib/admin-pricing.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const num = (v: string) => (v === "" || v === "-" ? 0 : Number(v)) || 0;
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** Pre-loaded (seeded) rows carry `_locked: true`: name + delete are locked, prices stay editable. */
const LOCK_KEY = "_locked";
const isLocked = (row: Record<string, string | number | boolean>) => row[LOCK_KEY] === true;

export function CatalogEditor({
  branch,
  title,
  intro,
  hideHeader,
  category,
  onCategoryChange,
}: {
  branch: string;
  title: string;
  intro?: string;
  hideHeader?: boolean;
  /** When set (e.g. from a ?cat= URL param), selects the screen with this category name. */
  category?: string;
  /** Called when the user picks a category in the dropdown, so the URL can follow. */
  onCategoryChange?: (category: string) => void;
}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getPricingCatalog);
  const saveFn = useServerFn(savePricingScreen);
  const { data: screens, isLoading } = useQuery({
    queryKey: ["pricing-catalog", branch],
    queryFn: () => getFn({ data: { branch } }),
  });
  const itemNosFn = useServerFn(listItemNumbers);
  const { data: itemNumbers } = useQuery({
    queryKey: ["item-numbers"],
    queryFn: () => itemNosFn(),
    enabled: branch === "duro_last",
  });

  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CatalogScreenData | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const draftIdRef = useRef<string | null>(null);
  draftIdRef.current = draftId;

  const selected = useMemo(() => {
    if (category) {
      const byCat = screens?.find((s) => s.category === category);
      if (byCat) return byCat;
    }
    return screens?.find((s) => s.id === (selId ?? screens?.[0]?.id));
  }, [screens, selId, category]);
  if (selected && selected.id !== draftId) {
    setDraft(clone(selected.data as unknown as CatalogScreenData));
    setDraftId(selected.id);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!screens || screens.length === 0)
    return <p className="text-sm text-muted-foreground">Nothing here yet.</p>;
  if (!selected || !draft) return null;

  const cols = draft.columns;
  // Legacy part-number columns hold text ("1225B", "1312 BF"): never a number input.
  const isPartCol = (c: string) => /part\s*#/i.test(c);
  const itemNosFor = (row: Record<string, unknown>) =>
    itemNumbers?.filter(
      (m) => m.screen_id === selected.id && m.row_label === String(row[labelCol] ?? ""),
    ) ?? [];
  // The label column is "Description" on every legacy screen except Underlayment, whose
  // captured column list is ["Name", "Cost/Sq. Ft."]; fall back to the first column.
  const labelCol = cols.includes("Description") ? "Description" : (cols[0] ?? "Description");
  const valueCols = cols.filter((c) => c !== labelCol);

  const setCell = (ri: number, col: string, v: string | number) =>
    setDraft((p) => {
      const n = clone(p!);
      n.rows[ri]![col] = v;
      return n;
    });

  // Delete a row after the confirm dialog, with a toast Undo that restores it in place.
  // Edits (deletes included) only persist on "Save changes", so Undo before saving is exact.
  const deleteRow = () => {
    if (confirmDelete === null) return;
    const ri = confirmDelete;
    const removed = draft.rows[ri];
    const screenId = selected.id;
    setConfirmDelete(null);
    if (!removed) return;
    setDraft((p) => {
      const n = clone(p!);
      n.rows.splice(ri, 1);
      return n;
    });
    toast("Row deleted", {
      description: String(removed[labelCol] ?? "") || undefined,
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          if (draftIdRef.current !== screenId) {
            toast.error("Switch back to that category to undo this deletion.");
            return;
          }
          setDraft((p) => {
            const n = clone(p!);
            n.rows.splice(Math.min(ri, n.rows.length), 0, removed);
            return n;
          });
        },
      },
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({ data: { id: selected.id, data: draft as never } });
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["pricing-catalog", branch] });
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      {!hideHeader && (
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-sm">Category</Label>
        <Select
          value={selected.id}
          onValueChange={(v) => {
            setSelId(v);
            const scr = screens.find((s) => s.id === v);
            if (scr && onCategoryChange) onCategoryChange(scr.category);
          }}
        >
          <SelectTrigger className="w-[320px] max-w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {screens.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {draft.extras && Object.keys(draft.extras).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Options</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            {Object.entries(draft.extras).map(([k, v]) => (
              <div key={k} className="space-y-2">
                <Label className="text-sm capitalize">{k.replace(/_/g, " ")}</Label>
                <Input
                  value={String(v)}
                  onChange={(e) =>
                    setDraft((p) => {
                      const n = clone(p!);
                      const raw = e.target.value;
                      n.extras = {
                        ...n.extras,
                        [k]: typeof v === "number" && raw !== "" ? num(raw) : raw,
                      };
                      return n;
                    })
                  }
                  className="max-w-[220px]"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{selected.category}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {cols.map((c) => (
                  <TableHead key={c} className="whitespace-nowrap">
                    {c}
                  </TableHead>
                ))}
                {branch === "duro_last" && (
                  <TableHead
                    className="whitespace-nowrap"
                    title="Duro-Last item numbers mapped to this product (Item Numbers & Price Import tab)"
                  >
                    Item #
                  </TableHead>
                )}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.rows.map((row, ri) => (
                <TableRow key={ri}>
                  <TableCell>
                    {isLocked(row) ? (
                      <div className="flex min-w-[220px] items-center gap-1.5 text-sm">
                        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span>{String(row[labelCol] ?? "")}</span>
                      </div>
                    ) : (
                      <Input
                        value={String(row[labelCol] ?? "")}
                        onChange={(e) => setCell(ri, labelCol, e.target.value)}
                        className="min-w-[220px]"
                      />
                    )}
                  </TableCell>
                  {valueCols.map((c) => (
                    <TableCell key={c}>
                      {isPartCol(c) ? (
                        <Input
                          value={String(row[c] ?? "")}
                          onChange={(e) => setCell(ri, c, e.target.value)}
                          className="w-28 font-mono text-xs"
                        />
                      ) : (
                        <Input
                          type="number"
                          step="0.0001"
                          value={Number(row[c] ?? 0)}
                          onChange={(e) => setCell(ri, c, num(e.target.value))}
                          className="w-28"
                        />
                      )}
                    </TableCell>
                  ))}
                  {branch === "duro_last" && (
                    <TableCell className="max-w-[320px] text-xs">
                      {itemNosFor(row).length === 0 ? (
                        <span
                          className="text-muted-foreground"
                          title="No Duro-Last item number mapped — add one on the Item Numbers tab"
                        >
                          —
                        </span>
                      ) : (
                        itemNosFor(row).map((m) => (
                          <span
                            key={`${m.item_no}|${m.price_col}`}
                            className="mb-0.5 mr-1 inline-block whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono"
                            title={
                              m.dl_description
                                ? `${m.dl_description} → ${m.price_col}`
                                : `→ ${m.price_col}`
                            }
                          >
                            {m.item_no}
                            {valueCols.filter((c) => !isPartCol(c)).length > 1 ? (
                              <span className="ml-1 font-sans text-[10px] text-muted-foreground">
                                {m.price_col}
                              </span>
                            ) : null}
                          </span>
                        ))
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    {isLocked(row) ? (
                      <span
                        className="flex justify-center text-muted-foreground"
                        title="Loaded item — can't be deleted; edit its prices only"
                      >
                        <Lock className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(ri)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft((p) => {
                const n = clone(p!);
                const blank: Record<string, string | number> = {};
                for (const c of n.columns) blank[c] = c === labelCol ? "" : 0;
                n.rows.push(blank);
                return n;
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" /> Add row
          </Button>
          <p className="text-xs text-muted-foreground">
            Loaded items (<Lock className="inline h-3 w-3 align-[-1px]" />) keep their name and
            can't be deleted — you can still edit their prices. Rows you add are fully editable.
          </p>
        </CardContent>
      </Card>

      {draft.help && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{draft.help}</p>
      )}

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this row?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete !== null && String(draft.rows[confirmDelete]?.[labelCol] ?? "").trim()
                ? `"${String(draft.rows[confirmDelete]![labelCol])}" will be removed from ${selected.category}.`
                : `This row will be removed from ${selected.category}.`}{" "}
              You can undo right after, and nothing is permanent until you save changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={deleteRow}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
