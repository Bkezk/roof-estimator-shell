import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, Save } from "lucide-react";

import { getPricingScreen, savePricingScreen } from "@/lib/admin-pricing.functions";
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

const SCREEN_ID = "duro_last:adhesives";

const numOrNull = (v: string): number | null => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

interface CoverageRow {
  group: string;
  substrate: string;
  field_coverage: number | null;
}
interface AdhesiveProduct {
  name: string;
  price: number;
  unit_type: string;
  part_no: string;
  field_spacing: string;
  perim_spacing: string;
  coverage: CoverageRow[];
}
interface AdhesivesData {
  kind: "adhesives";
  master_label?: string;
  products: AdhesiveProduct[];
  help?: string;
  notes?: string;
  gaps?: string[];
}

const emptyProduct = (): AdhesiveProduct => ({
  name: "New Adhesive",
  price: 0,
  unit_type: "",
  part_no: "",
  field_spacing: "",
  perim_spacing: "",
  coverage: [],
});

export function AdhesivesTab() {
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

  const data = useMemo<AdhesivesData | null>(() => {
    if (draft) return draft;
    if (!row) return null;
    return row.data as unknown as AdhesivesData;
  }, [draft, row]);

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
      await saveFn({ data: { id: SCREEN_ID, data: data as unknown as Record<string, unknown> } });
      qc.setQueryData(["pricing-screen", SCREEN_ID], { ...row, data });
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
                mutate((d) => d.products.push(emptyProduct()));
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
