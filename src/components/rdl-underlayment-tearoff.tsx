import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { getLaborTables, saveLaborTable } from "@/lib/admin-rdl.functions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const num = (v: string) => (v === "" || v === "-" ? 0 : Number(v)) || 0;
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

interface LayoutData {
  deck_columns: string[];
  fastening_times_min_per_fastener_by_deck: Record<string, number>;
  rows: { underlayment: string; layout_hours_per_2500sqft: number }[];
  fasteners_per_4x8_options?: { count: number; per_sqft: number; selected?: boolean }[];
}
interface AdhesiveData {
  adhesives: {
    adhesive: string;
    unit_type?: string;
    field_spacing?: number;
    perim_spacing?: number;
    rows: { substrate: string; coverage_sqft: number; labor: number }[];
  }[];
}
interface TearoffData {
  deck_columns: string[];
  rows: { tearoff_type: string; by_deck: Record<string, number> }[];
}

function useTables() {
  const getFn = useServerFn(getLaborTables);
  return useQuery({ queryKey: ["rdl-labor-tables"], queryFn: () => getFn() });
}

function SaveButton({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <div className="flex justify-end">
      <Button onClick={onSave} disabled={saving}>
        <Save className="mr-2 h-4 w-4" />
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

export function UnderlaymentEditor() {
  const qc = useQueryClient();
  const { data: tables, isLoading } = useTables();
  const saveFn = useServerFn(saveLaborTable);
  const [saving, setSaving] = useState(false);

  const layoutRow = tables?.find((t) => t.id === "underlayment_layout_mechanical");
  const adhRow = tables?.find((t) => t.id === "underlayment_adhesive_times");

  const [layout, setLayout] = useState<LayoutData | null>(null);
  const [adh, setAdh] = useState<AdhesiveData | null>(null);
  const [initId, setInitId] = useState<string | null>(null);
  const currentKey = (layoutRow?.id ?? "") + (adhRow?.id ?? "");
  if (layoutRow && adhRow && initId !== currentKey) {
    setLayout(clone(layoutRow.data as unknown as LayoutData));
    setAdh(clone(adhRow.data as unknown as AdhesiveData));
    setInitId(currentKey);
  }

  const [selAdh, setSelAdh] = useState(0);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!layout || !adh) return null;

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({
        data: { id: "underlayment_layout_mechanical", data: layout as never },
      });
      await saveFn({
        data: { id: "underlayment_adhesive_times", data: adh as never },
      });
      toast.success("Underlayment times saved");
      qc.invalidateQueries({ queryKey: ["rdl-labor-tables"] });
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const adhesive = adh.adhesives[selAdh]!;

  // Legacy: Labor = Layout Time + (min/fastener by deck) x # fasteners in 2,500 sq ft.
  // # fasteners comes from the selected fasteners-per-4'x8'-sheet option.
  const fastenerOpts = layout.fasteners_per_4x8_options ?? [];
  const selectedOpt = fastenerOpts.find((o) => o.selected) ?? fastenerOpts[0];
  const fastenersPer2500 = 2500 * (selectedOpt?.per_sqft ?? 0);
  const decks = layout.deck_columns;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="layout" className="space-y-4">
        <TabsList>
          <TabsTrigger value="layout">Layout &amp; Mechanical</TabsTrigger>
          <TabsTrigger value="adhesive">Adhesive Times</TabsTrigger>
        </TabsList>

        <TabsContent value="layout">
          <Card>
            <CardHeader>
              <CardTitle>Layout &amp; mechanical labor</CardTitle>
              <CardDescription>
                Labor = layout time + (time for one fastener by deck type) × # fasteners in 2,500
                sq ft. Gray per-deck hours are the calculated preview; layout hours and the
                minutes-per-fastener row are the editable inputs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {fastenerOpts.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm">Fasteners per 4&apos;x8&apos; sheet</Label>
                  <Select
                    value={String(selectedOpt?.count ?? "")}
                    onValueChange={(v) =>
                      setLayout((p) => {
                        const n = clone(p!);
                        n.fasteners_per_4x8_options = n.fasteners_per_4x8_options!.map((o) => ({
                          ...o,
                          selected: o.count === Number(v),
                        }));
                        return n;
                      })
                    }
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fastenerOpts.map((o) => (
                        <SelectItem key={o.count} value={String(o.count)}>
                          {o.count}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="max-h-[560px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background">Underlayment</TableHead>
                      <TableHead className="whitespace-nowrap">Layout (hr / 2,500 sq ft)</TableHead>
                      {decks.map((d) => (
                        <TableHead key={d} className="whitespace-nowrap text-center">
                          {d}
                        </TableHead>
                      ))}
                    </TableRow>
                    <TableRow>
                      <TableHead className="sticky left-0 whitespace-nowrap bg-background text-muted-foreground">
                        min / fastener →
                      </TableHead>
                      <TableHead />
                      {decks.map((d) => (
                        <TableHead key={d} className="text-center">
                          <Input
                            type="number"
                            step="0.001"
                            value={layout.fastening_times_min_per_fastener_by_deck[d] ?? 0}
                            onChange={(e) =>
                              setLayout((p) => {
                                const n = clone(p!);
                                n.fastening_times_min_per_fastener_by_deck[d] = num(
                                  e.target.value,
                                );
                                return n;
                              })
                            }
                            className="mx-auto w-20 text-center"
                          />
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {layout.rows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="sticky left-0 whitespace-nowrap bg-background font-medium">
                          {r.underlayment}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.001"
                            value={r.layout_hours_per_2500sqft}
                            onChange={(e) =>
                              setLayout((p) => {
                                const n = clone(p!);
                                n.rows[i]!.layout_hours_per_2500sqft = num(e.target.value);
                                return n;
                              })
                            }
                            className="w-24"
                          />
                        </TableCell>
                        {decks.map((d) => (
                          <TableCell
                            key={d}
                            className="text-center tabular-nums text-muted-foreground"
                          >
                            {(
                              r.layout_hours_per_2500sqft +
                              (fastenersPer2500 *
                                (layout.fastening_times_min_per_fastener_by_deck[d] ?? 0)) /
                                60
                            ).toFixed(2)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="adhesive">
          <Card>
            <CardHeader>
              <CardTitle>Adhesive coverage &amp; labor</CardTitle>
              <CardDescription>
                Field coverage (sq ft) and labor per substrate, per adhesive. A 0/0 row means the
                substrate doesn&apos;t apply to that adhesive.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm">Adhesive</Label>
                <Select value={String(selAdh)} onValueChange={(v) => setSelAdh(Number(v))}>
                  <SelectTrigger className="w-[320px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {adh.adhesives.map((a, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {a.adhesive}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(adhesive.unit_type ||
                  adhesive.field_spacing != null ||
                  adhesive.perim_spacing != null) && (
                  <p className="text-xs text-muted-foreground">
                    {adhesive.unit_type && <>Unit type: {adhesive.unit_type}</>}
                    {adhesive.field_spacing != null && (
                      <> · Field spacing: {adhesive.field_spacing}&quot;</>
                    )}
                    {adhesive.perim_spacing != null && (
                      <> · Perimeter spacing: {adhesive.perim_spacing}&quot;</>
                    )}
                  </p>
                )}
              </div>
              <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Substrate</TableHead>
                <TableHead>Coverage (sq ft)</TableHead>
                <TableHead>Labor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adhesive.rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.substrate}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={r.coverage_sqft}
                      onChange={(e) =>
                        setAdh((p) => {
                          const n = clone(p!);
                          n.adhesives[selAdh]!.rows[i]!.coverage_sqft = num(e.target.value);
                          return n;
                        })
                      }
                      className="max-w-[140px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.1"
                      value={r.labor}
                      onChange={(e) =>
                        setAdh((p) => {
                          const n = clone(p!);
                          n.adhesives[selAdh]!.rows[i]!.labor = num(e.target.value);
                          return n;
                        })
                      }
                      className="max-w-[120px]"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <SaveButton saving={saving} onSave={save} />
    </div>
  );
}

export function TearoffEditor() {
  const qc = useQueryClient();
  const { data: tables, isLoading } = useTables();
  const saveFn = useServerFn(saveLaborTable);
  const [saving, setSaving] = useState(false);

  const row = tables?.find((t) => t.id === "tearoff_times");
  const [t, setT] = useState<TearoffData | null>(null);
  const [initId, setInitId] = useState<string | null>(null);
  if (row && initId !== row.id) {
    setT(clone(row.data as unknown as TearoffData));
    setInitId(row.id);
  }

  const decks = useMemo(() => t?.deck_columns ?? [], [t]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!t) return null;

  const save = async () => {
    setSaving(true);
    try {
      await saveFn({ data: { id: "tearoff_times", data: t as never } });
      toast.success("Tearoff times saved");
      qc.invalidateQueries({ queryKey: ["rdl-labor-tables"] });
    } catch (e) {
      toast.error((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tearoff times</CardTitle>
          <CardDescription>
            Custom hours per 100 sq ft by tearoff type and deck. 0 means Bid-Advantage&apos;s
            built-in default applies. Type names ending in “…” were truncated in the old app.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background">Tearoff type</TableHead>
                {decks.map((d) => (
                  <TableHead key={d} className="whitespace-nowrap">
                    {d}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.rows.map((r, ri) => (
                <TableRow key={ri}>
                  <TableCell className="sticky left-0 bg-background font-medium">
                    {r.tearoff_type}
                  </TableCell>
                  {decks.map((d) => (
                    <TableCell key={d}>
                      <Input
                        type="number"
                        step="0.0001"
                        value={r.by_deck[d] ?? 0}
                        onChange={(e) =>
                          setT((p) => {
                            const n = clone(p!);
                            n.rows[ri]!.by_deck[d] = num(e.target.value);
                            return n;
                          })
                        }
                        className="w-20"
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <SaveButton saving={saving} onSave={save} />
    </div>
  );
}
