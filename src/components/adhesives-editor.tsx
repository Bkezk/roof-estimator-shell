import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, Save } from "lucide-react";

import { ADHESIVE_COVERAGE_GROUPS, ADHESIVE_GROUPS_LIST_ID } from "@/lib/adhesive-groups";
import { getPricingScreen, savePricingScreen } from "@/lib/admin-pricing.functions";
import {
  ADHESIVES_SCREEN_ID,
  mergeAdhesiveProducts,
  type AdhesiveProduct,
} from "@/lib/non-dl-adhesives";
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

const SCREEN_ID = ADHESIVES_SCREEN_ID;

const numOrNull = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

interface AdhesivesData {
  kind: "adhesives";
  master_label?: string;
  products: AdhesiveProduct[];
  help?: string;
  notes?: string;
  gaps?: string[];
}

/** A new product; with a group, its first coverage row starts in that group (the non-DL page). */
const emptyProduct = (group?: string): AdhesiveProduct => ({
  name: "New Adhesive",
  price: 0,
  unit_type: "",
  part_no: "",
  field_spacing: "",
  perim_spacing: "",
  coverage: group ? [{ group, substrate: "", field_coverage: 0 }] : [],
});

export interface AdhesivesTabProps {
  /**
   * A view of part of the one adhesives screen (owner, Oct 27: the Firestone / I.S.O. products on
   * their own Non-DL TPO and EPDM Adhesives page while the engine keeps reading the one screen;
   * lib/non-dl-adhesives.ts): only the products passing the filter are listed and edited, and the
   * save merges them back into the whole product list (mergeAdhesiveProducts), the rest untouched.
   * Absent = every product.
   */
  productFilter?: ((product: AdhesiveProduct) => boolean) | undefined;
  /** The coverage group a product added here starts with (so it belongs to this view). */
  newProductGroup?: string | undefined;
}

export function AdhesivesTab({ productFilter, newProductGroup }: AdhesivesTabProps = {}) {
  const qc = useQueryClient();
  const getFn = useServerFn(getPricingScreen);
  const saveFn = useServerFn(savePricingScreen);
  const { data: row, isLoading } = useQuery({
    queryKey: ["pricing-screen", SCREEN_ID],
    queryFn: () => getFn({ data: { id: SCREEN_ID } }),
  });

  const [draft, setDraft] = useState<AdhesivesData | null>(null);
  const [selIdx, setSelIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  // The screen as stored, and the view of it this editor works on (the filtered products).
  const stored = useMemo<AdhesivesData | null>(
    () => (row ? (row.data as unknown as AdhesivesData) : null),
    [row],
  );
  const data = useMemo<AdhesivesData | null>(() => {
    if (draft) return draft;
    if (!stored) return null;
    if (!productFilter) return stored;
    return { ...stored, products: (stored.products ?? []).filter(productFilter) };
  }, [draft, stored, productFilter]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading adhesives…</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">No adhesives data found.</p>;
  }

  const products = data.products ?? [];
  const idx = Math.min(selIdx, Math.max(0, products.length - 1));
  const product = products[idx];

  const mutate = (fn: (d: AdhesivesData) => void) => {
    const next = clone(data);
    fn(next);
    setDraft(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      // A filtered view saves the WHOLE screen: its edited products merged back among the ones
      // it never showed (lib/non-dl-adhesives.ts).
      const whole: AdhesivesData =
        productFilter && stored
          ? {
              ...data,
              products: mergeAdhesiveProducts(stored.products ?? [], productFilter, data.products),
            }
          : data;
      await saveFn({ data: { id: SCREEN_ID, data: whole as unknown as Record<string, unknown> } });
      qc.setQueryData(["pricing-screen", SCREEN_ID], { ...row, data: whole });
      setDraft(null);
      toast.success("Adhesives saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <Label>{data.master_label ?? "Adhesive"}</Label>
          <div className="flex items-center gap-2">
            <Select value={String(idx)} onValueChange={(v) => setSelIdx(Number(v))}>
              <SelectTrigger className="w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {products.map((p, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                mutate((d) => d.products.push(emptyProduct(newProductGroup)));
                setSelIdx(products.length);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Add adhesive
            </Button>
          </div>
        </div>
        <Button onClick={save} disabled={saving || !draft}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      {product && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{product.name}</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => {
                mutate((d) => d.products.splice(idx, 1));
                setSelIdx(Math.max(0, idx - 1));
              }}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Remove adhesive
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={product.name}
                  onChange={(e) => mutate((d) => (d.products[idx]!.name = e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Price</Label>
                <Input
                  type="number"
                  value={product.price}
                  onChange={(e) =>
                    mutate((d) => (d.products[idx]!.price = Number(e.target.value) || 0))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unit Type</Label>
                <Input
                  value={product.unit_type}
                  onChange={(e) => mutate((d) => (d.products[idx]!.unit_type = e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Part #</Label>
                <Input
                  value={product.part_no}
                  onChange={(e) => mutate((d) => (d.products[idx]!.part_no = e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Field Spacing</Label>
                <Input
                  value={product.field_spacing}
                  onChange={(e) => mutate((d) => (d.products[idx]!.field_spacing = e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Perim Spacing</Label>
                <Input
                  value={product.perim_spacing}
                  onChange={(e) => mutate((d) => (d.products[idx]!.perim_spacing = e.target.value))}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-sm">Coverage (SqFt) by substrate</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    mutate((d) => {
                      const last = d.products[idx]!.coverage.at(-1);
                      d.products[idx]!.coverage.push({
                        group: last?.group ?? "",
                        substrate: "",
                        field_coverage: 0,
                      });
                    })
                  }
                >
                  <Plus className="mr-1 h-4 w-4" /> Add row
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This grid IS the estimator&apos;s adhesive coverage (legacy AdhesiveCoverage): a
                roof-system group — Duro-Last / Duro-Bond / Duro-Tuff / Duro-Roof / Duro-Fleece, and
                Duro-Tech TPO, Non-DL TPO and EPDM Rubber for the accessory families — drives the
                membrane and Walls units for that system; the Insulations group drives
                insulation-layer units. The Group cell offers those names; a bid only finds a group
                spelled exactly that way. A blank cell keeps the installer-seeded value; 0 means
                &quot;needs a quote&quot;. Labor hours stay on Labor &rsaquo; Adhesive Times.
              </p>
              <datalist id={ADHESIVE_GROUPS_LIST_ID}>
                {ADHESIVE_COVERAGE_GROUPS.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[28%]">Group</TableHead>
                      <TableHead>Substrate</TableHead>
                      <TableHead className="w-[24%]">Field Coverage(SqFt)</TableHead>
                      <TableHead className="w-[48px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {product.coverage.map((c, ci) => (
                      <TableRow key={ci}>
                        <TableCell>
                          <Input
                            list={ADHESIVE_GROUPS_LIST_ID}
                            value={c.group}
                            onChange={(e) =>
                              mutate((d) => (d.products[idx]!.coverage[ci]!.group = e.target.value))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={c.substrate}
                            onChange={(e) =>
                              mutate(
                                (d) => (d.products[idx]!.coverage[ci]!.substrate = e.target.value),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={c.field_coverage ?? ""}
                            placeholder="—"
                            onChange={(e) =>
                              mutate(
                                (d) =>
                                  (d.products[idx]!.coverage[ci]!.field_coverage = numOrNull(
                                    e.target.value,
                                  )),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            onClick={() => mutate((d) => d.products[idx]!.coverage.splice(ci, 1))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                An empty coverage cell stores as “no value” (—); use 0 for an editable zero.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
