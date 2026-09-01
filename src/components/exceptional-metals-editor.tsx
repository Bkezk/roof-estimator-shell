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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const SCREEN_ID = "duro_last:exceptional_metals";

const num = (v: string) => (v.trim() === "" || v === "-" ? 0 : Number(v)) || 0;
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

interface CostRow {
  description: string | null;
  unit_cost: number;
  labor_per_unit_lf: number;
  labor_rate: number;
}
interface PartRow {
  description: string | null;
  part_no: string;
  price: number;
}
interface MetalsData {
  kind: "metals";
  subscreens: {
    gutters: {
      master_label: string;
      size_label: string;
      styles: string[];
      sizes_by_style: Record<string, string[]>;
      columns: string[];
      rows: CostRow[];
      captured_for: { style: string; size: string };
    };
    downspouts: {
      master_label: string;
      sizes: string[];
      size_grid: { columns: string[]; rows_by_size: Record<string, CostRow[]> };
      general_downspout: { columns: string[]; rows: CostRow[] };
    };
    pitch_pans: { columns: string[]; rows: CostRow[] };
    collection_boxes: {
      master_label: string;
      options: string[];
      columns: string[];
      rows_by_option: Record<string, CostRow[]>;
    };
    two_piece_metals: { columns: string[]; rows: PartRow[] };
  };
  help?: string;
  notes?: string;
  gaps?: string[];
}

const emptyCostRow = (): CostRow => ({
  description: "",
  unit_cost: 0,
  labor_per_unit_lf: 0,
  labor_rate: 0,
});
const emptyPartRow = (): PartRow => ({ description: "", part_no: "", price: 0 });

function CostGrid({ rows, onChange }: { rows: CostRow[]; onChange: (rows: CostRow[]) => void }) {
  const edit = (i: number, patch: Partial<CostRow>) => {
    const next = clone(rows);
    next[i] = { ...next[i]!, ...patch };
    onChange(next);
  };
  return (
    <div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead className="w-[16%]">Unit Cost</TableHead>
              <TableHead className="w-[18%]">Labor Per Unit/LF</TableHead>
              <TableHead className="w-[16%]">Labor Rate</TableHead>
              <TableHead className="w-[48px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Input
                    value={r.description ?? ""}
                    placeholder="(unlabeled)"
                    onChange={(e) => edit(i, { description: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={r.unit_cost}
                    onChange={(e) => edit(i, { unit_cost: num(e.target.value) })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={r.labor_per_unit_lf}
                    onChange={(e) => edit(i, { labor_per_unit_lf: num(e.target.value) })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={r.labor_rate}
                    onChange={(e) => edit(i, { labor_rate: num(e.target.value) })}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => onChange([...rows, emptyCostRow()])}
      >
        <Plus className="mr-1 h-4 w-4" /> Add row
      </Button>
    </div>
  );
}

export function ExceptionalMetalsTab() {
  const qc = useQueryClient();
  const getFn = useServerFn(getPricingScreen);
  const saveFn = useServerFn(savePricingScreen);
  const { data: row, isLoading } = useQuery({
    queryKey: ["pricing-screen", SCREEN_ID],
    queryFn: () => getFn({ data: { id: SCREEN_ID } }),
  });

  const [draft, setDraft] = useState<MetalsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [dsSize, setDsSize] = useState<string | null>(null);
  const [cbOption, setCbOption] = useState<string | null>(null);

  const data = useMemo<MetalsData | null>(() => {
    if (draft) return draft;
    if (!row) return null;
    return row.data as unknown as MetalsData;
  }, [draft, row]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading metals…</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">No Exceptional Metals data found.</p>;
  }

  const s = data.subscreens;
  const mutate = (fn: (d: MetalsData) => void) => {
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
      toast.success("Exceptional Metals saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const dsSizes = Object.keys(s.downspouts.size_grid.rows_by_size);
  const activeDsSize = dsSize ?? dsSizes[0] ?? "";
  const cbOptions = s.collection_boxes.options ?? Object.keys(s.collection_boxes.rows_by_option);
  const activeCbOption = cbOption ?? cbOptions[0] ?? "";

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || !draft}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <Tabs defaultValue="gutters" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="gutters">Gutters</TabsTrigger>
          <TabsTrigger value="downspouts">Downspouts</TabsTrigger>
          <TabsTrigger value="pitch_pans">Pitch Pans</TabsTrigger>
          <TabsTrigger value="collection_boxes">Collection Boxes</TabsTrigger>
          <TabsTrigger value="two_piece">Two Piece Metals</TabsTrigger>
        </TabsList>

        <TabsContent value="gutters">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gutters</CardTitle>
              <p className="text-xs text-muted-foreground">
                Priced grid captured for {s.gutters.captured_for.style} at{" "}
                {s.gutters.captured_for.size}. Styles: {s.gutters.styles.join(", ")}.
              </p>
            </CardHeader>
            <CardContent>
              <CostGrid
                rows={s.gutters.rows}
                onChange={(rows) => mutate((d) => (d.subscreens.gutters.rows = rows))}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="downspouts" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Downspouts — by size</CardTitle>
              <Select value={activeDsSize} onValueChange={setDsSize}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Size" />
                </SelectTrigger>
                <SelectContent>
                  {dsSizes.map((sz) => (
                    <SelectItem key={sz} value={sz}>
                      {sz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {activeDsSize && (
                <CostGrid
                  rows={s.downspouts.size_grid.rows_by_size[activeDsSize] ?? []}
                  onChange={(rows) =>
                    mutate(
                      (d) => (d.subscreens.downspouts.size_grid.rows_by_size[activeDsSize] = rows),
                    )
                  }
                />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">General Downspout accessories</CardTitle>
            </CardHeader>
            <CardContent>
              <CostGrid
                rows={s.downspouts.general_downspout.rows}
                onChange={(rows) =>
                  mutate((d) => (d.subscreens.downspouts.general_downspout.rows = rows))
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pitch_pans">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pitch Pans</CardTitle>
            </CardHeader>
            <CardContent>
              <CostGrid
                rows={s.pitch_pans.rows}
                onChange={(rows) => mutate((d) => (d.subscreens.pitch_pans.rows = rows))}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="collection_boxes">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Collection Boxes</CardTitle>
              <Select value={activeCbOption} onValueChange={setCbOption}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Scupper" />
                </SelectTrigger>
                <SelectContent>
                  {cbOptions.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {activeCbOption && (
                <CostGrid
                  rows={s.collection_boxes.rows_by_option[activeCbOption] ?? []}
                  onChange={(rows) =>
                    mutate(
                      (d) => (d.subscreens.collection_boxes.rows_by_option[activeCbOption] = rows),
                    )
                  }
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="two_piece">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Two Piece Metals</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-[20%]">Part #</TableHead>
                      <TableHead className="w-[18%]">Price</TableHead>
                      <TableHead className="w-[48px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.two_piece_metals.rows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Input
                            value={r.description ?? ""}
                            onChange={(e) =>
                              mutate(
                                (d) =>
                                  (d.subscreens.two_piece_metals.rows[i]!.description =
                                    e.target.value),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={r.part_no}
                            onChange={(e) =>
                              mutate(
                                (d) =>
                                  (d.subscreens.two_piece_metals.rows[i]!.part_no = e.target.value),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={r.price}
                            onChange={(e) =>
                              mutate(
                                (d) =>
                                  (d.subscreens.two_piece_metals.rows[i]!.price = num(
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
                            onClick={() =>
                              mutate(
                                (d) =>
                                  (d.subscreens.two_piece_metals.rows =
                                    d.subscreens.two_piece_metals.rows.filter((_, j) => j !== i)),
                              )
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() =>
                  mutate((d) => d.subscreens.two_piece_metals.rows.push(emptyPartRow()))
                }
              >
                <Plus className="mr-1 h-4 w-4" /> Add row
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
